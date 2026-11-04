using System.Data;
using CuentasClaras.Application.Common;

namespace CuentasClaras.Infrastructure.Common.MySql;

/// <summary>
/// Transacciones en MySQL, como server/common/mysql/MysqlUnitOfWork.ts: <see cref="Run{T}"/> guarda todo lo que hace
/// <c>work</c> o no guarda nada.
/// <list type="bullet">
/// <item>Una sola conexión por operación, de principio a fin, que se confirma cuando termina <c>work</c>. Dentro, las
/// consultas van en serie: una conexión no admite dos a la vez.</item>
/// <item>Anidadas: una llamada dentro de otra se une a la transacción exterior con un savepoint propio; si falla y quien la
/// llama lo captura, solo se deshace lo de dentro. Un bloqueo que pida y aún no esté tomado se toma ahí.</item>
/// <item>El bloqueo de app_locks es la primera sentencia: con REPEATABLE READ, la primera lectura fija lo que verá la
/// transacción. Las filas de productos se bloquean después, en orden de id (SELECT … ORDER BY id FOR UPDATE), en el
/// adaptador de la despensa.</item>
/// <item>Interbloqueo (1213): InnoDB ya ha deshecho todo; se repite la operación completa una sola vez, con otra conexión.</item>
/// </list>
/// </summary>
public sealed class MySqlUnitOfWork(MySqlDatabase database) : IUnitOfWork
{
    public async Task<T> Run<T>(Func<Task<T>> work, LockName? lockName = null, CancellationToken cancellationToken = default)
    {
        var name = lockName is { } value ? RowOf(value) : null;
        if (database.CurrentTransaction is { } current) return await Nested(current, work, name, cancellationToken);
        try
        {
            return await Transaction(work, name, cancellationToken);
        }
        catch (Exception error) when (MySqlErrors.IsDeadlock(error))
        {
            return await Transaction(work, name, cancellationToken);
        }
    }

    /// <summary>La fila de app_locks de cada zona (database/mysql/migrations/005-esquema-inicial.sql).</summary>
    public static string RowOf(LockName name) => name switch
    {
        LockName.Finance => "finance",
        LockName.Tickets => "tickets",
        _ => throw new ArgumentOutOfRangeException(nameof(name), name, "Zona de bloqueo desconocida."),
    };

    private async Task<T> Transaction<T>(Func<Task<T>> work, string? lockRow, CancellationToken cancellationToken)
    {
        await using var connection = await database.OpenConnection(cancellationToken);
        // Si work falla, DisposeAsync deshace lo que no se confirmó; una conexión rota no vuelve a usarse.
        await using var transaction = await connection.BeginTransactionAsync(IsolationLevel.RepeatableRead, cancellationToken);
        var context = new MySqlTransactionContext(connection, transaction);
        if (lockRow is not null) await TakeLock(context, lockRow, cancellationToken);
        var result = await database.WithTransaction(context, work);
        await transaction.CommitAsync(cancellationToken);
        return result;
    }

    private static async Task<T> Nested<T>(MySqlTransactionContext context, Func<Task<T>> work, string? lockRow, CancellationToken cancellationToken)
    {
        if (lockRow is not null && !context.Locks.Contains(lockRow)) await TakeLock(context, lockRow, cancellationToken);
        var savepoint = $"cc_anidada_{++context.Savepoints}";
        await MySqlCommands.Execute(context.Connection, context.Transaction, $"SAVEPOINT {savepoint}", [], cancellationToken);
        try
        {
            var result = await work();
            await MySqlCommands.Execute(context.Connection, context.Transaction, $"RELEASE SAVEPOINT {savepoint}", [], cancellationToken);
            return result;
        }
        catch (Exception error) when (!MySqlErrors.IsDeadlock(error))
        {
            // Tras un interbloqueo no queda transacción ni savepoint: lo repite la de fuera.
            try
            {
                await MySqlCommands.Execute(context.Connection, context.Transaction, $"ROLLBACK TO SAVEPOINT {savepoint}", [], CancellationToken.None);
            }
            catch (Exception)
            {
                // La conexión ya no responde: el error original es el que importa, y la transacción exterior se deshará.
            }
            throw;
        }
    }

    private static async Task TakeLock(MySqlTransactionContext context, string row, CancellationToken cancellationToken)
    {
        var found = await MySqlCommands.Query(context.Connection, context.Transaction,
            "SELECT name FROM app_locks WHERE name = ? FOR UPDATE", [row], reader => reader.GetString(0), cancellationToken);
        if (found.Count != 1)
            throw new InvalidOperationException(
                $"Falta la fila «{row}» en app_locks: la base de datos no tiene el esquema completo (database/mysql/migrations).");
        context.Locks.Add(row);
    }
}
