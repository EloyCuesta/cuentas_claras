namespace CuentasClaras.Application.Pantry.Contracts;

/// <summary>
/// Un producto como lo devuelve la API (GET /api/despensa/productos y las demás), con los campos y el orden de Express.
/// Está en los contratos porque también es lo que reciben los tickets a través de IPantryCatalog.
/// </summary>
public sealed record PantryItemView(
    string Id,
    string Name,
    string? OwnerId,
    string Unit,
    string Tracking,
    double Quantity,
    double Target,
    string Frequency,
    long? PriceCents,
    string Notes,
    long Version,
    string CreatedAt,
    string UpdatedAt);

/// <summary>Un producto nuevo que crea otro módulo (los tickets, al guardar una línea con «Producto nuevo»).</summary>
public sealed record NewPantryItem(
    string Name,
    string? OwnerId,
    string Unit,
    string Tracking,
    double Quantity,
    double Target,
    string Frequency,
    long? PriceCents,
    string Notes);

/// <summary>
/// Lo que deja un ticket guardado en un producto que ya existía (TicketPurchase de ApplyTicketPurchase.ts): el precio nuevo
/// por unidad (o por kilo), o null si el ticket no permite saberlo, y cuánto se compró en la unidad del producto, o null.
/// </summary>
public sealed record PantryTicketPurchase(long? PriceCents, double? AddQuantity);

/// <summary>
/// Una compra de un producto sacada de un ticket (PantryPurchase de shared/pantry/types.ts), para el ritmo de compra:
/// kilos (Measure «kg») o unidades («ud») o null, y lo que costó ya con descuentos, o null si no se sabe.
/// </summary>
public sealed record PantryPurchaseView(
    string ItemId, string Date, double? Amount, string? Measure, long? CostCents, string? Store, string? TicketId, string RecordedAt);

/// <summary>
/// Las compras de los tickets desde una fecha, una por producto y ticket, en el orden del historial (PAN-03). La despensa
/// las necesita para la actividad (GET /api/despensa/actividad) sin conocer los tickets: lo implementa Tickets en
/// Infrastructure, con el SQL de purchaseLinesSince y PurchaseHistory.
/// </summary>
public interface IPantryPurchaseHistory
{
    Task<IReadOnlyList<PantryPurchaseView>> PurchasesSince(string date);
}

/// <summary>
/// Lo que otros módulos pueden usar de la despensa (PantryApi de server/modules/pantry/index.ts): hoy, los tickets.
/// Dentro de una transacción de otro módulo, todo se une a ella. Las revisiones (eventsSince) no están: la actividad que
/// las usa es una consulta de la propia despensa (IPantryPurchaseHistory le da las compras).
/// </summary>
public interface IPantryCatalog
{
    /// <summary>Bloquea esos productos hasta el final de la transacción en curso (FOR UPDATE, en orden de id), antes de leer nada.</summary>
    Task LockItems(IReadOnlyCollection<string> ids);

    Task<PantryItemView?> GetItem(string id);

    /// <summary>Crea el producto con las comprobaciones de siempre (el dueño existe); el servidor pone id, versión y fechas.</summary>
    Task<PantryItemView> CreateItem(NewPantryItem input);

    /// <summary>Todos los productos, por frecuencia y nombre.</summary>
    Task<IReadOnlyList<PantryItemView>> ListItems();

    /// <summary>El precio nuevo y, si el producto se cuenta, lo comprado; cada cambio sube la versión (404 si ya no existe).</summary>
    Task ApplyTicketPurchase(string id, PantryTicketPurchase purchase);
}
