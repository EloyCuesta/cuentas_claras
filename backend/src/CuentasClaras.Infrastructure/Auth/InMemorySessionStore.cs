using CuentasClaras.Application.Auth;

namespace CuentasClaras.Infrastructure.Auth;

/// <summary>Sesiones en memoria por host; sus operaciones admiten peticiones concurrentes.</summary>
public sealed class InMemorySessionStore : ISessionStore
{
    private readonly Dictionary<string, long> sessions = new(StringComparer.Ordinal);
    private readonly object gate = new();

    public long? Get(string token)
    {
        lock (gate) return sessions.TryGetValue(token, out var expiresAt) ? expiresAt : null;
    }

    public void Set(string token, long expiresAt)
    {
        lock (gate) sessions[token] = expiresAt;
    }

    public void Delete(string token)
    {
        lock (gate) sessions.Remove(token);
    }

    public void DeleteExpired(long now)
    {
        lock (gate)
        {
            foreach (var token in sessions.Where(entry => entry.Value <= now).Select(entry => entry.Key).ToArray())
                sessions.Remove(token);
        }
    }
}
