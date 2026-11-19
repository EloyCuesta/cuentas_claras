using System.Text.Json;
using System.Text.Json.Serialization;
using CuentasClaras.Domain.Tickets;

namespace CuentasClaras.Application.Tickets;

// Lo que devuelve la API de tickets, con los campos y el orden de Express (shared/tickets/types.ts y ticketParse.ts). Una
// propiedad que TypeScript deja undefined no se escribe (JsonIgnore WhenWritingNull); las que pueden ser null, sí.

/// <summary>Un ticket guardado, en resumen (PantryTicketSummary).</summary>
public sealed record TicketSummaryView(
    string Id, string Store, string StoreName, string Address, string Date, string? Time, long? TotalCents, long LinesCount,
    long ProductsCount, string CreatedAt);

/// <summary>Una línea guardada (PantryTicketLine). La evidencia es el JSON que se guardó, tal cual; sin ella no se escribe.</summary>
public sealed record TicketLineView(
    string Id, int Position, string RawName, long Quantity, long? UnitPriceCents, long? AmountCents, long DiscountCents, double? WeightKg,
    long? PricePerKgCents, string? TaxCode, string? ItemId, bool Occasional, string ReviewStatus, bool Confirmed,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] JsonElement? Evidence);

/// <summary>Un ticket guardado con sus líneas en orden, y sus ajustes y avisos tal como se guardaron (PantryTicket).</summary>
public sealed record TicketView(
    string Id, string Store, string StoreName, string Address, string Date, string? Time, long? TotalCents, long LinesCount,
    long ProductsCount, string CreatedAt, IReadOnlyList<TicketLineView> Lines, JsonElement Adjustments, JsonElement Issues)
{
    public TicketSummaryView Summary() => new(Id, Store, StoreName, Address, Date, Time, TotalCents, LinesCount, ProductsCount, CreatedAt);
}

public sealed record TicketBoxView(double X0, double Y0, double X1, double Y1)
{
    public static TicketBoxView From(TicketBox box) => new(box.X0, box.Y0, box.X1, box.Y1);
}

/// <summary>De qué imagen y franja sale una línea (en el orden en que lo escribe el lector de Express).</summary>
public sealed record TicketSourceView(int ImageIndex, int SegmentIndex, double Width, double Height, TicketBoxView Box)
{
    public static TicketSourceView From(TicketSource source) =>
        new(source.ImageIndex, source.SegmentIndex, source.Width, source.Height, TicketBoxView.From(source.Box));
}

public sealed record TicketDiscrepancyView(string Kind, string Verdict, long RecognizedCents, long CalculatedCents, string Explanation, IReadOnlyList<string> Reasons);

public sealed record TicketAmountOptionView(long Cents, string Origin);

/// <summary>Lo que leyó el OCR de una línea y por qué se eligió su importe (TicketEvidence).</summary>
public sealed record TicketEvidenceView(
    string Text,
    string? Reread,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Normalized,
    long? RecognizedCents,
    long? CalculatedCents,
    string SelectedBy,
    IReadOnlyList<string> Issues,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] TicketDiscrepancyView? Discrepancy,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyList<TicketAmountOptionView>? Options,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] TicketSourceView? Source)
{
    public static TicketEvidenceView From(TicketEvidence evidence) => new(
        evidence.Text, evidence.Reread, evidence.Normalized, evidence.RecognizedCents, evidence.CalculatedCents, evidence.SelectedBy, evidence.Issues,
        evidence.Discrepancy is { } discrepancy
            ? new TicketDiscrepancyView(discrepancy.Kind, discrepancy.Verdict, discrepancy.RecognizedCents, discrepancy.CalculatedCents,
                discrepancy.Explanation, discrepancy.Reasons)
            : null,
        evidence.Options?.Select(option => new TicketAmountOptionView(option.Cents, option.Origin)).ToList(),
        evidence.Source is { } source ? TicketSourceView.From(source) : null);
}

public sealed record ParsedTicketLineView(
    int Position, string RawName, string Key, long Quantity, long? UnitPriceCents, long? AmountCents, long DiscountCents, double? WeightKg,
    long? PricePerKgCents, string? TaxCode, IReadOnlyList<string> Flags, TicketEvidenceView Evidence);

public sealed record TicketAdjustmentView(
    string Id, string Label, string Kind, long? AmountCents, bool NeedsReview,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? OriginalText)
{
    public static TicketAdjustmentView From(TicketAdjustment adjustment) => new(
        adjustment.Id, adjustment.Label, adjustment.Kind, adjustment.AmountCents, adjustment.NeedsReview, adjustment.OriginalText);
}

public sealed record TicketCheckView(string Status, long LinesTotalCents, long? DifferenceCents, int Unreadable, int Pending);

public sealed record TicketTaxGroupView(string Code, long RateBasisPoints, long BaseCents, long TaxCents, long GrossCents);

/// <summary>El ticket leído (ParsedTicket), en el orden de parseTicket.</summary>
public sealed record ParsedTicketView(
    string Store, string StoreName, string Address, string? Date, string? Time, long? TotalCents, IReadOnlyList<ParsedTicketLineView> Lines,
    IReadOnlyList<TicketAdjustmentView> Adjustments, IReadOnlyList<string> Issues, TicketCheckView Check, IReadOnlyList<TicketTaxGroupView> TaxGroups,
    string? PaymentMethod,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyList<NonProductView>? NonProducts)
{
    public static ParsedTicketView From(ParsedTicket ticket) => new(
        ticket.Store, ticket.StoreName, ticket.Address, ticket.Date, ticket.Time, ticket.TotalCents,
        [.. ticket.Lines.Select(line => new ParsedTicketLineView(line.Position, line.RawName, line.Key, line.Quantity, line.UnitPriceCents,
            line.AmountCents, line.DiscountCents, line.WeightKg, line.PricePerKgCents, line.TaxCode, line.Flags, TicketEvidenceView.From(line.Evidence)))],
        [.. ticket.Adjustments.Select(TicketAdjustmentView.From)],
        ticket.Issues,
        new TicketCheckView(ticket.Check.Status, ticket.Check.LinesTotalCents, ticket.Check.DifferenceCents, ticket.Check.Unreadable, ticket.Check.Pending),
        [.. ticket.TaxGroups.Select(group => new TicketTaxGroupView(group.Code, group.RateBasisPoints, group.BaseCents, group.TaxCents, group.GrossCents))],
        ticket.PaymentMethod,
        ticket.NonProducts is null ? null : [.. ticket.NonProducts.Select(line => new NonProductView(line.Text, line.Source is null ? null : TicketSourceView.From(line.Source)))]);
}

/// <summary>Una línea que no parece un producto (texto y, si lo hay, de dónde sale).</summary>
public sealed record NonProductView(string Text, [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] TicketSourceView? Source);

/// <summary>Qué hacer con cada producto del ticket (TicketSuggestion): un producto, no seguirlo o uno nuevo.</summary>
public sealed record ItemSuggestionView(string Kind, string ItemId, string How);

public sealed record IgnoreSuggestionView(string Kind, string How);

public sealed record NewSuggestionView(string Kind, string Name, string Frequency);

/// <summary>
/// POST /api/despensa/tickets/leer (TicketDraft): el ticket leído, la sugerencia de cada clave (en el orden de
/// suggestForTicket), el ticket igual ya guardado (resumen, o entero si se reconoció por su contenido), el posible
/// duplicado, la huella del origen y el id de esta lectura.
/// </summary>
public sealed record TicketDraftView(
    ParsedTicketView Ticket, IReadOnlyDictionary<string, object> Suggestions, object? Duplicate, TicketSummaryView? PossibleDuplicate,
    string SourceFingerprint, string ImportId)
{
    /// <summary>
    /// El orden de las claves de un objeto de JavaScript: primero las que son índices de lista (un entero de 0 a 2^32 − 2 escrito
    /// sin ceros delante), de menor a mayor; después las demás, en el orden en que se añadieron.
    /// </summary>
    public static IReadOnlyList<string> JsObjectKeyOrder(IEnumerable<string> keys)
    {
        static bool IsIndex(string key) =>
            key.Length is > 0 and <= 10 && key.All(char.IsAsciiDigit) && (key == "0" || key[0] != '0') && ulong.Parse(key, System.Globalization.CultureInfo.InvariantCulture) < uint.MaxValue;
        var list = keys.ToList();
        return [.. list.Where(IsIndex).OrderBy(key => ulong.Parse(key, System.Globalization.CultureInfo.InvariantCulture)), .. list.Where(key => !IsIndex(key))];
    }

    public static object Suggestion(TicketSuggestion suggestion) => suggestion switch
    {
        ItemSuggestion item => new ItemSuggestionView(item.Kind, item.ItemId, item.How),
        IgnoreSuggestion ignore => new IgnoreSuggestionView(ignore.Kind, ignore.How),
        NewSuggestion created => new NewSuggestionView(created.Kind, created.Name, created.Frequency),
        _ => throw new ArgumentOutOfRangeException(nameof(suggestion)),
    };
}
