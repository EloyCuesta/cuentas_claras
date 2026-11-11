using System.Text.Json;
using CuentasClaras.Application.Common;
using CuentasClaras.Application.Pantry.Contracts;
using CuentasClaras.Domain.Pantry;

namespace CuentasClaras.Application.Pantry;

/// <summary>
/// Crear un producto (CreateItem.ts): el servidor pone el id, la versión (1) y las fechas. Lo usan la ruta de productos
/// y, a través de IPantryCatalog, los tickets al guardar un producto nuevo.
/// </summary>
public sealed class CreateItem(IPantryStore store, IClock clock, IIdGenerator ids, IUnitOfWork unitOfWork)
{
    /// <summary>POST /api/despensa/productos.</summary>
    public Task<PantryItemView> Handle(JsonElement body) => Execute(PantryRequests.Valid(PantryRequests.ValidateItemInput(body)));

    public Task<PantryItemView> Execute(PantryItemInput input) => unitOfWork.Run(async () =>
    {
        await PantryRequire.Owner(store, input.OwnerId);
        var id = ids.NewId();
        await store.InsertItem(id, input, clock.NowIso());
        return PantryViews.Item(await PantryRequire.Item(store, id));
    });
}

/// <summary>
/// Editar un producto (UpdateItem.ts, PAN-01): solo si sigue en la versión con que se abrió el formulario, y sube su
/// versión (para que «Deshacer» y otra edición no pisen este cambio). Bloquea el producto antes de leer nada y comprueba
/// en este orden: 404, 409 y el dueño.
/// </summary>
public sealed class UpdateItem(IPantryStore store, IClock clock, IUnitOfWork unitOfWork)
{
    /// <summary>El producto cambió desde que se abrió el formulario (otro móvil, un + o una compra): no se pisa.</summary>
    public const string StaleMessage =
        "Este producto ha cambiado desde que lo abriste (quizá desde otro dispositivo), así que no se ha guardado. Vuelve a cargarlo para ver cómo está ahora.";

    /// <summary>PUT /api/despensa/productos/:id: todo el cuerpo, expectedVersion incluida, se valida antes de buscar el producto.</summary>
    public Task<PantryItemView> Handle(string id, JsonElement body)
    {
        var update = PantryRequests.Valid(PantryRequests.ValidateItemUpdate(body));
        return Execute(id, update.Input, update.ExpectedVersion);
    }

    public Task<PantryItemView> Execute(string id, PantryItemInput input, long expectedVersion) => unitOfWork.Run(async () =>
    {
        await store.LockItems([id]);
        var current = await PantryRequire.Item(store, id);
        if (current.Version != expectedVersion) throw new AppError("CONFLICT", StaleMessage);
        await PantryRequire.Owner(store, input.OwnerId);
        await store.UpdateItem(id, input, clock.NowIso());
        return PantryViews.Item(await PantryRequire.Item(store, id));
    });
}

/// <summary>Borrar un producto (DeleteItem.ts), con sus revisiones; lo bloquea antes de leerlo.</summary>
public sealed class DeleteItem(IPantryStore store, IUnitOfWork unitOfWork)
{
    public Task Execute(string id) => unitOfWork.Run(async () =>
    {
        await store.LockItems([id]);
        await PantryRequire.Item(store, id);
        await store.DeleteItem(id);
    });
}

/// <summary>
/// La despensa para otros módulos (IPantryCatalog, la PantryApi de Express): los mismos casos de uso y lecturas que las
/// rutas, que dentro de una transacción de los tickets se unen a ella.
/// </summary>
public sealed class PantryCatalog(IPantryStore store, PantryQueries queries, CreateItem createItem, ApplyTicketPurchase applyTicketPurchase) : IPantryCatalog
{
    public Task LockItems(IReadOnlyCollection<string> ids) => store.LockItems(ids);

    public Task<PantryItemView?> GetItem(string id) => queries.GetItem(id);

    public Task<PantryItemView> CreateItem(NewPantryItem input) => createItem.Execute(PantryViews.Input(input));

    public Task<IReadOnlyList<PantryItemView>> ListItems() => queries.ListItems();

    public Task ApplyTicketPurchase(string id, PantryTicketPurchase purchase) => applyTicketPurchase.Execute(id, purchase);
}
