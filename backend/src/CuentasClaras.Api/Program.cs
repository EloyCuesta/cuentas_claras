using CuentasClaras.Api.Composition;

namespace CuentasClaras.Api;

/// <summary>
/// Arranque local: valida el código antes de conectar con MySQL y nunca carga datos de SQLite. La configuración sale del
/// entorno y, para lo que no esté en él, del .env de la raíz, como Express (DotEnv; CUENTAS_ENV_FILE=ninguno no lo lee).
/// </summary>
public static class Program
{
    public static async Task<int> Main(string[] args)
    {
        try
        {
            var read = DotEnv.Reader(Environment.GetEnvironmentVariable);
            await using var app = await ApiHost.CreateConfigured(HostSettings.FromEnvironment(read), read, args: args);
            await app.RunAsync();
            return 0;
        }
        catch (Exception error) when (error is ArgumentException or StartupException)
        {
            Console.Error.WriteLine(error.Message);
            return 1;
        }
    }
}
