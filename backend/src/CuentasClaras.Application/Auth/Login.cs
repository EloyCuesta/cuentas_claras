using CuentasClaras.Application.Common;
using CuentasClaras.Domain.Auth;

namespace CuentasClaras.Application.Auth;

/// <summary>Abre una sesión y limita fallos; la operación completa es síncrona y atómica entre peticiones.</summary>
public sealed class Login
{
    public const int MaxCodeLength = AccessCode.MaxLength;
    public const long SessionMilliseconds = AccessPolicy.SessionMilliseconds;

    private readonly ICodeVerifier verifier;
    private readonly ITokenGenerator tokens;
    private readonly ISessionStore sessions;
    private readonly IAttemptStore attempts;
    private readonly IClock clock;
    private readonly object gate = new();

    public Login(ICodeVerifier verifier, ITokenGenerator tokens, ISessionStore sessions, IAttemptStore attempts, IClock clock)
    {
        this.verifier = verifier;
        this.tokens = tokens;
        this.sessions = sessions;
        this.attempts = attempts;
        this.clock = clock;
    }

    public string Execute(string code, string ip, string? previousToken = null)
    {
        // Una sola instancia por host: cinco fallos simultáneos deben bloquear también el sexto.
        lock (gate)
        {
            var now = clock.NowMs();
            var entry = CurrentAttempts(ip, now);
            if (entry?.LockedUntil is { } lockedUntil)
            {
                var waitMs = lockedUntil - now;
                throw new AppError("TOO_MANY_ATTEMPTS",
                    $"Demasiados intentos con un código incorrecto. Vuelve a intentarlo dentro de {AccessPolicy.MinutesLeft(waitMs)} min.",
                    (int)Math.Ceiling(waitMs / 1000d));
            }

            if (!verifier.Matches(code))
            {
                attempts.Set(ip, AccessPolicy.AfterFailure(entry, now));
                throw new AppError("UNAUTHORIZED", "El código no es correcto.");
            }

            attempts.Delete(ip);
            sessions.DeleteExpired(now);
            var token = tokens.NewToken();
            sessions.Set(token, now + SessionMilliseconds);
            // Solo un acceso correcto sustituye la sesión previa del navegador.
            if (previousToken is not null) sessions.Delete(previousToken);
            return token;
        }
    }

    private Attempts? CurrentAttempts(string ip, long now)
    {
        var entry = attempts.Get(ip);
        if (entry is not null && AccessPolicy.AttemptsExpired(entry, now))
        {
            attempts.Delete(ip);
            return null;
        }
        return entry;
    }
}
