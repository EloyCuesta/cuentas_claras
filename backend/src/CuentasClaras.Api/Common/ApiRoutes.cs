using System.Text.Json;

namespace CuentasClaras.Api.Common;

/// <summary>
/// Una petición ya enrutada: el cuerpo JSON como lo ve un router de Express (Undefined si no llegó JSON), los parámetros
/// de la ruta decodificados y la query.
/// </summary>
public sealed class ApiRequest(HttpContext http, JsonElement body, IReadOnlyDictionary<string, string> parameters, QueryValues query)
{
    public HttpContext Http { get; } = http;

    /// <summary>req.body: Undefined sin cuerpo JSON; si llegó, un objeto o una lista.</summary>
    public JsonElement Body { get; } = body;

    public QueryValues Query { get; } = query;

    public CancellationToken Aborted => Http.RequestAborted;

    /// <summary>req.params[name], ya decodificado.</summary>
    public string Param(string name) => parameters[name];
}

/// <summary>Quién puede usar una ruta: la despensa y los tickets, cualquiera; lo demás (finanzas), con sesión.</summary>
public enum RouteAccess
{
    Public,
    Session,
}

/// <summary>
/// Las rutas de los módulos, en el orden en que se registran. Coinciden como en Express: el método exacto (HEAD cuenta
/// como GET), los segmentos fijos sin distinguir mayúsculas, «:nombre» por un segmento no vacío y una barra final opcional.
/// </summary>
public sealed class ApiRouteTable
{
    private readonly List<ApiRoute> routes = [];

    public IReadOnlyList<(string Method, string Pattern, RouteAccess Access)> Registered =>
        [.. routes.Select(route => (route.Method, route.Pattern, route.Access))];

    public void Map(string method, string pattern, RouteAccess access, Func<ApiRequest, Task> handler)
    {
        if (!pattern.StartsWith("/api/", StringComparison.Ordinal))
            throw new ArgumentException($"Las rutas van bajo /api: {pattern}", nameof(pattern));
        routes.Add(new ApiRoute(method, pattern, pattern.Split('/'), access, handler));
    }

    /// <summary>La primera ruta que coincide con el método y la ruta (sin la query ni la barra final), o null.</summary>
    public ApiRoute? Find(string method, string path)
    {
        var parts = path.Split('/');
        foreach (var route in routes)
            if (route.Matches(method, parts)) return route;
        return null;
    }
}

public sealed class ApiRoute(string method, string pattern, string[] segments, RouteAccess access, Func<ApiRequest, Task> handler)
{
    public string Method { get; } = method;
    public string Pattern { get; } = pattern;
    public RouteAccess Access { get; } = access;
    public Func<ApiRequest, Task> Handler { get; } = handler;

    public bool Matches(string requestMethod, string[] parts)
    {
        if (!string.Equals(requestMethod, Method, StringComparison.Ordinal) || parts.Length != segments.Length) return false;
        for (var i = 0; i < parts.Length; i++)
        {
            if (segments[i].StartsWith(':'))
            {
                if (parts[i].Length == 0) return false;
            }
            else if (!parts[i].Equals(segments[i], StringComparison.OrdinalIgnoreCase)) return false;
        }
        return true;
    }

    /// <summary>Los parámetros, decodificados con decodeURIComponent: un escape mal formado lanza (500, como Express).</summary>
    public IReadOnlyDictionary<string, string> Parameters(string path)
    {
        var parts = path.Split('/');
        var parameters = new Dictionary<string, string>(StringComparer.Ordinal);
        for (var i = 0; i < segments.Length; i++)
            if (segments[i].StartsWith(':')) parameters[segments[i][1..]] = UriText.DecodeComponent(parts[i]);
        return parameters;
    }
}
