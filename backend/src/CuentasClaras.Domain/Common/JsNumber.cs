using System.Globalization;
using System.Numerics;
using System.Text;

namespace CuentasClaras.Domain.Common;

/// <summary>
/// Los number de TypeScript (doble IEEE 754) con sus reglas de JavaScript: Math.round lleva las
/// mitades hacia +∞ (Math.Round de .NET va al par), Number.isSafeInteger, String(x) y toFixed.
/// Nada depende de la cultura del equipo: en un Windows en español, $"{1.5}" escribe «1,5».
/// </summary>
public static class JsNumber
{
    public const double MaxSafeInteger = 9007199254740991;

    /// <summary>Math.round: el entero más cercano y, a la misma distancia, el de arriba (−2,5 → −2).</summary>
    public static double Round(double value)
    {
        if (double.IsNaN(value) || double.IsInfinity(value)) return value;
        var floor = Math.Floor(value);
        // value − floor es exacto en doble, también cerca de 2^52; Math.Floor(value + 0,5) no lo es.
        return value - floor >= 0.5 ? floor + 1 : floor;
    }

    /// <summary>Number.isSafeInteger.</summary>
    public static bool IsSafeInteger(double value) =>
        double.IsFinite(value) && Math.Floor(value) == value && Math.Abs(value) <= MaxSafeInteger;

    /// <summary>String(x) de un entero: siempre con la cultura invariante.</summary>
    public static string ToString(long value) => value.ToString(CultureInfo.InvariantCulture);

    /// <summary>String(x) (Number::toString): el decimal más corto que vuelve al mismo doble, con las reglas de exponente de JavaScript.</summary>
    public static string ToString(double value)
    {
        if (double.IsNaN(value)) return "NaN";
        if (value == 0) return "0";
        if (double.IsInfinity(value)) return value > 0 ? "Infinity" : "-Infinity";
        if (value < 0) return "-" + ToString(-value);

        // «R» da las cifras más cortas que vuelven al mismo doble; aquí solo se reordenan.
        var shortest = value.ToString("R", CultureInfo.InvariantCulture);
        var exponentAt = shortest.IndexOf('E');
        var mantissa = exponentAt < 0 ? shortest : shortest[..exponentAt];
        var exponent = exponentAt < 0 ? 0 : int.Parse(shortest[(exponentAt + 1)..], NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture);
        var point = mantissa.IndexOf('.');
        var digits = point < 0 ? mantissa : mantissa.Remove(point, 1);
        var n = (point < 0 ? mantissa.Length : point) + exponent;
        var leadingZeros = digits.Length - digits.TrimStart('0').Length;
        digits = digits.Trim('0');
        n -= leadingZeros;
        var k = digits.Length;

        if (k <= n && n <= 21) return digits + new string('0', n - k);
        if (0 < n && n <= 21) return digits[..n] + "." + digits[n..];
        if (-6 < n && n <= 0) return "0." + new string('0', -n) + digits;
        var e = n - 1;
        var sign = e >= 0 ? "+" : "-";
        return (k == 1 ? digits : digits[..1] + "." + digits[1..]) + "e" + sign + Math.Abs(e).ToString(CultureInfo.InvariantCulture);
    }

    /// <summary>Number.prototype.toFixed: redondea el valor exacto del doble, con la mitad hacia arriba, sin coma flotante.</summary>
    public static string ToFixed(double value, int fractionDigits)
    {
        if (double.IsNaN(value)) return "NaN";
        if (Math.Abs(value) >= 1e21) return ToString(value);
        if (value < 0) return "-" + ToFixed(-value, fractionDigits);

        // El doble es exactamente mantisa × 2^exponente: n = redondeo(valor × 10^f) con enteros grandes.
        var bits = BitConverter.DoubleToInt64Bits(value);
        var exponentBits = (int)((bits >> 52) & 0x7FF);
        var fraction = bits & 0xFFFFFFFFFFFFFL;
        var mantissa = exponentBits == 0 ? fraction : fraction | (1L << 52);
        var exponent = exponentBits == 0 ? -1074 : exponentBits - 1075;
        var scaled = new BigInteger(mantissa) * BigInteger.Pow(10, fractionDigits);
        BigInteger n;
        if (exponent >= 0) n = scaled << exponent;
        else
        {
            var denominator = BigInteger.One << -exponent;
            n = (2 * scaled + denominator) / (2 * denominator);
        }

        var text = n.ToString(CultureInfo.InvariantCulture);
        if (fractionDigits == 0) return text;
        if (text.Length <= fractionDigits) text = new string('0', fractionDigits + 1 - text.Length) + text;
        var builder = new StringBuilder(text);
        builder.Insert(text.Length - fractionDigits, '.');
        return builder.ToString();
    }
}
