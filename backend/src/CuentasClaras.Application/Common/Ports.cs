namespace CuentasClaras.Application.Common;

/// <summary>Reloj sustituible: evita esperas reales para caducidades y bloqueos.</summary>
public interface IClock
{
    long NowMs();
}

/// <summary>IDs nuevos; no impone formato ni transforma los IDs de datos existentes.</summary>
public interface IIdGenerator
{
    string NewId();
}

/// <summary>Zonas cuyas escrituras van en serie: cada una es una fila de app_locks.</summary>
public enum LockName
{
    Finance,
    Tickets,
}

/// <summary>
/// Una operación que escribe guarda todo o nada. El bloqueo de su zona se toma antes que cualquier lectura;
/// una llamada dentro de otra se une a la transacción exterior y, si falla, solo deshace lo suyo.
/// </summary>
public interface IUnitOfWork
{
    Task<T> Run<T>(Func<Task<T>> work, LockName? lockName = null, CancellationToken cancellationToken = default);
}
