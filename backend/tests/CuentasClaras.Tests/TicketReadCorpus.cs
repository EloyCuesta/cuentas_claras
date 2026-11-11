using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using CuentasClaras.Application.Common;
using CuentasClaras.Application.Tickets;
using static CuentasClaras.Tests.CorpusJson;

namespace CuentasClaras.Tests;

/// <summary>
/// Ejecuta en C# el corpus de la lectura de tickets (fixtures/migration/rules-ticket-read.json, TIC-02): el base64 de Node, la
/// cabecera de PNG y JPEG y el cuerpo de POST /api/despensa/tickets/leer, con la forma del JSON de TypeScript
/// (tests/ticketReadRules.ts): los bytes como { length, sha256 } y un error como { throws }.
/// </summary>
internal static class TicketReadCorpus
{
    private static readonly Dictionary<string, Func<JsonElement, JsonNode?>> Operations = new(StringComparer.Ordinal)
    {
        ["decodeBase64"] = input => String(Convert.ToHexStringLower(NodeBase64.Decode(Text(input, "text")))),
        ["imageInfo"] = input => ImageInfo.Of(Convert.FromHexString(Text(input, "hex"))) is { } info
            ? Object(("type", info.Type), ("width", info.Width), ("height", info.Height))
            : null,
        ["readTicketRequest"] = input =>
        {
            TicketReadInput read;
            try
            {
                read = TicketReadRequest.Read(BodyOf(input));
            }
            catch (AppError error)
            {
                return Object(("throws", error.Message));
            }
            var source = read.Source.Text is { } text
                ? Object(("kind", "texto"), ("text", text))
                : Object(("kind", "imagenes"), ("images", Array(read.Source.Images.Select(image => (JsonNode?)Object(
                        ("length", (long)image.Length), ("sha256", Convert.ToHexStringLower(SHA256.HashData(image))))))),
                    ("segments", read.Source.Segments is { } segments
                        ? Array(segments.Select(segment => (JsonNode?)Object(("imageIndex", segment.ImageIndex), ("segmentIndex", segment.SegmentIndex),
                            ("offsetY", segment.OffsetY), ("fullHeight", segment.FullHeight))))
                        : Omit));
            return Object(("source", source), ("today", read.Today));
        },
    };

    public static IReadOnlyCollection<string> Ported => Operations.Keys;

    public static JsonNode? Run(string operation, JsonElement input) =>
        Operations.TryGetValue(operation, out var run) ? run(input) : throw new InvalidOperationException($"Operación sin portar: {operation}");

    private static JsonElement BodyOf(JsonElement input)
    {
        if (TextOrNull(input, "bodyJson") is { } text)
            return JsonDocument.Parse(text, new JsonDocumentOptions { MaxDepth = 256 }).RootElement;
        return Get(input, "body");
    }
}
