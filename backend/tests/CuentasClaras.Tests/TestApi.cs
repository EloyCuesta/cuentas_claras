using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using CuentasClaras.Api.Composition;
using CuentasClaras.Application.Common;
using CuentasClaras.Application.Tickets;
using CuentasClaras.Infrastructure.Common.MySql;
using Microsoft.AspNetCore.Builder;

namespace CuentasClaras.Tests;

/// <summary>
/// La API .NET de verdad (Kestrel en un puerto libre) sobre una base de pruebas ya migrada, como startApi de Express:
/// reloj e ids sustituibles, y la cookie de sesión guardada como la guardaría un navegador.
/// </summary>
internal sealed class TestApi : IAsyncDisposable
{
    public const string Code = "codigo-de-prueba";
    private readonly WebApplication app;

    public HttpClient Client { get; }

    /// <summary>La cookie de la última sesión iniciada; null = invitado.</summary>
    public string? Cookie { get; set; }

    private TestApi(WebApplication app, HttpClient client)
    {
        this.app = app;
        Client = client;
    }

    public static async Task<TestApi> Start(MySqlDatabase database, IClock? clock = null, IIdGenerator? ids = null,
        bool login = true, string code = Code, ITicketReader? reader = null)
    {
        var app = ApiHost.CreateWithDatabase(new HostSettings(code, Port: 0), database, clock, ids,
            ["--Logging:LogLevel:Default=Critical"], reader);
        try
        {
            await app.StartAsync(TestContext.Current.CancellationToken);
            var client = new HttpClient(new HttpClientHandler { UseCookies = false, AllowAutoRedirect = false })
            {
                BaseAddress = new Uri(app.Urls.Single()), Timeout = TimeSpan.FromSeconds(60),
            };
            var api = new TestApi(app, client);
            if (login) await api.SignIn(code);
            return api;
        }
        catch
        {
            await app.DisposeAsync();
            throw;
        }
    }

    public async Task SignIn(string code = Code)
    {
        using var response = await Send("POST", "/api/auth/login", JsonSerializer.Serialize(new { codigo = code }), guest: true);
        Assert.Equal(200, (int)response.StatusCode);
        Cookie = Header(response, "set-cookie")!.Split(';')[0];
    }

    /// <summary>Una petición con el cuerpo JSON en texto (o sin cuerpo) y la cookie de la sesión, salvo como invitado.</summary>
    public async Task<HttpResponseMessage> Send(string method, string path, string? json = null, bool guest = false)
    {
        using var message = new HttpRequestMessage(new HttpMethod(method), path);
        if (json is not null)
        {
            message.Content = new ByteArrayContent(Encoding.UTF8.GetBytes(json));
            message.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
        }
        if (!guest && Cookie is not null) message.Headers.Add("Cookie", Cookie);
        return await Client.SendAsync(message, TestContext.Current.CancellationToken);
    }

    /// <summary>Estado y sobre JSON de una petición; <paramref name="body"/> se serializa como lo haría JSON.stringify.</summary>
    public async Task<(int Status, JsonElement Body)> Call(string method, string path, object? body = null, bool guest = false)
    {
        var json = body switch
        {
            null => null,
            string raw => raw,
            _ => JsonSerializer.Serialize(body),
        };
        using var response = await Send(method, path, json, guest);
        var text = await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken);
        return ((int)response.StatusCode, JsonDocument.Parse(text).RootElement.Clone());
    }

    /// <summary>El data de una respuesta correcta, comprobando el estado.</summary>
    public async Task<JsonElement> Data(string method, string path, object? body = null, int status = 200)
    {
        var (actual, envelope) = await Call(method, path, body);
        Assert.True(actual == status, $"{method} {path}: {actual} {envelope}");
        Assert.True(envelope.GetProperty("ok").GetBoolean(), envelope.ToString());
        return envelope.GetProperty("data");
    }

    /// <summary>Comprueba un error con su código y su mensaje exactos.</summary>
    public async Task Fails(string method, string path, object? body, int status, string code, string message, bool guest = false)
    {
        var (actual, envelope) = await Call(method, path, body, guest);
        Assert.True(actual == status, $"{method} {path}: {actual} {envelope}");
        Assert.False(envelope.GetProperty("ok").GetBoolean());
        Assert.Equal(code, envelope.GetProperty("error").GetProperty("code").GetString());
        Assert.Equal(message, envelope.GetProperty("error").GetProperty("message").GetString());
    }

    public static string? Header(HttpResponseMessage response, string name) =>
        response.Headers.TryGetValues(name, out var values) || response.Content.Headers.TryGetValues(name, out values)
            ? string.Join(", ", values) : null;

    public async ValueTask DisposeAsync()
    {
        Client.Dispose();
        await app.StopAsync(CancellationToken.None);
        await app.DisposeAsync();
    }
}

/// <summary>Ids de ensayo en orden, como el IdGenerator de los contratos: si se acaban, la prueba falla.</summary>
internal sealed class QueuedIds(params string[] ids) : IIdGenerator
{
    private readonly Queue<string> pending = new(ids);

    public int Remaining => pending.Count;

    public string NewId() => pending.TryDequeue(out var id) ? id : throw new InvalidOperationException("La prueba ha agotado sus ids de ensayo.");
}
