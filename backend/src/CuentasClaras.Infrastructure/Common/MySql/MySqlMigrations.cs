using System.Data;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using CuentasClaras.Application.Common;
using MySqlConnector;

namespace CuentasClaras.Infrastructure.Common.MySql;

/// <summary>Una migración de database/mysql/migrations/: NNN-que-hace.sql, con su versión y sus sentencias.</summary>
public sealed record MySqlMigration(int Version, string Name, string File, IReadOnlyList<string> Statements);

/// <summary>
/// Cómo se prepara una base. <paramref name="SeedNewDatabase"/> crea los datos iniciales solo en una base nueva, en la
/// transacción que completa la migración que crea sus tablas; null no siembra nada (lo que hace el importador).
/// <paramref name="Migrations"/> sustituye la lista incrustada: solo para probar una migración que falla a medias.
/// </summary>
public sealed record MigrationOptions(
    IClock Clock,
    Func<MySqlConnection, MySqlTransaction, CancellationToken, Task>? SeedNewDatabase = null,
    IReadOnlyList<MySqlMigration>? Migrations = null);

/// <summary>
/// Las migraciones de MySQL, con las mismas reglas que server/common/mysql/migrations.ts y sobre los mismos archivos,
/// incrustados en este ensamblado: el mismo historial (schema_migrations) sirve a Express y a .NET.
/// <list type="bullet">
/// <item>Dos arranques a la vez no migran a la vez: GET_LOCK con la misma clave que Express.</item>
/// <item>El DDL de MySQL se confirma solo: antes de empezar se anota la migración sin applied_at y al terminar se
/// completa. Una fila sin applied_at es una migración a medias: se explica y no se continúa.</item>
/// <item>Una base de una versión más nueva, o con tablas pero sin historial, no se toca.</item>
/// </list>
/// </summary>
public static partial class MySqlMigrations
{
    /// <summary>La versión cuya migración crea las categorías: tras ella se siembran en una base nueva.</summary>
    public const int SeedVersion = 5;
    private const string Prefix = "database/mysql/";

    public static IReadOnlyList<MySqlMigration> All { get; } = Load();
    public static int LatestVersion => All.Count == 0 ? 0 : All[^1].Version;
    private static readonly IReadOnlyList<string> HistoryStatements = SplitStatements(ReadEmbedded("schema_migrations.sql"));

    /// <summary>El texto de un archivo incrustado («schema_migrations.sql», «migrations/005-esquema-inicial.sql»), con saltos \n.</summary>
    public static string ReadEmbedded(string file)
    {
        using var stream = typeof(MySqlMigrations).Assembly.GetManifestResourceStream(Prefix + file)
            ?? throw new InvalidOperationException($"Falta {Prefix}{file} en el ensamblado de Infrastructure.");
        using var reader = new StreamReader(stream, Encoding.UTF8);
        return reader.ReadToEnd().Replace("\r\n", "\n", StringComparison.Ordinal);
    }

    /// <summary>Los archivos incrustados, relativos a database/mysql/.</summary>
    public static IReadOnlyList<string> EmbeddedFiles() =>
        [.. typeof(MySqlMigrations).Assembly.GetManifestResourceNames()
            .Where(name => name.StartsWith(Prefix, StringComparison.Ordinal))
            .Select(name => name[Prefix.Length..]).Order(StringComparer.Ordinal)];

    /// <summary>
    /// Las sentencias de un archivo .sql: quita las líneas de comentario («--» al principio) y corta en cada «;» al
    /// final de una línea. Lanza si algo queda sin «;».
    /// </summary>
    public static IReadOnlyList<string> SplitStatements(string sql)
    {
        var statements = new List<string>();
        var current = new List<string>();
        foreach (var line in sql.Replace("\r\n", "\n", StringComparison.Ordinal).Split('\n'))
        {
            if (Comment().IsMatch(line)) continue;
            current.Add(line);
            if (!EndOfStatement().IsMatch(line)) continue;
            var statement = EndOfStatement().Replace(string.Join('\n', current), "").Trim();
            if (statement.Length > 0) statements.Add(statement);
            current.Clear();
        }
        var rest = string.Join('\n', current).Trim();
        if (rest.Length > 0) throw new InvalidOperationException($"Falta el «;» final de una sentencia: «{rest[..Math.Min(60, rest.Length)]}…»");
        return statements;
    }

    /// <summary>La clave de GET_LOCK de una base: la misma que calcula Express, para que no migren a la vez.</summary>
    public static string LockKey(string database) =>
        "cuentas_claras_migraciones_" + Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(database)))[..24];

    /// <summary>Aplica las migraciones pendientes y devuelve la versión del esquema.</summary>
    public static async Task<int> Run(MySqlDatabase database, MigrationOptions options, CancellationToken cancellationToken = default)
    {
        await using var connection = await database.OpenConnection(cancellationToken);
        var key = LockKey(database.Settings.Database);
        // GET_LOCK es por sesión y por servidor: la clave incluye la base.
        var got = await Scalar(connection, null, "SELECT GET_LOCK(?, 60)", [key], cancellationToken);
        if (got is not 1L and not 1)
            throw new DatabaseSetupException(
                $"Otro proceso lleva más de un minuto preparando la base de datos «{database.Settings.Database}». Ciérralo y vuelve a arrancar.");
        try
        {
            return await Migrate(connection, database.Settings.Database, options, cancellationToken);
        }
        finally
        {
            await Scalar(connection, null, "SELECT RELEASE_LOCK(?)", [key], CancellationToken.None);
        }
    }

    private static async Task<int> Migrate(MySqlConnection connection, string database, MigrationOptions options, CancellationToken cancellationToken)
    {
        var migrations = options.Migrations ?? All;
        var latest = migrations.Count == 0 ? 0 : migrations[^1].Version;
        var names = await MySqlCommands.Query(connection, null,
            "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME",
            [], reader => reader.GetString(0), cancellationToken);
        var foreign = names.Where(name => name != "schema_migrations").ToList();
        if (!names.Contains("schema_migrations") && foreign.Count > 0) throw WithoutHistory(database, foreign);
        foreach (var statement in HistoryStatements) await MySqlCommands.Execute(connection, null, statement, [], cancellationToken);

        var history = await MySqlCommands.Query(connection, null,
            "SELECT version, name, started_at, applied_at FROM schema_migrations ORDER BY version", [],
            reader => (Version: reader.GetInt32(0), Name: reader.GetString(1), StartedAt: reader.GetString(2),
                AppliedAt: reader.IsDBNull(3) ? null : reader.GetString(3)), cancellationToken);
        var unfinished = history.FirstOrDefault(row => row.AppliedAt is null);
        if (unfinished != default)
            throw new DatabaseSetupException(
                $"La migración {unfinished.Version} («{unfinished.Name}») empezó el {unfinished.StartedAt} y no terminó. " +
                $"El DDL de MySQL se confirma solo, así que la base «{database}» puede tener solo parte de sus cambios, y no se continúa. " +
                "Restaura la copia de la base o, si era nueva, bórrala y créala vacía otra vez (README, «Preparar MySQL»).");
        if (history.Count == 0 && foreign.Count > 0) throw WithoutHistory(database, foreign);
        var newest = history.Count == 0 ? 0 : history.Max(row => row.Version);
        if (newest > latest)
            throw new DatabaseSetupException(
                $"La base de datos «{database}» es de una versión más nueva de Cuentas claras (esquema {newest}). Actualiza la aplicación antes de abrirla.");

        var isNew = history.Count == 0;
        foreach (var migration in migrations)
        {
            if (migration.Version <= newest) continue;
            await MySqlCommands.Execute(connection, null,
                "INSERT INTO schema_migrations (version, name, started_at, applied_at) VALUES (?, ?, ?, NULL)",
                [migration.Version, migration.Name, Now(options.Clock)], cancellationToken);
            for (var index = 0; index < migration.Statements.Count; index++)
            {
                try
                {
                    await MySqlCommands.Execute(connection, null, migration.Statements[index], [], cancellationToken);
                }
                catch (MySqlException error)
                {
                    throw new DatabaseSetupException(
                        $"La migración {migration.Version} («{migration.Name}») ha fallado en la sentencia {index + 1} de {migration.Statements.Count}: " +
                        $"{error.Message}. Ha quedado a medias en «{database}»: corrige la causa y vuelve a empezar con una base vacía.", error);
                }
            }
            await using var transaction = await connection.BeginTransactionAsync(IsolationLevel.RepeatableRead, cancellationToken);
            if (isNew && options.SeedNewDatabase is { } seed && migration.Version == SeedVersion)
                await seed(connection, transaction, cancellationToken);
            await MySqlCommands.Execute(connection, transaction, "UPDATE schema_migrations SET applied_at = ? WHERE version = ?",
                [Now(options.Clock), migration.Version], cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        return latest;
    }

    private static DatabaseSetupException WithoutHistory(string database, IEnumerable<string> tables) => new(
        $"La base de datos «{database}» tiene tablas ({string.Join(", ", tables)}) pero no el historial de Cuentas claras (schema_migrations): " +
        "no se aplica el esquema encima. Usa una base vacía para la aplicación.");

    /// <summary>El instante como lo escribe Express (toISOString): «2026-11-04T17:13:15.121Z».</summary>
    private static string Now(IClock clock) =>
        DateTimeOffset.FromUnixTimeMilliseconds(clock.NowMs()).UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);

    private static async Task<object?> Scalar(MySqlConnection connection, MySqlTransaction? transaction, string sql,
        IReadOnlyList<object?> parameters, CancellationToken cancellationToken)
    {
        var rows = await MySqlCommands.Query(connection, transaction, sql, parameters,
            reader => reader.IsDBNull(0) ? null : reader.GetValue(0), cancellationToken);
        return rows.Count == 0 ? null : rows[0];
    }

    private static IReadOnlyList<MySqlMigration> Load() =>
        [.. EmbeddedFiles().Where(file => file.StartsWith("migrations/", StringComparison.Ordinal)).Select(file =>
        {
            var name = file["migrations/".Length..];
            var match = MigrationFile().Match(name);
            if (!match.Success) throw new InvalidOperationException($"Nombre de migración no válido: {name} (debe ser NNN-que-hace.sql)");
            return new MySqlMigration(int.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture),
                match.Groups[2].Value.Replace('-', ' '), name, SplitStatements(ReadEmbedded(file)));
        })];

    [GeneratedRegex(@"^\s*--")]
    private static partial Regex Comment();

    [GeneratedRegex(@";\s*\z")]
    private static partial Regex EndOfStatement();

    [GeneratedRegex(@"^(\d{3})-([a-z0-9]+(?:-[a-z0-9]+)*)\.sql\z")]
    private static partial Regex MigrationFile();
}
