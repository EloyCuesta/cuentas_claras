using System.Security.Cryptography;
using System.Text;
using CuentasClaras.Application.Tickets;
using CuentasClaras.Domain.Tickets;

namespace CuentasClaras.Infrastructure.Tickets;

/// <summary>
/// SHA-256 de las partes, una detrás de otra, en hexadecimal (Sha256Hasher.ts). Los textos van en UTF-8 como hash.update de
/// Node: un sustituto suelto se escribe como U+FFFD (EF BF BD), que es lo que hace Encoding.UTF8. Las huellas guardadas
/// dependen de estos bytes (hay tres golden en el corpus de tickets).
/// </summary>
public sealed class Sha256Hasher : IHasher
{
    public string Sha256Hex(IReadOnlyList<FingerprintPart> parts)
    {
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        foreach (var part in parts)
        {
            if (part.Text is { } text) hash.AppendData(Encoding.UTF8.GetBytes(text));
            if (part.Bytes is { } bytes) hash.AppendData(bytes);
        }
        return Convert.ToHexStringLower(hash.GetHashAndReset());
    }
}
