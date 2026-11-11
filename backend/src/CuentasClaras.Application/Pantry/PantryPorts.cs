using CuentasClaras.Domain.Pantry;

namespace CuentasClaras.Application.Pantry;

/// <summary>
/// Persistencia de la despensa (PantryRepository de server/modules/pantry/application/ports.ts): personas y productos
/// (PAN-01), cantidades, compras y revisiones (PAN-02). Solo guarda y lee; las comprobaciones y los mensajes están en los casos de uso, que la llaman dentro de
/// IUnitOfWork.Run. Las listas salen sin ordenar: las ordena PantryQueries con PantryRules.
/// </summary>
public interface IPantryStore
{
    Task<IReadOnlyList<PantryPerson>> ListPeople();
    Task<PantryPerson?> GetPerson(string id);
    Task InsertPerson(PantryPerson person);
    Task RenamePerson(string id, string name);
    Task DeletePerson(string id);
    /// <summary>Productos de una persona (no se puede borrar mientras tenga alguno).</summary>
    Task<long> CountItemsOf(string personId);

    /// <summary>
    /// Bloquea las filas de esos productos hasta que termine la transacción (SELECT … FOR UPDATE, en orden de id): otra
    /// escritura sobre ellos espera. Va antes que cualquier otra lectura de la transacción. Los ids que no existen se saltan.
    /// </summary>
    Task LockItems(IReadOnlyCollection<string> ids);
    Task<IReadOnlyList<PantryItem>> ListItems();
    Task<PantryItem?> GetItem(string id);
    /// <summary>Versión 1, createdAt = updatedAt = now.</summary>
    Task InsertItem(string id, PantryItemInput input, string now);
    /// <summary>Los productos de esos ids que existen (para comprar varios a la vez), en orden de id.</summary>
    Task<IReadOnlyList<PantryItem>> GetItems(IReadOnlyCollection<string> ids);
    /// <summary>Sube la versión y pone updatedAt = now; createdAt no cambia.</summary>
    Task UpdateItem(string id, PantryItemInput input, string now);
    /// <summary>Cada uno de estos sube la versión y pone updatedAt = now.</summary>
    Task SetQuantity(string id, double quantity, string now);
    Task SetPrice(string id, long priceCents, string now);
    /// <summary>Completa hasta el objetivo los que tengan menos, con una sola escritura.</summary>
    Task FillToTarget(IReadOnlyCollection<string> ids, string now);
    Task DeleteItem(string id);

    Task InsertEvent(PantryEvent pantryEvent);
    Task<PantryEvent?> GetEvent(string id);
    Task DeleteEvent(string id);
}
