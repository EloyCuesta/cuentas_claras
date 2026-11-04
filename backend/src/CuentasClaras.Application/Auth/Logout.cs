namespace CuentasClaras.Application.Auth;

/// <summary>Cierra una sesión; repetir el cierre o no aportar token siempre tiene éxito.</summary>
public sealed class Logout
{
    private readonly ISessionStore sessions;

    public Logout(ISessionStore sessions) => this.sessions = sessions;

    public void Execute(string? token)
    {
        if (!string.IsNullOrEmpty(token)) sessions.Delete(token);
    }
}
