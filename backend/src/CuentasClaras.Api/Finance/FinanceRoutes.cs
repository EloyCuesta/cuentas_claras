using CuentasClaras.Api.Common;
using CuentasClaras.Application.Common;
using CuentasClaras.Application.Finance;

namespace CuentasClaras.Api.Finance;

/// <summary>Los casos de uso de las finanzas que usan sus rutas.</summary>
public sealed record FinanceUseCases(
    FinanceQueries Queries, RestoreBackup RestoreBackup, SaveMovement SaveMovement, DeleteMovement DeleteMovement,
    SaveCategory SaveCategory, DeleteCategory DeleteCategory, SaveRecurring SaveRecurring, DeleteRecurring DeleteRecurring,
    GenerateOccurrences GenerateOccurrences, SetMeta SetMeta, SummaryQueries Summaries, ImportBrowserData ImportBrowserData);

/// <summary>
/// Las rutas financieras (server/modules/finance/adapters/http/), todas con sesión: solo traducen HTTP ⇄ caso de uso,
/// con las mismas rutas, códigos y mensajes. La validación del cuerpo está en Application (FinanceRequests).
/// </summary>
public static class FinanceRoutes
{
    public static void Map(ApiRouteTable routes, FinanceUseCases useCases)
    {
        // Todos los datos de una vez: categorías, movimientos y recurrentes.
        routes.Map("GET", "/api/data", RouteAccess.Session, async request =>
            await ApiResponse.Data(request.Http, await useCases.Queries.LoadAll()));

        // Sustituye todo (restaurar una copia de seguridad).
        routes.Map("PUT", "/api/data", RouteAccess.Session, async request =>
        {
            await useCases.RestoreBackup.Handle(request.Body);
            await ApiResponse.Data(request.Http, null);
        });

        // Importa los datos que había en el navegador (solo si aquí no hay nada del usuario): 201 con los recuentos.
        routes.Map("POST", "/api/import", RouteAccess.Session, async request =>
            await ApiResponse.Data(request.Http, await useCases.ImportBrowserData.Handle(request.Body), 201));

        // Crea o actualiza un movimiento (marcar como pagado incluido).
        routes.Map("PUT", "/api/movements/:id", RouteAccess.Session, async request =>
        {
            await useCases.SaveMovement.Handle(request.Param("id"), request.Body);
            await ApiResponse.Data(request.Http, null);
        });

        // Lo elimina; si era un vencimiento, no se vuelve a generar.
        routes.Map("DELETE", "/api/movements/:id", RouteAccess.Session, async request =>
        {
            await useCases.DeleteMovement.Execute(request.Param("id"));
            await ApiResponse.Data(request.Http, null);
        });

        // Crea o actualiza una categoría (nombre, orden, presupuesto…).
        routes.Map("PUT", "/api/categories/:id", RouteAccess.Session, async request =>
        {
            await useCases.SaveCategory.Handle(request.Param("id"), request.Body);
            await ApiResponse.Data(request.Http, null);
        });

        // Elimina la categoría y sus subcategorías; sus movimientos y recurrentes pasan a ?replacementId.
        routes.Map("DELETE", "/api/categories/:id", RouteAccess.Session, async request =>
        {
            string? replacementId = null;
            if (request.Query.Has("replacementId"))
            {
                // Express: un texto no vacío; repetido sería una lista y tampoco vale.
                replacementId = request.Query.Single("replacementId");
                if (string.IsNullOrEmpty(replacementId)) throw new AppError("VALIDATION", "El parámetro «replacementId» no es válido.");
            }
            await useCases.DeleteCategory.Execute(request.Param("id"), replacementId);
            await ApiResponse.Data(request.Http, null);
        });

        // Guarda el recurrente y rehace sus vencimientos pendientes: { rule, horizon, markPaidBefore } → { created }.
        routes.Map("PUT", "/api/recurring/:id", RouteAccess.Session, async request =>
        {
            var created = await useCases.SaveRecurring.Handle(request.Param("id"), request.Body);
            await ApiResponse.Data(request.Http, new { created });
        });

        // Lo elimina con sus pendientes (los pagados se conservan).
        routes.Map("DELETE", "/api/recurring/:id", RouteAccess.Session, async request =>
        {
            await useCases.DeleteRecurring.Execute(request.Param("id"));
            await ApiResponse.Data(request.Http, null);
        });

        // Crea los vencimientos que falten hasta { horizon } → { created }.
        routes.Map("POST", "/api/occurrences/generate", RouteAccess.Session, async request =>
        {
            var created = await useCases.GenerateOccurrences.Handle(request.Body);
            await ApiResponse.Data(request.Http, new { created });
        });

        // Datos auxiliares (fecha de la última copia descargada…).
        routes.Map("GET", "/api/meta/:key", RouteAccess.Session, async request =>
            await ApiResponse.Data(request.Http, await useCases.Queries.GetMeta(request.Param("key"))));

        routes.Map("PUT", "/api/meta/:key", RouteAccess.Session, async request =>
        {
            await useCases.SetMeta.Handle(request.Param("key"), request.Body);
            await ApiResponse.Data(request.Http, null);
        });

        // FIN-04, solo en .NET: lo que enseñan las plantillas mensual y anual, calculado aquí (shared/finance/summaryViews.ts).
        routes.Map("GET", "/api/summary/month", RouteAccess.Session, async request =>
            await ApiResponse.Data(request.Http, await useCases.Summaries.Month(
                request.Query.Single("year"), request.Query.Single("month"), request.Query.Single("hoy"))));

        routes.Map("GET", "/api/summary/year", RouteAccess.Session, async request =>
            await ApiResponse.Data(request.Http, await useCases.Summaries.YearView(request.Query.Single("year"), request.Query.Single("hoy"))));
    }
}
