namespace CuentasClaras.Domain.Common;

/// <summary>
/// El resultado de validar un dato que llega a la API, como ValidationResult de
/// shared/common/validation.ts: el valor leído o un solo mensaje en español, que el servidor envía
/// tal cual con un 400.
/// </summary>
public sealed record ValidationResult<T>
{
    private ValidationResult(bool ok, T? value, string? error)
    {
        Ok = ok;
        Value = value;
        Error = error;
    }

    public bool Ok { get; }
    public T? Value { get; }
    public string? Error { get; }

    public static ValidationResult<T> Valid(T value) => new(true, value, null);

    public static ValidationResult<T> Invalid(string error) => new(false, default, error);
}
