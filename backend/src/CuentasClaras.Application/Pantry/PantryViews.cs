using CuentasClaras.Application.Pantry.Contracts;
using CuentasClaras.Domain.Pantry;

namespace CuentasClaras.Application.Pantry;

/// <summary>Una persona como la devuelve la API.</summary>
public sealed record PantryPersonView(string Id, string Name, string CreatedAt)
{
    public static PantryPersonView From(PantryPerson person) => new(person.Id, person.Name, person.CreatedAt);
}

/// <summary>Una revisión como la devuelve la API.</summary>
public sealed record PantryEventView(string Id, string ItemId, string Kind, string Date, string CreatedAt)
{
    public static PantryEventView From(PantryEvent pantryEvent) =>
        new(pantryEvent.Id, pantryEvent.ItemId, pantryEvent.Kind, pantryEvent.Date, pantryEvent.CreatedAt);
}

/// <summary>GET y PUT /api/despensa/presupuesto y PUT /api/despensa/repaso: { monthlyBudgetCents, lastReviewDate }.</summary>
public sealed record PantrySettingsView(long? MonthlyBudgetCents, string? LastReviewDate)
{
    public static PantrySettingsView From(PantrySettings settings) => new(settings.MonthlyBudgetCents, settings.LastReviewDate);
}

/// <summary>GET /api/despensa/actividad: las compras de los tickets y las revisiones, para el ritmo de compra.</summary>
public sealed record PantryActivityView(IReadOnlyList<PantryPurchaseView> Purchases, IReadOnlyList<PantryEventView> Events);

/// <summary>Un cambio de una compra, para deshacerla: el de un producto que se cuenta.</summary>
public sealed record QuantityChangeView(string Id, double PreviousQuantity, long Version);

/// <summary>El de un producto que va por compras: la compra apuntada.</summary>
public sealed record EventChangeView(string Id, string EventId);

/// <summary>
/// POST /api/despensa/comprado: { changes, items }. Changes mezcla los dos tipos de cambio (como object, para que cada uno se
/// escriba con sus campos): primero los productos que se cuentan y después las compras apuntadas, como en Express.
/// </summary>
public sealed record PurchaseResultView(IReadOnlyList<object> Changes, IReadOnlyList<PantryItemView> Items);

/// <summary>Conversiones entre el dominio y los contratos de la despensa.</summary>
public static class PantryViews
{
    public static PantryItemView Item(PantryItem item) => new(
        item.Id, item.Name, item.OwnerId, item.Unit, item.Tracking, item.Quantity, item.Target, item.Frequency, item.PriceCents,
        item.Notes, item.Version, item.CreatedAt, item.UpdatedAt);

    public static object Change(PantryPurchaseChange change) => change switch
    {
        QuantityChange quantity => new QuantityChangeView(quantity.Id, quantity.PreviousQuantity, quantity.Version),
        EventChange bought => new EventChangeView(bought.Id, bought.EventId),
        _ => throw new ArgumentOutOfRangeException(nameof(change)),
    };

    public static PantryItemInput Input(NewPantryItem item) => new(
        item.Name, item.OwnerId, item.Unit, item.Tracking, item.Quantity, item.Target, item.Frequency, item.PriceCents, item.Notes);
}
