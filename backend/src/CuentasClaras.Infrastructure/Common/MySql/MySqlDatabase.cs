using MySqlConnector;

namespace CuentasClaras.Infrastructure.Common.MySql;

/// <summary>
/// La conexión con MySQL, como server/common/mysql/MysqlDatabase.ts: un pool de MySqlConnector y la transacción en curso.
/// <list type="bullet">
/// <item>Cada conexión que sale del pool fija su sesión (<see cref="SessionSetup"/>): utf8mb4_0900_bin también para los
/// textos sueltos, modo estricto y REPEATABLE READ, aunque el servidor tenga otros valores. El pool reinicia la sesión
/// al devolverla, así que se fija en cada apertura.</item>
/// <item>Parámetros posicionales «?»: texto, números finitos o null; nunca una fecha de .NET, que arrastra hora y zona.
/// Las fechas de calendario viajan como texto AAAA-MM-DD y se leen con <see cref="MySqlRead.Date"/>.</item>
/// <item>Dentro de <see cref="MySqlUnitOfWork"/>, <see cref="Rows{T}"/> y <see cref="Run"/> usan la conexión de esa
/// transacción; fuera, una conexión del pool por sentencia.</item>
/// </list>
/// </summary>
public sealed class MySqlDatabase : IDisposable, IAsyncDisposable
{
    public const string SessionSetup =
        "SET character_set_client = utf8mb4, character_set_connection = utf8mb4, character_set_results = utf8mb4, " +
        "collation_connection = utf8mb4_0900_bin, " +
        "sql_mode = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION', " +
        "transaction_isolation = 'REPEATABLE-READ'";

    private readonly MySqlDataSource source;
    private readonly AsyncLocal<MySqlTransactionContext?> current = new();

    public MySqlSettings Settings { get; }

    public MySqlDatabase(MySqlSettings settings)
    {
        Settings = settings;
        var connection = new MySqlConnectionStringBuilder
        {
            Server = settings.Host,
            Port = (uint)settings.Port,
            UserID = settings.User,
            Password = settings.Password,
            Database = settings.Database,
            CharacterSet = "utf8mb4",
            Pooling = true,
            MaximumPoolSize = 10,
            ConnectionIdleTimeout = 60,
            ConnectionTimeout = 10,
            ConnectionReset = true,
            // Los TINYINT 0/1 se leen como números, como en SQLite y Express; un CHAR(36) sigue siendo texto.
            TreatTinyAsBoolean = false,
            GuidFormat = MySqlGuidFormat.None,
            // Filas encontradas, aunque no cambien: lo mismo que cuenta mysql2.
            UseAffectedRows = false,
            AllowUserVariables = false,
            AllowLoadLocalInfile = false,
            AutoEnlist = false,
            PersistSecurityInfo = false,
        };
        source = new MySqlDataSource(connection.ConnectionString);
    }

    /// <summary>
    /// Conecta, comprueba que responde y aplica las migraciones pendientes de database/mysql/. Si algo falla, cierra el
    /// pool y lanza <see cref="DatabaseSetupException"/> con lo que hay que revisar, sin la contraseña.
    /// </summary>
    public static async Task<(MySqlDatabase Database, int SchemaVersion)> Open(
        MySqlSettings settings, MigrationOptions options, CancellationToken cancellationToken = default)
    {
        var database = new MySqlDatabase(settings);
        try
        {
            await database.Ping(cancellationToken);
            var version = await MySqlMigrations.Run(database, options, cancellationToken);
            return (database, version);
        }
        catch (Exception error)
        {
            await database.DisposeAsync();
            if (error is OperationCanceledException) throw;
            throw new DatabaseSetupException(MySqlErrors.Explain(error, settings), error);
        }
    }

    /// <summary>Filas de una consulta, con parámetros.</summary>
    public Task<List<T>> Rows<T>(string sql, IReadOnlyList<object?> parameters, Func<MySqlDataReader, T> map,
        CancellationToken cancellationToken = default) =>
        WithConnection(context => MySqlCommands.Query(context.Connection, context.Transaction, sql, parameters, map, cancellationToken), cancellationToken);

    /// <summary>Una sentencia que escribe; devuelve las filas encontradas.</summary>
    public Task<int> Run(string sql, IReadOnlyList<object?> parameters, CancellationToken cancellationToken = default) =>
        WithConnection(context => MySqlCommands.Execute(context.Connection, context.Transaction, sql, parameters, cancellationToken), cancellationToken);

    /// <summary>SELECT 1: lanza si MySQL no responde.</summary>
    public Task Ping(CancellationToken cancellationToken = default) => Rows("SELECT 1", [], reader => reader.GetInt32(0), cancellationToken);

    /// <summary>Una conexión del pool con su sesión ya fijada.</summary>
    public async Task<MySqlConnection> OpenConnection(CancellationToken cancellationToken = default)
    {
        var connection = await source.OpenConnectionAsync(cancellationToken);
        try
        {
            await MySqlCommands.Execute(connection, null, SessionSetup, [], cancellationToken);
            return connection;
        }
        catch
        {
            await connection.DisposeAsync();
            throw;
        }
    }

    internal MySqlTransactionContext? CurrentTransaction => current.Value;

    /// <summary>Ejecuta <paramref name="work"/> con <paramref name="context"/> como transacción en curso (lo usa MySqlUnitOfWork).</summary>
    internal async Task<T> WithTransaction<T>(MySqlTransactionContext context, Func<Task<T>> work)
    {
        var previous = current.Value;
        current.Value = context;
        try
        {
            return await work();
        }
        finally
        {
            current.Value = previous;
        }
    }

    public void Dispose() => source.Dispose();

    public ValueTask DisposeAsync() => source.DisposeAsync();

    private async Task<T> WithConnection<T>(Func<MySqlTransactionContext, Task<T>> action, CancellationToken cancellationToken)
    {
        if (current.Value is { } transaction) return await action(transaction);
        await using var connection = await OpenConnection(cancellationToken);
        return await action(new MySqlTransactionContext(connection, null));
    }
}

/// <summary>Lo que guarda la transacción en curso; una sola conexión, usada en serie.</summary>
internal sealed class MySqlTransactionContext(MySqlConnection connection, MySqlTransaction? transaction)
{
    public MySqlConnection Connection { get; } = connection;
    public MySqlTransaction? Transaction { get; } = transaction;
    /// <summary>Filas de app_locks ya tomadas en esta transacción.</summary>
    public HashSet<string> Locks { get; } = [];
    /// <summary>Para nombrar los savepoints de las llamadas anidadas.</summary>
    public int Savepoints { get; set; }
}

/// <summary>Sentencias sueltas sobre una conexión: siempre con parámetros posicionales comprobados.</summary>
public static class MySqlCommands
{
    public static async Task<int> Execute(MySqlConnection connection, MySqlTransaction? transaction, string sql,
        IReadOnlyList<object?> parameters, CancellationToken cancellationToken = default)
    {
        await using var command = Command(connection, transaction, sql, parameters);
        return await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public static async Task<List<T>> Query<T>(MySqlConnection connection, MySqlTransaction? transaction, string sql,
        IReadOnlyList<object?> parameters, Func<MySqlDataReader, T> map, CancellationToken cancellationToken = default)
    {
        await using var command = Command(connection, transaction, sql, parameters);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var rows = new List<T>();
        while (await reader.ReadAsync(cancellationToken)) rows.Add(map(reader));
        return rows;
    }

    private static MySqlCommand Command(MySqlConnection connection, MySqlTransaction? transaction, string sql, IReadOnlyList<object?> parameters)
    {
        var command = new MySqlCommand(sql, connection, transaction);
        foreach (var value in parameters) command.Parameters.Add(new MySqlParameter { Value = Checked(value) });
        return command;
    }

    private static object Checked(object? value) => value switch
    {
        null => DBNull.Value,
        string or int or long or decimal => value,
        double number when double.IsFinite(number) => number,
        _ => throw new ArgumentException(
            $"Parámetro SQL no admitido ({value.GetType().Name}): usa texto, un número finito o null; las fechas, como texto AAAA-MM-DD."),
    };
}

/// <summary>Lectura de columnas con los tipos del esquema (docs/migration/DATA.md).</summary>
public static class MySqlRead
{
    public static string Text(MySqlDataReader reader, string column) => reader.GetString(reader.GetOrdinal(column));

    public static string? NullableText(MySqlDataReader reader, string column) =>
        reader.IsDBNull(reader.GetOrdinal(column)) ? null : reader.GetString(reader.GetOrdinal(column));

    /// <summary>Céntimos y demás enteros (BIGINT, INT, TINYINT) como long.</summary>
    public static long Integer(MySqlDataReader reader, string column) => reader.GetInt64(reader.GetOrdinal(column));

    public static long? NullableInteger(MySqlDataReader reader, string column) =>
        reader.IsDBNull(reader.GetOrdinal(column)) ? null : reader.GetInt64(reader.GetOrdinal(column));

    /// <summary>DECIMAL exacto: milésimas de cantidades y pesos, sin pasar por double.</summary>
    public static decimal Decimal(MySqlDataReader reader, string column) => reader.GetDecimal(reader.GetOrdinal(column));

    public static decimal? NullableDecimal(MySqlDataReader reader, string column) =>
        reader.IsDBNull(reader.GetOrdinal(column)) ? null : reader.GetDecimal(reader.GetOrdinal(column));

    /// <summary>Un DATE como AAAA-MM-DD: el mismo día del calendario, sin hora ni zona horaria del equipo.</summary>
    public static string Date(MySqlDataReader reader, string column) =>
        reader.GetFieldValue<DateOnly>(reader.GetOrdinal(column)).ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);

    public static string? NullableDate(MySqlDataReader reader, string column) =>
        reader.IsDBNull(reader.GetOrdinal(column)) ? null : Date(reader, column);
}
