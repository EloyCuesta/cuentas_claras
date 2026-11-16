using System.Text.Json;
using CuentasClaras.Application.Common;
using CuentasClaras.Application.Pantry.Contracts;
using CuentasClaras.Domain.Tickets;

namespace CuentasClaras.Application.Tickets;

/// <summary>Lecturas de los tickets (queries.ts): los últimos y uno entero. La actividad es de la despensa (PantryActivityQueries).</summary>
public sealed class TicketQueries(ITicketStore store)
{
    /// <summary>Cuántos tickets recientes se mandan.</summary>
    public const int RecentTickets = 100;

    /// <summary>Los últimos tickets (resumen), los más recientes primero.</summary>
    public Task<IReadOnlyList<TicketSummaryView>> ListTickets() => store.ListSummaries(RecentTickets);

    /// <summary>Un ticket con sus líneas (404 si ya no existe).</summary>
    public async Task<TicketView> GetTicket(string id) => await store.GetTicket(id) ?? throw new AppError("NOT_FOUND", "Ese ticket ya no existe.");
}

/// <summary>
/// Cambiar el producto de una línea de un ticket guardado (SetLineItem.ts; null = no seguirla). Cambian a la vez todas las
/// líneas iguales del ticket, y queda aprendido para la próxima vez en esa tienda. Con el bloqueo «tickets» y, antes de leer,
/// el del producto nuevo: si alguien lo borra a la vez, una de las dos espera a la otra.
/// </summary>
public sealed class SetLineItem(ITicketStore store, IPantryCatalog pantry, TicketQueries queries, IClock clock, IUnitOfWork unitOfWork)
{
    /// <summary>PUT /api/despensa/tickets/:id/lineas/:lineId: { itemId }, validado antes de buscar nada.</summary>
    public Task<TicketView> Handle(string ticketId, string lineId, JsonElement body)
    {
        var result = TicketRequests.ValidateLineUpdate(body);
        if (!result.Ok) throw new AppError("VALIDATION", result.Error!);
        return Execute(ticketId, lineId, result.Value!.ItemId);
    }

    public Task<TicketView> Execute(string ticketId, string lineId, string? itemId) => unitOfWork.Run(async () =>
    {
        if (itemId is not null) await pantry.LockItems([itemId]);
        var ticket = await store.GetSummary(ticketId) ?? throw new AppError("NOT_FOUND", "Ese ticket ya no existe.");
        var line = await store.GetLine(ticketId, lineId) ?? throw new AppError("NOT_FOUND", "Esa línea del ticket ya no existe.");
        if (itemId is not null && await pantry.GetItem(itemId) is null) throw new AppError("VALIDATION", "Ese producto ya no existe. Elige otro.");
        // Todas las líneas iguales del ticket cambian a la vez.
        foreach (var other in await store.LinesOf(ticketId))
            if (other.NameKey == line.NameKey) await store.SetLineItem(other.Id, itemId);
        await store.UpsertAlias(TicketIdentity.AliasStoreOf(ticket.Store, ticket.StoreName), line.NameKey, itemId, clock.NowIso());
        return await queries.GetTicket(ticketId);
    }, LockName.Tickets);
}

/// <summary>
/// Borrar un ticket y sus líneas (DeleteTicket.ts): sus compras dejan de contar para el ritmo. Los productos creados con él, lo
/// aprendido y las cantidades de los que se cuentan se quedan como están. Con el bloqueo «tickets», como guardar.
/// </summary>
public sealed class DeleteTicket(ITicketStore store, IUnitOfWork unitOfWork)
{
    public Task Execute(string id) => unitOfWork.Run(async () =>
    {
        if (await store.GetSummary(id) is null) throw new AppError("NOT_FOUND", "Ese ticket ya no existe.");
        await store.DeleteTicket(id);
    }, LockName.Tickets);
}
