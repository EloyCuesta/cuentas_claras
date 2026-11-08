using System.Globalization;
using CuentasClaras.Application.Common;

namespace CuentasClaras.Infrastructure.Common;

/// <summary>Instantes del servidor en UTC; no decide las fechas de calendario que envía el navegador.</summary>
public sealed class SystemClock : IClock
{
    public long NowMs() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    /// <summary>todayISO() de Express: la fecha local del equipo. Solo de reserva, cuando la petición no trae la del navegador.</summary>
    public string Today() => DateTime.Now.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
}
