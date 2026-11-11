using CuentasClaras.Api.Common;
using CuentasClaras.Application.Tickets;

namespace CuentasClaras.Api.Tickets;

/// <summary>Los casos de uso de los tickets que usan sus rutas (TIC-02: leer; guardar, consultar, cambiar y borrar llegan después).</summary>
public sealed record TicketUseCases(ReadTicket ReadTicket);

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
    }
}
