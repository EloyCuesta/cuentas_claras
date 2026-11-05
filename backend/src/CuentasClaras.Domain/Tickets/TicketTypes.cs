namespace CuentasClaras.Domain.Tickets;

// Los tipos de shared/tickets/types.ts. En las propiedades opcionales de TypeScript (`x?:`), null
// significa «no está» (undefined): JSON.stringify no las escribe. Los number son double donde
// TypeScript calcula con decimales (pesos, confianzas, posiciones) y long donde son céntimos o
// cantidades enteras, que la validación ya exige.

/// <summary>Un rectángulo de la imagen, en píxeles.</summary>
public sealed record TicketBox(double X0, double Y0, double X1, double Y1);

/// <summary>De qué imagen y franja sale una línea, y dónde está.</summary>
public sealed record TicketSource(int ImageIndex, int SegmentIndex, TicketBox Box, double Width, double Height);

/// <summary>Una palabra del OCR con su confianza (0 a 100).</summary>
public sealed record OcrWord(string Text, double Confidence, TicketBox Box);

/// <summary>Una línea leída de la imagen de un ticket. <see cref="Reread"/>: su parte final leída otra vez solo con cifras.</summary>
public sealed record OcrLine(string Text, string? Reread, double? Confidence = null, IReadOnlyList<OcrWord>? Words = null, TicketSource? Source = null);

/// <summary>Por qué el importe leído no coincide con el calculado y qué indica cada evidencia.</summary>
public sealed record TicketDiscrepancy(string Kind, string Verdict, long RecognizedCents, long CalculatedCents, string Explanation, IReadOnlyList<string> Reasons);

/// <summary>Un importe que la revisión ofrece como botón («Usar 9,90 €»), con su origen.</summary>
public sealed record TicketAmountOption(long Cents, string Origin);

/// <summary>Lo que leyó el OCR de una línea y por qué se eligió su importe.</summary>
public sealed record TicketEvidence(
    string Text,
    string? Reread,
    long? RecognizedCents,
    long? CalculatedCents,
    string SelectedBy,
    IReadOnlyList<string> Issues,
    string? Normalized = null,
    TicketDiscrepancy? Discrepancy = null,
    IReadOnlyList<TicketAmountOption>? Options = null,
    TicketSource? Source = null);

/// <summary>Un descuento, cupón o promoción del ticket. AmountCents con signo (los descuentos restan); null es desconocido, nunca cero.</summary>
public sealed record TicketAdjustment(string Id, string Label, string Kind, long? AmountCents, bool NeedsReview, string? OriginalText = null);

/// <summary>Una línea tal como la envía la revisión al guardar (TicketSaveLine).</summary>
public sealed record TicketSaveLine(
    string RawName,
    long Quantity,
    long? UnitPriceCents,
    long? AmountCents,
    long DiscountCents,
    double? WeightKg,
    long? PricePerKgCents,
    string? TaxCode,
    bool Occasional,
    string? ReviewStatus = null,
    bool? Confirmed = null,
    TicketEvidence? Evidence = null);

/// <summary>Qué hacer con un producto del ticket al guardarlo.</summary>
public abstract record TicketDecision(string Kind);

public sealed record ItemDecision(string ItemId) : TicketDecision("item");

public sealed record NewItemDecision(string Name, string? OwnerId, string Frequency) : TicketDecision("new");

public sealed record IgnoreDecision() : TicketDecision("ignore");

/// <summary>Lo que envía la revisión al guardar: cabecera, líneas y una decisión por producto (clave nameKey del nombre).</summary>
public sealed record TicketSaveInput(
    string Store,
    string StoreName,
    string Address,
    string Date,
    string? Time,
    long? TotalCents,
    IReadOnlyList<TicketSaveLine> Lines,
    IReadOnlyList<KeyValuePair<string, TicketDecision>> Decisions,
    IReadOnlyList<TicketAdjustment> Adjustments,
    IReadOnlyList<string> Issues,
    bool Acknowledged,
    string? ImportId,
    string? SourceFingerprint,
    bool DistinctPurchase);

/// <summary>Un cálculo de céntimos con operandos que no son enteros seguros de JavaScript.</summary>
public sealed class TicketCalculationException() : InvalidOperationException("Cálculo monetario no válido");
