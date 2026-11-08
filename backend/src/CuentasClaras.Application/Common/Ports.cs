namespace CuentasClaras.Application.Common;

/// <summary>Reloj sustituible: evita esperas reales para caducidades y bloqueos.</summary>
public interface IClock
{
    long NowMs();

    /// <summary>nowISO de Express: el instante en UTC con milisegundos y «Z», como new Date().toISOString().</summary>
    string NowIso() => Instants.ToIso(NowMs());

    /// <summary>
    /// today de Express: la fecha local del servidor (AAAA-MM-DD). Solo es la reserva cuando el navegador no la manda:
    /// la fecha de hoy de verdad es la del navegador.
    /// </summary>
    string Today();
}

/// <summary>Instantes como los escribe JavaScript.</summary>
public static class Instants
{
    /// <summary>new Date(ms).toISOString(): «AAAA-MM-DDTHH:MM:SS.mmmZ», en UTC.</summary>
    public static string ToIso(long ms) =>
        DateTimeOffset.FromUnixTimeMilliseconds(ms).UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", System.Globalization.CultureInfo.InvariantCulture);
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

/// <summary>Atajos para el trabajo que no devuelve nada.</summary>
public static class UnitOfWorkExtensions
{
    public static Task Run(this IUnitOfWork unitOfWork, Func<Task> work, LockName? lockName = null, CancellationToken cancellationToken = default) =>
        unitOfWork.Run(async () =>
        {
            await work();
            return true;
        }, lockName, cancellationToken);
}
