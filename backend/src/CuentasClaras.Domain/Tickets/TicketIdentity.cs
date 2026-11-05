using System.Text;
using System.Text.RegularExpressions;
using CuentasClaras.Domain.Common;

namespace CuentasClaras.Domain.Tickets;

/// <summary>Lo que entra en la huella de una línea guardada.</summary>
public sealed record FingerprintLine(string RawName, long Quantity, long? UnitPriceCents, long? AmountCents, long DiscountCents, double? WeightKg, long? PricePerKgCents);

/// <summary>Lo que entra en la huella de un ajuste.</summary>
public sealed record FingerprintAdjustment(string Kind, long? AmountCents);

/// <summary>Lo que entra en la huella de un ticket guardado.</summary>
public sealed record FingerprintInput(
    string Store, string StoreName, string Date, string? Time, long? TotalCents,
    IReadOnlyList<FingerprintLine> Lines, IReadOnlyList<FingerprintAdjustment>? Adjustments = null);

/// <summary>Una parte de lo que se resume en una huella: un texto (que el Hasher pasa a UTF-8, como hash.update de Node) o unos bytes.</summary>
public sealed record FingerprintPart(string? Text, byte[]? Bytes);

/// <summary>
/// Qué identifica un ticket (server/modules/tickets/domain/ticketIdentity.ts): la tienda donde se
/// aprende lo que es cada nombre y el texto del que sale la huella (SHA-256) que impide guardarlo dos
/// veces. No cambies estos textos: las huellas ya guardadas dejarían de coincidir (hay tres golden en
/// el corpus de tickets y en server/modules/tickets/tickets.test.ts).
/// </summary>
public static class TicketIdentity
{
    private static readonly Regex Spaces = JsRegex.Create(@"\s+");

    /// <summary>aliasStoreOf: las equivalencias se aprenden por tienda: «lidl», o «otra:» y el nombre normalizado de la tienda.</summary>
    public static string AliasStoreOf(string store, string storeName) => store == "lidl" ? "lidl" : $"otra:{TicketText.NameKey(storeName)}";

    /// <summary>
    /// fingerprintSource: tienda, fecha, hora, total, líneas y ajustes, sin que importe el orden de las
    /// líneas ni de los ajustes. Es JSON.stringify byte a byte (<see cref="JsJson"/>), con .sort() de
    /// JavaScript: por unidades UTF-16 (ordinal), nunca por la cultura.
    /// </summary>
    public static string FingerprintSource(FingerprintInput input)
    {
        var lines = input.Lines
            .Select(line => JsJson.Array([
                JsJson.String(TicketText.NameKey(line.RawName)),
                JsJson.Number(line.Quantity),
                JsJson.Number(line.UnitPriceCents),
                JsJson.Number(line.AmountCents),
                JsJson.Number(line.DiscountCents),
                line.WeightKg is { } weightKg ? JsJson.Number(JsNumber.Round(weightKg * 1000)) : "null",
                JsJson.Number(line.PricePerKgCents),
            ]))
            .OrderBy(line => line, StringComparer.Ordinal);
        var adjustments = (input.Adjustments ?? [])
            .Select(adjustment => JsJson.Array([JsJson.String(adjustment.Kind), JsJson.Number(adjustment.AmountCents)]))
            .OrderBy(adjustment => adjustment, StringComparer.Ordinal);
        return JsJson.Array([
            JsJson.String(AliasStoreOf(input.Store, input.StoreName)),
            JsJson.String(input.Date),
            JsJson.StringOrNull(input.Time),
            JsJson.Number(input.TotalCents),
            JsJson.Array(lines.Select(JsJson.String)),
            JsJson.Array(adjustments.Select(JsJson.String)),
        ]);
    }

    /// <summary>pastedTextSource: el mismo texto con otros espacios o saltos de línea es el mismo ticket (NFC y los espacios de JavaScript).</summary>
    public static string PastedTextSource(string text) => JsText.Trim(Spaces.Replace(JsText.Normalize(text, NormalizationForm.FormC), " "));

    /// <summary>imagesSource: cada imagen, con su tamaño delante, byte a byte y en orden.</summary>
    public static IReadOnlyList<FingerprintPart> ImagesSource(IReadOnlyList<byte[]> images) =>
        [.. images.SelectMany(image => new[] { new FingerprintPart(JsNumber.ToString(image.Length), null), new FingerprintPart(null, image) })];
}
