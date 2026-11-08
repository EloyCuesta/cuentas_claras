using CuentasClaras.Domain.Common;

namespace CuentasClaras.Domain.Finance;

/// <summary>Las reglas de las copias que usa el servidor (shared/finance/backup.ts).</summary>
public static class BackupRules
{
    /// <summary>categoryKey: JSON.stringify([id, name, type, parentId, order, budgetCents]).</summary>
    private static string CategoryKey(Category category) => JsJson.Array([
        JsJson.String(category.Id), JsJson.String(category.Name), JsJson.String(category.Type), JsJson.StringOrNull(category.ParentId),
        JsJson.Number(category.Order), JsJson.Number(category.BudgetCents),
    ]);

    private static readonly HashSet<string> DefaultKeys = new(DefaultCategories.All.Select(CategoryKey), StringComparer.Ordinal);

    /// <summary>
    /// hasUserData: hay algo del usuario (movimientos, recurrentes o categorías distintas de las iniciales: nombres,
    /// presupuestos, orden…). Sirve para no importar encima de datos que ya existen. La despensa no cuenta.
    /// </summary>
    public static bool HasUserData(FinanceData data)
    {
        if (data.Movements.Count > 0 || data.Recurring.Count > 0) return true;
        return data.Categories.Count != DefaultKeys.Count || data.Categories.Any(category => !DefaultKeys.Contains(CategoryKey(category)));
    }
}
