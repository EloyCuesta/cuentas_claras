using System.Text.Json;
using CuentasClaras.Application.Common;
using CuentasClaras.Application.Pantry.Contracts;
using CuentasClaras.Domain.Tickets;

namespace CuentasClaras.Application.Tickets;

/// <summary>Qué es un ticket ya guardado (server/modules/tickets/application/duplicates.ts).</summary>
public static class TicketDuplicates
{
    public static string Fingerprint(IHasher hasher, FingerprintInput input) =>
        hasher.Sha256Hex([new FingerprintPart(TicketIdentity.FingerprintSource(input), null)]);

    /// <summary>
    /// findDuplicate: el mismo ticket, si ya está guardado: desde la misma lectura o el mismo origen, con la misma huella o,
    /// en los guardados con una huella anterior, con el mismo contenido (entonces se devuelve el ticket entero, con sus líneas).
    /// </summary>
    public static async Task<object?> Find(ITicketStore store, IHasher hasher, FingerprintInput input, string? importId, string? sourceFingerprint)
    {
        var fingerprint = Fingerprint(hasher, input);
        var found = await store.FindByImport(importId ?? "", sourceFingerprint ?? "") ?? await store.FindByFingerprint(fingerprint);
        if (found is not null) return found;
        // Los tickets guardados con una huella anterior la conservan: se compara su contenido.
        foreach (var candidate in await store.Candidates(input.Date, input.TotalCents))
        {
            var saved = await store.GetTicket(candidate.Id);
            if (saved is not null && Fingerprint(hasher, Saved(saved, candidate.Store)) == fingerprint) return saved;
        }
        return null;
    }

    /// <summary>
    /// possibleDuplicate: otra compra en la misma tienda, con la misma fecha y el mismo total, a la misma hora (o sin hora en
    /// alguna de las dos): puede ser el mismo ticket leído de otra forma, y hay que confirmarlo.
    /// </summary>
    public static async Task<TicketSummaryView?> Possible(ITicketStore store, string storeKind, string storeName, string date, string? time, long? totalCents)
    {
        var aliasStore = TicketIdentity.AliasStoreOf(storeKind, storeName);
        bool SameTime(string? other) => other == time || other is null || time is null;
        return (await store.Candidates(date, totalCents))
            .FirstOrDefault(summary => TicketIdentity.AliasStoreOf(summary.Store, summary.StoreName) == aliasStore && SameTime(summary.Time));
    }

    /// <summary>La huella de un ticket guardado ({ ...saved, store }), con sus ajustes tal como se guardaron.</summary>
    private static FingerprintInput Saved(TicketView saved, string store) => new(
        store, saved.StoreName, saved.Date, saved.Time, saved.TotalCents,
        [.. saved.Lines.Select(line => new FingerprintLine(line.RawName, line.Quantity, line.UnitPriceCents, line.AmountCents, line.DiscountCents,
            line.WeightKg, line.PricePerKgCents))],
        saved.Adjustments.ValueKind == JsonValueKind.Array
            ? [.. saved.Adjustments.EnumerateArray().Select(adjustment => new FingerprintAdjustment(
                adjustment.TryGetProperty("kind", out var kind) && kind.ValueKind == JsonValueKind.String ? kind.GetString()! : "",
                adjustment.TryGetProperty("amountCents", out var cents) && cents.ValueKind == JsonValueKind.Number ? (long)cents.GetDouble() : null))]
            : []);
}

/// <summary>
/// Leer un ticket sin guardar nada (ReadTicket.ts): el texto (con OCR local si son imágenes), lo que se propone para cada
/// producto (lo aprendido en esa tienda y los nombres parecidos) y si ya estaba guardado. Sin transacción ni bloqueo: el
/// OCR tarda segundos y no debe parar los guardados; lo que importa se vuelve a comprobar al guardar, dentro del bloqueo
/// «tickets». El total nunca decide un importe: lo hace TicketParser. Si el OCR falla, un 400 que lo explica.
/// </summary>
public sealed class ReadTicket(ITicketStore store, IPantryCatalog pantry, ITicketReader reader, IHasher hasher, IClock clock, IIdGenerator ids)
{
    /// <summary>POST /api/despensa/tickets/leer: el cuerpo se valida entero antes de leer nada.</summary>
    public Task<TicketDraftView> Handle(JsonElement body, CancellationToken cancellationToken = default)
    {
        var input = TicketReadRequest.Read(body);
        return Execute(input.Source, input.Today, cancellationToken);
    }

    /// <summary><paramref name="hoy"/> es la fecha de hoy del navegador (la de un ticket sin fecha); sin ella, la del servidor.</summary>
    public async Task<TicketDraftView> Execute(TicketReadSource source, string? hoy, CancellationToken cancellationToken = default)
    {
        var today = hoy ?? clock.Today();
        IReadOnlyList<IReadOnlyList<OcrLine>> pages;
        string sourceFingerprint;
        if (source.Text is { } text)
        {
            pages = [TicketParser.LinesFromText(text)];
            sourceFingerprint = hasher.Sha256Hex([new FingerprintPart(TicketIdentity.PastedTextSource(text), null)]);
        }
        else
        {
            sourceFingerprint = hasher.Sha256Hex(TicketIdentity.ImagesSource(source.Images));
            try
            {
                pages = await reader.Read(source.Images, source.Segments, cancellationToken);
            }
            catch (Exception error) when (!(error is OperationCanceledException && cancellationToken.IsCancellationRequested))
            {
                // El lector ya ha explicado la causa en la consola.
                throw new AppError("VALIDATION", "No se ha podido leer la imagen. Prueba con otra captura más nítida.");
            }
        }

        var ticket = TicketParser.ParseTicket(pages);
        if (ticket.Lines.Count == 0)
            throw new AppError("VALIDATION", "No se ha encontrado ningún producto en el ticket. Prueba con una captura más nítida o pega el texto.");
        var learned = await store.Aliases(TicketIdentity.AliasStoreOf(ticket.Store, ticket.StoreName));
        var items = await pantry.ListItems();
        var suggestions = TicketMatcher.SuggestForTicket([.. ticket.Lines.Select(line => new SuggestionLine(line.Key, line.RawName))], learned,
            [.. items.Select(item => new CatalogItem(item.Id, item.Name))]);
        var date = ticket.Date ?? today;
        var duplicate = await TicketDuplicates.Find(store, hasher, new FingerprintInput(ticket.Store, ticket.StoreName, date, ticket.Time, ticket.TotalCents,
            [.. ticket.Lines.Select(line => new FingerprintLine(line.RawName, line.Quantity, line.UnitPriceCents, line.AmountCents, line.DiscountCents,
                line.WeightKg, line.PricePerKgCents))],
            [.. ticket.Adjustments.Select(adjustment => new FingerprintAdjustment(adjustment.Kind, adjustment.AmountCents))]), null, sourceFingerprint);
        var possible = duplicate is null
            ? await TicketDuplicates.Possible(store, ticket.Store, ticket.StoreName, date, ticket.Time, ticket.TotalCents)
            : null;
        // Object.fromEntries: un objeto de JavaScript pone primero las claves que son índices enteros.
        var byKey = new Dictionary<string, object>(StringComparer.Ordinal);
        var values = suggestions.ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal);
        foreach (var key in TicketDraftView.JsObjectKeyOrder(suggestions.Select(pair => pair.Key))) byKey[key] = TicketDraftView.Suggestion(values[key]);
        return new TicketDraftView(ParsedTicketView.From(ticket), byKey, duplicate, possible, sourceFingerprint, ids.NewId());
    }
}
