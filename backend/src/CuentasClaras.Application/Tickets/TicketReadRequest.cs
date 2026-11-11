using System.Buffers.Binary;
using System.Text.Json;
using System.Text.RegularExpressions;
using CuentasClaras.Application.Common;
using CuentasClaras.Domain.Common;
using static CuentasClaras.Application.Common.JsonInput;

namespace CuentasClaras.Application.Tickets;

/// <summary>Lo que se lee: el texto pegado, o las imágenes con sus franjas (si son franjas de imágenes largas).</summary>
public sealed record TicketReadSource(string? Text, IReadOnlyList<byte[]> Images, IReadOnlyList<TicketSegmentInput>? Segments);

/// <summary>Una petición de lectura ya validada, con la fecha de hoy del navegador si era válida.</summary>
public sealed record TicketReadInput(TicketReadSource Source, string? Today);

/// <summary>Tipo y tamaño de una imagen PNG o JPEG, leídos de su cabecera sin decodificarla (server/common/imageInfo.ts).</summary>
public sealed record ImageInfo(string Type, long Width, long Height)
{
    private static readonly byte[] PngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

    public static ImageInfo? Of(byte[] buffer)
    {
        var info = Png(buffer) ?? Jpeg(buffer);
        return info is { Width: > 0, Height: > 0 } ? info : null;
    }

    private static ImageInfo? Png(byte[] buffer)
    {
        if (buffer.Length < 24 || !buffer.AsSpan(0, 8).SequenceEqual(PngSignature)) return null;
        // El primer bloque es IHDR: ancho y alto en los bytes 16-23.
        if (buffer[12] != 'I' || buffer[13] != 'H' || buffer[14] != 'D' || buffer[15] != 'R') return null;
        return new ImageInfo("png", BinaryPrimitives.ReadUInt32BigEndian(buffer.AsSpan(16)), BinaryPrimitives.ReadUInt32BigEndian(buffer.AsSpan(20)));
    }

    /// <summary>Marcadores SOF (inicio de imagen) de JPEG que llevan el tamaño.</summary>
    private static bool IsStartOfFrame(int marker) => marker is >= 0xc0 and <= 0xcf && marker != 0xc4 && marker != 0xc8 && marker != 0xcc;

    private static ImageInfo? Jpeg(byte[] buffer)
    {
        if (buffer.Length < 4 || buffer[0] != 0xff || buffer[1] != 0xd8) return null;
        var offset = 2;
        while (offset + 4 <= buffer.Length)
        {
            if (buffer[offset] != 0xff) return null;
            var marker = buffer[offset + 1];
            if (marker == 0xff)
            {
                offset++; // relleno
                continue;
            }
            if (marker == 0xd8 || marker == 0x01 || marker is >= 0xd0 and <= 0xd7)
            {
                offset += 2;
                continue;
            }
            if (marker == 0xd9) return null;
            var length = BinaryPrimitives.ReadUInt16BigEndian(buffer.AsSpan(offset + 2));
            if (length < 2) return null;
            if (IsStartOfFrame(marker))
            {
                // readUInt16BE de Node lanza si se sale del búfer; aquí ya se ha comprobado que caben los dos.
                if (offset + 9 > buffer.Length) return null;
                return new ImageInfo("jpeg", BinaryPrimitives.ReadUInt16BigEndian(buffer.AsSpan(offset + 7)),
                    BinaryPrimitives.ReadUInt16BigEndian(buffer.AsSpan(offset + 5)));
            }
            offset += 2 + length;
        }
        return null;
    }
}

/// <summary>
/// Buffer.from(texto, 'base64') de Node, que no rechaza nada: de cada carácter se queda con su byte bajo, acepta también
/// «-» y «_» (base64url), se salta lo que no es del alfabeto, para en el primer «=» y descarta un último carácter suelto.
/// Las huellas de las imágenes se calculan sobre estos bytes, así que tienen que ser los mismos que en Express.
/// </summary>
public static class NodeBase64
{
    private static readonly sbyte[] Table = BuildTable();

    private static sbyte[] BuildTable()
    {
        var table = new sbyte[256];
        Array.Fill(table, (sbyte)-1);
        const string alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        for (var i = 0; i < alphabet.Length; i++) table[alphabet[i]] = (sbyte)i;
        table['-'] = 62;
        table['_'] = 63;
        return table;
    }

    public static byte[] Decode(string text)
    {
        var output = new List<byte>(text.Length * 3 / 4);
        var buffer = 0;
        var count = 0;
        foreach (var unit in text)
        {
            var low = unit & 0xff;
            if (low == '=') break;
            var value = Table[low];
            if (value < 0) continue;
            buffer = (buffer << 6) | (byte)value;
            if (++count == 4)
            {
                output.Add((byte)(buffer >> 16));
                output.Add((byte)(buffer >> 8));
                output.Add((byte)buffer);
                buffer = 0;
                count = 0;
            }
        }
        if (count == 2) output.Add((byte)(buffer >> 4));
        else if (count == 3)
        {
            output.Add((byte)(buffer >> 10));
            output.Add((byte)(buffer >> 2));
        }
        return [.. output];
    }
}

/// <summary>
/// El cuerpo de POST /api/despensa/tickets/leer, decodificado y validado antes de leer nada
/// (server/modules/tickets/adapters/http/readTicketRequest.ts), con los mismos mensajes y el mismo orden:
/// { texto } (no vacío, hasta 20 000 caracteres), { franjas } (hasta 24, ordenadas y de la misma imagen) o { imagenes } (hasta
/// 6). Las imágenes: PNG o JPEG por su cabecera, hasta 8 MB cada una, 20 MB en total y 40 Mpx. Y hoy, si es una fecha.
/// </summary>
public static class TicketReadRequest
{
    private const int MaxImages = 6;
    private const int MaxSegments = 24;
    private const int MaxImageBytes = 8 * 1024 * 1024;
    private const int MaxTotalBytes = 20 * 1024 * 1024;
    private const double MaxPixels = 40_000_000;
    private const int MaxText = 20_000;

    /// <summary>item.replace(/^data:[^,]*,/, ''): la cabecera de una data URL.</summary>
    private static readonly Regex DataUrl = new("^data:[^,]*,", RegexOptions.CultureInvariant);

    public static TicketReadInput Read(JsonElement body)
    {
        if (!IsObject(body)) throw new AppError("VALIDATION", "Falta el cuerpo de la petición en JSON.");
        var hoy = Get(body, "hoy");
        var today = IsString(hoy) && IsoDates.IsValid(Text(hoy)) ? Text(hoy) : null;
        var texto = Get(body, "texto");
        if (IsString(texto))
        {
            var text = Text(texto);
            if (JsText.Trim(text).Length == 0) throw new AppError("VALIDATION", "Pega el texto del ticket.");
            if (text.Length > MaxText) throw new AppError("VALIDATION", "El texto del ticket es demasiado largo.");
            return new TicketReadInput(new TicketReadSource(text, [], null), today);
        }
        var franjas = Get(body, "franjas");
        if (IsArray(franjas))
        {
            var segments = franjas.EnumerateArray().ToList();
            var images = DecodeImages([.. segments.Select(segment => Get(segment, "image"))], isArray: true, MaxSegments);
            return new TicketReadInput(new TicketReadSource(null, images, ReadSegments(segments, images)), today);
        }
        var imagenes = Get(body, "imagenes");
        return new TicketReadInput(new TicketReadSource(null, DecodeImages(IsArray(imagenes) ? [.. imagenes.EnumerateArray()] : [], IsArray(imagenes),
            MaxImages), null), today);
    }

    private static List<byte[]> DecodeImages(IReadOnlyList<JsonElement> items, bool isArray, int max)
    {
        if (!isArray || items.Count == 0) throw new AppError("VALIDATION", "Elige al menos una imagen del ticket.");
        if (items.Count > max) throw new AppError("VALIDATION", $"Se pueden leer como máximo {max} imágenes o franjas de un mismo ticket.");
        var bytes = 0L;
        var result = new List<byte[]>();
        for (var i = 0; i < items.Count; i++)
        {
            var item = items[i];
            if (!IsString(item) || Text(item).Length == 0) throw new AppError("VALIDATION", $"La imagen {i + 1} no es válida.");
            var buffer = NodeBase64.Decode(DataUrl.Replace(Text(item), "", 1));
            bytes += buffer.Length;
            if (bytes > MaxTotalBytes)
                throw new AppError("VALIDATION", "Las imágenes superan 20 MB. Recorta los márgenes o el contenido publicitario.");
            if (buffer.Length > MaxImageBytes) throw new AppError("VALIDATION", $"La imagen {i + 1} es demasiado grande (máximo 8 MB).");
            var info = ImageInfo.Of(buffer) ?? throw new AppError("VALIDATION", $"La imagen {i + 1} no es una imagen PNG o JPEG.");
            if ((double)info.Width * info.Height > MaxPixels || info.Width > 8000 || info.Height > 40000)
                throw new AppError("VALIDATION", $"La imagen {i + 1} es demasiado grande para leerla.");
            result.Add(buffer);
        }
        return result;
    }

    /// <summary>Coordenadas de cada franja: van seguidas, sin huecos, y son de la misma imagen que la anterior.</summary>
    private static List<TicketSegmentInput> ReadSegments(IReadOnlyList<JsonElement> franjas, IReadOnlyList<byte[]> images)
    {
        var previous = new Dictionary<long, (long Segment, long Offset, long Width, long Height)>();
        var result = new List<TicketSegmentInput>();
        for (var i = 0; i < franjas.Count; i++)
        {
            var raw = franjas[i];
            var values = new[] { "imageIndex", "segmentIndex", "offsetY", "fullHeight" }.Select(name => Get(raw, name)).ToArray();
            if (!values.All(value => IsNumber(value) && JsNumber.IsSafeInteger(Number(value))))
                throw new AppError("VALIDATION", "Las coordenadas de las franjas no son válidas.");
            var (imageIndex, segmentIndex, offsetY, fullHeight) = ((long)Number(values[0]), (long)Number(values[1]), (long)Number(values[2]), (long)Number(values[3]));
            if (imageIndex is < 0 or > 5 || segmentIndex is < 0 or > 23 || offsetY < 0 || fullHeight is < 1 or > 160000)
                throw new AppError("VALIDATION", "Las coordenadas de las franjas no son válidas.");
            var info = ImageInfo.Of(images[i])!;
            var hasPrevious = previous.TryGetValue(imageIndex, out var prev);
            if (info.Height > 4096 || offsetY + info.Height > fullHeight
                || (hasPrevious
                    ? segmentIndex != prev.Segment + 1 || offsetY <= prev.Offset || info.Width != prev.Width || fullHeight != prev.Height
                    : segmentIndex != 0 || offsetY != 0))
                throw new AppError("VALIDATION", "Las franjas deben estar ordenadas y pertenecer a la misma imagen.");
            previous[imageIndex] = (segmentIndex, offsetY, info.Width, fullHeight);
            result.Add(new TicketSegmentInput((int)imageIndex, (int)segmentIndex, (int)offsetY, (int)fullHeight));
        }
        return result;
    }
}
