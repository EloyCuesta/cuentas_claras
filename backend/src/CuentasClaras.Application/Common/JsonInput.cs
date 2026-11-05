using System.Globalization;
using System.Text;
using System.Text.Json;
using CuentasClaras.Domain.Common;

namespace CuentasClaras.Application.Common;

/// <summary>
/// Un cuerpo JSON sin tipar leído como lo ve un validador de TypeScript después de JSON.parse:
/// una propiedad que no está es undefined (un JsonElement Undefined), typeof distingue texto,
/// número, booleano, objeto y lista, String(x) convierte cualquier valor y un número que desborda
/// el doble es ±Infinity. Lo usan los validadores de los casos de uso que reciben el cuerpo de la
/// API, igual que ReadCode recibe el del login en el host.
/// </summary>
public static class JsonInput
{
    public static bool IsUndefined(JsonElement value) => value.ValueKind == JsonValueKind.Undefined;

    /// <summary>value === null || value === undefined (lo que ?? sustituye).</summary>
    public static bool IsNullish(JsonElement value) => value.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null;

    /// <summary>isObject de los validadores: un objeto que no es una lista ni null.</summary>
    public static bool IsObject(JsonElement value) => value.ValueKind == JsonValueKind.Object;

    public static bool IsArray(JsonElement value) => value.ValueKind == JsonValueKind.Array;

    public static bool IsString(JsonElement value) => value.ValueKind == JsonValueKind.String;

    public static bool IsNumber(JsonElement value) => value.ValueKind == JsonValueKind.Number;

    /// <summary>value === true.</summary>
    public static bool IsTrue(JsonElement value) => value.ValueKind == JsonValueKind.True;

    /// <summary>value === false.</summary>
    public static bool IsFalse(JsonElement value) => value.ValueKind == JsonValueKind.False;

    /// <summary>raw.name: la propiedad, o undefined si no está o si raw no es un objeto. Con nombres repetidos vale el último, como JSON.parse.</summary>
    public static JsonElement Get(JsonElement value, string name) =>
        value.ValueKind == JsonValueKind.Object && value.TryGetProperty(name, out var property) ? property : default;

    /// <summary>'name' in raw.</summary>
    public static bool Has(JsonElement value, string name) => value.ValueKind == JsonValueKind.Object && value.TryGetProperty(name, out _);

    /// <summary>
    /// El texto de una cadena JSON. JSON.parse admite sustitutos sueltos («\ud800») y GetString no:
    /// en ese caso se decodifica el texto en bruto, para quedarse con lo mismo que JavaScript.
    /// </summary>
    public static string Text(JsonElement value)
    {
        try
        {
            return value.GetString() ?? "";
        }
        catch (InvalidOperationException)
        {
            return Unescape(value.GetRawText());
        }
    }

    /// <summary>El número como doble; un literal que desborda (1e400) es ±Infinity, como en JSON.parse.</summary>
    public static double Number(JsonElement value)
    {
        if (value.TryGetDouble(out var number)) return number;
        return value.GetRawText().StartsWith('-') ? double.NegativeInfinity : double.PositiveInfinity;
    }

    /// <summary>String(value) de JavaScript, para las comprobaciones que lo usan: una lista se une con comas, un objeto es «[object Object]».</summary>
    public static string JsString(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.Undefined => "undefined",
        JsonValueKind.Null => "null",
        JsonValueKind.True => "true",
        JsonValueKind.False => "false",
        JsonValueKind.String => Text(value),
        JsonValueKind.Number => JsNumber.ToString(Number(value)),
        JsonValueKind.Array => string.Join(",", value.EnumerateArray().Select(item => IsNullish(item) ? "" : JsString(item))),
        _ => "[object Object]",
    };

    private static string Unescape(string raw)
    {
        var result = new StringBuilder(raw.Length);
        for (var index = 1; index < raw.Length - 1; index++)
        {
            var unit = raw[index];
            if (unit != '\\')
            {
                result.Append(unit);
                continue;
            }
            var escaped = raw[++index];
            switch (escaped)
            {
                case 'b': result.Append('\b'); break;
                case 'f': result.Append('\f'); break;
                case 'n': result.Append('\n'); break;
                case 'r': result.Append('\r'); break;
                case 't': result.Append('\t'); break;
                case 'u':
                    result.Append((char)int.Parse(raw.AsSpan(index + 1, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture));
                    index += 4;
                    break;
                default: result.Append(escaped); break;
            }
        }
        return result.ToString();
    }
}
