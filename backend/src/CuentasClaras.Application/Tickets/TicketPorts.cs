using CuentasClaras.Domain.Tickets;

namespace CuentasClaras.Application.Tickets;

/// <summary>Dónde va cada franja de una imagen larga (TicketSegment sin la imagen): ya validadas por TicketReadRequest.</summary>
public sealed record TicketSegmentInput(int ImageIndex, int SegmentIndex, int OffsetY, int FullHeight);

/// <summary>
/// Lee el texto de las imágenes de un ticket en este mismo equipo (TicketReader de server/modules/tickets/application/ports.ts):
/// una lista de líneas por imagen (o franja), en orden. Las imágenes ya vienen validadas (PNG o JPEG). Si no puede leerlas,
/// lanza una excepción y explica la causa en la consola; ReadTicket la convierte en el 400 de siempre.
/// </summary>
public interface ITicketReader
{
    Task<IReadOnlyList<IReadOnlyList<OcrLine>>> Read(IReadOnlyList<byte[]> images, IReadOnlyList<TicketSegmentInput>? segments,
        CancellationToken cancellationToken = default);
}

/// <summary>SHA-256 en hexadecimal de las partes, una detrás de otra (los textos, en UTF-8 como hash.update de Node).</summary>
public interface IHasher
{
    string Sha256Hex(IReadOnlyList<FingerprintPart> parts);
}

/// <summary>
/// Tickets guardados y lo aprendido en cada tienda (TicketRepository de Express). Solo SQL y conversión de filas; qué es
/// un duplicado está en TicketDuplicates. TIC-02 usa las lecturas; guardar, cambiar y borrar llegan con TIC-03 y TIC-04.
/// </summary>
public interface ITicketStore
{
    /// <summary>Lo aprendido en una tienda (AliasStoreOf): nombre normalizado → producto, o null si no se sigue; por nombre.</summary>
    Task<IReadOnlyList<AliasRecord>> Aliases(string aliasStore);

    /// <summary>El ticket guardado desde esa misma lectura (importId) o desde el mismo origen (huella del texto o las imágenes).</summary>
    Task<TicketSummaryView?> FindByImport(string importId, string sourceFingerprint);

    Task<TicketSummaryView?> FindByFingerprint(string fingerprint);

    /// <summary>Tickets de esa fecha y ese total (el total puede ser null), en orden de id.</summary>
    Task<IReadOnlyList<TicketSummaryView>> Candidates(string date, long? totalCents);

    /// <summary>Con sus líneas en orden, sus ajustes y sus avisos.</summary>
    Task<TicketView?> GetTicket(string id);
}
