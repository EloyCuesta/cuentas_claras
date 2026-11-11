using System.Text.Json;
using CuentasClaras.Application.Common;
using CuentasClaras.Application.Pantry.Contracts;
using CuentasClaras.Domain.Tickets;

namespace CuentasClaras.Application.Tickets;

/// <summary>POST /api/despensa/tickets: el ticket guardado, entero, y todos los productos de la despensa.</summary>
public sealed record TicketSavedView(TicketView Ticket, IReadOnlyList<PantryItemView> Items);

/// <summary>
/// Guardar un ticket revisado (SaveTicket.ts), todo o nada, en una transacción con el bloqueo «tickets»: dos guardados a la vez
/// van uno detrás de otro. Antes de leer nada se bloquean también los productos que ya existían (en orden de id), así que un +
/// a la vez no se pierde.
/// 1. 409 si ya estaba guardado, o si hay otra compra igual y no se ha confirmado que es distinta (dentro del bloqueo: el
///    segundo de dos guardados iguales ve el primero).
/// 2. Cada producto del ticket (las líneas con el mismo nombre normalizado van juntas) se asocia a uno de la despensa, a uno
///    nuevo (uno por nombre y persona, aunque venga en varias líneas) o a ninguno, según su decisión.
/// 3. Se recuerda lo aprendido en esa tienda, y los productos que ya existían reciben el precio y, si se cuentan, lo comprado.
/// 4. Se guardan el ticket y sus líneas, también las dudosas, que quedan pendientes y no cambian la despensa.
/// Solo las líneas fiables (CanApplyLine) crean productos, cambian precios y cantidades o cuentan para lo aprendido.
/// </summary>
public sealed class SaveTicket(ITicketStore store, IPantryCatalog pantry, IHasher hasher, IClock clock, IIdGenerator ids, IUnitOfWork unitOfWork)
{
    /// <summary>POST /api/despensa/tickets: validateTicketSave, o un 400 con su mensaje.</summary>
    public Task<TicketSavedView> Handle(JsonElement body)
    {
        var result = TicketRequests.ValidateTicketSave(body);
        if (!result.Ok) throw new AppError("VALIDATION", result.Error!);
        return Execute(result.Value!);
    }

    public static FingerprintInput FingerprintOf(TicketSaveInput input) => new(
        input.Store, input.StoreName, input.Date, input.Time, input.TotalCents,
        [.. input.Lines.Select(line => new FingerprintLine(line.RawName, line.Quantity, line.UnitPriceCents, line.AmountCents, line.DiscountCents,
            line.WeightKg, line.PricePerKgCents))],
        [.. input.Adjustments.Select(adjustment => new FingerprintAdjustment(adjustment.Kind, adjustment.AmountCents))]);

    public Task<TicketSavedView> Execute(TicketSaveInput input) => unitOfWork.Run(async () =>
    {
        // Las líneas de cada clave, en el orden en que aparece cada clave (un Map de JavaScript).
        var keys = new List<string>();
        var linesByKey = new Dictionary<string, List<TicketSaveLine>>(StringComparer.Ordinal);
        foreach (var line in input.Lines)
        {
            var key = TicketText.NameKey(line.RawName);
            if (!linesByKey.TryGetValue(key, out var lines))
            {
                linesByKey[key] = lines = [];
                keys.Add(key);
            }
            lines.Add(line);
        }
        // input.decisions[key]: con claves repetidas, la última.
        var decisions = new Dictionary<string, TicketDecision>(StringComparer.Ordinal);
        foreach (var (key, decision) in input.Decisions) decisions[key] = decision;

        // Los productos que ya existen y van a cambiar se bloquean antes de cualquier lectura.
        var existing = keys.Select(key => decisions.GetValueOrDefault(key)).OfType<ItemDecision>().Select(decision => decision.ItemId)
            .Distinct(StringComparer.Ordinal).ToList();
        await pantry.LockItems(existing);

        var duplicate = await TicketDuplicates.Find(store, hasher, FingerprintOf(input), input.ImportId, input.SourceFingerprint);
        if (duplicate is not null)
        {
            var (storeName, date) = duplicate switch
            {
                TicketSummaryView summary => (summary.StoreName, summary.Date),
                TicketView ticket => (ticket.StoreName, ticket.Date),
                _ => throw new InvalidOperationException("Duplicado desconocido."),
            };
            throw new AppError("CONFLICT", $"Este ticket ya está guardado ({storeName}, {string.Join('/', date.Split('-').Reverse())}).");
        }
        if (!input.DistinctPurchase && await TicketDuplicates.Possible(store, input.Store, input.StoreName, input.Date, input.Time, input.TotalCents) is not null)
            throw new AppError("CONFLICT", "Hay una compra con la misma fecha, hora y total. Confirma si se trata de otra compra.");
        var aliasStore = TicketIdentity.AliasStoreOf(input.Store, input.StoreName);
        var now = clock.NowIso();

        // Producto de cada clave: uno que ya existe, uno nuevo (uno por nombre y persona) o ninguno.
        var itemOfKey = new Dictionary<string, string?>(StringComparer.Ordinal);
        var created = new Dictionary<string, string>(StringComparer.Ordinal);
        string SameNew(NewItemDecision decision) => $"{TicketText.NameKey(decision.Name)}|{decision.OwnerId ?? ""}";
        foreach (var key in keys)
        {
            var lines = linesByKey[key];
            if (!decisions.TryGetValue(key, out var decision)) throw new AppError("VALIDATION", $"Falta qué hacer con «{lines[0].RawName}».");
            switch (decision)
            {
                case IgnoreDecision:
                    itemOfKey[key] = null;
                    continue;
                case ItemDecision item:
                    if (await pantry.GetItem(item.ItemId) is null)
                        throw new AppError("VALIDATION", $"«{lines[0].RawName}» está asociado a un producto que ya no existe. Elige otro.");
                    itemOfKey[key] = item.ItemId;
                    continue;
                case NewItemDecision newItem:
                    if (!lines.Any(TicketArithmetic.CanApplyLine))
                    {
                        itemOfKey[key] = null;
                        continue;
                    }
                    var sameNew = SameNew(newItem);
                    if (!created.TryGetValue(sameNew, out var id))
                    {
                        var allLines = keys
                            .Where(other => decisions.GetValueOrDefault(other) is NewItemDecision same && SameNew(same) == sameNew)
                            .SelectMany(other => linesByKey[other])
                            .Where(TicketArithmetic.CanApplyLine)
                            .ToList();
                        var unit = TicketPurchaseRules.NewItemUnit(allLines);
                        id = (await pantry.CreateItem(new NewPantryItem(newItem.Name, newItem.OwnerId, unit, "compras", 0, 0, newItem.Frequency,
                            TicketPurchaseRules.PriceFromLines(allLines, unit), ""))).Id;
                        created[sameNew] = id;
                    }
                    itemOfKey[key] = id;
                    continue;
            }
        }

        // Lo aprendido y lo que cambia en los productos que ya existían.
        foreach (var key in keys)
            if (linesByKey[key].Any(TicketArithmetic.CanApplyLine)) await store.UpsertAlias(aliasStore, key, itemOfKey[key], now);
        var createdIds = created.Values.ToHashSet(StringComparer.Ordinal);
        var touchedOrder = new List<string>();
        var touched = new Dictionary<string, List<TicketSaveLine>>(StringComparer.Ordinal);
        foreach (var key in keys)
        {
            if (itemOfKey[key] is not { } itemId || createdIds.Contains(itemId)) continue;
            if (!touched.TryGetValue(itemId, out var lines))
            {
                touched[itemId] = lines = [];
                touchedOrder.Add(itemId);
            }
            lines.AddRange(linesByKey[key].Where(TicketArithmetic.CanApplyLine));
        }
        foreach (var itemId in touchedOrder)
        {
            var lines = touched[itemId];
            if (lines.Count == 0) continue;
            // «Para una ocasión» no cuenta para el ritmo, pero lo comprado sí está en casa.
            var item = (await pantry.GetItem(itemId))!;
            await pantry.ApplyTicketPurchase(itemId, new PantryTicketPurchase(
                TicketPurchaseRules.PriceFromLines(lines, item.Unit), TicketPurchaseRules.QuantityFromLines(lines, item.Unit)));
        }

        var ticketId = ids.NewId();
        await store.InsertTicket(new TicketToInsert(ticketId, input.Store, input.StoreName, input.Address, input.Date, input.Time, input.TotalCents,
            TicketDuplicates.Fingerprint(hasher, FingerprintOf(input)), now, input.Adjustments, input.Issues, input.ImportId, input.SourceFingerprint));
        for (var position = 0; position < input.Lines.Count; position++)
        {
            var line = input.Lines[position];
            var key = TicketText.NameKey(line.RawName);
            await store.InsertLine(new LineToInsert(ids.NewId(), ticketId, position, line.RawName, key, line.Quantity, line.UnitPriceCents, line.AmountCents,
                line.DiscountCents, line.WeightKg, line.PricePerKgCents, line.TaxCode, itemOfKey.GetValueOrDefault(key), line.Occasional,
                TicketPurchaseRules.LineReviewStatus(line), line.Confirmed == true, line.Evidence));
        }
        return new TicketSavedView((await store.GetTicket(ticketId))!, await pantry.ListItems());
    }, LockName.Tickets);
}
