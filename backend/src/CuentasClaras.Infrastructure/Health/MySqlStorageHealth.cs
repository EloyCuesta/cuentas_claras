using CuentasClaras.Application.Health;
using CuentasClaras.Infrastructure.Common.MySql;

namespace CuentasClaras.Infrastructure.Health;

/// <summary>Consulta MySQL en cada petición: la versión aplicada que dice schema_migrations, no la del arranque.</summary>
public sealed class MySqlStorageHealth(MySqlDatabase database) : IStorageHealth
{
    public async Task<int> Check(CancellationToken cancellationToken)
    {
        var versions = await database.Rows("SELECT MAX(version) FROM schema_migrations WHERE applied_at IS NOT NULL", [],
            reader => reader.IsDBNull(0) ? (int?)null : reader.GetInt32(0), cancellationToken);
        return versions[0] ?? throw new InvalidOperationException("La base de datos no tiene ninguna migración aplicada.");
    }
}
