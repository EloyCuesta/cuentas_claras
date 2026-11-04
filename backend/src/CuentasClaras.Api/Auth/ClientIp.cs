using System.Net;

namespace CuentasClaras.Api.Auth;

/// <summary>Equivalente a trust proxy loopback: recorre desde el socket y se detiene en el primer salto no fiable.</summary>
public static class ClientIp
{
    public static string Resolve(IPAddress? remote, string forwardedFor)
    {
        var current = remote?.ToString() ?? "desconocida";
        foreach (var part in forwardedFor.Split(',').Reverse())
        {
            if (!IsLoopback(current)) break;
            var next = part.Trim(' ');
            if (next.Length > 0) current = next;
        }
        return current;
    }

    private static bool IsLoopback(string value)
    {
        if (!IPAddress.TryParse(value, out var ip)) return false;
        if (ip.IsIPv4MappedToIPv6) ip = ip.MapToIPv4();
        return IPAddress.IsLoopback(ip);
    }
}
