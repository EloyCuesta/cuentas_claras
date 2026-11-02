using System.Net;
using CuentasClaras.Application.Auth;
using CuentasClaras.Application.Common;
using CuentasClaras.Application.Health;
using CuentasClaras.Infrastructure.Auth;
using CuentasClaras.Infrastructure.Common;
using CuentasClaras.Infrastructure.Health;
using CuentasClaras.Api.Common;

namespace CuentasClaras.Api.Composition;

/// <summary>Compone adaptadores y casos de uso a mano, una vez por host. ASP.NET solo gestiona el transporte.</summary>
public static class ApiHost
{
    public static WebApplication Create(HostSettings settings, IClock? clock = null,
        IStorageHealth? storage = null, string[]? args = null)
    {
        // La validación precede incluso a la construcción del host y de sus recursos.
        var verifier = new Sha256CodeVerifier(settings.AccessCode);
        clock ??= new SystemClock();
        var sessions = new InMemorySessionStore();
        var login = new Login(verifier, new RandomTokenGenerator(), sessions, new InMemoryAttemptStore(), clock);
        var logout = new Logout(sessions);
        var checkSession = new CheckSession(sessions, clock);
        var health = new CheckHealth(storage ?? new UnconfiguredStorageHealth());

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
