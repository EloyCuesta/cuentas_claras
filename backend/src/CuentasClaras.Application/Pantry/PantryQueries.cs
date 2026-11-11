using CuentasClaras.Application.Common;
using CuentasClaras.Application.Pantry.Contracts;
using CuentasClaras.Domain.Pantry;

namespace CuentasClaras.Application.Pantry;

/// <summary>
/// Lecturas de la despensa (server/modules/pantry/application/queries.ts): no cambian nada, así que no abren
/// transacción propia. Dentro de la de un caso de uso (o de un ticket), leen con esa misma transacción.
/// </summary>
public sealed class PantryQueries(IPantryStore store)
{
    /// <summary>Por nombre.</summary>
    public async Task<IReadOnlyList<PantryPersonView>> ListPeople() =>
        [.. PantryRules.SortPeople(await store.ListPeople()).Select(PantryPersonView.From)];

    /// <summary>Por frecuencia y nombre.</summary>
    public async Task<IReadOnlyList<PantryItemView>> ListItems() =>
        [.. PantryRules.SortItems(await store.ListItems()).Select(PantryViews.Item)];

    public async Task<PantryItemView?> GetItem(string id) => await store.GetItem(id) is { } item ? PantryViews.Item(item) : null;
}

/// <summary>Comprobaciones que comparten varios casos de uso (require.ts), con sus mensajes de siempre.</summary>
internal static class PantryRequire
{
    public static async Task<PantryPerson> Person(IPantryStore store, string id) =>
        await store.GetPerson(id) ?? throw new AppError("NOT_FOUND", "Esa persona ya no existe. Vuelve a cargar la despensa.");

    public static async Task<PantryItem> Item(IPantryStore store, string id) =>
        await store.GetItem(id) ?? throw new AppError("NOT_FOUND", "Ese producto ya no existe. Vuelve a cargar la despensa.");

    /// <summary>El dueño de un producto es Compartido (null) o una persona que existe.</summary>
    public static async Task Owner(IPantryStore store, string? ownerId)
    {
        if (ownerId is not null && await store.GetPerson(ownerId) is null)
            throw new AppError("VALIDATION", "El producto es de una persona que no existe. Elige otra o «Compartido».");
    }
}
