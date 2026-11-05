namespace CuentasClaras.Domain.Tickets;

/// <summary>
/// Lo que las reglas de tickets necesitan de la despensa, con sus mismos valores (shared/pantry/types.ts
/// y shared/pantry/pantry.ts). Domain.Tickets no puede usar Domain.Pantry (ArchitectureTests), y la
/// despensa en C# es de PAN-01: cuando exista, sus valores tienen que coincidir con estos
/// (docs/decisiones.md, «Tickets sin Domain.Pantry»). El corpus de tickets ya fija los límites.
/// </summary>
public static class TicketVocabulary
{
    /// <summary>MAX_PANTRY_CENTS: el precio y el presupuesto máximos de la despensa.</summary>
    public const long MaxPantryCents = 10_000_000;

    /// <summary>PANTRY_NAME_MAX: la longitud máxima del nombre de un producto.</summary>
    public const int PantryNameMax = 80;

    public const string Weekly = "semanal";
    public const string Monthly = "mensual";
    public const string Occasional = "ocasional";

    /// <summary>PANTRY_FREQUENCIES, en su orden.</summary>
    public static IReadOnlyList<string> Frequencies { get; } = [Weekly, Monthly, Occasional];

    /// <summary>isPantryFrequency.</summary>
    public static bool IsFrequency(string? value) => value is not null && Frequencies.Contains(value, StringComparer.Ordinal);

    /// <summary>Las unidades que usan las reglas de compra (PantryUnit).</summary>
    public const string Kilos = "kg";
    public const string Grams = "g";
    public const string Units = "ud";
}
