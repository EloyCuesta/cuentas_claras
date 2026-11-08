using CuentasClaras.Domain.Finance;

namespace CuentasClaras.Application.Finance;

/// <summary>Una categoría como la devuelve la API, con los campos y el orden de Express.</summary>
public sealed record CategoryView(string Id, string Name, string Type, string? ParentId, double Order, long? BudgetCents)
{
    public static CategoryView From(Category category) =>
        new(category.Id, category.Name, category.Type, category.ParentId, category.Order, category.BudgetCents);
}

/// <summary>Un movimiento como lo devuelve la API.</summary>
public sealed record MovementView(
    string Id, string Concept, long AmountCents, string Type, string CategoryId, string Status, string? PaidDate, string? DueDate,
    string Notes, string? RecurringId, string? OccurrenceDate, int? InstallmentNumber, string CreatedAt, string UpdatedAt)
{
    public static MovementView From(Movement movement) => new(
        movement.Id, movement.Concept, movement.AmountCents, movement.Type, movement.CategoryId, movement.Status,
        movement.PaidDate, movement.DueDate, movement.Notes, movement.RecurringId, movement.OccurrenceDate,
        movement.InstallmentNumber, movement.CreatedAt, movement.UpdatedAt);
}

/// <summary>Un recurrente como lo devuelve la API, con sus fechas excluidas.</summary>
public sealed record RecurringView(
    string Id, string Concept, long AmountCents, string Type, string CategoryId, string Frequency, string StartDate,
    string? EndDate, int? Installments, string Notes, IReadOnlyList<string> ExcludedDates, string CreatedAt, string UpdatedAt)
{
    public static RecurringView From(RecurringRule rule) => new(
        rule.Id, rule.Concept, rule.AmountCents, rule.Type, rule.CategoryId, rule.Frequency, rule.StartDate, rule.EndDate,
        rule.Installments, rule.Notes, rule.ExcludedDates, rule.CreatedAt, rule.UpdatedAt);
}

/// <summary>GET /api/data: solo finanzas (categorías, movimientos y recurrentes), nunca la despensa.</summary>
public sealed record FinanceDataView(IReadOnlyList<CategoryView> Categories, IReadOnlyList<MovementView> Movements, IReadOnlyList<RecurringView> Recurring)
{
    public static FinanceDataView From(FinanceData data) => new(
        [.. data.Categories.Select(CategoryView.From)], [.. data.Movements.Select(MovementView.From)], [.. data.Recurring.Select(RecurringView.From)]);
}

/// <summary>GET /api/meta/:key: { value }, null si no se ha guardado.</summary>
public sealed record MetaView(string? Value);
