namespace CuentasClaras.Domain.Auth;

/// <summary>Valida la configuración con las mismas reglas Unicode que JavaScript, sin recortar el secreto.</summary>
public static class AccessCode
{
    public const int MinLength = 4;
    public const int MaxLength = 200;

    public static string Validate(string? value)
    {
        if (string.IsNullOrEmpty(value))
            throw new ArgumentException("Falta el código de acceso. Copia .env.example como .env y escribe tu código en CUENTAS_CODIGO (al menos 4 caracteres).");

        if (value.All(IsJavaScriptWhitespace))
            throw new ArgumentException("El código de acceso (CUENTAS_CODIGO) no puede ser solo espacios.");

        // Una pareja sustituta cuenta como un carácter; un sustituto aislado también cuenta uno, como [...value].
        var characters = 0;
        for (var index = 0; index < value.Length; index++)
        {
            characters++;
            if (char.IsHighSurrogate(value[index]) && index + 1 < value.Length && char.IsLowSurrogate(value[index + 1]))
                index++;
        }
        if (characters < MinLength)
            throw new ArgumentException("El código de acceso (CUENTAS_CODIGO) debe tener al menos 4 caracteres.");
        if (value.Length > MaxLength)
            throw new ArgumentException("El código de acceso (CUENTAS_CODIGO) puede tener como máximo 200 caracteres.");
        return value;
    }

    // String.Trim de .NET incluye U+0085 y excluye U+FEFF; ambos difieren del contrato ECMAScript.
    private static bool IsJavaScriptWhitespace(char value) => value is
        '\u0009' or '\u000A' or '\u000B' or '\u000C' or '\u000D' or '\u0020' or '\u00A0' or
        '\u1680' or >= '\u2000' and <= '\u200A' or '\u2028' or '\u2029' or '\u202F' or '\u205F' or '\u3000' or '\uFEFF';
}
