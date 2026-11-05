namespace CuentasClaras.Domain.Tickets;

// Lo que devuelve el analizador de tickets (los tipos de shared/tickets/ticketParse.ts).

/// <summary>Una línea de producto leída del ticket.</summary>
/// <param name="Key">La clave para emparejar con productos (nameKey).</param>
/// <param name="AmountCents">Antes de descuentos; negativo en una devolución; null si no se ha podido leer.</param>
/// <param name="DiscountCents">Descuentos aplicados a esta línea, en positivo.</param>
/// <param name="Flags">ilegible, deducido, corregido o dudoso, en el orden en que se marcan.</param>
public sealed record ParsedTicketLine(
    int Position,
    string RawName,
    string Key,
    long Quantity,
    long? UnitPriceCents,
    long? AmountCents,
    long DiscountCents,
    double? WeightKg,
    long? PricePerKgCents,
    string? TaxCode,
    IReadOnlyList<string> Flags,
    TicketEvidence Evidence);

/// <summary>La comprobación con el total: cuadra, pendiente, no_cuadra, incompleto o sin_total.</summary>
public sealed record TicketCheck(string Status, long LinesTotalCents, long? DifferenceCents, int Unreadable, int Pending);

/// <summary>Un grupo del desglose de IVA: «B 10% 25,50 2,55» → base 25,50 € + cuota 2,55 € = 28,05 €.</summary>
/// <param name="RateBasisPoints">En puntos básicos: 10 % = 1000.</param>
public sealed record TicketTaxGroup(string Code, long RateBasisPoints, long BaseCents, long TaxCents, long GrossCents);

/// <summary>Un grupo del desglose comparado con sus artículos; null si alguno no tiene importe.</summary>
public sealed record TaxGroupCheck(string Code, long GrossCents, long? LinesCents, long? DifferenceCents);

public sealed record TaxGroupsCheck(bool Conclusive, int Mismatches, IReadOnlyList<TaxGroupCheck> Groups);

/// <summary>Lo que checkTicket mira de una línea.</summary>
public sealed record CheckLine(long? AmountCents, long DiscountCents, bool Pending = false);

/// <summary>Lo que checkTaxGroups mira de una línea.</summary>
public sealed record TaxLine(long? AmountCents, long DiscountCents, string? TaxCode);

/// <summary>El ticket leído: tienda, fecha, total, productos, ajustes, la comprobación y lo que hay que revisar.</summary>
/// <param name="Time">Hora de la compra (HH:MM).</param>
/// <param name="PaymentMethod">«Lidl Pay», «Tarjeta», «Efectivo»… Nunca un número de tarjeta.</param>
public sealed record ParsedTicket(
    string Store,
    string StoreName,
    string Address,
    string? Date,
    string? Time,
    long? TotalCents,
    IReadOnlyList<ParsedTicketLine> Lines,
    TicketCheck Check,
    IReadOnlyList<TicketAdjustment> Adjustments,
    IReadOnlyList<string> Issues,
    IReadOnlyList<TicketTaxGroup> TaxGroups,
    string? PaymentMethod);
