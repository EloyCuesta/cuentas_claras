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
        ["hasUserData"] = input => JsonValue.Create(BackupRules.HasUserData(ReadData(Get(input, "data")))),
        // shared/finance/categories.ts
        ["withDescendants"] = input => Strings(CategoryRules.WithDescendants([.. Items(input, "categories").Select(ReadCategory)], Text(input, "categoryId"))),
        // shared/common/dates.ts y shared/finance/recurring.ts (FIN-03)
        ["addMonthsClamped"] = input => String(IsoDates.AddMonthsClamped(Text(input, "value"), (int)Long(input, "months"))),
        ["generationHorizon"] = input => String(RecurringRules.GenerationHorizon(Text(input, "today"))),
        ["scheduleDates"] = input =>
        {
            var rule = Get(input, "rule");
            return Strings(RecurringRules.ScheduleDates(Text(rule, "startDate"), TextOrNull(rule, "endDate"), (int?)LongOrNull(rule, "installments"),
                Text(rule, "frequency"), Text(input, "until")));
        },
        ["planOccurrences"] = input =>
        {
            var next = 0;
            return Array(RecurringRules.PlanOccurrences(ReadRule(Get(input, "rule")), [.. Items(input, "existing").Select(ReadMovement)],
                Text(input, "horizon"), Text(input, "now"), () => $"id-{++next}").Select(MovementJson));
        },
        // shared/finance/summaryViews.ts (FIN-04): con la serialización de la API, como las responde GET /api/summary/*
        ["forecastMovements"] = input => Api(FinanceSummaries.ForecastMovements(ReadData(Get(input, "data")), Text(input, "today"), Text(input, "until"))
            .Select(MovementView.From).ToList()),
        ["monthView"] = input => Api(FinanceSummaries.MonthView(ReadData(Get(input, "data")), Text(input, "today"), (int)Long(input, "year"), (int)Long(input, "month"))),
        ["yearView"] = input => Api(FinanceSummaries.YearView(ReadData(Get(input, "data")), Text(input, "today"), (int)Long(input, "year"))),
        ["compareNames"] = input =>
        {
            var names = Items(input, "names").Select(Text).ToArray();
            return Array(names.Select(a => (JsonNode?)Array(names.Select(b => Number(JsCollator.Compare(a, b))))));
        },
    };

    /// <summary>Las opciones de la API (ApiResponse): camelCase y los double como JSON.stringify.</summary>
    private static readonly JsonSerializerOptions ApiJson = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Converters = { new CuentasClaras.Application.Common.JsDoubleConverter() },
    };

    private static JsonNode? Api<T>(T value) => JsonSerializer.SerializeToNode(value, ApiJson);

    private static FinanceData ReadData(JsonElement data) => new(
        [.. Items(data, "categories").Select(ReadCategory)], [.. Items(data, "movements").Select(ReadMovement)],
        [.. Items(data, "recurring").Select(ReadRule)]);

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

    private static Movement ReadMovement(JsonElement movement) => new(
        Text(movement, "id"), Text(movement, "concept"), Long(movement, "amountCents"), Text(movement, "type"), Text(movement, "categoryId"),
        Text(movement, "status"), TextOrNull(movement, "paidDate"), TextOrNull(movement, "dueDate"), Text(movement, "notes"),
        TextOrNull(movement, "recurringId"), TextOrNull(movement, "occurrenceDate"), (int?)LongOrNull(movement, "installmentNumber"),
        Text(movement, "createdAt"), Text(movement, "updatedAt"));

    private static RecurringRule ReadRule(JsonElement rule) => new(
        Text(rule, "id"), Text(rule, "concept"), Long(rule, "amountCents"), Text(rule, "type"), Text(rule, "categoryId"),
        Text(rule, "frequency"), Text(rule, "startDate"), TextOrNull(rule, "endDate"), (int?)LongOrNull(rule, "installments"),
        Text(rule, "notes"), [.. Items(rule, "excludedDates").Select(Text)], Text(rule, "createdAt"), Text(rule, "updatedAt"));

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
