using System.Text.Json;
using System.Text.Json.Nodes;
using CuentasClaras.Domain.Common;
using static CuentasClaras.Tests.CorpusJson;

namespace CuentasClaras.Tests;

/// <summary>
/// Ejecuta en C# cada operación del corpus de reglas de tickets (fixtures/migration/rules-tickets.json),
/// con las entradas tal cual, y escribe el resultado con la forma del JSON de TypeScript: las mismas
/// claves, sin las propiedades undefined, un Map como lista de pares y un error como { throws }.
/// El ejecutor de TypeScript equivalente es tests/ticketRules.ts.
/// </summary>
internal static class TicketRulesCorpus
{
    private static readonly Dictionary<string, Func<JsonElement, JsonNode?>> Operations = new(StringComparer.Ordinal)
    {
        // shared/common
        ["formatEuros"] = input => String(Money.FormatEuros(Long(input, "cents"), TextOrNull(input, "sign") == "always")),
        ["isValidISODate"] = input => JsonValue.Create(Get(input, "value") is { ValueKind: JsonValueKind.String } value && IsoDates.IsValid(Text(value))),
        ["toISODate"] = input => String(IsoDates.ToIsoDate((int)Long(input, "year"), (int)Long(input, "month"), (int)Long(input, "day"))),
    };

    public static IReadOnlyCollection<string> Ported => Operations.Keys;

    public static JsonNode? Run(string operation, JsonElement input) =>
        Operations.TryGetValue(operation, out var run)
            ? run(input)
            : throw new InvalidOperationException($"La operación «{operation}» no tiene regla en C#.");
}
