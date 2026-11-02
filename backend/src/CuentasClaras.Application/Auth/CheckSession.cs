using CuentasClaras.Application.Common;

namespace CuentasClaras.Application.Auth;

/// <summary>Comprueba caducidad absoluta; consultar la sesión nunca prolonga su duración.</summary>
public sealed class CheckSession
{
    private readonly ISessionStore sessions;
    private readonly IClock clock;

    public CheckSession(ISessionStore sessions, IClock clock)
    {
        this.sessions = sessions;
        this.clock = clock;
    }

    public bool Execute(string? token)
    {
        if (string.IsNullOrEmpty(token)) return false;
        var expiresAt = sessions.Get(token);
        if (expiresAt is null) return false;
        if (expiresAt <= clock.NowMs())
        {
            sessions.Delete(token);
            return false;
        }
        return true;
    }
}
