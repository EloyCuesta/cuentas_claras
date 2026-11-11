using CuentasClaras.Api.Common;
using CuentasClaras.Application.Pantry;

namespace CuentasClaras.Api.Pantry;

/// <summary>Los casos de uso de la despensa que usan sus rutas.</summary>
public sealed record PantryUseCases(
    PantryQueries Queries, CreatePerson CreatePerson, RenamePerson RenamePerson, DeletePerson DeletePerson,
    CreateItem CreateItem, UpdateItem UpdateItem, DeleteItem DeleteItem, AdjustItem AdjustItem, MarkPurchased MarkPurchased,
    UndoPurchase UndoPurchase);

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

        // Lo borra con sus revisiones.
        routes.Map("DELETE", "/api/despensa/productos/:id", RouteAccess.Public, async request =>
        {
            await useCases.DeleteItem.Execute(request.Param("id"));
            await ApiResponse.Data(request.Http, null);
        });

        // «Marcar todo como comprado»: { ids, date? } → { changes, items }.
        routes.Map("POST", "/api/despensa/comprado", RouteAccess.Public, async request =>
            await ApiResponse.Data(request.Http, await useCases.MarkPurchased.Handle(request.Body)));

        // Deshacer la compra: { changes } → los productos, o 409 si algo cambió después.
        routes.Map("POST", "/api/despensa/comprado/deshacer", RouteAccess.Public, async request =>
            await ApiResponse.Data(request.Http, await useCases.UndoPurchase.Handle(request.Body)));
    }
}
