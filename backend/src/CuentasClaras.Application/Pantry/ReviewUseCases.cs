using System.Text.Json;
using CuentasClaras.Application.Common;
using CuentasClaras.Application.Pantry.Contracts;
using CuentasClaras.Domain.Common;

namespace CuentasClaras.Application.Pantry;

/// <summary>Deshacer una revisión (DeleteEvent.ts): 404 si ya no está.</summary>
public sealed class DeleteEvent(IPantryStore store, IUnitOfWork unitOfWork)
{
    public Task Execute(string id) => unitOfWork.Run(async () =>
    {
        if (await store.GetEvent(id) is null) throw new AppError("NOT_FOUND", "Esa revisión ya no existe.");
        await store.DeleteEvent(id);
    });
}

/// <summary>El presupuesto mensual de la despensa (SetBudget.ts): un número de céntimos o null; 0 es un presupuesto de 0 €.</summary>
public sealed class SetBudget(IPantryStore store, IUnitOfWork unitOfWork)
{
    /// <summary>PUT /api/despensa/presupuesto: { monthlyBudgetCents }.</summary>
    public Task<PantrySettingsView> Handle(JsonElement body) => Execute(PantryRequests.Valid(PantryRequests.ValidateBudget(body)));

    public Task<PantrySettingsView> Execute(long? monthlyBudgetCents) => unitOfWork.Run(async () =>
    {
        await store.SetBudget(monthlyBudgetCents);
        return PantrySettingsView.From(await store.GetSettings());
    });
}

/// <summary>Apuntar el día del repaso de la semana (SetReviewDate.ts), con la fecha de hoy del navegador.</summary>
public sealed class SetReviewDate(IPantryStore store, IUnitOfWork unitOfWork)
{
    /// <summary>PUT /api/despensa/repaso: { date }.</summary>
    public Task<PantrySettingsView> Handle(JsonElement body) => Execute(PantryRequests.Valid(PantryRequests.ValidateReview(body)));

    public Task<PantrySettingsView> Execute(string date) => unitOfWork.Run(async () =>
    {
        await store.SetReviewDate(date);
        return PantrySettingsView.From(await store.GetSettings());
    });
}

/// <summary>
/// Las lecturas de la despensa que no son productos ni personas: el presupuesto y el repaso, y la actividad para el ritmo de
/// compra (activity de server/modules/tickets/application/queries.ts). En .NET la actividad es de la despensa: las compras
/// llegan por IPantryPurchaseHistory, que implementa Tickets, y las revisiones son suyas.
/// </summary>
public sealed class PantryActivityQueries(IPantryStore store, IPantryPurchaseHistory purchases, IClock clock)
{
    /// <summary>Días de historial que se mandan para el ritmo de compra.</summary>
    public const int ActivityDays = 400;

    public async Task<PantrySettingsView> Settings() => PantrySettingsView.From(await store.GetSettings());

    /// <summary>
    /// GET /api/despensa/actividad?hoy=AAAA-MM-DD: las compras de los tickets (una por producto y ticket) y las revisiones de
    /// los últimos 400 días. hoy es la fecha del navegador; si falta, no es una fecha o se repite, la del servidor.
    /// </summary>
    public async Task<PantryActivityView> Activity(string? today)
    {
        var since = IsoDates.AddDays(IsoDates.IsValid(today) ? today! : clock.Today(), -ActivityDays);
        return new PantryActivityView(await purchases.PurchasesSince(since), [.. (await store.EventsSince(since)).Select(PantryEventView.From)]);
    }
}
