using System.Net;
using CuentasClaras.Application.Auth;
using CuentasClaras.Application.Common;
using CuentasClaras.Application.Health;
using CuentasClaras.Infrastructure.Auth;
using CuentasClaras.Infrastructure.Common;
using CuentasClaras.Infrastructure.Common.MySql;
using CuentasClaras.Infrastructure.Finance;
using CuentasClaras.Infrastructure.Health;
using CuentasClaras.Api.Common;

namespace CuentasClaras.Api.Composition;

/// <summary>El host no puede arrancar por su almacenamiento: el mensaje, en español y sin la contraseña, se enseña tal cual.</summary>
public sealed class StartupException(string message, Exception? inner = null) : Exception(message, inner);

/// <summary>Compone adaptadores y casos de uso a mano, una vez por host. ASP.NET solo gestiona el transporte.</summary>
public static class ApiHost
{
    /// <summary>Host sin base de datos: el ensayo aislado del acceso. Salud usa <paramref name="storage"/> o falla.</summary>
    public static WebApplication Create(HostSettings settings, IClock? clock = null,
        IStorageHealth? storage = null, string[]? args = null)
    {
        // La validación precede incluso a la construcción del host y de sus recursos.
        var verifier = new Sha256CodeVerifier(settings.AccessCode);
        return Build(settings, verifier, clock ?? new SystemClock(), storage ?? new UnconfiguredStorageHealth(), args);
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
            return Build(settings, verifier, clock, new UnconfiguredStorageHealth(), args);
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
            var app = Build(settings, verifier, clock, new MySqlStorageHealth(opened), args);
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

    private static WebApplication Build(HostSettings settings, Sha256CodeVerifier verifier, IClock clock,
        IStorageHealth storage, string[]? args)
    {
        var sessions = new InMemorySessionStore();
        var login = new Login(verifier, new RandomTokenGenerator(), sessions, new InMemoryAttemptStore(), clock);
        var logout = new Logout(sessions);
        var checkSession = new CheckSession(sessions, clock);
        var health = new CheckHealth(storage);

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
        var router = new ApiRouter(login, logout, checkSession, health);
        app.Run(router.Handle);
        return app;
    }
}
