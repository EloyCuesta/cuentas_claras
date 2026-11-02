using System.Globalization;
using System.Net;

namespace CuentasClaras.Api.Composition;

/// <summary>Configuración explícita por entorno; permite puerto cero solo para ensayos con un puerto libre.</summary>
public sealed record HostSettings(string? AccessCode, string Host = "127.0.0.1", int Port = 3201)
{
    public static HostSettings FromEnvironment(Func<string, string?>? read = null)
    {
        read ??= Environment.GetEnvironmentVariable;
        var host = read("CUENTAS_HOST") ?? "127.0.0.1";
        var portText = read("CUENTAS_PORT") ?? "3201";
        if (!int.TryParse(portText, NumberStyles.None, CultureInfo.InvariantCulture, out var port)
            || port is < 0 or > 65535)
            throw new ArgumentException("CUENTAS_PORT debe ser un puerto entre 0 y 65535.");
        if (!IPAddress.TryParse(host, out _))
            throw new ArgumentException("CUENTAS_HOST debe ser una dirección IP local válida.");
        return new HostSettings(read("CUENTAS_CODIGO"), host, port);
    }
}
