using CuentasClaras.Application.Common;

namespace CuentasClaras.Infrastructure.Common;

/// <summary>UUID para nuevos registros, con el formato de crypto.randomUUID; no convierte IDs existentes.</summary>
public sealed class UuidGenerator : IIdGenerator
{
    public string NewId() => Guid.NewGuid().ToString("D");
}
