namespace CuentasClaras.Api.Common;

/// <summary>Error del transporte JSON, separado de los errores de negocio.</summary>
public sealed class BodyException(int status, string message) : Exception(message)
{
    public int Status { get; } = status;
}
