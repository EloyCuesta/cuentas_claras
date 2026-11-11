using System.Net;
using CuentasClaras.Api.Common;
using CuentasClaras.Api.Finance;
using CuentasClaras.Api.Pantry;
using CuentasClaras.Api.Tickets;
using CuentasClaras.Application.Auth;
using CuentasClaras.Application.Common;
using CuentasClaras.Application.Finance;
using CuentasClaras.Application.Health;
using CuentasClaras.Application.Pantry;
using CuentasClaras.Application.Tickets;
using CuentasClaras.Infrastructure.Auth;
using CuentasClaras.Infrastructure.Common;
using CuentasClaras.Infrastructure.Common.MySql;
using CuentasClaras.Infrastructure.Finance;
using CuentasClaras.Infrastructure.Health;
using CuentasClaras.Infrastructure.Pantry;
using CuentasClaras.Infrastructure.Tickets;

namespace CuentasClaras.Api.Composition;

/// <summary>El host no puede arrancar por su almacenamiento: el mensaje, en español y sin la contraseña, se enseña tal cual.</summary>
public sealed class StartupException(string message, Exception? inner = null) : Exception(message, inner);

/// <summary>Compone adaptadores y casos de uso a mano, una vez por host. ASP.NET solo gestiona el transporte.</summary>
public static class ApiHost
{
    /// <summary>
    /// Host sin base de datos: el ensayo aislado del acceso. Salud usa <paramref name="storage"/> o falla; las rutas de datos
    /// existen, pero cualquier consulta da un error interno.
    /// </summary>
    public static WebApplication Create(HostSettings settings, IClock? clock = null,
        IStorageHealth? storage = null, string[]? args = null)
    {
        // La validación precede incluso a la construcción del host y de sus recursos.
        var verifier = new Sha256CodeVerifier(settings.AccessCode);
        return Build(settings, verifier, new HostServices(clock ?? new SystemClock(), new UuidGenerator(),
            MySqlDatabase.Unconfigured(), storage ?? new UnconfiguredStorageHealth(), OwnedReader(Environment.GetEnvironmentVariable), OwnsReader: true), args);
    }

    /// <summary>El lector de tickets del host: el worker Node del OCR (CUENTAS_OCR_WORKER), que solo arranca al leer una imagen.</summary>
    private static NodeTicketReader OwnedReader(Func<string, string?> read) => new(OcrWorkerSettings.FromEnvironment(read));

    /// <summary>
    /// Host sobre una base ya abierta y migrada, para las pruebas de integración y el corpus HTTP: reloj, ids y lector de
    /// tickets sustituibles, como startApi en Express. Quien abrió la base la cierra; un lector que se pasa, también.
    /// </summary>
    public static WebApplication CreateWithDatabase(HostSettings settings, MySqlDatabase database, IClock? clock = null,
        IIdGenerator? ids = null, string[]? args = null, ITicketReader? reader = null)
    {
        var verifier = new Sha256CodeVerifier(settings.AccessCode);
        return Build(settings, verifier, new HostServices(clock ?? new SystemClock(), ids ?? new UuidGenerator(),
            database, new MySqlStorageHealth(database), reader ?? OwnedReader(Environment.GetEnvironmentVariable), OwnsReader: reader is null), args);
    }

    /// <summary>
    /// Arranque real. Primero el código de acceso; después CUENTAS_DB_*: sin CUENTAS_DB_USER el host solo sirve el acceso
    /// (salud responde 500); con él, abre MySQL, aplica las migraciones de database/mysql/ y siembra una base nueva.
    /// </summary>
    public static async Task<WebApplication> CreateConfigured(HostSettings settings, Func<string, string?>? read = null,
        string[]? args = null, TextWriter? log = null, CancellationToken cancellationToken = default)
    {
        var verifier = new Sha256CodeVerifier(settings.AccessCode);
        var clock = new SystemClock();
        log ??= Console.Out;
        var database = MySqlSettings.FromEnvironment(read ?? Environment.GetEnvironmentVariable);
        if (database is null)
        {
            log.WriteLine("[api] Sin CUENTAS_DB_USER: solo acceso; /api/health responde 500 hasta configurar MySQL.");
            return Build(settings, verifier, new HostServices(clock, new UuidGenerator(), MySqlDatabase.Unconfigured(),
                new UnconfiguredStorageHealth(), OwnedReader(read ?? Environment.GetEnvironmentVariable), OwnsReader: true), args);
        }

        MySqlDatabase opened;
        int version;
        try
        {
            (opened, version) = await MySqlDatabase.Open(database, DefaultCategorySeed.Options(clock), cancellationToken);
        }
        catch (DatabaseSetupException error)
        {
            throw new StartupException(error.Message, error);
        }
        try
        {
            var app = Build(settings, verifier, new HostServices(clock, new UuidGenerator(), opened, new MySqlStorageHealth(opened),
                OwnedReader(read ?? Environment.GetEnvironmentVariable), OwnsReader: true), args);
            app.Lifetime.ApplicationStopped.Register(opened.Dispose);
            log.WriteLine($"[api] Base de datos MySQL: {database.Describe()} (esquema {version})");
            return app;
        }
        catch
        {
            await opened.DisposeAsync();
            throw;
        }
    }

    /// <summary>Las rutas que atiende el acceso y la salud antes que los módulos (ApiRouter).</summary>
    public static IReadOnlyList<(string Method, string Pattern)> HostRoutes { get; } =
        [("POST", "/api/auth/login"), ("POST", "/api/auth/logout"), ("GET", "/api/auth/me"), ("GET", "/api/health")];

    /// <summary>La tabla de rutas de los módulos, sin base de datos: para el inventario de las pruebas, nunca se ejecuta.</summary>
    public static ApiRouteTable ModuleRoutes()
    {
        var routes = new ApiRouteTable();
        MapModules(routes, new HostServices(new SystemClock(), new UuidGenerator(), MySqlDatabase.Unconfigured(), new UnconfiguredStorageHealth(),
            OwnedReader(_ => null)));
        return routes;
    }

    /// <summary>
    /// Lo que comparten los módulos de un host: reloj, ids, la base de datos (abierta o sin configurar) y el lector de tickets
    /// (OwnsReader: el host lo cierra al pararse).
    /// </summary>
    private sealed record HostServices(IClock Clock, IIdGenerator Ids, MySqlDatabase Database, IStorageHealth Storage, ITicketReader Reader,
        bool OwnsReader = false);

    /// <summary>Compone cada módulo con sus adaptadores y registra sus rutas, en el orden de server/app.ts.</summary>
    private static void MapModules(ApiRouteTable routes, HostServices services)
    {
        var unitOfWork = new MySqlUnitOfWork(services.Database);

        // La despensa, pública (antes que requireAdmin en Express).
        var pantryStore = new MySqlPantryStore(services.Database);
        var pantryQueries = new PantryQueries(pantryStore);
        var addEvent = new AddEvent(pantryStore, services.Clock, services.Ids, unitOfWork);
        var createItem = new CreateItem(pantryStore, services.Clock, services.Ids, unitOfWork);
        PantryRoutes.Map(routes, new PantryUseCases(
            pantryQueries,
            new CreatePerson(pantryStore, services.Clock, services.Ids, unitOfWork),
            new RenamePerson(pantryStore, unitOfWork),
            new DeletePerson(pantryStore, unitOfWork),
            createItem,
            new UpdateItem(pantryStore, services.Clock, unitOfWork),
            new DeleteItem(pantryStore, unitOfWork),
            new AdjustItem(pantryStore, services.Clock, unitOfWork),
            new MarkPurchased(pantryStore, pantryQueries, addEvent, services.Clock, unitOfWork),
            new UndoPurchase(pantryStore, pantryQueries, services.Clock, unitOfWork),
            addEvent,
            new DeleteEvent(pantryStore, unitOfWork),
            new SetBudget(pantryStore, unitOfWork),
            new SetReviewDate(pantryStore, unitOfWork),
            // Las compras de la actividad las da Tickets, por el contrato de la despensa.
            new PantryActivityQueries(pantryStore, new MySqlTicketPurchaseHistory(services.Database), services.Clock)));

        // Los tickets, públicos como la despensa: usan de ella solo su catálogo (Application.Pantry.Contracts).
        var catalog = new PantryCatalog(pantryStore, pantryQueries, createItem, new ApplyTicketPurchase(pantryStore, services.Clock, unitOfWork));
        var ticketStore = new MySqlTicketStore(services.Database);
        TicketRoutes.Map(routes, new TicketUseCases(
            new ReadTicket(ticketStore, catalog, services.Reader, new Sha256Hasher(), services.Clock, services.Ids)));

        // Las finanzas, con sesión.
        var financeStore = new MySqlFinanceStore(services.Database);
        FinanceRoutes.Map(routes, new FinanceUseCases(
            new FinanceQueries(financeStore, unitOfWork),
            new RestoreBackup(financeStore, unitOfWork),
            new SaveMovement(financeStore, unitOfWork),
            new DeleteMovement(financeStore, unitOfWork),
            new SaveCategory(financeStore, unitOfWork),
            new DeleteCategory(financeStore, services.Clock, unitOfWork),
            new SaveRecurring(financeStore, services.Clock, services.Ids, unitOfWork),
            new DeleteRecurring(financeStore, unitOfWork),
            new GenerateOccurrences(financeStore, services.Clock, services.Ids, unitOfWork),
            new SetMeta(financeStore, unitOfWork),
            new SummaryQueries(financeStore, unitOfWork),
            new ImportBrowserData(financeStore, services.Clock, unitOfWork)));
    }

    private static WebApplication Build(HostSettings settings, Sha256CodeVerifier verifier, HostServices services, string[]? args)
    {
        var sessions = new InMemorySessionStore();
        var login = new Login(verifier, new RandomTokenGenerator(), sessions, new InMemoryAttemptStore(), services.Clock);
        var logout = new Logout(sessions);
        var checkSession = new CheckSession(sessions, services.Clock);
        var health = new CheckHealth(services.Storage);

        var routes = new ApiRouteTable();
        MapModules(routes, services);

        var builder = WebApplication.CreateBuilder(new WebApplicationOptions
        {
            Args = args ?? [],
            ApplicationName = typeof(Program).Assembly.GetName().Name,
        });
        builder.WebHost.ConfigureKestrel(options =>
        {
            options.AddServerHeader = false;
            // El lector cuenta bytes (también descomprimidos) y genera el sobre de error común.
            options.Limits.MaxRequestBodySize = null;
            options.Listen(IPAddress.Parse(settings.Host), settings.Port);
        });
        var app = builder.Build();
        // El worker del OCR se cierra con el host (si es suyo).
        if (services.OwnsReader && services.Reader is IAsyncDisposable owned)
            app.Lifetime.ApplicationStopping.Register(() => owned.DisposeAsync().AsTask().GetAwaiter().GetResult());
        var router = new ApiRouter(login, logout, checkSession, health, routes, MySqlErrors.IsConstraintViolation);
        app.Run(router.Handle);
        return app;
    }
}
