using System.Text.Encodings.Web;
using System.Text.Json;
using CuentasClaras.Application.Common;

namespace CuentasClaras.Api.Common;

/// <summary>Único sobre HTTP: conserva mensajes y códigos actuales, incluida la cabecera de caché en los errores.</summary>
public static class ApiResponse
{
    public const string InternalMessage = "Error interno del servidor. Revisa la consola donde se ejecuta npm run dev.";
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    public static Task Data(HttpContext context, object? data) => Write(context, 200, new { ok = true, data });

    public static Task Error(HttpContext context, int status, string code, string message) =>
        Write(context, status, new { ok = false, error = new { code, message } });

    public static Task Failure(HttpContext context, Exception error)
    {
        if (error is BodyException body) return Error(context, body.Status, "VALIDATION", body.Message);
        if (error is AppError known)
        {
            if (known.RetryAfterSeconds is { } seconds)
                context.Response.Headers.RetryAfter = seconds.ToString(System.Globalization.CultureInfo.InvariantCulture);
            var status = known.Code switch
            {
                "VALIDATION" => 400, "UNAUTHORIZED" => 401, "NOT_FOUND" => 404,
                "CONFLICT" => 409, "TOO_MANY_ATTEMPTS" => 429, _ => 500,
            };
            return Error(context, status, known.Code, known.Message);
        }
        if (error is BadHttpRequestException bad && bad.StatusCode == 413)
            return Error(context, 413, "VALIDATION", JsonBody.TooLargeMessage);
        context.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("Api")
            .LogError(error, "Error inesperado en la API");
        return Error(context, 500, "INTERNAL", InternalMessage);
    }

    private static async Task Write(HttpContext context, int status, object value)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(value, JsonOptions);
        context.Response.StatusCode = status;
        context.Response.ContentType = "application/json; charset=utf-8";
        context.Response.Headers.CacheControl = "no-store";
        context.Response.ContentLength = bytes.Length;
        if (!HttpMethods.IsHead(context.Request.Method))
            await context.Response.Body.WriteAsync(bytes, context.RequestAborted);
    }
}
