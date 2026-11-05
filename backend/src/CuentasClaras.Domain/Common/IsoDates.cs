namespace CuentasClaras.Domain.Common;

/// <summary>Fechas de calendario «AAAA-MM-DD» como texto, sin DateTime ni zona horaria (shared/common/dates.ts).</summary>
public static class IsoDates
{
    private static readonly System.Text.RegularExpressions.Regex IsoDate = JsRegex.Create(@"^(\d{4})-(\d{2})-(\d{2})$");

    public static bool IsLeapYear(int year) => (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;

    public static int DaysInMonth(int year, int month) =>
        month == 2 ? (IsLeapYear(year) ? 29 : 28) : month is 4 or 6 or 9 or 11 ? 30 : 31;

    /// <summary>toISODate: el año con cuatro cifras y el mes y el día con dos.</summary>
    public static string ToIsoDate(int year, int month, int day) =>
        $"{JsNumber.ToString(year).PadLeft(4, '0')}-{JsNumber.ToString(month).PadLeft(2, '0')}-{JsNumber.ToString(day).PadLeft(2, '0')}";

    /// <summary>parseISODate: las partes de una fecha real entre 1900 y 2999, o null.</summary>
    public static (int Year, int Month, int Day)? Parse(string value)
    {
        var match = IsoDate.Match(value);
        if (!match.Success) return null;
        var year = int.Parse(match.Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture);
        var month = int.Parse(match.Groups[2].Value, System.Globalization.CultureInfo.InvariantCulture);
        var day = int.Parse(match.Groups[3].Value, System.Globalization.CultureInfo.InvariantCulture);
        if (year < 1900 || year > 2999) return null;
        if (month < 1 || month > 12) return null;
        if (day < 1 || day > DaysInMonth(year, month)) return null;
        return (year, month, day);
    }

    /// <summary>isValidISODate: un texto con una fecha que existe.</summary>
    public static bool IsValid(string? value) => value is not null && Parse(value) is not null;
}
