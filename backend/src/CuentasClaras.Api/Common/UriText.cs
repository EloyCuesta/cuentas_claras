using System.Text;

namespace CuentasClaras.Api.Common;

/// <summary>Un escape «%» mal formado en un parámetro de la ruta: Express responde con su error interno (500).</summary>
public sealed class MalformedUriException(string message) : Exception(message);

/// <summary>
/// Decodificación de la URL como la hace Express 5: los parámetros de la ruta con decodeURIComponent (estricto) y la
/// query con querystring.parse de Node (permisivo: «+» es un espacio y un escape roto se queda como está).
/// </summary>
public static class UriText
{
    private static readonly UTF8Encoding StrictUtf8 = new(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true);

    /// <summary>decodeURIComponent: un «%» sin dos cifras hexadecimales o unos bytes que no son UTF-8 lanzan.</summary>
    public static string DecodeComponent(string value)
    {
        if (!value.Contains('%')) return value;
        try
        {
            return Decode(value, strict: true);
        }
        catch (DecoderFallbackException)
        {
            throw new MalformedUriException("URI malformed");
        }
    }

    /// <summary>querystring.unescape: decodeURIComponent y, si falla, los escapes válidos como bytes UTF-8 (U+FFFD si no lo son).</summary>
    public static string DecodeQueryComponent(string value)
    {
        var text = value.Replace('+', ' ');
        if (!text.Contains('%')) return text;
        try
        {
            return Decode(text, strict: true);
        }
        catch (Exception error) when (error is MalformedUriException or DecoderFallbackException)
        {
            return Decode(text, strict: false);
        }
    }

    private static string Decode(string value, bool strict)
    {
        var result = new StringBuilder(value.Length);
        var bytes = new List<byte>();
        for (var index = 0; index < value.Length; index++)
        {
            if (value[index] == '%' && IsHex(value, index + 1) && IsHex(value, index + 2))
            {
                bytes.Add(Convert.ToByte(value.Substring(index + 1, 2), 16));
                index += 2;
                continue;
            }
            Flush(result, bytes, strict);
            if (value[index] == '%' && strict) throw new MalformedUriException("URI malformed");
            result.Append(value[index]);
        }
        Flush(result, bytes, strict);
        return result.ToString();
    }

    private static bool IsHex(string value, int index) => index < value.Length && Uri.IsHexDigit(value[index]);

    private static void Flush(StringBuilder result, List<byte> bytes, bool strict)
    {
        if (bytes.Count == 0) return;
        var array = bytes.ToArray();
        result.Append(strict ? StrictUtf8.GetString(array) : Encoding.UTF8.GetString(array));
        bytes.Clear();
    }
}

/// <summary>
/// La query de una petición como querystring.parse de Node (el analizador «simple» de Express 5): las parejas separadas
/// por «&amp;», la clave hasta el primer «=» y una clave repetida da varios valores, que ningún parámetro admite.
/// </summary>
public sealed class QueryValues
{
    private readonly Dictionary<string, List<string>> values = new(StringComparer.Ordinal);

    public static readonly QueryValues Empty = new();

    public static QueryValues Parse(string? query)
    {
        var parsed = new QueryValues();
        if (string.IsNullOrEmpty(query)) return parsed;
        var keys = 0;
        foreach (var piece in query.Split('&'))
        {
            if (piece.Length == 0) continue;
            // maxKeys de querystring.parse: a partir de mil claves, el resto se ignora.
            if (++keys > 1000) break;
            var equals = piece.IndexOf('=');
            var key = UriText.DecodeQueryComponent(equals < 0 ? piece : piece[..equals]);
            var value = equals < 0 ? "" : UriText.DecodeQueryComponent(piece[(equals + 1)..]);
            if (!parsed.values.TryGetValue(key, out var list)) parsed.values[key] = list = [];
            list.Add(value);
        }
        return parsed;
    }

    /// <summary>req.query[name] cuando es un texto: null si no está o si se repite (Express lo daría como lista).</summary>
    public string? Single(string name) => values.TryGetValue(name, out var list) && list.Count == 1 ? list[0] : null;

    /// <summary>'name' in req.query.</summary>
    public bool Has(string name) => values.ContainsKey(name);
}
