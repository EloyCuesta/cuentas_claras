using CuentasClaras.Application.Common;
using CuentasClaras.Infrastructure.Common.MySql;
using MySqlConnector;

namespace CuentasClaras.Tests;

/// <summary>
/// Lo que los casos de uso darán por hecho de las transacciones (docs/arquitectura.md), como
/// server/common/mysql/MysqlUnitOfWork.test.ts: contra MySQL de verdad y, cuando hace falta, con dos conexiones.
/// </summary>
[Trait("Categoria", TestDatabase.Category)]
public sealed class MySqlUnitOfWorkTests
{
    private static CancellationToken Token => TestContext.Current.CancellationToken;

    /// <summary>Una base de prueba con una tabla t (x) y su unidad de trabajo; otro «proceso» si se pasa la misma base.</summary>
    private static async Task<Side> Setup(TestDatabase test)
    {
        var (database, _) = await test.Open();
        await database.Run("CREATE TABLE IF NOT EXISTS t (x INT NOT NULL) ENGINE=InnoDB", [], Token);
        return new Side(database, new MySqlUnitOfWork(database));
    }

    private sealed record Side(MySqlDatabase Database, MySqlUnitOfWork UnitOfWork)
    {
        public Task<int> Insert(int x) => Database.Run("INSERT INTO t (x) VALUES (?)", [x], Token);
        public Task<List<int>> Rows() => Database.Rows("SELECT x FROM t ORDER BY x", [], reader => reader.GetInt32(0), Token);
        public async Task<long> Count(string suffix = "") =>
            (await Database.Rows("SELECT COUNT(*) FROM t" + suffix, [], reader => reader.GetInt64(0), Token))[0];
    }

    [Fact]
    public async Task Guarda_todo_o_nada()
    {
        await using var test = await TestDatabase.Create();
        var side = await Setup(test);
        await Assert.ThrowsAsync<InvalidOperationException>(() => side.UnitOfWork.Run<int>(async () =>
        {
            await side.Insert(1);
            await side.Insert(2);
            throw new InvalidOperationException("fallo a mitad");
        }, cancellationToken: Token));
        Assert.Empty(await side.Rows());
        await side.UnitOfWork.Run(async () => await side.Insert(1) + await side.Insert(2), cancellationToken: Token);
        Assert.Equal([1, 2], await side.Rows());
    }

    [Fact]
    public async Task Se_confirma_al_terminar_el_trabajo_no_antes()
    {
        await using var test = await TestDatabase.Create();
        var side = await Setup(test);
        var other = await test.Connect();
        async Task<long> Seen() => (await MySqlCommands.Query(other, null, "SELECT COUNT(*) FROM t", [], reader => reader.GetInt64(0), Token))[0];
        var seenInside = await side.UnitOfWork.Run(async () =>
        {
            await side.Insert(1);
            await Task.Delay(50, Token);
            return await Seen();
        }, cancellationToken: Token);
        Assert.Equal(0, seenInside);
        Assert.Equal(1, await Seen());
    }

    [Fact]
    public async Task Las_anidadas_usan_la_misma_conexion_y_un_fallo_dentro_que_se_captura_solo_deshace_lo_de_dentro()
    {
        await using var test = await TestDatabase.Create();
        var side = await Setup(test);
        async Task<long> ConnectionId() => (await side.Database.Rows("SELECT CONNECTION_ID()", [], reader => reader.GetInt64(0), Token))[0];
        var ids = await side.UnitOfWork.Run(async () =>
        {
            await side.Insert(1);
            var outer = await ConnectionId();
            var inner = await side.UnitOfWork.Run(async () =>
            {
                await side.Insert(2);
                return await ConnectionId();
            }, LockName.Finance, Token);
            try
            {
                await side.UnitOfWork.Run<int>(async () =>
                {
                    await side.Insert(3);
                    throw new InvalidOperationException("fallo de dentro");
                }, cancellationToken: Token);
            }
            catch (InvalidOperationException)
            {
                // Quien llama decide seguir: solo se deshace el 3.
            }
            await side.Insert(4);
            return (outer, inner);
        }, cancellationToken: Token);
        Assert.Equal(ids.outer, ids.inner);
        Assert.Equal([1, 2, 4], await side.Rows());
    }

    [Fact]
    public async Task Fuera_de_una_transaccion_cada_consulta_va_al_pool_y_se_confirma_sola()
    {
        await using var test = await TestDatabase.Create();
        var side = await Setup(test);
        await side.Insert(1);
        var other = await test.Connect();
        Assert.Equal([1], await MySqlCommands.Query(other, null, "SELECT x FROM t", [], reader => reader.GetInt32(0), Token));
    }

    [Fact]
    public async Task Un_bloqueo_con_nombre_pone_en_serie_dos_operaciones_de_dos_conexiones_y_la_segunda_ve_lo_de_la_primera()
    {
        await using var test = await TestDatabase.Create();
        var first = await Setup(test);
        // Otro proceso: su propio pool contra la misma base.
        var second = await Setup(test);
        Task<long> ReadThenWrite(Side side, int value, LockName? lockName) => side.UnitOfWork.Run(async () =>
        {
            var count = await side.Count();
            await Task.Delay(100, Token);
            await side.Insert(value);
            return count;
        }, lockName, Token);
        // Sin bloqueo, las dos leen a la vez lo mismo.
        Assert.Equal(new long[] { 0, 0 }, await Task.WhenAll(ReadThenWrite(first, 1, null), ReadThenWrite(second, 2, null)));
        // Con el bloqueo, la segunda espera y ve lo que confirmó la primera.
        var seen = await Task.WhenAll(ReadThenWrite(first, 3, LockName.Finance), ReadThenWrite(second, 4, LockName.Finance));
        Assert.Equal([2L, 3L], seen.Order());
        Assert.Equal([1, 2, 3, 4], await first.Rows());
    }

    [Fact]
    public async Task El_bloqueo_va_el_primero_una_lectura_anterior_fija_una_instantanea_que_no_ve_lo_confirmado_despues()
    {
        await using var test = await TestDatabase.Create();
        var side = await Setup(test);
        var other = await test.Connect();
        var values = await side.UnitOfWork.Run(async () =>
        {
            var before = await side.Count();
            await MySqlCommands.Execute(other, null, "INSERT INTO t (x) VALUES (1)", [], Token);
            // Con REPEATABLE READ la instantánea ya está fijada: el bloqueo tardío no la cambia…
            await side.UnitOfWork.Run(() => Task.FromResult(0), LockName.Finance, Token);
            var after = await side.Count();
            // …aunque una lectura con bloqueo sí ve la fila confirmada.
            var current = await side.Count(" FOR UPDATE");
            return new[] { before, after, current };
        }, cancellationToken: Token);
        Assert.Equal([0L, 0L, 1L], values);
        // Tomado como primera sentencia, la transacción sí ve lo que otra conexión confirmó antes.
        await MySqlCommands.Execute(other, null, "INSERT INTO t (x) VALUES (2)", [], Token);
        Assert.Equal(2, await side.UnitOfWork.Run(() => side.Count(), LockName.Finance, Token));
    }

    [Fact]
    public async Task Si_falta_la_fila_del_bloqueo_lo_dice_en_vez_de_seguir_sin_bloquear()
    {
        await using var test = await TestDatabase.Create();
        var side = await Setup(test);
        await side.Database.Run("DELETE FROM app_locks WHERE name = 'finance'", [], Token);
        var error = await Assert.ThrowsAsync<InvalidOperationException>(
            () => side.UnitOfWork.Run(() => side.Insert(1), LockName.Finance, Token));
        Assert.Contains("Falta la fila «finance» en app_locks", error.Message);
        Assert.Empty(await side.Rows());
    }

    [Fact]
    public async Task Ante_un_interbloqueo_repite_la_operacion_completa_una_sola_vez()
    {
        await using var test = await TestDatabase.Create();
        var side = await Setup(test);
        var db = side.Database;
        await db.Run("CREATE TABLE d (id INT PRIMARY KEY, v INT NOT NULL) ENGINE=InnoDB", [], Token);
        await db.Run("INSERT INTO d (id, v) VALUES (1, 0), (2, 0), (3, 0), (4, 0), (5, 0)", [], Token);
        var other = await test.Connect();
        // La otra conexión cambia varias filas (la transacción «grande», que InnoDB no deshace) y retiene la 2.
        await using var otherTransaction = await other.BeginTransactionAsync(Token);
        await MySqlCommands.Execute(other, otherTransaction, "UPDATE d SET v = v + 10 WHERE id IN (2, 3, 4, 5)", [], Token);
        var firstLock = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var attempts = 0;
        var running = side.UnitOfWork.Run(async () =>
        {
            attempts++;
            await db.Rows("SELECT v FROM d WHERE id = 1 FOR UPDATE", [], reader => reader.GetInt32(0), Token);
            if (attempts == 1) firstLock.SetResult();
            await db.Rows("SELECT v FROM d WHERE id = 2 FOR UPDATE", [], reader => reader.GetInt32(0), Token);
            return await db.Run("UPDATE d SET v = v + 1 WHERE id IN (1, 2)", [], Token);
        }, cancellationToken: Token);
        await firstLock.Task;
        await Task.Delay(100, Token);
        // Ahora pide la 1, que tiene la transacción de la unidad de trabajo: el ciclo es un interbloqueo.
        await MySqlCommands.Query(other, otherTransaction, "SELECT v FROM d WHERE id = 1 FOR UPDATE", [], reader => reader.GetInt32(0), Token);
        await otherTransaction.CommitAsync(Token);
        await running;
        Assert.Equal(2, attempts);
        Assert.Equal([(1, 1), (2, 11), (3, 10), (4, 10), (5, 10)],
            await db.Rows("SELECT id, v FROM d ORDER BY id", [], reader => (reader.GetInt32(0), reader.GetInt32(1)), Token));
    }

    [Fact]
    public async Task Las_filas_de_productos_bloqueadas_en_orden_de_id_hacen_esperar_a_otra_conexion_hasta_confirmar()
    {
        await using var test = await TestDatabase.Create();
        var side = await Setup(test);
        await side.Database.Run(
            "INSERT INTO pantry_items (id, name, unit, quantity, target, frequency, created_at, updated_at) VALUES " +
            "('i1', 'Leche', 'l', 1, 2, 'semanal', 'x', 'x'), ('i2', 'Pan', 'ud', 0, 1, 'semanal', 'x', 'x')", [], Token);
        var other = await test.Connect();
        Task<long>? waiting = null;
        await side.UnitOfWork.Run(async () =>
        {
            // Como lockItems de la despensa: InnoDB bloquea según recorre la clave primaria, también con IN (...).
            await side.Database.Rows("SELECT id FROM pantry_items WHERE id IN (?, ?) ORDER BY id FOR UPDATE", ["i2", "i1"],
                reader => reader.GetString(0), Token);
            waiting = Task.Run(async () =>
            {
                await using var transaction = await other.BeginTransactionAsync(Token);
                await MySqlCommands.Query(other, transaction, "SELECT id FROM pantry_items WHERE id = ? FOR UPDATE", ["i1"],
                    reader => reader.GetString(0), Token);
                var quantity = (await MySqlCommands.Query(other, transaction, "SELECT quantity FROM pantry_items WHERE id = 'i1'", [],
                    reader => reader.GetDecimal(0), Token))[0];
                await transaction.CommitAsync(Token);
                return (long)quantity;
            }, Token);
            await Task.Delay(300, Token);
            Assert.False(waiting.IsCompleted);
            return await side.Database.Run("UPDATE pantry_items SET quantity = quantity + 1 WHERE id = 'i1'", [], Token);
        }, LockName.Tickets, Token);
        // La otra conexión entra al confirmar y ve la cantidad ya sumada.
        Assert.Equal(2, await waiting!);
    }
}
