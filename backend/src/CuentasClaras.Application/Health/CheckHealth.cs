namespace CuentasClaras.Application.Health;

/// <summary>Comprobación real del almacenamiento; una ausencia de implementación no representa una base sana.</summary>
public interface IStorageHealth
{
    int Check();
}

/// <summary>Devuelve la versión comprobada del esquema, sin conocer el motor de datos.</summary>
public sealed class CheckHealth
{
    private readonly IStorageHealth storage;

    public CheckHealth(IStorageHealth storage) => this.storage = storage;

    public int Execute() => storage.Check();
}
