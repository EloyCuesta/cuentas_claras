using CuentasClaras.Application.Health;

namespace CuentasClaras.Infrastructure.Health;

/// <summary>BASE-02 no incorpora almacenamiento: falla explícitamente hasta disponer del adaptador de DATA-01.</summary>
public sealed class UnconfiguredStorageHealth : IStorageHealth
{
    public int Check() => throw new InvalidOperationException("El almacenamiento MySQL todavía no está configurado; pendiente de DATA-01.");
}
