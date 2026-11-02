using System.Security.Cryptography;
using CuentasClaras.Application.Auth;

namespace CuentasClaras.Infrastructure.Auth;

/// <summary>32 bytes criptográficos por sesión, expresados como 64 caracteres hexadecimales minúsculos.</summary>
public sealed class RandomTokenGenerator : ITokenGenerator
{
    public string NewToken() => Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(32));
}
