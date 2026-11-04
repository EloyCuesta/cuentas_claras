using System.Net;
using System.Net.Sockets;
using CuentasClaras.Api.Composition;
using CuentasClaras.Infrastructure.Common.MySql;
using Microsoft.AspNetCore.Builder;

namespace CuentasClaras.Tests;

/// <summary>El arranque configurado: CUENTAS_DB_*, el código antes que MySQL, la salud real y los errores sin la contraseña.</summary>
public sealed class MySqlHostTests
{
    private const string Code = "codigo-de-prueba";
    private static CancellationToken Token => TestContext.Current.CancellationToken;

    [Fact]
    public void La_configuracion_por_entorno_sigue_las_reglas_de_Express_y_nunca_muestra_la_contrasena()
    {
        static Func<string, string?> Env(Dictionary<string, string> values) => name => values.GetValueOrDefault(name);

        Assert.Null(MySqlSettings.FromEnvironment(Env([])));
        Assert.Null(MySqlSettings.FromEnvironment(Env(new() { ["CUENTAS_DB_USER"] = "   ", ["CUENTAS_DB_PASSWORD"] = "x" })));
        Assert.Equal(new MySqlSettings("127.0.0.1", 3306, "cuentas", "", "cuentas_claras"),
            MySqlSettings.FromEnvironment(Env(new() { ["CUENTAS_DB_USER"] = "cuentas" })));
        var all = MySqlSettings.FromEnvironment(Env(new()
        {
            ["CUENTAS_DB_HOST"] = " db.local ", ["CUENTAS_DB_PORT"] = "3307", ["CUENTAS_DB_USER"] = " cuentas ",
            ["CUENTAS_DB_PASSWORD"] = "  con espacios  ", ["CUENTAS_DB_NAME"] = "cuentas_test_data01",
        }))!;
        // La contraseña no se recorta: puede empezar o terminar con espacios.
        Assert.Equal(new MySqlSettings("db.local", 3307, "cuentas", "  con espacios  ", "cuentas_test_data01"), all);
        Assert.Equal("cuentas@db.local:3307/cuentas_test_data01", all.Describe());
        Assert.DoesNotContain("espacios", all.ToString());

        foreach (var port in new[] { "0", "65536", "abc", "3306.5", "-1" })
        {
            var error = Assert.Throws<ArgumentException>(() =>
                MySqlSettings.FromEnvironment(Env(new() { ["CUENTAS_DB_USER"] = "u", ["CUENTAS_DB_PORT"] = port })));
            Assert.Equal("CUENTAS_DB_PORT debe ser un número de puerto entre 1 y 65535 (por defecto 3306).", error.Message);
        }
        foreach (var name in new[] { "cuentas-claras", "piña", new string('a', 65), "a;b" })
        {
            var error = Assert.Throws<ArgumentException>(() =>
                MySqlSettings.FromEnvironment(Env(new() { ["CUENTAS_DB_USER"] = "u", ["CUENTAS_DB_NAME"] = name })));
            Assert.Equal("CUENTAS_DB_NAME solo puede tener letras sin tildes, números y guiones bajos (hasta 64).", error.Message);
        }
    }

    [Fact]
    public async Task El_codigo_se_valida_antes_de_intentar_conectar_con_MySQL()
    {
        var port = ClosedPort();
        Func<string, string?> read = name => name switch
        {
            "CUENTAS_DB_USER" => "nadie", "CUENTAS_DB_PASSWORD" => "secreto-que-no-sale", "CUENTAS_DB_PORT" => port.ToString(), _ => null,
        };
        var invalid = await Assert.ThrowsAsync<ArgumentException>(() =>
            ApiHost.CreateConfigured(new HostSettings("abc", Port: 0), read, log: TextWriter.Null, cancellationToken: Token));
        Assert.Contains("CUENTAS_CODIGO", invalid.Message);
        // Con el código válido sí intenta conectar, y lo explica sin la contraseña.
        var down = await Assert.ThrowsAsync<StartupException>(() =>
            ApiHost.CreateConfigured(new HostSettings(Code, Port: 0), read, log: TextWriter.Null, cancellationToken: Token));
        Assert.StartsWith($"MySQL no responde en 127.0.0.1:{port}.", down.Message);
        Assert.DoesNotContain("secreto-que-no-sale", down.Message);
    }

    [Fact]
    public async Task Sin_CUENTAS_DB_USER_el_host_solo_sirve_el_acceso_y_la_salud_no_inventa_una_version()
    {
        var log = new StringWriter();
        await using var api = await Running.Start(await ApiHost.CreateConfigured(new HostSettings(Code, Port: 0), _ => null,
            ["--Logging:LogLevel:Default=Critical"], log, Token));
        Assert.Contains("Sin CUENTAS_DB_USER: solo acceso", log.ToString());
        using var health = await api.Client.GetAsync("/api/health", Token);
        Assert.Equal(HttpStatusCode.InternalServerError, health.StatusCode);
        Assert.Equal("{\"ok\":true,\"data\":{\"rol\":\"invitado\"}}", await (await api.Client.GetAsync("/api/auth/me", Token)).Content.ReadAsStringAsync(Token));
    }

    [Fact, Trait("Categoria", TestDatabase.Category)]
    public async Task El_host_configurado_responde_la_salud_con_la_version_aplicada_leida_de_MySQL()
    {
        await using var test = await TestDatabase.Create();
        var log = new StringWriter();
        await using (var api = await Running.Start(await ApiHost.CreateConfigured(new HostSettings(Code, Port: 0), test.Variables(),
            ["--Logging:LogLevel:Default=Critical"], log, Token)))
        {
            Assert.Equal($"[api] Base de datos MySQL: {test.Settings.Describe()} (esquema 5)", log.ToString().Trim());
            Assert.DoesNotContain(test.Settings.Password, log.ToString());
            using var health = await api.Client.GetAsync("/api/health", Token);
            Assert.Equal(HttpStatusCode.OK, health.StatusCode);
            Assert.Equal("no-store", health.Headers.CacheControl?.ToString());
            Assert.Equal("{\"ok\":true,\"data\":{\"status\":\"ok\",\"schemaVersion\":5}}", await health.Content.ReadAsStringAsync(Token));
            // La versión se lee en cada petición, no se recuerda la del arranque.
            await MySqlCommands.Execute(await test.Connect(), null,
                "INSERT INTO schema_migrations (version, name, started_at, applied_at) VALUES (6, 'sintetica', 'x', 'x')", [], Token);
            Assert.Equal("{\"ok\":true,\"data\":{\"status\":\"ok\",\"schemaVersion\":6}}",
                await (await api.Client.GetAsync("/api/health", Token)).Content.ReadAsStringAsync(Token));
            // El acceso sigue igual con almacenamiento.
            using var login = await api.Client.PostAsync("/api/auth/login",
                new StringContent($"{{\"codigo\":\"{Code}\"}}", System.Text.Encoding.UTF8, "application/json"), Token);
            Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        }
        // Migró y sembró la base, con el historial de Express.
        Assert.Equal(27L, await test.Scalar("SELECT COUNT(*) FROM categories"));
    }

    [Fact, Trait("Categoria", TestDatabase.Category)]
    public async Task Explica_un_usuario_rechazado_y_una_base_inexistente_sin_mostrar_la_contrasena_ni_crearla()
    {
        var server = TestDatabase.Server();
        Func<string, string?> With(string password, string database) => name => name switch
        {
            "CUENTAS_DB_HOST" => server.Host, "CUENTAS_DB_PORT" => server.Port.ToString(), "CUENTAS_DB_USER" => server.User,
            "CUENTAS_DB_PASSWORD" => password, "CUENTAS_DB_NAME" => database, _ => null,
        };
        var rejected = await Assert.ThrowsAsync<StartupException>(() => ApiHost.CreateConfigured(new HostSettings(Code, Port: 0),
            With("contraseña-equivocada-123", "cuentas_test_rechazo"), log: TextWriter.Null, cancellationToken: Token));
        Assert.StartsWith($"MySQL ha rechazado el usuario «{server.User}»", rejected.Message);
        Assert.DoesNotContain("contraseña-equivocada-123", rejected.Message);

        var missing = "cuentas_test_no_existe_" + Guid.NewGuid().ToString("N")[..8];
        var unknown = await Assert.ThrowsAsync<StartupException>(() => ApiHost.CreateConfigured(new HostSettings(Code, Port: 0),
            With(server.Password, missing), log: TextWriter.Null, cancellationToken: Token));
        Assert.StartsWith($"La base de datos «{missing}» no existe en MySQL", unknown.Message);
        Assert.DoesNotContain(server.Password, unknown.Message);
        await using var probe = await TestDatabase.Create();
        Assert.Equal(0L, await probe.Scalar("SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?", missing));
    }

    private static int ClosedPort()
    {
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        return ((IPEndPoint)listener.LocalEndpoint).Port;
    }

    private sealed class Running(WebApplication app, HttpClient client) : IAsyncDisposable
    {
        public HttpClient Client { get; } = client;

        public static async Task<Running> Start(WebApplication app)
        {
            await app.StartAsync(Token);
            return new Running(app, new HttpClient(new HttpClientHandler { UseCookies = false }) { BaseAddress = new Uri(app.Urls.Single()) });
        }

        public async ValueTask DisposeAsync()
        {
            Client.Dispose();
            await app.StopAsync(Token);
            await app.DisposeAsync();
        }
    }
}
