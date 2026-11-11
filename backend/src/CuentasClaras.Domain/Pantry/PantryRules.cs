using CuentasClaras.Domain.Common;

namespace CuentasClaras.Domain.Pantry;

/// <summary>
/// Las reglas de la despensa que usa el servidor (shared/pantry/pantry.ts): unidades, frecuencias, cantidades en
/// milésimas enteras y el orden de personas y productos. Las comprueba el corpus fixtures/migration/rules-pantry.json.
/// </summary>
public static class PantryRules
{
    /// <summary>PANTRY_UNITS, en su orden (el de los mensajes).</summary>
    public static readonly IReadOnlyList<string> Units = ["ud", "g", "kg", "ml", "l", "paquete", "lata", "botella", "bolsa", "docena"];

    /// <summary>PANTRY_FREQUENCIES: también el orden de la lista de productos.</summary>
    public static readonly IReadOnlyList<string> Frequencies = ["semanal", "mensual", "ocasional"];

    /// <summary>Las unidades que admiten decimales; las demás se cuentan en números enteros.</summary>
    private static readonly HashSet<string> DecimalUnits = new(["g", "kg", "ml", "l"], StringComparer.Ordinal);

    public const int QuantityDecimals = 3;
    private const double Milli = 1000;
    /// <summary>Cantidad máxima de un producto (un millón de gramos, botellas…).</summary>
    public const double MaxQuantity = 1_000_000;
    /// <summary>Precio y presupuesto máximos de la despensa: 100.000,00 €.</summary>
    public const long MaxPantryCents = 10_000_000;
    public const int PantryNameMax = 80;
    public const int PersonNameMax = 40;
    public const int PantryNotesMax = 120;

    public static bool IsUnit(string value) => Units.Contains(value, StringComparer.Ordinal);

    public static bool IsFrequency(string value) => Frequencies.Contains(value, StringComparer.Ordinal);

    /// <summary>unitName: el singular de UNIT_NAMES, que en todas las unidades es la propia clave («ud», «paquete»…).</summary>
    public static string UnitName(string unit) => unit;

    /// <summary>toMilli: la cantidad en milésimas enteras, o null si es negativa, enorme o tiene más de 3 decimales.</summary>
    public static double? ToMilli(double value)
    {
        if (!double.IsFinite(value) || value < 0 || value > MaxQuantity) return null;
        var scaled = value * Milli;
        var rounded = JsNumber.Round(scaled);
        // Tolera los restos binarios (0,1 + 0,2), no un cuarto decimal de verdad.
        return Math.Abs(scaled - rounded) < 1e-6 ? rounded : null;
    }

    /// <summary>
    /// checkQuantity: la cantidad para esa unidad, normalizada (sin restos binarios) y sin redondear a escondidas.
    /// Lo que no es un número llega como NaN («Escribe una cantidad.»).
    /// </summary>
    public static ValidationResult<double> CheckQuantity(double value, string unit)
    {
        if (!double.IsFinite(value)) return ValidationResult<double>.Invalid("Escribe una cantidad.");
        if (value < 0) return ValidationResult<double>.Invalid("La cantidad no puede ser negativa.");
        if (value > MaxQuantity) return ValidationResult<double>.Invalid("La cantidad es demasiado grande.");
        if (ToMilli(value) is not { } milli) return ValidationResult<double>.Invalid($"Usa como máximo {QuantityDecimals} decimales.");
        if (!DecimalUnits.Contains(unit) && milli % Milli != 0)
            return ValidationResult<double>.Invalid($"En «{UnitName(unit)}» la cantidad tiene que ser un número entero.");
        return ValidationResult<double>.Valid(milli / Milli);
    }

    /// <summary>stepQuantity: la cantidad tras pulsar + (delta &gt; 0) o − (delta &lt; 0), en milésimas; restar nunca baja de cero.</summary>
    public static double StepQuantity(double quantity, double delta)
    {
        var current = ToMilli(quantity) ?? 0;
        var step = JsNumber.Round(delta * Milli);
        return Math.Max(0, current + step) / Milli;
    }

    /// <summary>Los tipos de revisión: «Queda», «Queda poco», «Se acabó» y «Lo he comprado».</summary>
    public static readonly IReadOnlyList<string> EventKinds = ["queda", "poco", "se_acabo", "comprado"];

    /// <summary>
    /// byName: por nombre sin mayúsculas ni tildes, después con ellas y, en empate, por id; con el comparador «es» de
    /// localeCompare. El id es un UUID del servidor: con «es» o con la colación por defecto de Node da el mismo orden.
    /// </summary>
    private static int ByName(string aName, string aId, string bName, string bId)
    {
        var order = JsCollator.CompareBase(aName, bName);
        if (order == 0) order = JsCollator.Compare(aName, bName);
        return order != 0 ? order : JsCollator.Compare(aId, bId);
    }

    /// <summary>sortPeople: por nombre (orden estable).</summary>
    public static IReadOnlyList<PantryPerson> SortPeople(IEnumerable<PantryPerson> people) =>
        [.. people.Order(Comparer<PantryPerson>.Create((a, b) => ByName(a.Name, a.Id, b.Name, b.Id)))];

    /// <summary>sortItems: por frecuencia (semanal, mensual, ocasional) y nombre.</summary>
    public static IReadOnlyList<PantryItem> SortItems(IEnumerable<PantryItem> items) =>
        [.. items.Order(Comparer<PantryItem>.Create((a, b) =>
        {
            var order = FrequencyIndex(a.Frequency) - FrequencyIndex(b.Frequency);
            return order != 0 ? Math.Sign(order) : ByName(a.Name, a.Id, b.Name, b.Id);
        }))];

    private static int FrequencyIndex(string frequency)
    {
        for (var i = 0; i < Frequencies.Count; i++)
            if (Frequencies[i] == frequency) return i;
        return -1;
    }
}
