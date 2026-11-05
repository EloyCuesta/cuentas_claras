using System.Globalization;
using System.Text;

namespace CuentasClaras.Domain.Common;

/// <summary>
/// JSON.stringify de JavaScript, byte a byte, para los textos de los que salen huellas. No es
/// System.Text.Json: su codificador por defecto escapa comillas ("), «&lt;», «&gt;», «&amp;», «'»,
/// «+» y todo lo que no es ASCII, y JavaScript los deja tal cual.
/// </summary>
public static class JsJson
{
    /// <summary>Una cadena: escapa «"», «\», los controles (\b \f \n \r \t, el resto \u00xx en minúscula) y los sustitutos sueltos.</summary>
    public static string String(string value)
    {
        var result = new StringBuilder(value.Length + 2).Append('"');
        for (var index = 0; index < value.Length; index++)
        {
            var unit = value[index];
            switch (unit)
            {
                case '"': result.Append("\\\""); break;
                case '\\': result.Append("\\\\"); break;
                case '\b': result.Append("\\b"); break;
                case '\f': result.Append("\\f"); break;
                case '\n': result.Append("\\n"); break;
                case '\r': result.Append("\\r"); break;
                case '\t': result.Append("\\t"); break;
                default:
                    if (unit < 0x20) Escape(result, unit);
                    else if (char.IsHighSurrogate(unit) && index + 1 < value.Length && char.IsLowSurrogate(value[index + 1]))
                    {
                        result.Append(unit).Append(value[index + 1]);
                        index++;
                    }
                    else if (char.IsSurrogate(unit)) Escape(result, unit);
                    else result.Append(unit);
                    break;
            }
        }
        return result.Append('"').ToString();
    }

    /// <summary>Un número (null si no es finito, como JSON.stringify).</summary>
    public static string Number(double? value) => value is { } number && double.IsFinite(number) ? JsNumber.ToString(number) : "null";

    public static string Number(long? value) => value is { } number ? JsNumber.ToString(number) : "null";

    public static string StringOrNull(string? value) => value is null ? "null" : String(value);

    /// <summary>Una lista de valores ya escritos en JSON, sin espacios.</summary>
    public static string Array(IEnumerable<string> items) => "[" + string.Join(",", items) + "]";

    private static void Escape(StringBuilder result, char unit) =>
        result.Append("\\u").Append(((int)unit).ToString("x4", CultureInfo.InvariantCulture));
}
