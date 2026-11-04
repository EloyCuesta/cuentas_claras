namespace CuentasClaras.Application.Common;

/// <summary>Error previsto de aplicación, independiente de HTTP; el adaptador conserva código y mensaje.</summary>
public sealed class AppError : Exception
{
    public string Code { get; }
    public int? RetryAfterSeconds { get; }

    public AppError(string code, string message, int? retryAfterSeconds = null) : base(message)
    {
        Code = code;
        RetryAfterSeconds = retryAfterSeconds;
    }
}
