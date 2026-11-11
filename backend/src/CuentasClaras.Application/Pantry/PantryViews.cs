using CuentasClaras.Application.Pantry.Contracts;
using CuentasClaras.Domain.Pantry;

namespace CuentasClaras.Application.Pantry;

/// <summary>Una persona como la devuelve la API.</summary>
public sealed record PantryPersonView(string Id, string Name, string CreatedAt)
{
    public static PantryPersonView From(PantryPerson person) => new(person.Id, person.Name, person.CreatedAt);
}

/// <summary>Conversiones entre el dominio y los contratos de la despensa.</summary>
public static class PantryViews
{
    public static PantryItemView Item(PantryItem item) => new(
        item.Id, item.Name, item.OwnerId, item.Unit, item.Tracking, item.Quantity, item.Target, item.Frequency, item.PriceCents,
        item.Notes, item.Version, item.CreatedAt, item.UpdatedAt);

    public static PantryItemInput Input(NewPantryItem item) => new(
        item.Name, item.OwnerId, item.Unit, item.Tracking, item.Quantity, item.Target, item.Frequency, item.PriceCents, item.Notes);
}
