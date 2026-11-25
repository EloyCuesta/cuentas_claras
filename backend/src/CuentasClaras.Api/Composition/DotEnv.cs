namespace CuentasClaras.Api.Composition;

/// <summary>
/// El archivo .env de la raíz del repositorio, como <c>--env-file-if-exists=.env</c> en Express (CUT-PREP): sin
/// dependencias, «CLAVE=valor» por línea, con comentarios «#», <c>export</c> opcional y valores entre comillas. Una
/// variable del entorno manda sobre la del archivo. La raíz es la primera carpeta con package.json subiendo desde la
/// actual (o desde la del ensamblado, porque <c>dotnet run --project</c> puede arrancar en la del proyecto).
/// <c>CUENTAS_ENV_FILE</c> elige otro archivo, o <c>ninguno</c> para no leer ninguno: así arrancan los hosts de las
/// pruebas, que nunca deben abrir la base de la instalación.
/// </summary>
public static class DotEnv
{
    public const string FileVariable = "CUENTAS_ENV_FILE";
    public const string None = "ninguno";

    /// <summary>Lee primero el entorno y, si la variable no está, el archivo .env (si existe).</summary>
    public static Func<string, string?> Reader(Func<string, string?> environment, string? currentDirectory = null)
    {
        var chosen = environment(FileVariable);
        if (string.Equals(chosen?.Trim(), None, StringComparison.OrdinalIgnoreCase)) return environment;
        var path = string.IsNullOrWhiteSpace(chosen)
            ? Find(currentDirectory ?? Environment.CurrentDirectory) ?? Find(AppContext.BaseDirectory)
            : Path.GetFullPath(chosen);
        if (path is null || !File.Exists(path)) return environment;
        var values = Parse(File.ReadAllText(path));
        return name => environment(name) ?? values.GetValueOrDefault(name);
    }

    /// <summary>El .env de la primera carpeta con package.json, subiendo desde <paramref name="from"/>.</summary>
    private static string? Find(string from)
    {
        for (var directory = Path.GetFullPath(from); directory is not null; directory = Path.GetDirectoryName(directory))
            if (File.Exists(Path.Combine(directory, "package.json"))) return Path.Combine(directory, ".env");
        return null;
    }

    /// <summary>Las variables de un .env. Una clave repetida se queda con su último valor, como en Node.</summary>
    public static Dictionary<string, string> Parse(string text)
    {
        var values = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var raw in text.Replace("\r\n", "\n").Split('\n'))
        {
            var line = raw.Trim();
            if (line.Length == 0 || line.StartsWith('#')) continue;
            if (line.StartsWith("export ", StringComparison.Ordinal)) line = line["export ".Length..].TrimStart();
            var equals = line.IndexOf('=');
            if (equals <= 0) continue;
            var key = line[..equals].Trim();
            if (key.Length == 0 || key.Any(char.IsWhiteSpace)) continue;
            values[key] = Value(line[(equals + 1)..].Trim());
        }
        return values;
    }

    private static string Value(string value)
    {
        if (value.Length >= 2 && value[0] is '"' or '\'' or '`' && value[^1] == value[0])
        {
            var inner = value[1..^1];
            return value[0] == '"' ? inner.Replace("\\n", "\n") : inner;
        }
        // Sin comillas, «#» empieza un comentario.
        var comment = value.IndexOf('#');
        return (comment >= 0 ? value[..comment] : value).Trim();
    }
}
