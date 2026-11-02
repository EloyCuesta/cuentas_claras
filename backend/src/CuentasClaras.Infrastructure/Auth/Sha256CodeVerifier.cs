using System.Security.Cryptography;
using System.Text;
using CuentasClaras.Application.Auth;
using CuentasClaras.Domain.Auth;

namespace CuentasClaras.Infrastructure.Auth;

/// <summary>Retiene solo el hash y compara 32 bytes en tiempo constante; no elimina espacios del secreto.</summary>
public sealed class Sha256CodeVerifier : ICodeVerifier
{
    private readonly byte[] codeHash;

    public Sha256CodeVerifier(string? accessCode)
    {
        codeHash = Hash(AccessCode.Validate(accessCode));
    }

    public bool Matches(string code) => CryptographicOperations.FixedTimeEquals(Hash(code), codeHash);

    // UTF8 de .NET sustituye los sustitutos aislados por U+FFFD, como Buffer.from(text, 'utf8').
    private static byte[] Hash(string code) => SHA256.HashData(Encoding.UTF8.GetBytes(code));
}
