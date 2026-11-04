using CuentasClaras.Application.Health;

namespace CuentasClaras.Infrastructure.Health;

/// <summary>Host solo de acceso (sin CUENTAS_DB_USER): falla explícitamente en lugar de inventar una versión.</summary>
public sealed class UnconfiguredStorageHealth : IStorageHealth
{
    public Task<int> Check(CancellationToken cancellationToken) =>
        throw new InvalidOperationException("El almacenamiento MySQL no está configurado: falta CUENTAS_DB_USER.");
}
