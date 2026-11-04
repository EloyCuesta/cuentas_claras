using System.Buffers;
using System.IO.Compression;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace CuentasClaras.Api.Common;

/// <summary>Lee JSON antes del acceso, con los límites de Express incluso para cuerpos comprimidos o sin longitud.</summary>
public static class JsonBody
{
    public const string InvalidMessage = "El cuerpo de la petición no es JSON válido.";
    public const string TooLargeMessage = "Los datos enviados son demasiado grandes.";
    private const int RegularLimit = 20 * 1024 * 1024;
    private const int TicketLimit = 30 * 1024 * 1024;

    public static async Task<JsonDocument?> Read(HttpRequest request, string path)
    {
        // Express ignora otros tipos de contenido; el validador del caso de uso reclama después el objeto.
        if (!request.Headers.ContainsKey("Content-Length") && !request.Headers.ContainsKey("Transfer-Encoding"))
            return null;
        if (!MediaTypeHeaderValue.TryParse(request.ContentType, out var contentType)
            || !string.Equals(contentType.MediaType, "application/json", StringComparison.OrdinalIgnoreCase))
            return null;

        var encoding = DecodeEncoding(contentType.CharSet?.Trim('"') ?? "utf-8");
        var limit = IsTicketReader(path) ? TicketLimit : RegularLimit;
        using var decompressor = Decompress(request);
        var input = decompressor ?? request.Body;
        using var body = new MemoryStream();
        var buffer = ArrayPool<byte>.Shared.Rent(64 * 1024);
        try
        {
            while (true)
            {
                var read = await input.ReadAsync(buffer.AsMemory(0, buffer.Length), request.HttpContext.RequestAborted);
                if (read == 0) break;
                if (body.Length + read > limit) throw new BodyException(413, TooLargeMessage);
                body.Write(buffer, 0, read);
            }
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(buffer);
        }

        if (body.Length == 0) return JsonDocument.Parse("{}");
        var text = encoding.GetString(body.GetBuffer(), 0, checked((int)body.Length));
        if (text.StartsWith('\ufeff')) text = text[1..];
        try
        {
            // JSON.parse no impone el límite de 64 niveles predeterminado de System.Text.Json.
            var document = JsonDocument.Parse(text, new JsonDocumentOptions { MaxDepth = int.MaxValue });
            if (document.RootElement.ValueKind is JsonValueKind.Object or JsonValueKind.Array) return document;
            document.Dispose();
            throw new BodyException(400, InvalidMessage);
        }
        catch (JsonException)
        {
            throw new BodyException(400, InvalidMessage);
        }
    }

    private static bool IsTicketReader(string path)
    {
        const string prefix = "/api/despensa/tickets/leer";
        return path.Equals(prefix, StringComparison.OrdinalIgnoreCase)
            || path.StartsWith(prefix + "/", StringComparison.OrdinalIgnoreCase);
    }

    private static Stream? Decompress(HttpRequest request) => request.Headers.ContentEncoding.ToString().ToLowerInvariant() switch
    {
        "" or "identity" => null,
        "gzip" => new GZipStream(request.Body, CompressionMode.Decompress, leaveOpen: true),
        "deflate" => new ZLibStream(request.Body, CompressionMode.Decompress, leaveOpen: true),
        "br" => new BrotliStream(request.Body, CompressionMode.Decompress, leaveOpen: true),
        _ => throw new InvalidOperationException("Codificación de contenido no compatible."),
    };

    private static Encoding DecodeEncoding(string charset)
    {
        // Express solo admite familias UTF para JSON. Los errores de charset no son entity.* y dan INTERNAL.
        return charset.ToLowerInvariant() switch
        {
            "utf-8" => Encoding.UTF8,
            "utf-16" or "utf-16le" => Encoding.Unicode,
            "utf-16be" => Encoding.BigEndianUnicode,
            "utf-32" or "utf-32le" => Encoding.UTF32,
            "utf-32be" => new UTF32Encoding(bigEndian: true, byteOrderMark: true),
            _ => throw new InvalidOperationException("Juego de caracteres JSON no compatible."),
        };
    }
}
