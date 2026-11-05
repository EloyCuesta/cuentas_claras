using CuentasClaras.Domain.Common;

namespace CuentasClaras.Domain.Tickets;

/// <summary>
/// Lo que deja un ticket guardado en la despensa (server/modules/tickets/domain/ticketPurchase.ts): el
/// precio y la cantidad de cada producto, la unidad de los nuevos y si cada línea es fiable. Solo las
/// líneas fiables (canApplyLine) cambian precios, cantidades y el ritmo.
/// </summary>
public static class TicketPurchaseRules
{
    private static readonly string[] CountUnits = [TicketVocabulary.Units, "paquete", "lata", "botella", "bolsa", "docena"];

    private static long Paid(TicketSaveLine line) => (line.AmountCents ?? 0) - line.DiscountCents;

    private static bool IsCountUnit(string unit) => CountUnits.Contains(unit, StringComparer.Ordinal);

    /// <summary>priceFromLines: el precio por unidad (o por kilo) que deja la última línea fiable, si la unidad lo permite.</summary>
    public static long? PriceFromLines(IReadOnlyList<TicketSaveLine> lines, string unit)
    {
        var last = lines.Where(TicketArithmetic.CanApplyLine).LastOrDefault();
        if (last is null) return null;
        long? price = null;
        if (last.WeightKg is { } weightKg && unit is TicketVocabulary.Kilos or TicketVocabulary.Grams)
            price = TicketArithmetic.RoundRatio((double)Paid(last) * 1000, JsNumber.Round(weightKg * 1000));
        else if (last.WeightKg is null && IsCountUnit(unit))
            price = TicketArithmetic.RoundRatio(Paid(last), last.Quantity);
        return price is >= 0 and <= TicketVocabulary.MaxPantryCents ? price : null;
    }

    /// <summary>quantityFromLines: cuánto se compró en la unidad del producto (kilos o gramos si todas se pesan; unidades si ninguna).</summary>
    public static double? QuantityFromLines(IReadOnlyList<TicketSaveLine> lines, string unit)
    {
        var bought = lines.Where(TicketArithmetic.CanApplyLine).ToList();
        if (bought.Count == 0) return null;
        if (bought.All(line => line.WeightKg is not null))
        {
            double grams = 0;
            foreach (var line in bought) grams += JsNumber.Round(line.WeightKg!.Value * 1000);
            if (unit == TicketVocabulary.Kilos) return grams / 1000;
            if (unit == TicketVocabulary.Grams) return grams;
            return null;
        }
        if (bought.All(line => line.WeightKg is null) && IsCountUnit(unit))
        {
            double quantity = 0;
            foreach (var line in bought) quantity += line.Quantity;
            return quantity;
        }
        return null;
    }

    /// <summary>newItemUnit: kg si todas sus líneas fiables se pesan (también si no hay ninguna); si no, ud.</summary>
    public static string NewItemUnit(IReadOnlyList<TicketSaveLine> usableLines) =>
        usableLines.All(line => line.WeightKg is not null) ? TicketVocabulary.Kilos : TicketVocabulary.Units;

    /// <summary>lineReviewStatus: verificada si es fiable o es una devolución que nadie ha dejado pendiente; si no, pendiente.</summary>
    public static string LineReviewStatus(TicketSaveLine line)
    {
        var confirmedReturn = line.AmountCents is < 0 && line.ReviewStatus != "pending";
        return TicketArithmetic.CanApplyLine(line) || confirmedReturn ? "verified" : "pending";
    }
}
