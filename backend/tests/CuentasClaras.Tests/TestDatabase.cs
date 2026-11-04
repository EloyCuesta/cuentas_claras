using System.Security.Cryptography;
using CuentasClaras.Application.Common;
using CuentasClaras.Infrastructure.Common.MySql;
using CuentasClaras.Infrastructure.Finance;
using MySqlConnector;

namespace CuentasClaras.Tests;

/// <summary>
/// Una base MySQL de pruebas, como server/common/testing/testDatabase.ts: se llama cuentas_test_&lt;aleatorio&gt;, se crea
/// con CUENTAS_DB_HOST, CUENTAS_DB_PORT, CUENTAS_DB_USER y CUENTAS_DB_PASSWORD del entorno (sin mirar CUENTAS_DB_NAME)
/// y se borra al terminar. Nunca usa cuentas_claras. Sin MySQL, la prueba falla con un mensaje claro: no se salta.
/// </summary>
internal sealed class TestDatabase : IAsyncDisposable
{
    public const string Category = "MySql";
    private readonly List<IAsyncDisposable> opened = [];

    public string Name { get; }
    public MySqlSettings Settings { get; }

    private TestDatabase(string name, MySqlSettings settings)
    {
        Name = name;
        Settings = settings;
    }

    public static async Task<TestDatabase> Create()
    {
        var name = "cuentas_test_" + Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(8));
        var server = Server();
        await using (var admin = await Admin(server))
            // El nombre lo genera esta clase (prefijo y hexadecimal): no lleva datos de nadie.
            await MySqlCommands.Execute(admin, null, $"CREATE DATABASE `{name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin", [],
                TestContext.Current.CancellationToken);
        return new TestDatabase(name, server with { Database = name });
    }

    /// <summary>El servidor de las pruebas, como lo leería el host, con otra base.</summary>
    public static MySqlSettings Server(string database = "information_schema")
    {
        var user = Environment.GetEnvironmentVariable("CUENTAS_DB_USER")?.Trim();
        if (string.IsNullOrEmpty(user))
            throw new InvalidOperationException(
                "Las pruebas de MySQL necesitan CUENTAS_DB_USER y CUENTAS_DB_PASSWORD en el entorno (el host .NET no lee .env), " +
                "con un usuario que pueda crear y borrar las bases cuentas_test_% (README, «Pruebas»).");
        var port = Environment.GetEnvironmentVariable("CUENTAS_DB_PORT")?.Trim();
        return new MySqlSettings(
            Environment.GetEnvironmentVariable("CUENTAS_DB_HOST")?.Trim() is { Length: > 0 } host ? host : MySqlSettings.DefaultHost,
            string.IsNullOrEmpty(port) ? MySqlSettings.DefaultPort : int.Parse(port, System.Globalization.CultureInfo.InvariantCulture),
            user, Environment.GetEnvironmentVariable("CUENTAS_DB_PASSWORD") ?? "", database);
    }

    /// <summary>Las variables CUENTAS_DB_* de esta base, para el host configurado.</summary>
    public Func<string, string?> Variables() => name => name switch
    {
        "CUENTAS_DB_HOST" => Settings.Host,
        "CUENTAS_DB_PORT" => Settings.Port.ToString(System.Globalization.CultureInfo.InvariantCulture),
        "CUENTAS_DB_USER" => Settings.User,
        "CUENTAS_DB_PASSWORD" => Settings.Password,
        "CUENTAS_DB_NAME" => Name,
        _ => null,
    };

    /// <summary>Abre (y migra) la base como el host: con las categorías iniciales, salvo que se pida otra cosa.</summary>
    public async Task<(MySqlDatabase Database, int SchemaVersion)> Open(IClock? clock = null, bool seed = true,
        IReadOnlyList<MySqlMigration>? migrations = null)
    {
        var result = await MySqlDatabase.Open(Settings,
            new MigrationOptions(clock ?? new FixedClock(), seed ? DefaultCategorySeed.Insert : null, migrations),
            TestContext.Current.CancellationToken);
        opened.Add(result.Database);
        return result;
    }

    /// <summary>Otra conexión suelta a esta base, con la sesión de la aplicación: «otro proceso» o para mirar.</summary>
    public async Task<MySqlConnection> Connect()
    {
        var database = new MySqlDatabase(Settings);
        opened.Add(database);
        var connection = await database.OpenConnection(TestContext.Current.CancellationToken);
        opened.Add(connection);
        return connection;
    }

    public async Task<List<T>> Query<T>(string sql, Func<MySqlDataReader, T> map, params object?[] parameters)
    {
        var connection = await Connect();
        return await MySqlCommands.Query(connection, null, sql, parameters, map, TestContext.Current.CancellationToken);
    }

    public async Task<object?> Scalar(string sql, params object?[] parameters) =>
        (await Query(sql, reader => reader.IsDBNull(0) ? null : reader.GetValue(0), parameters))[0];

    public async Task<IReadOnlyList<string>> Tables() => await Query(
        "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME", reader => reader.GetString(0));

    public async ValueTask DisposeAsync()
    {
        for (var index = opened.Count - 1; index >= 0; index--) await opened[index].DisposeAsync();
        await using var admin = await Admin(Server());
        await MySqlCommands.Execute(admin, null, $"DROP DATABASE IF EXISTS `{Name}`", [], CancellationToken.None);
    }

    private static async Task<MySqlConnection> Admin(MySqlSettings server)
    {
        var builder = new MySqlConnectionStringBuilder
        {
            Server = server.Host, Port = (uint)server.Port, UserID = server.User, Password = server.Password, Pooling = false,
        };
        var connection = new MySqlConnection(builder.ConnectionString);
        try
        {
            await connection.OpenAsync(TestContext.Current.CancellationToken);
            return connection;
        }
        catch (MySqlException error)
        {
            await connection.DisposeAsync();
            throw new InvalidOperationException(
                $"Las pruebas necesitan MySQL y no se puede conectar con {server.User}@{server.Host}:{server.Port} ({error.ErrorCode}). " +
                "Arranca MySQL Server y revisa CUENTAS_DB_HOST, CUENTAS_DB_PORT, CUENTAS_DB_USER y CUENTAS_DB_PASSWORD (README, «Pruebas»).", error);
        }
    }
}

/// <summary>Reloj fijo de las pruebas: started_at y applied_at deterministas.</summary>
internal sealed class FixedClock(long now = 1_793_736_000_000) : IClock
{
    public long Now { get; set; } = now;
    public long NowMs() => Now;
}
