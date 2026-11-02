using CuentasClaras.Domain.Auth;

namespace CuentasClaras.Application.Auth;

/// <summary>Sesiones temporales: cada instancia del host posee su almacén.</summary>
public interface ISessionStore
{
    long? Get(string token);
    void Set(string token, long expiresAt);
    void Delete(string token);
    void DeleteExpired(long now);
}

/// <summary>Intentos por IP; Login coordina la lectura y modificación completa.</summary>
public interface IAttemptStore
{
    Attempts? Get(string ip);
    void Set(string ip, Attempts attempts);
    void Delete(string ip);
}

/// <summary>Comprueba el secreto mediante hashes de longitud fija.</summary>
public interface ICodeVerifier
{
    bool Matches(string code);
}

/// <summary>Tokens impredecibles de sesión, distintos de los IDs de entidades.</summary>
public interface ITokenGenerator
{
    string NewToken();
}
