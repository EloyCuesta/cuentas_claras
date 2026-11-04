namespace CuentasClaras.Domain.Auth;

/// <summary>Duración absoluta de sesiones y ventanas de intentos; los instantes son milisegundos Unix.</summary>
public static class AccessPolicy
{
    public const long SessionMilliseconds = 12 * 60 * 60 * 1000;
    public const long AttemptWindowMilliseconds = 15 * 60 * 1000;
    public const long LockMilliseconds = 15 * 60 * 1000;
    public const int MaxFailedAttempts = 5;

    public static bool AttemptsExpired(Attempts entry, long now) => entry.LockedUntil is { } lockedUntil
        ? lockedUntil <= now
        : now - entry.WindowStart >= AttemptWindowMilliseconds;

    public static Attempts AfterFailure(Attempts? entry, long now)
    {
        var failures = (entry?.Failures ?? 0) + 1;
        return new Attempts(failures, entry?.WindowStart ?? now,
            failures >= MaxFailedAttempts ? now + LockMilliseconds : null);
    }

    public static int MinutesLeft(long milliseconds) => Math.Max(1, (int)Math.Ceiling(milliseconds / 60_000d));
}

/// <summary>Instantánea inmutable de los intentos de una IP, segura para compartir entre lecturas.</summary>
public sealed record Attempts(int Failures, long WindowStart, long? LockedUntil);
