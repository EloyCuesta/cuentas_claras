using System.Text.Json;
using System.Text.Json.Nodes;
using CuentasClaras.Application.Pantry;
using CuentasClaras.Domain.Common;
using CuentasClaras.Domain.Pantry;
using static CuentasClaras.Tests.CorpusJson;

namespace CuentasClaras.Tests;

/// <summary>
/// Ejecuta en C# cada operación del corpus de reglas de la despensa (fixtures/migration/rules-pantry.json), con las
/// entradas tal cual, y escribe el resultado con la forma del JSON de TypeScript: las mismas claves, en el mismo orden,
/// y un ValidationResult como { ok, value } o { ok, error }. El ejecutor de TypeScript equivalente es tests/pantryRules.ts.
/// </summary>
internal static class PantryRulesCorpus
{
    private static readonly Dictionary<string, Func<JsonElement, JsonNode?>> Operations = new(StringComparer.Ordinal)
    {
        // shared/pantry/pantryValidation.ts (PAN-01)
        ["validatePersonInput"] = input => Result(PantryRequests.ValidatePerson(BodyOf(input)), name => Object(("name", name))),
        ["validateItemInput"] = input => Result(PantryRequests.ValidateItemInput(BodyOf(input)), ItemInput),
        ["validateItemUpdate"] = input => Result(PantryRequests.ValidateItemUpdate(BodyOf(input)), update =>
        {
            var json = ItemInput(update.Input);
            json["expectedVersion"] = Number(update.ExpectedVersion);
            return json;
        }),
        // PAN-02: + y −, «Marcar todo como comprado» y «Deshacer»
        ["validateDeltaInput"] = input => Result(PantryRequests.ValidateDelta(BodyOf(input)), Number),
        ["validatePurchaseInput"] = input => Result(PantryRequests.ValidatePurchase(BodyOf(input)),
            purchase => Object(("ids", Strings(purchase.Ids)), ("date", purchase.Date))),
        ["validateUndoInput"] = input => Result(PantryRequests.ValidateUndo(BodyOf(input)), changes => Array(changes.Select(change => (JsonNode?)(change switch
        {
            QuantityChange quantity => Object(("id", quantity.Id), ("previousQuantity", Number(quantity.PreviousQuantity)), ("version", Number(quantity.Version))),
            EventChange bought => Object(("id", bought.Id), ("eventId", bought.EventId)),
            _ => throw new InvalidOperationException(),
        })))),
        ["stepQuantity"] = input => Number(PantryRules.StepQuantity(Double(input, "quantity"), Double(input, "delta"))),
        // shared/pantry/pantry.ts
        ["checkQuantity"] = input =>
        {
            var value = BodyOf(input);
            return Result(PantryRules.CheckQuantity(value.ValueKind == JsonValueKind.Number ? Application.Common.JsonInput.Number(value) : double.NaN,
                Text(input, "unit")), Number);
        },
        ["sortPeople"] = input => Strings(PantryRules.SortPeople(Items(input, "people")
            .Select(person => new PantryPerson(Text(person, "id"), Text(person, "name"), Text(person, "createdAt")))).Select(person => person.Id)),
        ["sortItems"] = input => Strings(PantryRules.SortItems(Items(input, "items")
            .Select(item => new PantryItem(Text(item, "id"), Text(item, "name"), null, "ud", "cantidad", 0, 0, Text(item, "frequency"), null, "", 1, "", "")))
            .Select(item => item.Id)),
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

    /// <summary>PantryItemInput en el orden en que lo escribe validateItemInput.</summary>
    private static JsonObject ItemInput(PantryItemInput input) => Object(
        ("name", input.Name), ("ownerId", input.OwnerId), ("unit", input.Unit), ("tracking", input.Tracking), ("quantity", Number(input.Quantity)),
        ("target", Number(input.Target)), ("frequency", input.Frequency), ("priceCents", Number(input.PriceCents)), ("notes", input.Notes));
}
