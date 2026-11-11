using System.Text.Json;
using CuentasClaras.Application.Common;
using CuentasClaras.Domain.Common;
using CuentasClaras.Domain.Pantry;
using static CuentasClaras.Application.Common.JsonInput;

namespace CuentasClaras.Application.Pantry;

/// <summary>Una edición: los campos del producto y la versión con que se abrió el formulario.</summary>
public sealed record PantryItemUpdate(PantryItemInput Input, long ExpectedVersion);

/// <summary>«Marcar todo como comprado»: los productos, sin repetidos y en el orden en que llegaron, y la fecha de hoy del navegador.</summary>
public sealed record PantryPurchaseInput(IReadOnlyList<string> Ids, string? Date);

/// <summary>
/// Validación de lo que llega a la API de la despensa (shared/pantry/pantryValidation.ts): mismos campos, orden de
/// comprobaciones y mensajes. Recibe el cuerpo sin tipar, como lo ve TypeScript después de JSON.parse.
/// </summary>
public static class PantryRequests
{
    private sealed class InputError(string message) : Exception(message);

    /// <summary>validatePersonInput: { name }.</summary>
    public static ValidationResult<string> ValidatePerson(JsonElement raw) =>
        Attempt(() => ReadName(Get(ReadObject(raw), "name"), "La persona", PantryRules.PersonNameMax));

    /// <summary>validateItemInput: lo que envía la interfaz al crear o editar un producto.</summary>
    public static ValidationResult<PantryItemInput> ValidateItemInput(JsonElement raw) => Attempt(() => ReadItem(raw));

    /// <summary>validateItemUpdate: lo mismo y, después, expectedVersion, la versión del producto que se abrió.</summary>
    public static ValidationResult<PantryItemUpdate> ValidateItemUpdate(JsonElement raw) => Attempt(() =>
    {
        var input = ReadItem(raw);
        var version = Get(raw, "expectedVersion");
        if (!IsNumber(version) || !JsNumber.IsSafeInteger(Number(version)) || Number(version) < 1)
            throw new InputError("El campo «expectedVersion» debe ser la versión del producto (un número entero mayor que 0).");
        return new PantryItemUpdate(input, (long)Number(version));
    });

    /// <summary>Cuántos productos se compran o se deshacen a la vez, como máximo (MAX_IDS).</summary>
    private const int MaxIds = 1000;

    /// <summary>validateDeltaInput: { delta }, lo que suma (positivo) o resta (negativo) un botón + o −.</summary>
    public static ValidationResult<double> ValidateDelta(JsonElement raw) => Attempt(() =>
    {
        var delta = Get(ReadObject(raw), "delta");
        var number = IsNumber(delta) ? Number(delta) : double.NaN;
        if (!double.IsFinite(number) || number == 0 || Math.Abs(number) > 1_000_000)
            throw new InputError("El campo «delta» debe ser un número distinto de 0.");
        return number;
    });

    /// <summary>validatePurchaseInput: { ids, date? }: una lista no vacía de ids (sin repetidos) y la fecha de la compra.</summary>
    public static ValidationResult<PantryPurchaseInput> ValidatePurchase(JsonElement raw) => Attempt(() =>
    {
        var body = ReadObject(raw);
        var ids = Get(body, "ids");
        if (!IsArray(ids) || ids.GetArrayLength() == 0) throw new InputError("Indica al menos un producto en «ids».");
        if (ids.GetArrayLength() > MaxIds) throw new InputError($"Se pueden indicar como máximo {MaxIds} productos a la vez.");
        if (!ids.EnumerateArray().All(id => IsString(id) && Text(id).Length is > 0 and <= 200))
            throw new InputError("Cada elemento de «ids» debe ser un id.");
        // [...new Set(ids)]: el orden de la primera aparición.
        return new PantryPurchaseInput([.. ids.EnumerateArray().Select(id => Text(id)).Distinct(StringComparer.Ordinal)],
            ReadOptionalDate(Get(body, "date"), "date"));
    });

    /// <summary>validateUndoInput: { changes }, lo que devolvió la compra, para deshacerla.</summary>
    public static ValidationResult<IReadOnlyList<PantryPurchaseChange>> ValidateUndo(JsonElement raw) => Attempt(() =>
    {
        var changes = Get(ReadObject(raw), "changes");
        if (!IsArray(changes) || changes.GetArrayLength() == 0) throw new InputError("Indica los cambios que hay que deshacer en «changes».");
        if (changes.GetArrayLength() > MaxIds) throw new InputError($"Se pueden deshacer como máximo {MaxIds} productos a la vez.");
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var result = new List<PantryPurchaseChange>();
        foreach (var change in changes.EnumerateArray())
        {
            if (!IsObject(change)) throw new InputError("Cada cambio debe tener «id» y «previousQuantity» y «version», o «eventId».");
            var id = Get(change, "id");
            if (!IsString(id) || Text(id).Length == 0 || !seen.Add(Text(id))) throw new InputError("Cada cambio debe tener un «id» distinto.");
            var eventId = Get(change, "eventId");
            if (!IsUndefined(eventId))
            {
                if (!IsString(eventId) || Text(eventId).Length == 0 || Text(eventId).Length > 200) throw new InputError("El campo «eventId» no es válido.");
                result.Add(new EventChange(Text(id), Text(eventId)));
                continue;
            }
            var previous = Get(change, "previousQuantity");
            var previousQuantity = IsNumber(previous) ? Number(previous) : double.NaN;
            if (!double.IsFinite(previousQuantity) || previousQuantity < 0) throw new InputError("El campo «previousQuantity» debe ser una cantidad válida.");
            var version = Get(change, "version");
            if (!IsNumber(version) || !JsNumber.IsSafeInteger(Number(version)) || Number(version) < 1) throw new InputError("El campo «version» no es válido.");
            result.Add(new QuantityChange(Text(id), previousQuantity, (long)Number(version)));
        }
        return (IReadOnlyList<PantryPurchaseChange>)result;
    });

    /// <summary>readOptionalDate: undefined o null dan null; si no, una fecha AAAA-MM-DD real.</summary>
    private static string? ReadOptionalDate(JsonElement value, string field)
    {
        if (IsNullish(value)) return null;
        if (!IsString(value) || !IsoDates.IsValid(Text(value))) throw new InputError($"El campo «{field}» debe ser una fecha AAAA-MM-DD.");
        return Text(value);
    }

    /// <summary>valid() de los routers: el valor, o un 400 con el mensaje del validador.</summary>
    public static T Valid<T>(ValidationResult<T> result) =>
        result.Ok ? result.Value! : throw new AppError("VALIDATION", result.Error!);

    private static ValidationResult<T> Attempt<T>(Func<T> read)
    {
        try
        {
            return ValidationResult<T>.Valid(read());
        }
        catch (InputError error)
        {
            return ValidationResult<T>.Invalid(error.Message);
        }
    }

    private static JsonElement ReadObject(JsonElement raw) =>
        IsObject(raw) ? raw : throw new InputError("Falta el cuerpo de la petición en JSON.");

    private static string ReadName(JsonElement value, string label, int max)
    {
        if (!IsString(value)) throw new InputError($"{label}: falta el nombre.");
        var name = JsText.Trim(Text(value));
        if (name.Length == 0) throw new InputError($"{label}: el nombre está vacío.");
        if (name.Length > max) throw new InputError($"{label}: el nombre puede tener como máximo {max} caracteres.");
        return name;
    }

    private static long? ReadCents(JsonElement value, string field)
    {
        if (IsNullish(value)) return null;
        var number = IsNumber(value) ? Number(value) : double.NaN;
        // Number.isInteger: finito y sin decimales.
        if (!double.IsFinite(number) || Math.Floor(number) != number || number < 0 || number > PantryRules.MaxPantryCents)
            throw new InputError($"El campo «{field}» debe ser un número entero de céntimos entre 0 y {JsNumber.ToString(PantryRules.MaxPantryCents)}, o null.");
        return (long)number;
    }

    /// <summary>Un campo que tiene que ser uno de esos textos (PANTRY_UNITS.includes: el mismo texto, sin convertir).</summary>
    private static string ReadOneOf(JsonElement value, IReadOnlyList<string> allowed, string field)
    {
        if (IsString(value) && allowed.Contains(Text(value), StringComparer.Ordinal)) return Text(value);
        throw new InputError($"El campo «{field}» debe ser {string.Join(", ", allowed.Select(option => $"«{option}»"))}.");
    }

    private static double ReadQuantity(JsonElement value, string unit, string label)
    {
        var checkedQuantity = PantryRules.CheckQuantity(IsNumber(value) ? Number(value) : double.NaN, unit);
        return checkedQuantity.Ok ? checkedQuantity.Value : throw new InputError($"{label}: {checkedQuantity.Error}");
    }

    private static PantryItemInput ReadItem(JsonElement raw)
    {
        var body = ReadObject(raw);
        var name = ReadName(Get(body, "name"), "El producto", PantryRules.PantryNameMax);

        var ownerId = Get(body, "ownerId");
        if (!IsNullish(ownerId) && (!IsString(ownerId) || Text(ownerId).Length == 0))
            throw new InputError("El campo «ownerId» debe ser el id de una persona o null (Compartido).");

        var unit = ReadOneOf(Get(body, "unit"), PantryRules.Units, "unit");
        var frequency = ReadOneOf(Get(body, "frequency"), PantryRules.Frequencies, "frequency");
        var quantity = ReadQuantity(Get(body, "quantity"), unit, "Cantidad actual");
        var target = ReadQuantity(Get(body, "target"), unit, "Objetivo");

        // body.tracking ?? 'cantidad'
        var trackingValue = Get(body, "tracking");
        var tracking = IsNullish(trackingValue) ? "cantidad" : IsString(trackingValue) ? Text(trackingValue) : null;
        if (tracking is not ("cantidad" or "compras")) throw new InputError("El campo «tracking» debe ser «compras» o «cantidad».");

        // body.notes ?? ''
        var notesValue = Get(body, "notes");
        if (!IsNullish(notesValue) && !IsString(notesValue)) throw new InputError("El campo «notes» debe ser texto.");
        var notes = IsNullish(notesValue) ? "" : JsText.Trim(Text(notesValue));
        if (notes.Length > PantryRules.PantryNotesMax)
            throw new InputError($"Las notas pueden tener como máximo {PantryRules.PantryNotesMax} caracteres.");

        return new PantryItemInput(name, IsNullish(ownerId) ? null : Text(ownerId), unit, tracking, quantity, target, frequency,
            ReadCents(Get(body, "priceCents"), "priceCents"), notes);
    }
}
