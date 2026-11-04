using CuentasClaras.Application.Common;
using CuentasClaras.Domain.Finance;
using CuentasClaras.Infrastructure.Common.MySql;
using MySqlConnector;

namespace CuentasClaras.Infrastructure.Finance;

/// <summary>Las categorías iniciales de una base nueva, como hace Express al migrar; el importador no las crea.</summary>
public static class DefaultCategorySeed
{
    /// <summary>Las opciones del arranque de la aplicación: migrar y, en una base nueva, sembrar las categorías.</summary>
    public static MigrationOptions Options(IClock clock) => new(clock, Insert);

    public static async Task Insert(MySqlConnection connection, MySqlTransaction transaction, CancellationToken cancellationToken)
    {
        // Las principales van antes que sus subcategorías (clave foránea parent_id).
        foreach (var category in DefaultCategories.All)
            await MySqlCommands.Execute(connection, transaction,
                "INSERT INTO categories (id, name, type, parent_id, order_index, budget_cents) VALUES (?, ?, ?, ?, ?, ?)",
                [category.Id, category.Name, category.Type, category.ParentId, category.Order, category.BudgetCents], cancellationToken);
    }
}
