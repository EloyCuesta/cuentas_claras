using System.Text;

namespace CuentasClaras.Domain.Common;

/// <summary>
/// toUpperCase y toLowerCase de JavaScript (y toLocale…('es'), que en español son iguales). No
/// equivalen a ToUpperInvariant: JavaScript expande («ß» → «SS», «ﬁ» → «FI»), pasa «ı» a «I»,
/// baja «İ» a «i\u0307» y pone la sigma final. Las tablas salen de Node (<see cref="JsCaseData"/>).
/// Trabajan por puntos de código; un sustituto suelto se queda como está.
/// </summary>
public static class JsCase
{
    private const int CapitalSigma = 0x03A3;

    public static string ToUpper(string value)
    {
        var result = new StringBuilder(value.Length);
        foreach (var codePoint in JsText.CodePoints(value))
        {
            if (JsCaseData.UpperSpecials.TryGetValue(codePoint, out var special)) result.Append(special);
            else Append(result, Map(JsCaseData.Upper, codePoint));
        }
        return result.ToString();
    }

    public static string ToLower(string value)
    {
        var codePoints = JsText.CodePoints(value).ToArray();
        var result = new StringBuilder(value.Length);
        for (var index = 0; index < codePoints.Length; index++)
        {
            var codePoint = codePoints[index];
            if (codePoint == CapitalSigma) Append(result, IsFinalSigma(codePoints, index) ? 0x03C2 : 0x03C3);
            else if (JsCaseData.LowerSpecials.TryGetValue(codePoint, out var special)) result.Append(special);
            else Append(result, Map(JsCaseData.Lower, codePoint));
        }
        return result.ToString();
    }

    /// <summary>Final_Sigma de Unicode: detrás de una letra con mayúsculas y sin otra delante, saltando lo que se ignora.</summary>
    private static bool IsFinalSigma(int[] codePoints, int index)
    {
        var preceded = false;
        for (var before = index - 1; before >= 0; before--)
        {
            if (In(JsCaseData.CaseIgnorable, codePoints[before])) continue;
            preceded = In(JsCaseData.Cased, codePoints[before]);
            break;
        }
        if (!preceded) return false;
        for (var after = index + 1; after < codePoints.Length; after++)
        {
            if (In(JsCaseData.CaseIgnorable, codePoints[after])) continue;
            return !In(JsCaseData.Cased, codePoints[after]);
        }
        return true;
    }

    private static int Map((int Start, int End, int Step, int Delta)[] table, int codePoint)
    {
        int low = 0, high = table.Length - 1;
        while (low <= high)
        {
            var middle = (low + high) / 2;
            var run = table[middle];
            if (codePoint < run.Start) high = middle - 1;
            else if (codePoint > run.End) low = middle + 1;
            else return (codePoint - run.Start) % run.Step == 0 ? codePoint + run.Delta : codePoint;
        }
        return codePoint;
    }

    private static bool In((int Start, int End)[] ranges, int codePoint)
    {
        int low = 0, high = ranges.Length - 1;
        while (low <= high)
        {
            var middle = (low + high) / 2;
            if (codePoint < ranges[middle].Start) high = middle - 1;
            else if (codePoint > ranges[middle].End) low = middle + 1;
            else return true;
        }
        return false;
    }

    private static void Append(StringBuilder result, int codePoint)
    {
        if (codePoint is >= 0xD800 and <= 0xDFFF) result.Append((char)codePoint);
        else result.Append(char.ConvertFromUtf32(codePoint));
    }
}
