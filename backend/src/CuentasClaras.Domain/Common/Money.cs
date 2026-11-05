using System.Text;

namespace CuentasClaras.Domain.Common;

/// <summary>Importes en céntimos enteros (shared/common/money.ts).</summary>
public static class Money
{
    /// <summary>Signo menos tipográfico (U+2212), el que escribe formatEuros.</summary>
    public const string Minus = "\u2212";

    /// <summary>
    /// formatEuros: «1.234,56 €», con «.» de miles también en cuatro cifras, U+00A0 antes de «€» y
    /// U+2212 en los negativos; con <paramref name="alwaysSign"/>, «+» en los positivos. Se escribe a
    /// mano: el formato «C» de .NET depende de la cultura y de la versión de ICU del equipo.
    /// </summary>
    public static string FormatEuros(long cents, bool alwaysSign = false)
    {
        var absolute = Math.Abs(cents);
        var integer = JsNumber.ToString(absolute / 100);
        var grouped = new StringBuilder();
        for (var index = 0; index < integer.Length; index++)
        {
            if (index > 0 && (integer.Length - index) % 3 == 0) grouped.Append('.');
            grouped.Append(integer[index]);
        }
        var text = $"{grouped},{JsNumber.ToString(absolute % 100).PadLeft(2, '0')}\u00A0€";
        if (cents < 0) return Minus + text;
        return alwaysSign && cents > 0 ? "+" + text : text;
    }
}
