using CuentasClaras.Application.Common;

namespace CuentasClaras.Infrastructure.Common;

/// <summary>Instantes del servidor en UTC; no decide las fechas de calendario que envía el navegador.</summary>
public sealed class SystemClock : IClock
{
    public long NowMs() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
}
