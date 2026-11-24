using CuentasClaras.Api.Composition;

namespace CuentasClaras.Api;

/// <summary>
/// Arranque local: valida el código antes de conectar con MySQL y nunca carga datos de SQLite. El .env solo se lee si el
/// arranque lo pide con --env-file-if-exists=.env (los scripts de npm, como los de Express), y el entorno manda sobre él.
/// </summary>
public static class Program
{
    public static async Task<int> Main(string[] args)
    {
        try
        {
            var (envFile, rest) = EnvFile.TakeOption(args);
            Func<string, string?> read = Environment.GetEnvironmentVariable;
            if (envFile is not null) read = EnvFile.Reader(read, EnvFile.LoadIfExists(envFile));
            await using var app = await ApiHost.CreateConfigured(HostSettings.FromEnvironment(read), read, args: rest);
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
