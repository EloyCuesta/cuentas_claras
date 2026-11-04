using System.Text.Json;
using CuentasClaras.Api.Auth;
using CuentasClaras.Api.Common;
using CuentasClaras.Application.Auth;
using CuentasClaras.Application.Common;
using CuentasClaras.Application.Health;
using Microsoft.AspNetCore.Http.Features;

namespace CuentasClaras.Api.Composition;

/// <summary>Ordena el transporte: JSON, rutas públicas, sesión y rutas privadas. No simula módulos aún sin migrar.</summary>
public sealed class ApiRouter(Login login, Logout logout, CheckSession checkSession, CheckHealth health)
{
    // Permite reconocer el acceso de las rutas pendientes sin fingir que sus datos ya existen en .NET.
    private static readonly (string Method, string Path)[] PendingPublicRoutes =
    [
        ("GET", "/api/despensa/personas"), ("POST", "/api/despensa/personas"),
        ("PUT", "/api/despensa/personas/:id"), ("DELETE", "/api/despensa/personas/:id"),
        ("GET", "/api/despensa/productos"), ("POST", "/api/despensa/productos"),
        ("PUT", "/api/despensa/productos/:id"), ("DELETE", "/api/despensa/productos/:id"),
        ("POST", "/api/despensa/productos/:id/ajustar"), ("POST", "/api/despensa/productos/:id/revision"),
        ("DELETE", "/api/despensa/revisiones/:id"),
        ("GET", "/api/despensa/presupuesto"), ("PUT", "/api/despensa/presupuesto"),
        ("PUT", "/api/despensa/repaso"), ("POST", "/api/despensa/comprado"),
        ("POST", "/api/despensa/comprado/deshacer"),
        ("POST", "/api/despensa/tickets/leer"), ("GET", "/api/despensa/tickets"),
        ("POST", "/api/despensa/tickets"), ("GET", "/api/despensa/tickets/:id"),
        ("DELETE", "/api/despensa/tickets/:id"), ("PUT", "/api/despensa/tickets/:id/lineas/:lineId"),
        ("GET", "/api/despensa/actividad"),
    ];

    public async Task Handle(HttpContext context)
    {
        context.Response.Headers.CacheControl = "no-store";
        try
        {
            var request = context.Request;
            var originalUrl = context.Features.Get<IHttpRequestFeature>()?.RawTarget
                ?? request.Path + request.QueryString;
            var path = originalUrl.Split('?', 2)[0];
            using var body = await JsonBody.Read(request, path);
            // Express acepta una barra final y no distingue mayúsculas en los segmentos estáticos.
            if (path.EndsWith('/')) path = path[..^1];
            var method = HttpMethods.IsHead(request.Method) ? "GET" : request.Method;
            var token = SessionCookie.Read(request.Headers.Cookie.ToString());

            if (Matches(method, path, "POST", "/api/auth/login"))
            {
                var code = ReadCode(body);
                var ip = ClientIp.Resolve(context.Connection.RemoteIpAddress, request.Headers["X-Forwarded-For"].ToString());
                var newToken = login.Execute(code, ip, token);
                context.Response.Headers.Append("Set-Cookie", SessionCookie.Set(newToken));
                await ApiResponse.Data(context, new { rol = "admin" });
                return;
            }
            if (Matches(method, path, "POST", "/api/auth/logout"))
            {
                logout.Execute(token);
                context.Response.Headers.Append("Set-Cookie", SessionCookie.Clear);
                await ApiResponse.Data(context, null);
                return;
            }
            if (Matches(method, path, "GET", "/api/auth/me"))
            {
                await ApiResponse.Data(context, new { rol = checkSession.Execute(token) ? "admin" : "invitado" });
                return;
            }
            if (Matches(method, path, "GET", "/api/health"))
            {
                var schemaVersion = await health.Execute(context.RequestAborted);
                await ApiResponse.Data(context, new { status = "ok", schemaVersion });
                return;
            }

            var isApi = path.Equals("/api", StringComparison.OrdinalIgnoreCase)
                || path.StartsWith("/api/", StringComparison.OrdinalIgnoreCase);
            if (isApi && !PendingPublicRoutes.Any(route => Matches(method, path, route.Method, route.Path))
                && !checkSession.Execute(token))
                throw new AppError("UNAUTHORIZED", "Hace falta el código de acceso para ver esta sección.");

            await ApiResponse.Error(context, 404, "NOT_FOUND", $"No existe {request.Method} {originalUrl}.");
        }
        catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested)
        {
            // El cliente ya cerró la conexión: no intentar enviar un segundo error.
        }
        catch (Exception error)
        {
            await ApiResponse.Failure(context, error);
        }
    }

    private static string ReadCode(JsonDocument? body)
    {
        if (body is null || body.RootElement.ValueKind != JsonValueKind.Object)
            throw new AppError("VALIDATION", "Falta el cuerpo de la petición en JSON.");
        if (!body.RootElement.TryGetProperty("codigo", out var value) || value.ValueKind != JsonValueKind.String)
            throw new AppError("VALIDATION", "Escribe el código de acceso.");
        var code = value.GetString()!;
        if (code.Length == 0 || code.Length > Login.MaxCodeLength)
            throw new AppError("VALIDATION", "Escribe el código de acceso.");
        return code;
    }

    private static bool Matches(string method, string path, string expectedMethod, string pattern)
    {
        if (!string.Equals(method, expectedMethod, StringComparison.Ordinal)) return false;
        var parts = path.Split('/');
        var expected = pattern.Split('/');
        if (parts.Length != expected.Length) return false;
        for (var i = 0; i < parts.Length; i++)
        {
            if (expected[i].StartsWith(':'))
            {
                if (parts[i].Length == 0) return false;
            }
            else if (!parts[i].Equals(expected[i], StringComparison.OrdinalIgnoreCase)) return false;
        }
        return true;
    }
}
