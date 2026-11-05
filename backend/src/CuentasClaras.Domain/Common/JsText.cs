using System.Globalization;
using System.Text;

namespace CuentasClaras.Domain.Common;

/// <summary>
/// Texto con las reglas de JavaScript que usan las reglas portadas de TypeScript. .NET no las
/// sigue por defecto: <c>string.Trim</c> quita U+0085 y deja U+FEFF, <c>Normalize</c> falla con un
/// sustituto suelto y las categorías de un carácter no ven las letras fuera del plano básico.
/// </summary>
public static class JsText
{
    /// <summary>Lo que \s de JavaScript reconoce: WhiteSpace y LineTerminator de ECMAScript, para una clase de expresión regular.</summary>
    public const string WhiteSpaceClass = @"\t\n\v\f\r \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF";

    public static bool IsWhiteSpace(char value) => value is
        '\t' or '\n' or '\v' or '\f' or '\r' or ' ' or '\u00A0' or '\u1680' or >= '\u2000' and <= '\u200A' or
        '\u2028' or '\u2029' or '\u202F' or '\u205F' or '\u3000' or '\uFEFF';

    /// <summary>String.prototype.trim.</summary>
    public static string Trim(string value)
    {
        var start = 0;
        var end = value.Length;
        while (start < end && IsWhiteSpace(value[start])) start++;
        while (end > start && IsWhiteSpace(value[end - 1])) end--;
        return value[start..end];
    }

    /// <summary>String.prototype.slice, en unidades UTF-16 y con índices negativos desde el final.</summary>
    public static string Slice(string value, int start, int? end = null)
    {
        var length = value.Length;
        var from = start < 0 ? Math.Max(length + start, 0) : Math.Min(start, length);
        var to = end is not { } last ? length : last < 0 ? Math.Max(length + last, 0) : Math.Min(last, length);
        return from >= to ? "" : value[from..to];
    }

    /// <summary>El punto de código que empieza en <paramref name="index"/>, como codePointAt: un sustituto suelto es él mismo.</summary>
    public static int CodePointAt(string value, int index)
    {
        var unit = value[index];
        if (char.IsHighSurrogate(unit) && index + 1 < value.Length && char.IsLowSurrogate(value[index + 1]))
            return char.ConvertToUtf32(unit, value[index + 1]);
        return unit;
    }

    /// <summary>El punto de código que acaba justo antes de <paramref name="index"/> (lo que mira una búsqueda hacia atrás con la bandera u).</summary>
    public static int CodePointBefore(string value, int index)
    {
        var unit = value[index - 1];
        if (char.IsLowSurrogate(unit) && index >= 2 && char.IsHighSurrogate(value[index - 2]))
            return char.ConvertToUtf32(value[index - 2], unit);
        return unit;
    }

    /// <summary>Los puntos de código en orden; un sustituto suelto cuenta como uno.</summary>
    public static IEnumerable<int> CodePoints(string value)
    {
        for (var index = 0; index < value.Length; index++)
        {
            var codePoint = CodePointAt(value, index);
            if (codePoint > 0xFFFF) index++;
            yield return codePoint;
        }
    }

    /// <summary>\p{L} con la bandera u: la categoría del punto de código, no la de cada unidad UTF-16.</summary>
    public static bool IsLetter(int codePoint) =>
        codePoint is >= 0 and <= 0x10FFFF and not (>= 0xD800 and <= 0xDFFF) &&
        CharUnicodeInfo.GetUnicodeCategory(codePoint) is UnicodeCategory.UppercaseLetter or UnicodeCategory.LowercaseLetter or
            UnicodeCategory.TitlecaseLetter or UnicodeCategory.ModifierLetter or UnicodeCategory.OtherLetter;

    /// <summary>\d de JavaScript: solo 0-9.</summary>
    public static bool IsAsciiDigit(int codePoint) => codePoint is >= '0' and <= '9';

    /// <summary>(text.match(/\p{L}/gu) ?? []).length</summary>
    public static int CountLetters(string value) => CodePoints(value).Count(IsLetter);

    /// <summary>String.prototype.normalize: normaliza los tramos válidos y deja los sustitutos sueltos donde están, como JavaScript.</summary>
    public static string Normalize(string value, NormalizationForm form)
    {
        var result = new StringBuilder(value.Length);
        var start = 0;
        for (var index = 0; index < value.Length; index++)
        {
            var unit = value[index];
            if (char.IsHighSurrogate(unit) && index + 1 < value.Length && char.IsLowSurrogate(value[index + 1]))
            {
                index++;
                continue;
            }
            if (!char.IsSurrogate(unit)) continue;
            // Un sustituto suelto no se compone ni se descompone con nada: separa dos tramos independientes.
            result.Append(value[start..index].Normalize(form)).Append(unit);
            start = index + 1;
        }
        return result.Append(value[start..].Normalize(form)).ToString();
    }
}
