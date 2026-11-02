using CuentasClaras.Application.Auth;
using CuentasClaras.Domain.Auth;

namespace CuentasClaras.Infrastructure.Auth;

/// <summary>Instantáneas inmutables de fallos por IP; no sobreviven al reinicio.</summary>
public sealed class InMemoryAttemptStore : IAttemptStore
{
    private readonly Dictionary<string, Attempts> attempts = new(StringComparer.Ordinal);
    private readonly object gate = new();

    public Attempts? Get(string ip)
    {
        lock (gate) return attempts.GetValueOrDefault(ip);
    }

    public void Set(string ip, Attempts entry)
    {
        lock (gate) attempts[ip] = entry;
    }

    public void Delete(string ip)
    {
        lock (gate) attempts.Remove(ip);
    }
}
