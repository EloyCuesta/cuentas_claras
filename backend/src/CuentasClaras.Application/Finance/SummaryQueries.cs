using System.Text.RegularExpressions;
using CuentasClaras.Application.Common;
using CuentasClaras.Domain.Common;

namespace CuentasClaras.Application.Finance;

/// <summary>
/// Las consultas de resumen de .NET (FIN-04): GET /api/summary/month?year&amp;month&amp;hoy y GET /api/summary/year?year&amp;hoy.
/// Leen las finanzas en una transacción sin bloqueo (la misma foto que GET /api/data) y calculan lo mismo que la web con
/// shared/finance/summaryViews.ts. La fecha de hoy la manda el navegador: decide el horizonte y lo que se proyecta. No
/// guardan nada. Solo existen en .NET; React las usa si se compila con CUENTAS_BACKEND=dotnet.
/// </summary>
public sealed class SummaryQueries(IFinanceStore store, IUnitOfWork unitOfWork)
{
    private static readonly Regex YearPattern = JsRegex.Create(@"^\d{4}$");
    private static readonly Regex MonthPattern = JsRegex.Create(@"^\d{1,2}$");

    /// <summary>El año, de cuatro cifras entre 1900 y 2999 (las fechas que admite la aplicación).</summary>
    public static int ReadYear(string? value) =>
        value is not null && YearPattern.IsMatch(value) && int.Parse(value, System.Globalization.CultureInfo.InvariantCulture) is var year and >= 1900 and <= 2999
            ? year : throw new AppError("VALIDATION", "El parámetro «year» debe ser un año entre 1900 y 2999.");

    public static int ReadMonth(string? value) =>
        value is not null && MonthPattern.IsMatch(value) && int.Parse(value, System.Globalization.CultureInfo.InvariantCulture) is var month and >= 1 and <= 12
            ? month : throw new AppError("VALIDATION", "El parámetro «month» debe ser un mes entre 1 y 12.");

    public static string ReadToday(string? value) =>
        IsoDates.IsValid(value) ? value! : throw new AppError("VALIDATION", "El parámetro «hoy» debe ser una fecha AAAA-MM-DD.");

    /// <summary>Los parámetros se comprueban en orden (año, mes y hoy) antes de leer nada.</summary>
    public async Task<MonthSummaryView> Month(string? year, string? month, string? hoy)
    {
        var y = ReadYear(year);
        var m = ReadMonth(month);
        var today = ReadToday(hoy);
        var data = await unitOfWork.Run(store.ReadAll);
        return FinanceSummaries.MonthView(data, today, y, m);
    }

    public async Task<YearSummaryView> YearView(string? year, string? hoy)
    {
        var y = ReadYear(year);
        var today = ReadToday(hoy);
        var data = await unitOfWork.Run(store.ReadAll);
        return FinanceSummaries.YearView(data, today, y);
    }
}
