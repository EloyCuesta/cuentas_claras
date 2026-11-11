using System.Text.Json;
using CuentasClaras.Application.Common;
using CuentasClaras.Application.Pantry.Contracts;
using CuentasClaras.Domain.Common;
using CuentasClaras.Domain.Pantry;

namespace CuentasClaras.Application.Pantry;

/// <summary>
/// Botones + y − (AdjustItem.ts): suma o resta sobre la cantidad que hay ahora en el servidor, no sobre la que vio el
/// móvil. El producto se bloquea antes de leerlo, así que el segundo + espera al primero y suma sobre su resultado. Nunca
/// baja de cero, y solo g, kg, ml y l admiten decimales.
/// </summary>
public sealed class AdjustItem(IPantryStore store, IClock clock, IUnitOfWork unitOfWork)
{
    /// <summary>POST /api/despensa/productos/:id/ajustar: { delta }.</summary>
    public Task<PantryItemView> Handle(string id, JsonElement body) => Execute(id, PantryRequests.Valid(PantryRequests.ValidateDelta(body)));

    public Task<PantryItemView> Execute(string id, double delta) => unitOfWork.Run(async () =>
    {
        await store.LockItems([id]);
        var item = await PantryRequire.Item(store, id);
        var checkedQuantity = PantryRules.CheckQuantity(PantryRules.StepQuantity(item.Quantity, delta), item.Unit);
        if (!checkedQuantity.Ok) throw new AppError("VALIDATION", checkedQuantity.Error!);
        await store.SetQuantity(id, checkedQuantity.Value, clock.NowIso());
        return PantryViews.Item(await PantryRequire.Item(store, id));
    });
}

/// <summary>
/// Apuntar una revisión (AddEvent.ts): «Queda», «Queda poco», «Se acabó» o «Lo he comprado», con la fecha de hoy que manda
/// el navegador. Bloquea el producto: si otro lo borra a la vez, espera y después da 404. La usa «Marcar todo como
/// comprado» desde PAN-02; su ruta llega con PAN-03.
/// </summary>
public sealed class AddEvent(IPantryStore store, IClock clock, IIdGenerator ids, IUnitOfWork unitOfWork)
{
    public Task<PantryEventView> Execute(string itemId, string kind, string date) => unitOfWork.Run(async () =>
    {
        await store.LockItems([itemId]);
        await PantryRequire.Item(store, itemId);
        var pantryEvent = new PantryEvent(ids.NewId(), itemId, kind, date, clock.NowIso());
        await store.InsertEvent(pantryEvent);
        return PantryEventView.From(pantryEvent);
    });
}

/// <summary>
/// «Marcar todo como comprado» (MarkPurchased.ts), con los valores actuales del servidor: los productos se bloquean antes de
/// leerlos (en orden de id). Si alguno no existe no se cambia nada (404). Los que se cuentan pasan a su objetivo (los que ya
/// lo tienen, o más, se quedan igual: comprar nunca reduce); en los que van por compras se apunta «Lo he comprado» con la
/// fecha del navegador (si no llega, la del servidor). Devuelve lo necesario para deshacerlo.
/// </summary>
public sealed class MarkPurchased(IPantryStore store, PantryQueries queries, AddEvent addEvent, IClock clock, IUnitOfWork unitOfWork)
{
    /// <summary>POST /api/despensa/comprado: { ids, date? }.</summary>
    public Task<PurchaseResultView> Handle(JsonElement body)
    {
        var input = PantryRequests.Valid(PantryRequests.ValidatePurchase(body));
        return Execute(input.Ids, input.Date);
    }

    public Task<PurchaseResultView> Execute(IReadOnlyList<string> ids, string? date) => unitOfWork.Run(async () =>
    {
        var unique = ids.Distinct(StringComparer.Ordinal).ToList();
        await store.LockItems(unique);
        var items = await store.GetItems(unique);
        if (items.Count != unique.Count)
            throw new AppError("NOT_FOUND", "Algún producto de la lista ya no existe. Vuelve a cargar la despensa; no se ha cambiado nada.");
        var bought = new List<object>();
        foreach (var item in items.Where(entry => entry.Tracking == "compras"))
        {
            var pantryEvent = await addEvent.Execute(item.Id, "comprado", date ?? clock.Today());
            bought.Add(new EventChangeView(item.Id, pantryEvent.Id));
        }
        var pending = items.Where(item => item.Tracking == "cantidad" && item.Quantity < item.Target).ToList();
        // Una sola escritura para todos los productos que se cuentan.
        if (pending.Count > 0) await store.FillToTarget([.. pending.Select(item => item.Id)], clock.NowIso());
        var changes = new List<object>();
        foreach (var item in pending)
            changes.Add(new QuantityChangeView(item.Id, item.Quantity, (await PantryRequire.Item(store, item.Id)).Version));
        changes.AddRange(bought);
        return new PurchaseResultView(changes, await queries.ListItems());
    });
}

/// <summary>
/// Deshacer una compra (UndoPurchase.ts): cada producto que se cuenta vuelve a su cantidad anterior y se borran las compras
/// apuntadas. Solo si nada ha cambiado desde entonces (misma versión, la compra sigue ahí); si no, 409 y no se toca nada.
/// Solo se restaura la cantidad. Los productos se bloquean antes de comprobar nada, en orden de id.
/// </summary>
public sealed class UndoPurchase(IPantryStore store, PantryQueries queries, IClock clock, IUnitOfWork unitOfWork)
{
    /// <summary>POST /api/despensa/comprado/deshacer: { changes }.</summary>
    public Task<IReadOnlyList<PantryItemView>> Handle(JsonElement body) => Execute(PantryRequests.Valid(PantryRequests.ValidateUndo(body)));

    public Task<IReadOnlyList<PantryItemView>> Execute(IReadOnlyList<PantryPurchaseChange> changes) => unitOfWork.Run(async () =>
    {
        await store.LockItems([.. changes.Select(change => change.Id).Distinct(StringComparer.Ordinal)]);
        static AppError Conflict() => new("CONFLICT",
            "No se puede deshacer: algún producto ha cambiado o se ha borrado después de la compra (quizá desde otro dispositivo). No se ha tocado nada.");
        // Primero se comprueba todo; después se escribe.
        var quantities = new List<(string Id, double Quantity)>();
        var events = new List<string>();
        foreach (var change in changes)
        {
            if (change is EventChange bought)
            {
                var pantryEvent = await store.GetEvent(bought.EventId);
                if (pantryEvent is null || pantryEvent.ItemId != bought.Id || pantryEvent.Kind != "comprado") throw Conflict();
                events.Add(bought.EventId);
                continue;
            }
            var counted = (QuantityChange)change;
            var item = await store.GetItem(counted.Id);
            if (item is null || item.Version != counted.Version) throw Conflict();
            var quantity = PantryRules.CheckQuantity(counted.PreviousQuantity, item.Unit);
            if (!quantity.Ok) throw new AppError("VALIDATION", quantity.Error!);
            quantities.Add((counted.Id, quantity.Value));
        }
        var now = clock.NowIso();
        foreach (var (id, quantity) in quantities) await store.SetQuantity(id, quantity, now);
        foreach (var id in events) await store.DeleteEvent(id);
        return await queries.ListItems();
    });
}

/// <summary>
/// Lo que deja un ticket guardado en un producto que ya existía (ApplyTicketPurchase.ts): el precio nuevo y, si el producto
/// se cuenta, lo comprado. Cada cambio sube la versión. Lo llaman los tickets dentro de su transacción (aquí queda
/// anidada), que ya ha bloqueado sus productos: el bloqueo de aquí no espera.
/// </summary>
public sealed class ApplyTicketPurchase(IPantryStore store, IClock clock, IUnitOfWork unitOfWork)
{
    public Task Execute(string id, PantryTicketPurchase purchase) => unitOfWork.Run(async () =>
    {
        await store.LockItems([id]);
        var item = await PantryRequire.Item(store, id);
        var now = clock.NowIso();
        if (purchase.PriceCents is { } price && price != item.PriceCents) await store.SetPrice(id, price, now);
        if (purchase.AddQuantity is { } added && added > 0 && item.Tracking == "cantidad")
        {
            var checkedQuantity = PantryRules.CheckQuantity(JsNumber.Round((item.Quantity + added) * 1000) / 1000, item.Unit);
            if (checkedQuantity.Ok) await store.SetQuantity(id, checkedQuantity.Value, now);
        }
    });
}
