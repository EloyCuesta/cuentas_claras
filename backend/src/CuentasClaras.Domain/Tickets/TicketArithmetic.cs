using CuentasClaras.Domain.Common;

namespace CuentasClaras.Domain.Tickets;

/// <summary>Cálculos de una línea, comunes al servidor y a la revisión (shared/tickets/ticketArithmetic.ts).</summary>
public static class TicketArithmetic
{
    /// <summary>
    /// roundRatio: división entera con las mitades lejos de cero, también en devoluciones. Lanza si un
    /// operando no es un entero seguro de JavaScript (|x| ≤ 2^53 − 1) o el divisor no es positivo. Se
    /// calcula en doble, como TypeScript, para dar lo mismo también cerca de 2^53.
    /// </summary>
    public static long RoundRatio(double numerator, double denominator)
    {
        if (!JsNumber.IsSafeInteger(numerator) || !JsNumber.IsSafeInteger(denominator) || denominator <= 0)
            throw new TicketCalculationException();
        return (long)(Math.Sign(numerator) * Math.Floor((Math.Abs(numerator) + Math.Floor(denominator / 2)) / denominator));
    }

    /// <summary>calculatedAmount: peso × precio por kilo (con el peso en gramos como Math.round) o cantidad × precio, con el signo del importe.</summary>
    public static long? CalculatedAmount(TicketSaveLine line)
    {
        var sign = line.AmountCents is < 0 ? -1 : 1;
        if (line.WeightKg is { } weightKg && line.PricePerKgCents is { } pricePerKg)
            return sign * RoundRatio(JsNumber.Round(weightKg * 1000) * pricePerKg, 1000);
        return line.UnitPriceCents is { } unitPrice ? sign * line.Quantity * unitPrice : null;
    }

    /// <summary>lineProblems: lo que impide fiarse de una línea, independientemente del OCR, en su orden.</summary>
    public static IReadOnlyList<string> LineProblems(TicketSaveLine line)
    {
        var problems = new List<string>();
        if (line.AmountCents is null) problems.Add("Falta el importe");
        if (line.Quantity is < 1 or > 999) problems.Add("Cantidad no válida");
        if (line.WeightKg is { } weightKg && (!double.IsFinite(weightKg) || JsNumber.Round(weightKg * 1000) < 1)) problems.Add("Peso no válido");
        var calculated = CalculatedAmount(line);
        if (calculated is not null && line.AmountCents is not null && calculated != line.AmountCents) problems.Add("El importe no coincide con cantidad o peso × precio");
        if (line.AmountCents is { } amount && line.DiscountCents > Math.Max(0, amount)) problems.Add("Descuento mayor que el importe");
        return problems;
    }

    /// <summary>canApplyLine: solo una línea fiable (con importe, sin problemas y confirmada o sin incidencias) cambia la despensa.</summary>
    public static bool CanApplyLine(TicketSaveLine line)
    {
        if (line.AmountCents is null or < 0 || line.ReviewStatus == "pending") return false;
        return LineProblems(line).Count == 0 && (line.Confirmed == true || (line.Evidence?.Issues.Count ?? 0) == 0);
    }
}
