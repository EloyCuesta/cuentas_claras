namespace CuentasClaras.Api.Composition;

/// <summary>
/// El .env que piden los scripts de npm con <c>--env-file-if-exists=.env</c>, como el <c>--env-file-if-exists</c> de Node
/// en los de Express: el host nunca lo busca por su cuenta, y una variable que ya está en el entorno (aunque esté vacía)
/// manda sobre el archivo.
/// </summary>
/// <remarks>
/// El formato es el de Node en lo habitual: comentarios con «#», «export» delante, valores entre comillas dobles, simples
/// o invertidas (pueden ocupar varias líneas; en las dobles, «\n» es un salto de línea), un «#» tras un valor sin comillas
/// empieza un comentario, y si una clave se repite vale la última. Dos diferencias a propósito: un BOM al principio se
/// ignora (Node lo deja pegado a la primera clave) y «CLAVE=» seguido solo de espacios es un valor vacío (Node se come
/// la línea siguiente).
/// </remarks>
public static class EnvFile
{
    public const string Option = "--env-file-if-exists=";

    private static readonly char[] Blanks = [' ', '\t'];

    /// <summary>Saca la opción de los argumentos (ASP.NET la tomaría por configuración) y devuelve su ruta, si estaba.</summary>
    public static (string? Path, string[] Others) TakeOption(IReadOnlyList<string> args)
    {
        string? path = null;
        var rest = new List<string>();
        foreach (var arg in args)
        {
            if (arg.StartsWith(Option, StringComparison.Ordinal)) path = arg[Option.Length..];
            else rest.Add(arg);
        }
        return (path, [.. rest]);
    }

    /// <summary>Las variables del archivo; sin archivo, ninguna. Lanza ArgumentException, en español, si no se puede leer.</summary>
    public static IReadOnlyDictionary<string, string> LoadIfExists(string path)
    {
        if (path.Length == 0 || !File.Exists(path)) return new Dictionary<string, string>(StringComparer.Ordinal);
        try
        {
            return Parse(File.ReadAllText(path));
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            throw new ArgumentException($"No se puede leer {path}: {error.Message}", error);
        }
    }

    /// <summary>Lee primero el entorno y, si la variable no está, el archivo.</summary>
    public static Func<string, string?> Reader(Func<string, string?> environment, IReadOnlyDictionary<string, string> file) =>
        name => environment(name) ?? (file.TryGetValue(name, out var value) ? value : null);

    public static IReadOnlyDictionary<string, string> Parse(string content)
    {
        var values = new Dictionary<string, string>(StringComparer.Ordinal);
        var text = content.Replace("\r", "", StringComparison.Ordinal);
        if (text.StartsWith('﻿')) text = text[1..];
        var position = 0;
        while (position < text.Length)
        {
            var lineEnd = text.IndexOf('\n', position);
            if (lineEnd < 0) lineEnd = text.Length;
            var next = lineEnd + 1;
            var start = SkipBlanks(text, position, lineEnd);
            var equals = text.IndexOf('=', start, lineEnd - start);
            // Líneas vacías, comentarios, sin «=» o sin clave («=valor»): no son variables.
            if (start == lineEnd || text[start] == '#' || equals <= start)
            {
                position = next;
                continue;
            }

            var key = text[start..equals].Trim(Blanks);
            if (key.StartsWith("export ", StringComparison.Ordinal)) key = key["export ".Length..].Trim(Blanks);
            if (key.Length == 0)
            {
                position = next;
                continue;
            }

            var valueStart = SkipBlanks(text, equals + 1, lineEnd);
            var quote = valueStart < lineEnd ? text[valueStart] : '\0';
            var closing = quote is '"' or '\'' or '`' ? text.IndexOf(quote, valueStart + 1) : -1;
            if (closing >= 0)
            {
                var quoted = text[(valueStart + 1)..closing];
                values[key] = quote == '"' ? quoted.Replace("\\n", "\n", StringComparison.Ordinal) : quoted;
                // Lo que siga a la comilla de cierre, hasta el final de su línea, no cuenta.
                var after = text.IndexOf('\n', closing + 1);
                position = after < 0 ? text.Length : after + 1;
                continue;
            }

            // Sin comillas (o sin la de cierre): hasta el final de la línea; sin comillas, un «#» empieza un comentario.
            var value = text[valueStart..lineEnd];
            if (quote is not ('"' or '\'' or '`'))
            {
                var hash = value.IndexOf('#');
                if (hash >= 0) value = value[..hash];
                value = value.Trim(Blanks);
            }
            values[key] = value;
            position = next;
        }
        return values;
    }

    private static int SkipBlanks(string text, int from, int to)
    {
        while (from < to && Array.IndexOf(Blanks, text[from]) >= 0) from++;
        return from;
    }
}
