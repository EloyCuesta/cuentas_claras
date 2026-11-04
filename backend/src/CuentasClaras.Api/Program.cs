using CuentasClaras.Api.Composition;

namespace CuentasClaras.Api;

/// <summary>Arranque local: valida el código antes de conectar con MySQL; nunca carga datos de SQLite ni el archivo .env.</summary>
public static class Program
{
    public static async Task<int> Main(string[] args)
    {
        try
        {
            await using var app = await ApiHost.CreateConfigured(HostSettings.FromEnvironment(), args: args);
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
