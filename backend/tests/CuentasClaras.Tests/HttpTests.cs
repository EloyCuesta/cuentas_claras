using System.Diagnostics;
using System.Globalization;
using System.IO.Compression;
using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using CuentasClaras.Api.Auth;
using CuentasClaras.Api.Composition;
using CuentasClaras.Application.Common;
using CuentasClaras.Application.Health;
using Microsoft.AspNetCore.Builder;

namespace CuentasClaras.Tests;

/// <summary>Contratos sobre Kestrel real, puertos libres y datos sintéticos: nunca abre una base de datos.</summary>
public sealed class HttpTests
{
    private const string Code = "codigo-de-prueba";
    private const string InvalidJson = "El cuerpo de la petición no es JSON válido.";
    private const string TooLarge = "Los datos enviados son demasiado grandes.";
    private const string MissingBody = "Falta el cuerpo de la petición en JSON.";
    private const string MissingCode = "Escribe el código de acceso.";

    [Fact]
    public async Task Reproduce_los_tres_escenarios_y_22_peticiones_del_corpus_auth_sin_regenerar_expectativas()
    {
        using var fixture = JsonDocument.Parse(await File.ReadAllTextAsync(
            Path.Combine(AppContext.BaseDirectory, "Fixtures", "http-auth.json"), TestContext.Current.CancellationToken));
        Assert.Equal("cuentas-claras-http-v1", fixture.RootElement.GetProperty("format").GetString());
        var count = 0;
        foreach (var scenario in fixture.RootElement.GetProperty("scenarios").EnumerateArray())
        {
            var setup = scenario.GetProperty("setup");
            var clock = new HttpClock(DateTimeOffset.Parse(setup.GetProperty("now").GetString()!,
                CultureInfo.InvariantCulture).ToUnixTimeMilliseconds());
            await using var api = await RunningApi.Start(clock: clock);
            string? cookie = null;
            foreach (var step in scenario.GetProperty("steps").EnumerateArray())
            {
                if (step.TryGetProperty("advanceMs", out var advance)) clock.Now += advance.GetInt64();
                var request = step.GetProperty("request");
                using var message = new HttpRequestMessage(new HttpMethod(request.GetProperty("method").GetString()!),
                    request.GetProperty("path").GetString());
                if (request.TryGetProperty("body", out var body)) message.Content = JsonContent(body.GetRawText());
                if (cookie is not null) message.Headers.Add("Cookie", cookie);
                using var response = await api.Client.SendAsync(message, TestContext.Current.CancellationToken);
                var expected = step.GetProperty("expected");
                Assert.Equal(expected.GetProperty("status").GetInt32(), (int)response.StatusCode);
                using var actual = JsonDocument.Parse(await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
                Assert.True(JsonElement.DeepEquals(expected.GetProperty("body"), actual.RootElement),
                    $"{scenario.GetProperty("name")}: {step.GetProperty("name")}: {actual.RootElement}");
                foreach (var header in expected.GetProperty("headers").EnumerateObject())
                {
                    var value = Header(response, header.Name);
                    if (header.Name == "set-cookie" && value is not null)
                    {
                        cookie = value.Split(';')[0];
                        value = Regex.Replace(value, "cc_sesion=[a-f0-9]{64};", "cc_sesion=<token>;");
                    }
                    Assert.Equal(header.Value.ValueKind == JsonValueKind.Null ? null : header.Value.GetString(), value);
                }
                count++;
            }
        }
        Assert.Equal(22, count);
    }

    [Theory]
    [InlineData("{")]
    [InlineData("null")]
    [InlineData("123")]
    [InlineData("{\"codigo\":\"x\",}")]
    public async Task Json_invalido_se_rechaza_antes_del_acceso_y_siempre_lleva_no_store(string body)
    {
        await using var api = await RunningApi.Start();
        using var response = await api.Client.PostAsync("/api/data", JsonContent(body), TestContext.Current.CancellationToken);
        await AssertError(response, 400, "VALIDATION", InvalidJson);
    }

    [Theory]
    [InlineData("{}", MissingCode)]
    // Como readBody de Express: un array es JSON válido, pero no el objeto que se espera.
    [InlineData("[]", MissingBody)]
    [InlineData("{\"codigo\":42}", MissingCode)]
    [InlineData("{\"codigo\":\"\"}", MissingCode)]
    public async Task Cuerpo_sin_codigo_valido_no_cuenta_como_intento(string body, string message)
    {
        await using var api = await RunningApi.Start();
        for (var i = 0; i < 6; i++)
        {
            using var invalid = await api.Client.PostAsync("/api/auth/login", JsonContent(body), TestContext.Current.CancellationToken);
            await AssertError(invalid, 400, "VALIDATION", message);
        }
        using var login = await api.Login();
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
    }

    [Theory]
    [InlineData("/api/auth/login", 20, 400)]
    [InlineData("/api/despensa/tickets/leer", 30, 404)]
    public async Task Limites_de_bytes_exactos_y_un_byte_mas_tambien_en_cuerpos_comprimidos(
        string path, int mib, int acceptedStatus)
    {
        await using var api = await RunningApi.Start();
        foreach (var compressed in new[] { false, true })
        {
            using var accepted = await api.Client.PostAsync(path, SizedJson(mib * 1024 * 1024, compressed), TestContext.Current.CancellationToken);
            Assert.Equal(acceptedStatus, (int)accepted.StatusCode);
            Assert.Equal("no-store", Header(accepted, "cache-control"));
            using var rejected = await api.Client.PostAsync(path, SizedJson(mib * 1024 * 1024 + 1, compressed), TestContext.Current.CancellationToken);
            await AssertError(rejected, 413, "VALIDATION", TooLarge);
        }
    }

    [Fact]
    public async Task Finanzas_protegidas_y_reset_inexistente_incluso_con_sesion()
    {
        await using var api = await RunningApi.Start();
        var routes = new[] { "GET /api/data", "PUT /api/data", "POST /api/import", "PUT /api/movements/m1",
            "DELETE /api/movements/m1", "PUT /api/categories/c1", "DELETE /api/categories/c1",
            "PUT /api/recurring/r1", "DELETE /api/recurring/r1", "POST /api/occurrences/generate",
            "GET /api/meta/lastBackupAt", "PUT /api/meta/lastBackupAt", "POST /api/test/reset" };
        foreach (var route in routes)
        {
            var parts = route.Split(' ');
            using var message = new HttpRequestMessage(new HttpMethod(parts[0]), parts[1]);
            using var response = await api.Client.SendAsync(message, TestContext.Current.CancellationToken);
            await AssertError(response, 401, "UNAUTHORIZED", "Hace falta el código de acceso para ver esta sección.");
        }
        using var login = await api.Login();
        api.Client.DefaultRequestHeaders.Add("Cookie", Header(login, "set-cookie")!.Split(';')[0]);
        using var reset = await api.Client.PostAsync("/api/test/reset", null, TestContext.Current.CancellationToken);
        await AssertError(reset, 404, "NOT_FOUND", "No existe POST /api/test/reset.");
        using var unknown = await api.Client.GetAsync("/api/no-existe?origen=ensayo", TestContext.Current.CancellationToken);
        await AssertError(unknown, 404, "NOT_FOUND", "No existe GET /api/no-existe?origen=ensayo.");
    }

    [Fact]
    public async Task Login_renueva_la_sesion_y_reiniciar_la_pierde()
    {
        string latestCookie;
        await using (var api = await RunningApi.Start())
        {
            using var first = await api.Login();
            var firstCookie = Header(first, "set-cookie")!.Split(';')[0];
            api.Client.DefaultRequestHeaders.Add("Cookie", firstCookie);
            using var second = await api.Login();
            latestCookie = Header(second, "set-cookie")!.Split(';')[0];
            Assert.NotEqual(firstCookie, latestCookie);
            using var oldSession = await api.Client.GetAsync("/api/auth/me", TestContext.Current.CancellationToken);
            Assert.Contains("\"rol\":\"invitado\"", await oldSession.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        }
        await using var restarted = await RunningApi.Start();
        restarted.Client.DefaultRequestHeaders.Add("Cookie", latestCookie);
        using var lostSession = await restarted.Client.GetAsync("/api/auth/me", TestContext.Current.CancellationToken);
        Assert.Contains("\"rol\":\"invitado\"", await lostSession.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task Proxy_local_no_permite_esquivar_el_bloqueo_inventando_saltos_anteriores()
    {
        await using var api = await RunningApi.Start();
        for (var i = 0; i < 5; i++)
        {
            using var request = LoginRequest("incorrecto", $"203.0.113.{i + 1}, 192.0.2.10");
            using var response = await api.Client.SendAsync(request, TestContext.Current.CancellationToken);
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        }
        using var blockedRequest = LoginRequest(Code, "198.51.100.7, 192.0.2.10");
        using var blocked = await api.Client.SendAsync(blockedRequest, TestContext.Current.CancellationToken);
        Assert.Equal(429, (int)blocked.StatusCode);
        Assert.Equal("900", Header(blocked, "retry-after"));
        using var otherRequest = LoginRequest(Code, "192.0.2.11");
        using var other = await api.Client.SendAsync(otherRequest, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, other.StatusCode);
    }

    [Theory]
    [InlineData("192.0.2.10", "203.0.113.1", "192.0.2.10")]
    [InlineData("::ffff:192.0.2.10", "203.0.113.1", "::ffff:192.0.2.10")]
    [InlineData("127.0.0.1", "203.0.113.1, 192.0.2.10", "192.0.2.10")]
    [InlineData("::1", "192.0.2.10, 127.0.0.1", "192.0.2.10")]
    public void Solo_loopback_puede_actuar_como_proxy(string remote, string forwarded, string expected) =>
        Assert.Equal(expected, ClientIp.Resolve(IPAddress.Parse(remote), forwarded));

    [Fact]
    public async Task Salud_consulta_el_puerto_y_un_fallo_no_filtra_detalles()
    {
        var storage = new StorageProbe();
        await using var api = await RunningApi.Start(storage: storage);
        using var healthy = await api.Client.GetAsync("/api/health", TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, healthy.StatusCode);
        Assert.Equal("{\"ok\":true,\"data\":{\"status\":\"ok\",\"schemaVersion\":5}}",
            await healthy.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        Assert.Equal(1, storage.Checks);
        storage.Fail = true;
        using var failure = await api.Client.GetAsync("/api/health", TestContext.Current.CancellationToken);
        await AssertError(failure, 500, "INTERNAL",
            "Error interno del servidor. Revisa la consola donde se ejecuta npm run dev.");
        Assert.Equal(2, storage.Checks);
        await using var unconfigured = await RunningApi.Start();
        using var absent = await unconfigured.Client.GetAsync("/api/health", TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.InternalServerError, absent.StatusCode);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("abc")]
    [InlineData("     ")]
    public async Task Proceso_real_rechaza_codigo_invalido_antes_de_escuchar(string? code)
    {
        var start = new ProcessStartInfo("dotnet")
        {
            UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardError = true, RedirectStandardOutput = true,
        };
        start.ArgumentList.Add(typeof(CuentasClaras.Api.Program).Assembly.Location);
        start.Environment.Remove("CUENTAS_CODIGO");
        if (code is not null) start.Environment["CUENTAS_CODIGO"] = code;
        start.Environment["CUENTAS_HOST"] = "127.0.0.1";
        start.Environment["CUENTAS_PORT"] = "0";
        using var process = Process.Start(start)!;
        var output = process.StandardOutput.ReadToEndAsync(TestContext.Current.CancellationToken);
        var error = process.StandardError.ReadToEndAsync(TestContext.Current.CancellationToken);
        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(TestContext.Current.CancellationToken);
            timeout.CancelAfter(TimeSpan.FromSeconds(15));
            await process.WaitForExitAsync(timeout.Token);
            Assert.Equal(1, process.ExitCode);
            // En Windows el error sale en la página de códigos de la consola (850, 437…), no en UTF-8: se busca un texto ASCII.
            Assert.Contains("CUENTAS_CODIGO", await error);
            Assert.DoesNotContain("Now listening", await output);
        }
        finally
        {
            if (!process.HasExited) process.Kill(entireProcessTree: true);
        }
    }

    private static HttpRequestMessage LoginRequest(string code, string forwarded)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/auth/login")
        {
            Content = JsonContent(JsonSerializer.Serialize(new { codigo = code })),
        };
        request.Headers.Add("X-Forwarded-For", forwarded);
        return request;
    }

    private static StringContent JsonContent(string value) => new(value, Encoding.UTF8, "application/json");

    private static HttpContent SizedJson(int bytes, bool compressed)
    {
        var data = Encoding.UTF8.GetBytes("{\"padding\":\"" + new string('x', bytes - 14) + "\"}");
        Assert.Equal(bytes, data.Length);
        if (compressed)
        {
            using var buffer = new MemoryStream();
            using (var gzip = new GZipStream(buffer, CompressionLevel.Fastest, leaveOpen: true)) gzip.Write(data);
            data = buffer.ToArray();
        }
        var content = new ByteArrayContent(data);
        content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
        if (compressed) content.Headers.ContentEncoding.Add("gzip");
        return content;
    }

    private static string? Header(HttpResponseMessage response, string name) =>
        response.Headers.TryGetValues(name, out var values) || response.Content.Headers.TryGetValues(name, out values)
            ? string.Join(", ", values) : null;

    private static async Task AssertError(HttpResponseMessage response, int status, string code, string message)
    {
        Assert.Equal(status, (int)response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        var expected = JsonSerializer.SerializeToElement(new { ok = false, error = new { code, message } });
        Assert.True(JsonElement.DeepEquals(expected, body.RootElement), body.RootElement.GetRawText());
        Assert.Equal("no-store", Header(response, "cache-control"));
        Assert.Equal("application/json; charset=utf-8", Header(response, "content-type"));
        Assert.Null(response.Headers.Location);
    }

    private sealed class HttpClock(long now) : IClock
    {
        public long Now { get; set; } = now;
        public long NowMs() => Now;
    }

    private sealed class StorageProbe : IStorageHealth
    {
        public int Checks { get; private set; }
        public bool Fail { get; set; }
        public Task<int> Check(CancellationToken cancellationToken)
        {
            Checks++;
            if (Fail) throw new InvalidOperationException("detalle privado sintético");
            return Task.FromResult(5);
        }
    }

    private sealed class RunningApi(WebApplication app, HttpClient client) : IAsyncDisposable
    {
        public HttpClient Client { get; } = client;

        public static async Task<RunningApi> Start(IClock? clock = null, IStorageHealth? storage = null)
        {
            var app = ApiHost.Create(new HostSettings(Code, Port: 0), clock, storage,
                ["--Logging:LogLevel:Default=Critical"]);
            try
            {
                await app.StartAsync(TestContext.Current.CancellationToken);
                var client = new HttpClient(new HttpClientHandler { UseCookies = false, AllowAutoRedirect = false })
                {
                    BaseAddress = new Uri(app.Urls.Single()), Timeout = TimeSpan.FromSeconds(30),
                };
                return new RunningApi(app, client);
            }
            catch
            {
                await app.DisposeAsync();
                throw;
            }
        }

        public Task<HttpResponseMessage> Login() => Client.PostAsync("/api/auth/login",
            JsonContent(JsonSerializer.Serialize(new { codigo = Code })), TestContext.Current.CancellationToken);

        public async ValueTask DisposeAsync()
        {
            Client.Dispose();
            await app.StopAsync(TestContext.Current.CancellationToken);
            await app.DisposeAsync();
        }
    }
}
