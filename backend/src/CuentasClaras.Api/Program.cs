using CuentasClaras.Api.Composition;

namespace CuentasClaras.Api;

/// <summary>Arranque local: valida el código antes de escuchar; nunca carga datos de SQLite ni el archivo .env.</summary>
public static class Program
{
    public static async Task<int> Main(string[] args)
    {
        try
        {
            await using var app = ApiHost.Create(HostSettings.FromEnvironment(), args: args);
            await app.RunAsync();
            return 0;
        }
        catch (ArgumentException error)
        {
            Console.Error.WriteLine(error.Message);
            return 1;
        }
    }
}
