using System.Text.Json;
using System.Text.RegularExpressions;
using CuentasClaras.Application.Common;
using CuentasClaras.Domain.Common;
using CuentasClaras.Domain.Tickets;
using static CuentasClaras.Application.Common.JsonInput;

namespace CuentasClaras.Application.Tickets;

/// <summary>{ itemId }: el producto de una línea ya guardada (null = no seguirla).</summary>
public sealed record TicketLineUpdate(string? ItemId);

/// <summary>
/// Validación de lo que llega a la API al guardar un ticket revisado (shared/tickets/ticketValidation.ts).
/// Recibe el cuerpo JSON sin tipar, como ReadCode en el host del acceso, y devuelve el valor leído o
/// el mismo mensaje en español, en el mismo orden de comprobaciones. Está en Application y no en Api
/// porque usa las reglas de Domain.Tickets (nameKey, lineProblems, checkTicket), y Api no conoce Domain.
/// La ruta (TIC-03) convertirá el error en un 400 VALIDATION, como ReadCode.
/// </summary>
public static class TicketRequests
{
    private const int MaxLines = 300;
    private const long MaxLineCents = 10_000_000;
    private static readonly Regex Spaces = JsRegex.Create(@"\s+");
    private static readonly Regex Time = JsRegex.Create(@"^([01]\d|2[0-3]):[0-5]\d$");
    private static readonly Regex Identifier = JsRegex.Create(@"^[a-zA-Z0-9-]{16,128}$");

    private sealed class InputError(string message) : Exception(message);

    private static InputError Fail(string message) => new(message);

    /// <summary>int(): un entero seguro entre <paramref name="min"/> y <paramref name="max"/>, o null si se admite.</summary>
    private static long? Int(JsonElement value, string field, long min, long max, bool nullable = false)
    {
        if (nullable && IsNullish(value)) return null;
        var number = IsNumber(value) ? Number(value) : double.NaN;
        if (!IsNumber(value) || !JsNumber.IsSafeInteger(number) || number < min || number > max)
            throw Fail($"{field}: debe ser un número entero entre {JsNumber.ToString(min)} y {JsNumber.ToString(max)}{(nullable ? " (o null)" : "")}.");
        return (long)number;
    }

    private static string Slice(JsonElement value, int max) => JsText.Slice(Text(value), 0, max);

    /// <summary>Uno de los textos permitidos. Tiene que ser un texto: una lista como ["read"] no vale, aunque String() la convierta en «read».</summary>
    private static string? OneOf(JsonElement value, params string[] allowed)
    {
        if (!IsString(value)) return null;
        var text = Text(value);
        return allowed.Contains(text, StringComparer.Ordinal) ? text : null;
    }

    private static TicketSaveLine ReadLine(JsonElement raw, int index)
    {
        var label = $"Línea {JsNumber.ToString(index + 1)}";
        if (!IsObject(raw)) throw Fail($"{label}: formato no válido.");
        var rawName = IsString(Get(raw, "rawName")) ? JsText.Trim(Spaces.Replace(Text(Get(raw, "rawName")), " ")) : "";
        if (rawName == "" || rawName.Length > TicketVocabulary.PantryNameMax || TicketText.NameKey(rawName) == "") throw Fail($"{label}: falta el nombre o es demasiado largo.");
        var weightKg = Get(raw, "weightKg");
        if (!IsNullish(weightKg) && (!IsNumber(weightKg) || !double.IsFinite(Number(weightKg)) || Number(weightKg) <= 0 || Number(weightKg) > 1000))
            throw Fail($"{label}: el peso no es válido.");
        var taxValue = Get(raw, "taxCode");
        string? taxCode = null;
        if (!IsNullish(taxValue))
        {
            taxCode = IsString(taxValue) ? Text(taxValue) : null;
            if (taxCode is not ("A" or "B" or "C")) throw Fail($"{label}: la letra del IVA debe ser A, B, C o null.");
        }
        var evidence = ReadEvidence(Get(raw, "evidence"));
        var quantity = Int(Get(raw, "quantity"), $"{label}, cantidad", 1, 999)!.Value;
        var unitPriceCents = Int(Get(raw, "unitPriceCents"), $"{label}, precio unitario", 0, TicketVocabulary.MaxPantryCents, true);
        var amountCents = Int(Get(raw, "amountCents"), $"{label}, importe", -MaxLineCents, MaxLineCents, true);
        var discountValue = Get(raw, "discountCents");
        var discountCents = IsNullish(discountValue) ? 0 : Int(discountValue, $"{label}, descuento", 0, MaxLineCents)!.Value;
        double? weight = IsNumber(weightKg) ? JsNumber.Round(Number(weightKg) * 1000) / 1000 : null;
        var pricePerKgCents = Int(Get(raw, "pricePerKgCents"), $"{label}, precio por kilo", 0, TicketVocabulary.MaxPantryCents, true);
        var line = new TicketSaveLine(rawName, quantity, unitPriceCents, amountCents, discountCents, weight, pricePerKgCents, taxCode,
            IsTrue(Get(raw, "occasional")), Confirmed: IsTrue(Get(raw, "confirmed")), Evidence: evidence);
        // La estructura inválida se rechaza; unos datos económicos incompletos o incoherentes se guardan,
        // pero no cambian la despensa.
        var problems = TicketArithmetic.LineProblems(line);
        var pending = (IsString(Get(raw, "reviewStatus")) && Text(Get(raw, "reviewStatus")) == "pending") || problems.Count > 0 ||
            ((evidence?.Issues.Count ?? 0) > 0 && line.Confirmed != true);
        return line with { ReviewStatus = pending ? "pending" : "verified" };
    }

    private static string ShortText(JsonElement value, int max = 400) => IsString(value) ? Slice(value, max) : "";

    private static TicketEvidence? ReadEvidence(JsonElement raw)
    {
        if (IsNullish(raw)) return null;
        if (!IsObject(raw)) throw Fail("La evidencia de lectura no es válida.");
        var selectedBy = OneOf(Get(raw, "selectedBy"), "read", "reread", "calculation", "manual") ?? throw Fail("Origen del importe no válido.");
        var issues = Get(raw, "issues");
        if (!IsArray(issues) || issues.GetArrayLength() > 20 || issues.EnumerateArray().Any(issue => !IsString(issue) || Text(issue).Length > 400))
            throw Fail("Incidencias de lectura no válidas.");
        var text = IsString(Get(raw, "text")) ? Slice(Get(raw, "text"), 1000) : "";
        var reread = IsString(Get(raw, "reread")) ? Slice(Get(raw, "reread"), 1000) : null;
        var recognizedCents = Int(Get(raw, "recognizedCents"), "Importe reconocido", -MaxLineCents, MaxLineCents, true);
        var calculatedCents = Int(Get(raw, "calculatedCents"), "Importe calculado", -MaxLineCents, MaxLineCents, true);
        var normalized = IsString(Get(raw, "normalized")) ? Slice(Get(raw, "normalized"), 1000) : null;
        // La discrepancia original se guarda con el ticket: así se sabe después qué leyó el OCR y por qué se propuso otra cifra.
        TicketDiscrepancy? discrepancy = null;
        var d = Get(raw, "discrepancy");
        if (!IsNullish(d))
        {
            var kind = IsObject(d) ? OneOf(Get(d, "kind"), "units", "weight") : null;
            var verdict = IsObject(d) ? OneOf(Get(d, "verdict"), "calculation", "read", "ambiguous") : null;
            var reasons = Get(d, "reasons");
            if (kind is null || verdict is null || !IsArray(reasons) || reasons.GetArrayLength() > 10) throw Fail("La discrepancia de lectura no es válida.");
            discrepancy = new TicketDiscrepancy(kind, verdict,
                Int(Get(d, "recognizedCents"), "Importe leído", -MaxLineCents, MaxLineCents)!.Value,
                Int(Get(d, "calculatedCents"), "Importe calculado", -MaxLineCents, MaxLineCents)!.Value,
                ShortText(Get(d, "explanation")), [.. reasons.EnumerateArray().Select(reason => ShortText(reason))]);
        }
        List<TicketAmountOption>? options = null;
        var rawOptions = Get(raw, "options");
        if (!IsUndefined(rawOptions))
        {
            if (!IsArray(rawOptions) || rawOptions.GetArrayLength() > 4) throw Fail("Las opciones de importe no son válidas.");
            options = [];
            foreach (var option in rawOptions.EnumerateArray())
            {
                var origin = IsObject(option) ? OneOf(Get(option, "origin"), "read", "reread", "calculation") : null;
                if (origin is null) throw Fail("Las opciones de importe no son válidas.");
                options.Add(new TicketAmountOption(Int(Get(option, "cents"), "Opción de importe", -MaxLineCents, MaxLineCents)!.Value, origin));
            }
        }
        return new TicketEvidence(text, reread, recognizedCents, calculatedCents, selectedBy, [.. issues.EnumerateArray().Select(Text)],
            normalized, discrepancy, options);
    }

    private static List<TicketAdjustment> ReadAdjustments(JsonElement raw)
    {
        if (IsUndefined(raw)) return [];
        if (!IsArray(raw) || raw.GetArrayLength() > 100) throw Fail("Ajustes del ticket no válidos.");
        var ids = new HashSet<string>(StringComparer.Ordinal);
        var adjustments = new List<TicketAdjustment>();
        foreach (var a in raw.EnumerateArray())
        {
            var id = IsObject(a) && IsString(Get(a, "id")) ? Text(Get(a, "id")) : null;
            if (id is null || id.Length == 0 || id.Length > 100 || ids.Contains(id)) throw Fail("Identificador de ajuste no válido o repetido.");
            ids.Add(id);
            var label = IsString(Get(a, "label")) ? Text(Get(a, "label")) : null;
            if (label is null || JsText.Trim(label).Length == 0 || label.Length > 120) throw Fail("Escribe el concepto del ajuste.");
            var kind = OneOf(Get(a, "kind"), "discount", "coupon", "promotion", "other") ?? throw Fail("Tipo de ajuste no válido.");
            adjustments.Add(new TicketAdjustment(id, JsText.Trim(label), kind,
                Int(Get(a, "amountCents"), "Importe del ajuste", -MaxLineCents, MaxLineCents, true),
                !IsFalse(Get(a, "needsReview")), IsString(Get(a, "originalText")) ? Slice(Get(a, "originalText"), 1000) : null));
        }
        return adjustments;
    }

    private static TicketDecision ReadDecision(JsonElement raw, string key)
    {
        var label = $"El producto «{key}»";
        if (!IsObject(raw)) throw Fail($"{label}: falta qué hacer con él.");
        var kind = Get(raw, "kind");
        var kindText = IsString(kind) ? Text(kind) : null;
        if (kindText == "ignore") return new IgnoreDecision();
        if (kindText == "item")
        {
            var itemId = Get(raw, "itemId");
            if (!IsString(itemId) || Text(itemId) == "") throw Fail($"{label}: falta el producto de la despensa.");
            return new ItemDecision(Text(itemId));
        }
        if (kindText == "new")
        {
            var name = IsString(Get(raw, "name")) ? JsText.Trim(Text(Get(raw, "name"))) : "";
            if (name == "" || name.Length > TicketVocabulary.PantryNameMax)
                throw Fail($"{label}: el nombre del producto nuevo debe tener entre 1 y {JsNumber.ToString(TicketVocabulary.PantryNameMax)} caracteres.");
            var owner = Get(raw, "ownerId");
            string? ownerId = null;
            if (!IsNullish(owner))
            {
                if (!IsString(owner) || Text(owner) == "") throw Fail($"{label}: la persona no es válida.");
                ownerId = Text(owner);
            }
            var frequency = Get(raw, "frequency");
            if (!IsString(frequency) || !TicketVocabulary.IsFrequency(Text(frequency))) throw Fail($"{label}: la frecuencia no es válida.");
            return new NewItemDecision(name, ownerId, Text(frequency));
        }
        throw Fail($"{label}: «kind» debe ser «item», «new» o «ignore».");
    }

    private static string? ReadIdentifier(JsonElement value, string name)
    {
        if (IsUndefined(value)) return null;
        if (!IsString(value) || !Identifier.IsMatch(Text(value))) throw Fail($"{name} no válido.");
        return Text(value);
    }

    /// <summary>validateTicketSave: el cuerpo de POST /api/despensa/tickets; un elemento Undefined es «sin cuerpo».</summary>
    public static ValidationResult<TicketSaveInput> ValidateTicketSave(JsonElement raw)
    {
        try
        {
            if (!IsObject(raw)) throw Fail("Falta el cuerpo de la petición en JSON.");
            var storeValue = Get(raw, "store");
            var store = IsString(storeValue) ? Text(storeValue) : null;
            if (store is not ("lidl" or "otra")) throw Fail("El campo «store» debe ser «lidl» u «otra».");
            var storeName = IsString(Get(raw, "storeName")) ? JsText.Trim(Text(Get(raw, "storeName"))) : "";
            if (storeName == "" || storeName.Length > 60) throw Fail("Escribe el nombre de la tienda (hasta 60 caracteres).");
            var address = IsString(Get(raw, "address")) ? JsText.Slice(JsText.Trim(Text(Get(raw, "address"))), 0, 120) : "";
            var dateValue = Get(raw, "date");
            if (!IsString(dateValue) || !IsoDates.IsValid(Text(dateValue))) throw Fail("La fecha del ticket debe ser AAAA-MM-DD.");
            var timeValue = Get(raw, "time");
            string? time = null;
            if (!IsNullish(timeValue))
            {
                if (!IsString(timeValue) || !Time.IsMatch(Text(timeValue))) throw Fail("La hora del ticket debe ser HH:MM.");
                time = Text(timeValue);
            }
            var totalCents = Int(Get(raw, "totalCents"), "El total", -MaxLineCents, MaxLineCents, true);
            var rawLines = Get(raw, "lines");
            if (!IsArray(rawLines) || rawLines.GetArrayLength() == 0) throw Fail("El ticket no tiene ninguna línea.");
            if (rawLines.GetArrayLength() > MaxLines) throw Fail($"Un ticket puede tener como máximo {JsNumber.ToString(MaxLines)} líneas.");
            var lines = rawLines.EnumerateArray().Select(ReadLine).ToList();
            var adjustments = ReadAdjustments(Get(raw, "adjustments"));
            var rawIssues = Get(raw, "issues");
            if (!IsUndefined(rawIssues) && (!IsArray(rawIssues) || rawIssues.GetArrayLength() > 30 ||
                rawIssues.EnumerateArray().Any(issue => !IsString(issue) || Text(issue).Length > 400)))
                throw Fail("Incidencias del ticket no válidas.");
            List<string> issues = IsUndefined(rawIssues) ? [] : [.. rawIssues.EnumerateArray().Select(Text)];
            var check = TicketParser.CheckTicket([.. lines.Select(l => new CheckLine(l.AmountCents, l.DiscountCents, l.ReviewStatus == "pending"))],
                totalCents, [.. adjustments.Select(a => a.AmountCents)]);
            var acknowledged = IsTrue(Get(raw, "acknowledged"));
            if ((check.Status != "cuadra" || lines.Any(l => l.ReviewStatus == "pending") || adjustments.Any(a => a.NeedsReview || a.AmountCents is null) || issues.Count > 0) && !acknowledged)
                throw Fail("Confirma el guardado con las advertencias pendientes. Solo las líneas fiables actualizarán la despensa.");
            var rawDecisions = Get(raw, "decisions");
            if (!IsObject(rawDecisions)) throw Fail("Faltan las decisiones de los productos.");
            var decisions = new List<KeyValuePair<string, TicketDecision>>();
            foreach (var key in lines.Select(line => TicketText.NameKey(line.RawName)).Distinct(StringComparer.Ordinal))
                decisions.Add(new(key, ReadDecision(Get(rawDecisions, key), key)));
            var importId = ReadIdentifier(Get(raw, "importId"), "Identificador de importación");
            var sourceFingerprint = ReadIdentifier(Get(raw, "sourceFingerprint"), "Huella del origen");
            return ValidationResult<TicketSaveInput>.Valid(new TicketSaveInput(store, storeName, address, Text(dateValue), time, totalCents, lines, decisions,
                adjustments, issues, acknowledged, importId, sourceFingerprint, IsTrue(Get(raw, "distinctPurchase"))));
        }
        catch (InputError error)
        {
            return ValidationResult<TicketSaveInput>.Invalid(error.Message);
        }
    }

    /// <summary>validateLineUpdate: { itemId } o { itemId: null }.</summary>
    public static ValidationResult<TicketLineUpdate> ValidateLineUpdate(JsonElement raw)
    {
        if (!IsObject(raw) || !Has(raw, "itemId")) return ValidationResult<TicketLineUpdate>.Invalid("Falta el campo «itemId» (id del producto o null).");
        var itemId = Get(raw, "itemId");
        if (itemId.ValueKind == JsonValueKind.Null) return ValidationResult<TicketLineUpdate>.Valid(new TicketLineUpdate(null));
        if (!IsString(itemId) || Text(itemId) == "") return ValidationResult<TicketLineUpdate>.Invalid("El campo «itemId» debe ser un id o null.");
        return ValidationResult<TicketLineUpdate>.Valid(new TicketLineUpdate(Text(itemId)));
    }
}
