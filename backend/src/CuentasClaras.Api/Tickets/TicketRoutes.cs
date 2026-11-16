using CuentasClaras.Api.Common;
using CuentasClaras.Application.Tickets;

namespace CuentasClaras.Api.Tickets;

/// <summary>Los casos de uso de los tickets que usan sus rutas: leer (TIC-02), guardar (TIC-03), consultar, cambiar y borrar (TIC-04).</summary>
public sealed record TicketUseCases(ReadTicket ReadTicket, SaveTicket SaveTicket, TicketQueries Queries, SetLineItem SetLineItem, DeleteTicket DeleteTicket);

/// <summary>
/// Las rutas de los tickets (server/modules/tickets/adapters/http/routes.ts), públicas como la despensa. Solo traducen
/// HTTP ⇄ caso de uso: la validación de la lectura está en Application (TicketReadRequest).
/// </summary>
public static class TicketRoutes
{
    public static void Map(ApiRouteTable routes, TicketUseCases useCases)
    {
        // { imagenes }, { franjas } o { texto }, y { hoy } → el borrador del ticket (no guarda nada). Hasta 30 MB (JsonBody).
        routes.Map("POST", "/api/despensa/tickets/leer", RouteAccess.Public, async request =>
            await ApiResponse.Data(request.Http, await useCases.ReadTicket.Handle(request.Body, request.Aborted)));

        // TicketSaveInput → 201 { ticket, items }; 409 si ya estaba guardado o si es un posible duplicado sin confirmar.
        routes.Map("POST", "/api/despensa/tickets", RouteAccess.Public, async request =>
            await ApiResponse.Data(request.Http, await useCases.SaveTicket.Handle(request.Body), 201));

        // Los últimos tickets (resumen).
        routes.Map("GET", "/api/despensa/tickets", RouteAccess.Public, async request =>
            await ApiResponse.Data(request.Http, await useCases.Queries.ListTickets()));

        // Un ticket con sus líneas.
        routes.Map("GET", "/api/despensa/tickets/:id", RouteAccess.Public, async request =>
            await ApiResponse.Data(request.Http, await useCases.Queries.GetTicket(request.Param("id"))));

        // { itemId } → cambia el producto de esa línea (y de las iguales) y lo aprende.
        routes.Map("PUT", "/api/despensa/tickets/:id/lineas/:lineId", RouteAccess.Public, async request =>
            await ApiResponse.Data(request.Http, await useCases.SetLineItem.Handle(request.Param("id"), request.Param("lineId"), request.Body)));

        // Lo borra con sus líneas; los productos, lo aprendido y las cantidades se quedan.
        routes.Map("DELETE", "/api/despensa/tickets/:id", RouteAccess.Public, async request =>
        {
            await useCases.DeleteTicket.Execute(request.Param("id"));
            await ApiResponse.Data(request.Http, null);
        });
    }
}
