using CuentasClaras.Domain.Common;

namespace CuentasClaras.Domain.Tickets;

/// <summary>Una lectura del importe con sus cifras en bruto (incluidas las que el OCR pegó detrás: «7,920» → «7920»).</summary>
/// <param name="Malformed">Tenía cifras pegadas o sobrantes: el campo se leyó mal con seguridad.</param>
/// <param name="Printed">Cómo se leyó, para enseñarlo tal cual («7,920»).</param>
public sealed record AmountReading(long Cents, string RawDigits, bool Malformed, string? Printed = null);

/// <summary>La confianza de Tesseract en el importe y en los datos de la multiplicación, si se conoce.</summary>
public sealed record OcrConfidence(double? Amount = null, double? Inputs = null);

/// <summary>Lo que se sabe de las lecturas de una línea para decidir qué cifra está mal leída.</summary>
/// <param name="Recognized">La lectura elegida (normal o relectura).</param>
/// <param name="Readings">Todas las lecturas del importe que hay (1 o 2).</param>
/// <param name="InputsStable">Las dos pasadas del OCR leyeron igual los datos de la multiplicación.</param>
/// <param name="AmountStable">Hay dos pasadas y leyeron el mismo importe.</param>
public sealed record AmountEvidence(AmountReading Recognized, IReadOnlyList<AmountReading> Readings, bool InputsStable, bool AmountStable, OcrConfidence? Confidence = null);

/// <summary>
/// Qué cifra está mal leída cuando el importe de una línea no coincide con su multiplicación
/// (shared/tickets/ticketEvidence.ts). Un OCR suele equivocarse en una cifra: se comprueba si un
/// solo error en el importe o en los datos de la multiplicación explica la lectura, qué campo es
/// inestable entre las dos pasadas, si otra lectura da el cálculo y la confianza de cada palabra.
/// El total del ticket nunca interviene. Mensajes y orden de las comprobaciones, los de TypeScript.
/// </summary>
public static class TicketEvidenceRules
{
    public const string Insertion = "insercion";
    public const string Omission = "omision";
    public const string Substitution = "sustitucion";
    public const string Transposition = "transposicion";

    private static readonly Dictionary<string, string> EditText = new(StringComparer.Ordinal)
    {
        [Insertion] = "una cifra de más",
        [Omission] = "una cifra de menos",
        [Substitution] = "una cifra cambiada",
        [Transposition] = "dos cifras intercambiadas",
    };

    private const double Confident = 85;
    private const double Margin = 15;

    /// <summary>singleDigitEdit: el único error de una cifra que convierte <paramref name="expected"/> en <paramref name="read"/>; null si son iguales o hace falta más de uno.</summary>
    public static string? SingleDigitEdit(string read, string expected)
    {
        if (read == expected || !IsDigits(read) || !IsDigits(expected)) return null;
        if (read.Length == expected.Length + 1)
        {
            for (var i = 0; i < read.Length; i++)
                if (read[..i] + read[(i + 1)..] == expected) return Insertion;
            return null;
        }
        if (read.Length + 1 == expected.Length) return SingleDigitEdit(expected, read) == Insertion ? Omission : null;
        if (read.Length != expected.Length) return null;
        var diff = new List<int>();
        for (var i = 0; i < read.Length; i++)
            if (read[i] != expected[i]) diff.Add(i);
        if (diff.Count == 1) return Substitution;
        if (diff.Count == 2 && diff[1] == diff[0] + 1 && read[diff[0]] == expected[diff[1]] && read[diff[1]] == expected[diff[0]]) return Transposition;
        return null;
    }

    /// <summary>singleEditVariants: las cadenas a un error de <paramref name="digits"/>, en el orden en que las añade el Set de TypeScript (decide qué alternativa se cita).</summary>
    public static IReadOnlyList<string> SingleEditVariants(string digits)
    {
        var ordered = new List<string>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        void Add(string variant)
        {
            if (seen.Add(variant)) ordered.Add(variant);
        }
        for (var i = 0; i <= digits.Length; i++)
        {
            foreach (var d in "0123456789")
            {
                Add(digits[..i] + d + digits[i..]);
                if (i < digits.Length) Add(digits[..i] + d + digits[(i + 1)..]);
            }
            if (i < digits.Length) Add(digits[..i] + digits[(i + 1)..]);
            if (i + 1 < digits.Length) Add(digits[..i] + digits[i + 1] + digits[i] + digits[(i + 2)..]);
        }
        return [.. ordered.Where(variant => variant != digits && variant.Length > 0)];
    }

    /// <summary>printedDigits: las cifras de un importe como se imprime: 990 → «990» (9,90); 95 → «095» (0,95).</summary>
    public static string PrintedDigits(long cents)
    {
        var absolute = Math.Abs(cents);
        return JsNumber.ToString(absolute / 100) + JsNumber.ToString(absolute % 100).PadLeft(2, '0');
    }

    /// <summary>assessUnits: precio × cantidad. null si la línea es coherente.</summary>
    public static TicketDiscrepancy? AssessUnits(AmountEvidence evidence, long unitCents, long quantity)
    {
        var recognized = evidence.Recognized;
        var calculatedCents = (recognized.Cents == 0 ? 1 : Math.Sign(recognized.Cents)) * unitCents * quantity;
        if (calculatedCents == recognized.Cents) return null;
        var target = Math.Abs(recognized.Cents);
        string? alternative = null;
        foreach (var variant in SingleEditVariants(PrintedDigits(unitCents)))
        {
            var price = JsNumber.Parse(variant);
            if (price * quantity == target)
            {
                alternative = $"Un precio unitario de {Money.FormatEuros((long)price)} en lugar de {Money.FormatEuros(unitCents)} también daría {Money.FormatEuros(target)}.";
                break;
            }
        }
        if (alternative is null)
        {
            foreach (var variant in SingleEditVariants(JsNumber.ToString(quantity)))
            {
                var q = JsNumber.Parse(variant);
                if (q >= 1 && q <= 999 && q * unitCents == target)
                {
                    alternative = $"Una cantidad de {JsNumber.ToString(q)} en lugar de {JsNumber.ToString(quantity)} también daría {Money.FormatEuros(target)}.";
                    break;
                }
            }
        }
        return Decide(calculatedCents, "units", evidence, alternative, $"{Money.FormatEuros(unitCents)} × {JsNumber.ToString(quantity)}");
    }

    /// <summary>assessWeight: peso × precio por kilo, redondeado al céntimo. null si la línea es coherente.</summary>
    public static TicketDiscrepancy? AssessWeight(AmountEvidence evidence, long grams, long pricePerKgCents)
    {
        var recognized = evidence.Recognized;
        var sign = recognized.Cents < 0 ? -1 : 1;
        var calculatedCents = sign * TicketArithmetic.RoundRatio((double)grams * pricePerKgCents, 1000);
        if (calculatedCents == recognized.Cents) return null;
        var target = Math.Abs(recognized.Cents);
        string? alternative = null;
        foreach (var variant in SingleEditVariants(JsNumber.ToString(grams).PadLeft(4, '0')))
        {
            var g = JsNumber.Parse(variant);
            if (g >= 1 && g <= 1_000_000 && TicketArithmetic.RoundRatio(g * pricePerKgCents, 1000) == target)
            {
                alternative = $"Un peso de {GramsText(g)} en lugar de {GramsText(grams)} también daría {Money.FormatEuros(target)}.";
                break;
            }
        }
        if (alternative is null)
        {
            foreach (var variant in SingleEditVariants(PrintedDigits(pricePerKgCents)))
            {
                var price = JsNumber.Parse(variant);
                if (TicketArithmetic.RoundRatio(grams * price, 1000) == target)
                {
                    alternative = $"Un precio de {Money.FormatEuros((long)price)}/kg en lugar de {Money.FormatEuros(pricePerKgCents)}/kg también daría {Money.FormatEuros(target)}.";
                    break;
                }
            }
        }
        return Decide(calculatedCents, "weight", evidence, alternative, $"{GramsText(grams)} × {Money.FormatEuros(pricePerKgCents)}/kg");
    }

    private static TicketDiscrepancy Decide(long calculatedCents, string kind, AmountEvidence common, string? alternative, string operation)
    {
        var recognized = common.Recognized;
        var readings = common.Readings;
        var calculatedDigits = PrintedDigits(calculatedCents);
        var edit = readings.Select(reading => SingleDigitEdit(reading.RawDigits, calculatedDigits)).FirstOrDefault(found => found is not null);
        // recognized difiere del cálculo, así que una lectura que lo iguala es la otra pasada del OCR.
        var independent = readings.Any(reading => reading.Cents == calculatedCents);
        var read = recognized.Malformed && !string.IsNullOrEmpty(recognized.Printed) ? $"«{recognized.Printed}»" : Money.FormatEuros(recognized.Cents);
        var calc = Money.FormatEuros(calculatedCents);
        var reasons = new List<string>();
        var @base = $"El importe leído ({read}) no coincide con {operation} = {calc}.";
        TicketDiscrepancy Result(string verdict, string explanation) => new(kind, verdict, recognized.Cents, calculatedCents, $"{@base} {explanation}", reasons);

        if (edit is not null) reasons.Add($"Un error de lectura en el importe ({EditText[edit]}) explica {read} a partir de {calc}.");
        if (alternative is not null) reasons.Add(alternative);

        if (independent)
        {
            reasons.Add($"Otra lectura del OCR da exactamente {calc}.");
            return Result("calculation", $"Una segunda lectura del OCR da {calc}: se propone ese importe.");
        }
        if (edit is not null && alternative is null)
        {
            reasons.Add(kind == "units" ? "Ningún error de una cifra en el precio o la cantidad daría la cifra leída." :
                "Ningún error de una cifra en el peso o el precio por kilo daría la cifra leída.");
            return Result("calculation", $"Se explica por {EditText[edit]} en el importe: se propone {calc}.");
        }
        if (edit is null && alternative is not null)
            return Result("read", $"Un error en {(kind == "units" ? "el precio o la cantidad" : "el peso o el precio por kilo")} lo explica mejor que uno en el importe: revisa esos datos.");
        if (readings.Count > 1 && !common.AmountStable && common.InputsStable)
        {
            reasons.Add("Las dos lecturas del OCR coinciden en la multiplicación y discrepan en el importe.");
            if (edit is not null) return Result("calculation", $"El importe es la cifra inestable y {EditText[edit]} lo explica: se propone {calc}.");
        }
        if (readings.Count > 1 && common.AmountStable && !common.InputsStable && alternative is not null)
        {
            reasons.Add("Las dos lecturas del OCR coinciden en el importe y discrepan en la multiplicación.");
            return Result("read", "Los datos de la multiplicación son la cifra inestable: revísalos.");
        }
        if (edit is not null && recognized.Malformed)
        {
            reasons.Add("El importe leído tiene cifras sobrantes pegadas.");
            return Result("calculation", $"El importe leído está deformado y {EditText[edit]} lo explica: se propone {calc}.");
        }
        if (common.Confidence is { Amount: { } amount, Inputs: { } inputs })
        {
            if (inputs >= Confident && amount <= inputs - Margin)
            {
                reasons.Add($"El OCR confía más en la multiplicación ({Percent(inputs)} %) que en el importe ({Percent(amount)} %).");
                if (edit is not null) return Result("calculation", $"La lectura del importe es la menos fiable: se propone {calc}.");
            }
            if (amount >= Confident && inputs <= amount - Margin)
            {
                reasons.Add($"El OCR confía más en el importe ({Percent(amount)} %) que en la multiplicación ({Percent(inputs)} %).");
                if (alternative is not null) return Result("read", "La lectura de la multiplicación es la menos fiable: revísala.");
            }
        }
        return Result("ambiguous", edit is not null && alternative is not null
            ? "Tanto un error en el importe como uno en la multiplicación lo explican, y nada en el ticket permite saber cuál: elige tú el importe correcto."
            : "Harían falta varios errores de lectura para explicarlo: comprueba la línea en la imagen.");
    }

    /// <summary>Math.round(x) escrito como String(x): las mitades hacia arriba (84,5 → 85; −2,5 → −2).</summary>
    private static string Percent(double value) => JsNumber.ToString(JsNumber.Round(value));

    /// <summary>gramsText: «0,544 kg», con toFixed(3) y la primera «.» cambiada por «,».</summary>
    private static string GramsText(double grams)
    {
        var text = JsNumber.ToFixed(grams / 1000, 3);
        var point = text.IndexOf('.');
        return (point < 0 ? text : text[..point] + "," + text[(point + 1)..]) + " kg";
    }

    private static bool IsDigits(string text) => text.Length > 0 && text.All(unit => unit is >= '0' and <= '9');
}
