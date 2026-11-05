using System.Text;
using System.Text.RegularExpressions;

namespace CuentasClaras.Domain.Common;

/// <summary>
/// Traduce una expresión regular de JavaScript sin la bandera u a una de .NET que reconoce lo mismo.
/// El texto se copia tal cual del TypeScript y aquí se cambian las clases que .NET entiende distinto:
/// <list type="bullet">
/// <item>\d, \w y \b son ASCII en JavaScript; en .NET, Unicode («á» y «ñ» son letras de palabra; «٣», una cifra).</item>
/// <item>\s de JavaScript incluye U+FEFF y no U+0085; el de .NET, al revés.</item>
/// <item>«.» no pasa por \r, U+2028 ni U+2029; en .NET solo se para en \n.</item>
/// <item>«$» sin la bandera m es el final del texto; en .NET también acepta un salto de línea final (\z).</item>
/// <item>Con la bandera i, cada letra se escribe con sus dos formas: IgnoreCase de .NET iguala además «k» con el signo Kelvin.</item>
/// </list>
/// RegexOptions.ECMAScript no sirve: no admite \p{L}. Lo que usa la bandera u (\p{L}) se programa
/// aparte, por puntos de código (<see cref="JsText"/>). Lo que no se sabe traducir lanza al cargar el tipo.
/// </summary>
public static class JsRegex
{
    private const string Word = "A-Za-z0-9_";
    private const string WordBoundary = "(?:(?<=[" + Word + "])(?![" + Word + "])|(?<![" + Word + "])(?=[" + Word + "]))";
    private const string AnyButLineTerminator = @"[^\n\r\u2028\u2029]";

    public static Regex Create(string javaScriptSource, bool ignoreCase = false) =>
        new(Translate(javaScriptSource, ignoreCase), RegexOptions.CultureInvariant);

    public static string Translate(string source, bool ignoreCase = false)
    {
        var result = new StringBuilder(source.Length * 2);
        var inClass = false;
        for (var index = 0; index < source.Length; index++)
        {
            var unit = source[index];
            if (unit == '\\')
            {
                if (index + 1 >= source.Length) throw Unsupported(source, "\\ al final");
                var escaped = source[++index];
                switch (escaped)
                {
                    case 'd': result.Append(inClass ? "0-9" : "[0-9]"); break;
                    case 's': result.Append(inClass ? JsText.WhiteSpaceClass : "[" + JsText.WhiteSpaceClass + "]"); break;
                    case 'w': result.Append(inClass ? Word : "[" + Word + "]"); break;
                    case 'D' when !inClass: result.Append("[^0-9]"); break;
                    case 'S' when !inClass: result.Append("[^" + JsText.WhiteSpaceClass + "]"); break;
                    case 'W' when !inClass: result.Append("[^" + Word + "]"); break;
                    case 'b' when !inClass: result.Append(WordBoundary); break;
                    case 'u':
                        if (index + 4 >= source.Length) throw Unsupported(source, "\\u incompleto");
                        result.Append('\\').Append(source, index, 5);
                        index += 4;
                        break;
                    default:
                        if (char.IsLetterOrDigit(escaped)) throw Unsupported(source, "\\" + escaped);
                        result.Append('\\').Append(escaped);
                        break;
                }
                continue;
            }
            if (inClass)
            {
                if (unit == ']') inClass = false;
                else if (ignoreCase && char.IsLetter(unit))
                {
                    if (index + 1 < source.Length && source[index + 1] == '-') throw Unsupported(source, "rango de letras con la bandera i");
                    result.Append(Variants(unit));
                    continue;
                }
                result.Append(unit);
                continue;
            }
            switch (unit)
            {
                case '[':
                    inClass = true;
                    result.Append('[');
                    if (index + 1 < source.Length && source[index + 1] == '^') result.Append(source[++index]);
                    break;
                case '.': result.Append(AnyButLineTerminator); break;
                case '$': result.Append(@"\z"); break;
                default:
                    var variants = ignoreCase && char.IsLetter(unit) ? Variants(unit) : null;
                    if (variants is { Length: > 1 }) result.Append('[').Append(variants).Append(']');
                    else result.Append(unit);
                    break;
            }
        }
        if (inClass) throw Unsupported(source, "clase sin cerrar");
        return result.ToString();
    }

    /// <summary>
    /// Las letras que la bandera i (sin u) iguala con <paramref name="letter"/>: las de la misma
    /// mayúscula de un solo carácter, sin pasar de fuera de ASCII a ASCII (Canonicalize de ECMAScript).
    /// </summary>
    private static string Variants(char letter)
    {
        var canonical = Canonicalize(letter);
        var variants = new StringBuilder().Append(letter);
        foreach (var candidate in new[] { char.ToUpperInvariant(letter), char.ToLowerInvariant(letter) })
            if (candidate != letter && Canonicalize(candidate) == canonical && variants.ToString().IndexOf(candidate) < 0)
                variants.Append(candidate);
        return variants.ToString();
    }

    private static char Canonicalize(char unit)
    {
        var upper = JsCase.ToUpper(unit.ToString());
        if (upper.Length != 1) return unit;
        return unit >= 128 && upper[0] < 128 ? unit : upper[0];
    }

    private static ArgumentException Unsupported(string source, string what) =>
        new($"Expresión regular de JavaScript no traducible ({what}): {source}");
}
