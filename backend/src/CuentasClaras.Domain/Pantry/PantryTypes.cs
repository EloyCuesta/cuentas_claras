namespace CuentasClaras.Domain.Pantry;

/// <summary>Una persona de casa (shared/pantry/types.ts). Sus productos no se mezclan con los compartidos.</summary>
public sealed record PantryPerson(string Id, string Name, string CreatedAt);

/// <summary>
/// Lo que la web envía al crear o editar un producto (PantryItemInput); el resto lo pone el servidor. OwnerId null es
/// Compartido; Quantity y Target van en milésimas exactas (DECIMAL(10,3)); PriceCents null es «no se sabe» y 0, gratis.
/// </summary>
public sealed record PantryItemInput(
    string Name,
    string? OwnerId,
    string Unit,
    string Tracking,
    double Quantity,
    double Target,
    string Frequency,
    long? PriceCents,
    string Notes);

/// <summary>Un producto de la despensa, con la versión que sube en cada escritura y las fechas que pone el servidor.</summary>
public sealed record PantryItem(
    string Id,
    string Name,
    string? OwnerId,
    string Unit,
    string Tracking,
    double Quantity,
    double Target,
    string Frequency,
    long? PriceCents,
    string Notes,
    long Version,
    string CreatedAt,
    string UpdatedAt);
