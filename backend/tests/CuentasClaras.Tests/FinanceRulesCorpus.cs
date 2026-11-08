using System.Text.Json;
using System.Text.Json.Nodes;
using CuentasClaras.Application.Finance;
using CuentasClaras.Domain.Common;
using CuentasClaras.Domain.Finance;
using static CuentasClaras.Tests.CorpusJson;

namespace CuentasClaras.Tests;

/// <summary>
/// Ejecuta en C# cada operación del corpus de reglas de finanzas (fixtures/migration/rules-finance.json), con las
/// entradas tal cual, y escribe el resultado con la forma del JSON de TypeScript: las mismas claves, en el mismo orden,
/// y un ValidationResult como { ok, value } o { ok, error }. El ejecutor de TypeScript equivalente es tests/financeRules.ts.
/// </summary>
internal static class FinanceRulesCorpus
{
    private static readonly Dictionary<string, Func<JsonElement, JsonNode?>> Operations = new(StringComparer.Ordinal)
    {
        // shared/finance/backup.ts: lo que valida el servidor en cada ruta
        ["validateCategory"] = input => Result(FinanceRequests.ValidateCategory(BodyOf(input)), CategoryJson),
        ["validateMovement"] = input => Result(FinanceRequests.ValidateMovement(BodyOf(input)), MovementJson),
        ["validateRecurring"] = input => Result(FinanceRequests.ValidateRecurring(BodyOf(input)), RuleJson),
        ["validateFinanceData"] = input => Result(FinanceRequests.ValidateFinanceData(BodyOf(input)), DataJson),
        // shared/finance/categories.ts
        ["withDescendants"] = input => Strings(CategoryRules.WithDescendants([.. Items(input, "categories").Select(ReadCategory)], Text(input, "categoryId"))),
    };

    public static IReadOnlyCollection<string> Ported => Operations.Keys;

    public static JsonNode? Run(string operation, JsonElement input) =>
        Operations.TryGetValue(operation, out var run) ? run(input) : throw new InvalidOperationException($"Operación sin portar: {operation}");

    /// <summary>El cuerpo de una petición: «bodyJson» es el texto tal cual (JSON.parse), «body» ya es JSON y sin ninguno es undefined.</summary>
    private static JsonElement BodyOf(JsonElement input)
    {
        if (TextOrNull(input, "bodyJson") is { } text)
            return JsonDocument.Parse(text, new JsonDocumentOptions { MaxDepth = 256 }).RootElement;
        return Get(input, "body");
    }

    private static JsonObject Result<T>(ValidationResult<T> result, Func<T, JsonNode> json) => result.Ok
        ? Object(("ok", true), ("value", json(result.Value!)))
        : Object(("ok", false), ("error", result.Error));

    private static Category ReadCategory(JsonElement category) => new(
        Text(category, "id"), Text(category, "name"), Text(category, "type"), TextOrNull(category, "parentId"),
        Double(category, "order"), LongOrNull(category, "budgetCents"));

    public static JsonObject CategoryJson(Category category) => Object(
        ("id", category.Id), ("name", category.Name), ("type", category.Type), ("parentId", category.ParentId),
        ("order", category.Order), ("budgetCents", category.BudgetCents));

    public static JsonObject MovementJson(Movement movement) => Object(
        ("id", movement.Id), ("concept", movement.Concept), ("amountCents", movement.AmountCents), ("type", movement.Type),
        ("categoryId", movement.CategoryId), ("status", movement.Status), ("paidDate", movement.PaidDate), ("dueDate", movement.DueDate),
        ("notes", movement.Notes), ("recurringId", movement.RecurringId), ("occurrenceDate", movement.OccurrenceDate),
        ("installmentNumber", movement.InstallmentNumber), ("createdAt", movement.CreatedAt), ("updatedAt", movement.UpdatedAt));

    public static JsonObject RuleJson(RecurringRule rule) => Object(
        ("id", rule.Id), ("concept", rule.Concept), ("amountCents", rule.AmountCents), ("type", rule.Type),
        ("categoryId", rule.CategoryId), ("frequency", rule.Frequency), ("startDate", rule.StartDate), ("endDate", rule.EndDate),
        ("installments", rule.Installments), ("notes", rule.Notes), ("excludedDates", Strings(rule.ExcludedDates)),
        ("createdAt", rule.CreatedAt), ("updatedAt", rule.UpdatedAt));

    private static JsonObject DataJson(FinanceData data) => Object(
        ("categories", Array(data.Categories.Select(CategoryJson))),
        ("movements", Array(data.Movements.Select(MovementJson))),
        ("recurring", Array(data.Recurring.Select(RuleJson))));
}
