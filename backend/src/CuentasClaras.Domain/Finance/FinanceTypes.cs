namespace CuentasClaras.Domain.Finance;

/// <summary>
/// Un movimiento (shared/finance/types.ts): importe positivo en céntimos, tipo «ingreso» o «gasto» y estado «pendiente»
/// o «realizado». Las fechas son texto AAAA-MM-DD; los instantes, el texto que mandó la web.
/// </summary>
public sealed record Movement(
    string Id,
    string Concept,
    long AmountCents,
    string Type,
    string CategoryId,
    string Status,
    string? PaidDate,
    string? DueDate,
    string Notes,
    string? RecurringId,
    string? OccurrenceDate,
    int? InstallmentNumber,
    string CreatedAt,
    string UpdatedAt);

/// <summary>Un pago recurrente: la regla y las fechas de sus vencimientos eliminados, que no se vuelven a crear.</summary>
public sealed record RecurringRule(
    string Id,
    string Concept,
    long AmountCents,
    string Type,
    string CategoryId,
    string Frequency,
    string StartDate,
    string? EndDate,
    int? Installments,
    string Notes,
    IReadOnlyList<string> ExcludedDates,
    string CreatedAt,
    string UpdatedAt);

/// <summary>Todas las finanzas: lo que lee GET /api/data y lo que sustituye una copia de seguridad.</summary>
public sealed record FinanceData(IReadOnlyList<Category> Categories, IReadOnlyList<Movement> Movements, IReadOnlyList<RecurringRule> Recurring);

/// <summary>Reglas de las categorías que usa el servidor (shared/finance/categories.ts).</summary>
public static class CategoryRules
{
    /// <summary>withDescendants: la categoría y sus subcategorías, en el orden de la lista.</summary>
    public static IReadOnlyList<string> WithDescendants(IReadOnlyList<Category> categories, string categoryId) =>
        [categoryId, .. categories.Where(category => category.ParentId == categoryId).Select(category => category.Id)];
}

/// <summary>Los metadatos que no forman parte de la copia (shared/finance/meta.ts).</summary>
public static class MetaKeys
{
    public static IReadOnlyList<string> All { get; } = ["lastBackupAt", "browserImportAt"];
}
