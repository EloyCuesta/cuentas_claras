using System.Text.Json;
using System.Text.Json.Nodes;
using CuentasClaras.Domain.Common;
using CuentasClaras.Domain.Tickets;
using static CuentasClaras.Tests.CorpusJson;

namespace CuentasClaras.Tests;

/// <summary>
/// Ejecuta en C# cada operación del corpus de reglas de tickets (fixtures/migration/rules-tickets.json),
/// con las entradas tal cual, y escribe el resultado con la forma del JSON de TypeScript: las mismas
/// claves, sin las propiedades undefined, un Map como lista de pares y un error como { throws }.
/// El ejecutor de TypeScript equivalente es tests/ticketRules.ts.
/// </summary>
internal static partial class TicketRulesCorpus
{
    private static readonly Dictionary<string, Func<JsonElement, JsonNode?>> Operations = new(StringComparer.Ordinal)
    {
        // shared/common
        ["formatEuros"] = input => String(Money.FormatEuros(Long(input, "cents"), TextOrNull(input, "sign") == "always")),
        ["isValidISODate"] = input => JsonValue.Create(Get(input, "value") is { ValueKind: JsonValueKind.String } value && IsoDates.IsValid(Text(value))),
        ["toISODate"] = input => String(IsoDates.ToIsoDate((int)Long(input, "year"), (int)Long(input, "month"), (int)Long(input, "day"))),
        // shared/tickets/ticketText.ts
        ["nameKey"] = input => String(TicketText.NameKey(Text(input, "text"))),
        ["nameKeyEach"] = input => Strings(Items(input, "texts").Select(text => TicketText.NameKey(Text(text)))),
        ["similarity"] = input => Number(TicketText.Similarity(Text(input, "a"), Text(input, "b"))),
        ["prettyName"] = input => String(TicketText.PrettyName(Text(input, "raw"))),
        ["prettyNameEach"] = input => Strings(Items(input, "texts").Select(text => TicketText.PrettyName(Text(text)))),
        ["guessFrequency"] = input => String(TicketText.GuessFrequency(Text(input, "raw"))),
        // shared/tickets/ticketArithmetic.ts
        ["roundRatio"] = input => Number(TicketArithmetic.RoundRatio(Double(input, "numerator"), Double(input, "denominator"))),
        ["calculatedAmount"] = input => Number(TicketArithmetic.CalculatedAmount(ReadSaveLine(Get(input, "line")))),
        ["lineProblems"] = input => Strings(TicketArithmetic.LineProblems(ReadSaveLine(Get(input, "line")))),
        ["canApplyLine"] = input => JsonValue.Create(TicketArithmetic.CanApplyLine(ReadSaveLine(Get(input, "line")))),
        // shared/tickets/ticketEvidence.ts
        ["singleDigitEdit"] = input => String(TicketEvidenceRules.SingleDigitEdit(Text(input, "read"), Text(input, "expected"))),
        ["singleEditVariants"] = input => Strings(TicketEvidenceRules.SingleEditVariants(Text(input, "digits"))),
        ["printedDigits"] = input => String(TicketEvidenceRules.PrintedDigits(Long(input, "cents"))),
        ["assessUnits"] = input => Json(TicketEvidenceRules.AssessUnits(ReadAmountEvidence(Get(input, "input")), Long(Get(input, "input"), "unitCents"), Long(Get(input, "input"), "quantity"))),
        ["assessWeight"] = input => Json(TicketEvidenceRules.AssessWeight(ReadAmountEvidence(Get(input, "input")), Long(Get(input, "input"), "grams"), Long(Get(input, "input"), "pricePerKgCents"))),
    };

    /// <summary>Las operaciones de tickets de rules.json (BASE-01), que reciben la línea directamente.</summary>
    private static readonly Dictionary<string, Func<JsonElement, JsonNode?>> BaseOperations = new(StringComparer.Ordinal)
    {
        ["roundRatio"] = input => Number(TicketArithmetic.RoundRatio(Double(input, "numerator"), Double(input, "denominator"))),
        ["calculatedAmount"] = input => Number(TicketArithmetic.CalculatedAmount(ReadSaveLine(input))),
        ["canApplyLine"] = input => JsonValue.Create(TicketArithmetic.CanApplyLine(ReadSaveLine(input))),
    };

    public static IReadOnlyCollection<string> Ported => Operations.Keys;

    public static IReadOnlyCollection<string> BasePorted => BaseOperations.Keys;

    public static JsonNode? Run(string operation, JsonElement input) => Execute(Operations, operation, input);

    public static JsonNode? RunBase(string operation, JsonElement input) => Execute(BaseOperations, operation, input);

    private static JsonNode? Execute(Dictionary<string, Func<JsonElement, JsonNode?>> operations, string operation, JsonElement input)
    {
        if (!operations.TryGetValue(operation, out var run))
            throw new InvalidOperationException($"La operación «{operation}» no tiene regla en C#.");
        try
        {
            return run(input);
        }
        catch (TicketCalculationException error)
        {
            // TypeScript lanza Error('Cálculo monetario no válido'): el corpus guarda { throws: mensaje }.
            return Object(("throws", error.Message));
        }
    }

    // -------------------------------------------------------------------------------------------
    // Entradas: del JSON del corpus a los tipos de C#, sin completar nada que no esté.

    private static TicketBox ReadBox(JsonElement box) => new(Double(box, "x0"), Double(box, "y0"), Double(box, "x1"), Double(box, "y1"));

    private static TicketSource? ReadSource(JsonElement source) => source.ValueKind != JsonValueKind.Object ? null :
        new((int)Long(source, "imageIndex"), (int)Long(source, "segmentIndex"), ReadBox(Get(source, "box")), Double(source, "width"), Double(source, "height"));

    private static OcrLine ReadOcrLine(JsonElement line) => new(
        Text(line, "text"), TextOrNull(line, "reread"), DoubleOrNull(line, "confidence"),
        Has(line, "words") ? [.. Items(line, "words").Select(word => new OcrWord(Text(word, "text"), Double(word, "confidence"), ReadBox(Get(word, "box"))))] : null,
        ReadSource(Get(line, "source")));

    private static IReadOnlyList<IReadOnlyList<OcrLine>> ReadPages(JsonElement input) =>
        [.. Items(input, "pages").Select(page => (IReadOnlyList<OcrLine>)[.. page.EnumerateArray().Select(ReadOcrLine)])];

    private static TicketDiscrepancy? ReadDiscrepancy(JsonElement discrepancy) => discrepancy.ValueKind != JsonValueKind.Object ? null : new(
        Text(discrepancy, "kind"), Text(discrepancy, "verdict"), Long(discrepancy, "recognizedCents"), Long(discrepancy, "calculatedCents"),
        Text(discrepancy, "explanation"), [.. Items(discrepancy, "reasons").Select(Text)]);

    private static TicketEvidence? ReadEvidence(JsonElement evidence) => evidence.ValueKind != JsonValueKind.Object ? null : new(
        Text(evidence, "text"), TextOrNull(evidence, "reread"), LongOrNull(evidence, "recognizedCents"), LongOrNull(evidence, "calculatedCents"),
        Text(evidence, "selectedBy"), [.. Items(evidence, "issues").Select(Text)], TextOrNull(evidence, "normalized"),
        ReadDiscrepancy(Get(evidence, "discrepancy")),
        Has(evidence, "options") ? [.. Items(evidence, "options").Select(option => new TicketAmountOption(Long(option, "cents"), Text(option, "origin")))] : null,
        ReadSource(Get(evidence, "source")));

    private static AmountReading ReadAmountReading(JsonElement reading) =>
        new(Long(reading, "cents"), Text(reading, "rawDigits"), BoolOrNull(reading, "malformed") ?? false, TextOrNull(reading, "printed"));

    private static AmountEvidence ReadAmountEvidence(JsonElement input) => new(
        ReadAmountReading(Get(input, "recognized")), [.. Items(input, "readings").Select(ReadAmountReading)],
        BoolOrNull(input, "inputsStable") ?? false, BoolOrNull(input, "amountStable") ?? false,
        Get(input, "confidence") is { ValueKind: JsonValueKind.Object } confidence ? new OcrConfidence(DoubleOrNull(confidence, "amount"), DoubleOrNull(confidence, "inputs")) : null);

    private static TicketSaveLine ReadSaveLine(JsonElement line) => new(
        TextOrNull(line, "rawName") ?? "", Long(line, "quantity"), LongOrNull(line, "unitPriceCents"), LongOrNull(line, "amountCents"),
        LongOrNull(line, "discountCents") ?? 0, DoubleOrNull(line, "weightKg"), LongOrNull(line, "pricePerKgCents"), TextOrNull(line, "taxCode"),
        BoolOrNull(line, "occasional") ?? false, TextOrNull(line, "reviewStatus"), BoolOrNull(line, "confirmed"), ReadEvidence(Get(line, "evidence")));

    // -------------------------------------------------------------------------------------------
    // Salidas: de los tipos de C# al JSON que escribiría JSON.stringify.

    private static JsonObject Json(TicketBox box) => Object(("x0", box.X0), ("y0", box.Y0), ("x1", box.X1), ("y1", box.Y1));

    private static JsonObject Json(TicketSource source) => Object(
        ("imageIndex", source.ImageIndex), ("segmentIndex", source.SegmentIndex), ("box", Json(source.Box)), ("width", source.Width), ("height", source.Height));

    private static JsonObject Json(OcrLine line) => Object(
        ("text", line.Text), ("reread", line.Reread), ("confidence", OrOmit(line.Confidence)),
        ("words", line.Words is null ? Omit : Array(line.Words.Select(word => Object(("text", word.Text), ("confidence", word.Confidence), ("box", Json(word.Box)))))),
        ("source", line.Source is null ? Omit : Json(line.Source)));

    private static JsonObject? Json(TicketDiscrepancy? discrepancy) => discrepancy is null ? null : Object(
        ("kind", discrepancy.Kind), ("verdict", discrepancy.Verdict), ("recognizedCents", discrepancy.RecognizedCents),
        ("calculatedCents", discrepancy.CalculatedCents), ("explanation", discrepancy.Explanation), ("reasons", Strings(discrepancy.Reasons)));

    private static JsonObject Json(TicketEvidence evidence) => Object(
        ("text", evidence.Text), ("reread", evidence.Reread), ("normalized", OrOmit(evidence.Normalized)),
        ("recognizedCents", evidence.RecognizedCents), ("calculatedCents", evidence.CalculatedCents), ("selectedBy", evidence.SelectedBy),
        ("issues", Strings(evidence.Issues)),
        ("discrepancy", evidence.Discrepancy is null ? Omit : Json(evidence.Discrepancy)!),
        ("options", evidence.Options is null ? Omit : Array(evidence.Options.Select(option => Object(("cents", option.Cents), ("origin", option.Origin))))),
        ("source", evidence.Source is null ? Omit : Json(evidence.Source)));

    private static JsonObject Json(TicketSaveLine line) => Object(
        ("rawName", line.RawName), ("quantity", line.Quantity), ("unitPriceCents", line.UnitPriceCents), ("amountCents", line.AmountCents),
        ("discountCents", line.DiscountCents), ("weightKg", line.WeightKg), ("pricePerKgCents", line.PricePerKgCents), ("taxCode", line.TaxCode),
        ("occasional", line.Occasional), ("confirmed", OrOmit(line.Confirmed)), ("evidence", line.Evidence is null ? Omit : Json(line.Evidence)),
        ("reviewStatus", OrOmit(line.ReviewStatus)));
}
