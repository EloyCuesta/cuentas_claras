using CuentasClaras.Api.Common;
using CuentasClaras.Application.Pantry;

namespace CuentasClaras.Api.Pantry;

/// <summary>Los casos de uso de la despensa que usan sus rutas.</summary>
public sealed record PantryUseCases(
    PantryQueries Queries, CreatePerson CreatePerson, RenamePerson RenamePerson, DeletePerson DeletePerson,
    CreateItem CreateItem, UpdateItem UpdateItem, DeleteItem DeleteItem, AdjustItem AdjustItem, MarkPurchased MarkPurchased,
    UndoPurchase UndoPurchase, AddEvent AddEvent, DeleteEvent DeleteEvent, SetBudget SetBudget, SetReviewDate SetReviewDate,
    PantryActivityQueries Activity);

/// <summary>
/// Las rutas de la despensa (server/modules/pantry/adapters/http/routes.ts). Públicas a propósito: las usa cualquiera de
/// casa, sepa o no el código, y no devuelven ningún dato financiero. Solo traducen HTTP ⇄ caso de uso; la validación del
/// cuerpo está en Application (PantryRequests). Los ids que no existen responden 404 sin cambiar nada.
/// </summary>
public static class PantryRoutes
{
    public static void Map(ApiRouteTable routes, PantryUseCases useCases)
    {
        // Personas, por nombre.
        routes.Map("GET", "/api/despensa/personas", RouteAccess.Public, async request =>
            await ApiResponse.Data(request.Http, await useCases.Queries.ListPeople()));

        // { name } → 201 con la persona creada.
        routes.Map("POST", "/api/despensa/personas", RouteAccess.Public, async request =>
            await ApiResponse.Data(request.Http, await useCases.CreatePerson.Handle(request.Body), 201));

        // { name } → la persona renombrada.
        routes.Map("PUT", "/api/despensa/personas/:id", RouteAccess.Public, async request =>
            await ApiResponse.Data(request.Http, await useCases.RenamePerson.Handle(request.Param("id"), request.Body)));

        // 409 si todavía tiene productos.
        routes.Map("DELETE", "/api/despensa/personas/:id", RouteAccess.Public, async request =>
        {
            await useCases.DeletePerson.Execute(request.Param("id"));
            await ApiResponse.Data(request.Http, null);
        });

        // Productos, por frecuencia y nombre.
        routes.Map("GET", "/api/despensa/productos", RouteAccess.Public, async request =>
            await ApiResponse.Data(request.Http, await useCases.Queries.ListItems()));

        // PantryItemInput → 201 con el producto (id, versión y fechas del servidor).
        routes.Map("POST", "/api/despensa/productos", RouteAccess.Public, async request =>
            await ApiResponse.Data(request.Http, await useCases.CreateItem.Handle(request.Body), 201));

        // PantryItemInput y expectedVersion → el producto actualizado (409 si cambió desde que se abrió).
        routes.Map("PUT", "/api/despensa/productos/:id", RouteAccess.Public, async request =>
            await ApiResponse.Data(request.Http, await useCases.UpdateItem.Handle(request.Param("id"), request.Body)));

        // Botones + y −: { delta } → suma o resta a la cantidad actual del servidor.
        routes.Map("POST", "/api/despensa/productos/:id/ajustar", RouteAccess.Public, async request =>
            await ApiResponse.Data(request.Http, await useCases.AdjustItem.Handle(request.Param("id"), request.Body)));

        // «Queda», «Queda poco», «Se acabó» o «Lo he comprado»: { kind, date } → 201 con la revisión.
        routes.Map("POST", "/api/despensa/productos/:id/revision", RouteAccess.Public, async request =>
            await ApiResponse.Data(request.Http, await useCases.AddEvent.Handle(request.Param("id"), request.Body), 201));

        // Deshace una revisión.
        routes.Map("DELETE", "/api/despensa/revisiones/:id", RouteAccess.Public, async request =>
        {
            await useCases.DeleteEvent.Execute(request.Param("id"));
            await ApiResponse.Data(request.Http, null);
        });

        // Lo borra con sus revisiones.
        routes.Map("DELETE", "/api/despensa/productos/:id", RouteAccess.Public, async request =>
        {
            await useCases.DeleteItem.Execute(request.Param("id"));
            await ApiResponse.Data(request.Http, null);
        });

        // Presupuesto y repaso de la semana: { monthlyBudgetCents, lastReviewDate }.
        routes.Map("GET", "/api/despensa/presupuesto", RouteAccess.Public, async request =>
            await ApiResponse.Data(request.Http, await useCases.Activity.Settings()));

        routes.Map("PUT", "/api/despensa/presupuesto", RouteAccess.Public, async request =>
            await ApiResponse.Data(request.Http, await useCases.SetBudget.Handle(request.Body)));

        routes.Map("PUT", "/api/despensa/repaso", RouteAccess.Public, async request =>
            await ApiResponse.Data(request.Http, await useCases.SetReviewDate.Handle(request.Body)));

        // Compras de los tickets y revisiones de los últimos 400 días, para el ritmo de compra (?hoy=AAAA-MM-DD del navegador).
        routes.Map("GET", "/api/despensa/actividad", RouteAccess.Public, async request =>
            await ApiResponse.Data(request.Http, await useCases.Activity.Activity(request.Query.Single("hoy"))));

        // «Marcar todo como comprado»: { ids, date? } → { changes, items }.
        routes.Map("POST", "/api/despensa/comprado", RouteAccess.Public, async request =>
            await ApiResponse.Data(request.Http, await useCases.MarkPurchased.Handle(request.Body)));

        // Deshacer la compra: { changes } → los productos, o 409 si algo cambió después.
        routes.Map("POST", "/api/despensa/comprado/deshacer", RouteAccess.Public, async request =>
            await ApiResponse.Data(request.Http, await useCases.UndoPurchase.Handle(request.Body)));
    }
}
