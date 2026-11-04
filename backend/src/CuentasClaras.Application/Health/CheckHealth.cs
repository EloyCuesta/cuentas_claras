namespace CuentasClaras.Application.Health;

/// <summary>Comprobación real del almacenamiento; una ausencia de implementación no representa una base sana.</summary>
public interface IStorageHealth
{
    /// <summary>La versión del esquema aplicada, leída del almacenamiento; lanza si no responde.</summary>
    Task<int> Check(CancellationToken cancellationToken);
}

/// <summary>Devuelve la versión comprobada del esquema, sin conocer el motor de datos.</summary>
public sealed class CheckHealth
{
    private readonly IStorageHealth storage;

    public CheckHealth(IStorageHealth storage) => this.storage = storage;

    public Task<int> Execute(CancellationToken cancellationToken) => storage.Check(cancellationToken);
}
