using System.Text.Json;
using CuentasClaras.Application.Common;
using CuentasClaras.Domain.Common;
using CuentasClaras.Domain.Finance;
using static CuentasClaras.Application.Common.JsonInput;

namespace CuentasClaras.Application.Finance;

/// <summary>
/// Validación de lo que llega a la API de finanzas con las reglas de una copia de seguridad (shared/finance/backup.ts):
/// mismos campos, límites, orden de comprobaciones y mensajes. Cada lectura devuelve el registro limpio, solo con los
/// campos conocidos, o el primer problema. Recibe el cuerpo sin tipar, como lo ve TypeScript después de JSON.parse.
/// </summary>
public static class FinanceRequests
{
    /// <summary>MAX_CENTS de shared/common/money.ts.</summary>
    public const long MaxCents = 99_999_999_999;

    /// <summary>MAX_OCCURRENCES de shared/finance/recurring.ts: 100 años de cuotas mensuales.</summary>
    public const int MaxOccurrences = 1200;

    private static readonly string[] Types = ["ingreso", "gasto"];
    private static readonly string[] Statuses = ["pendiente", "realizado"];
    /// <summary>Object.keys(FREQUENCY_MONTHS), en su orden.</summary>
    private static readonly string[] Frequencies = ["mensual", "trimestral", "semestral", "anual"];

    private sealed class BackupError(string message) : Exception(message);

    public static ValidationResult<Category> ValidateCategory(JsonElement raw) => Attempt(() => ReadCategory(raw, "La categoría"));

    public static ValidationResult<Movement> ValidateMovement(JsonElement raw) => Attempt(() => ReadMovement(raw, "El movimiento"));

    public static ValidationResult<RecurringRule> ValidateRecurring(JsonElement raw) => Attempt(() => ReadRecurring(raw, "El recurrente"));

    /// <summary>Todos los datos de la aplicación: cada registro y las referencias entre ellos.</summary>
    public static ValidationResult<FinanceData> ValidateFinanceData(JsonElement raw) => Attempt(() =>
    {
        if (!IsObject(raw)) throw new BackupError("No se han recibido los datos.");
        return ReadFinanceData(raw);
    });

    /// <summary>valid() de los routers: el valor, o un 400 con el mensaje del validador.</summary>
    public static T Valid<T>(ValidationResult<T> result) =>
        result.Ok ? result.Value! : throw new AppError("VALIDATION", result.Error!);

    /// <summary>sameId: el id de la URL y el del cuerpo deben coincidir.</summary>
    public static void SameId(string bodyId, string urlId)
    {
        if (!string.Equals(bodyId, urlId, StringComparison.Ordinal))
            throw new AppError("VALIDATION", "El id de la dirección no coincide con el de los datos.");
    }

    /// <summary>readBody: un objeto JSON, o 400.</summary>
    public static JsonElement ReadBody(JsonElement body) =>
        IsObject(body) ? body : throw new AppError("VALIDATION", "Falta el cuerpo de la petición en JSON.");

    /// <summary>readDate de los routers: una fecha AAAA-MM-DD real, o 400 con el nombre del campo.</summary>
    public static string ReadDate(JsonElement value, string field) =>
        IsString(value) && IsoDates.IsValid(Text(value)) ? Text(value)
            : throw new AppError("VALIDATION", $"El campo «{field}» debe ser una fecha AAAA-MM-DD.");

    /// <summary>readOptionalDate: null o undefined dan null.</summary>
    public static string? ReadOptionalDate(JsonElement value, string field) => IsNullish(value) ? null : ReadDate(value, field);

    private static ValidationResult<T> Attempt<T>(Func<T> read)
    {
        try
        {
            return ValidationResult<T>.Valid(read());
        }
        catch (BackupError error)
        {
            return ValidationResult<T>.Invalid(error.Message);
        }
    }

    private static Category ReadCategory(JsonElement raw, string label)
    {
        var r = new FieldReader(raw, label);
        return new Category(
            r.String("id", 100),
            r.String("name", 200),
            r.OneOf("type", Types),
            r.NullableString("parentId", 100),
            r.Number("order"),
            r.NullableInteger("budgetCents", 0, MaxCents));
    }

    private static Movement ReadMovement(JsonElement raw, string label)
    {
        var r = new FieldReader(raw, label);
        var movement = new Movement(
            r.String("id", 100),
            r.String("concept", 500),
            r.Integer("amountCents", 1, MaxCents),
            r.OneOf("type", Types),
            r.String("categoryId", 100),
            r.OneOf("status", Statuses),
            r.NullableDate("paidDate"),
            r.NullableDate("dueDate"),
            r.String("notes", 5000, allowEmpty: true),
            r.NullableString("recurringId", 100),
            r.NullableDate("occurrenceDate"),
            (int?)r.NullableInteger("installmentNumber", 1, MaxOccurrences),
            r.String("createdAt", 40),
            r.String("updatedAt", 40));
        if (movement.Status == "realizado" && movement.PaidDate is null) throw r.Fail("está realizado pero no tiene fecha de pago o cobro.");
        if (movement.Status == "pendiente" && movement.DueDate is null) throw r.Fail("está pendiente pero no tiene fecha prevista.");
        return movement;
    }

    private static RecurringRule ReadRecurring(JsonElement raw, string label)
    {
        var r = new FieldReader(raw, label);
        var rule = new RecurringRule(
            r.String("id", 100),
            r.String("concept", 500),
            r.Integer("amountCents", 1, MaxCents),
            r.OneOf("type", Types),
            r.String("categoryId", 100),
            r.OneOf("frequency", Frequencies),
            r.Date("startDate"),
            r.NullableDate("endDate"),
            (int?)r.NullableInteger("installments", 1, MaxOccurrences),
            r.String("notes", 5000, allowEmpty: true),
            r.DateList("excludedDates"),
            r.String("createdAt", 40),
            r.String("updatedAt", 40));
        if (rule.EndDate is { } end && string.CompareOrdinal(end, rule.StartDate) < 0) throw r.Fail("la fecha de fin es anterior a la de inicio.");
        return rule;
    }

    private static FinanceData ReadFinanceData(JsonElement raw)
    {
        var data = new FinanceData(
            ReadList(raw, "categories", "categorías", "Categoría", ReadCategory),
            ReadList(raw, "movements", "movimientos", "Movimiento", ReadMovement),
            ReadList(raw, "recurring", "recurrentes", "Recurrente", ReadRecurring));
        AssertIntegrity(data);
        return data;
    }

    private static IReadOnlyList<T> ReadList<T>(JsonElement container, string key, string label, string itemLabel, Func<JsonElement, string, T> read)
    {
        var value = Get(container, key);
        if (!IsArray(value)) throw new BackupError($"La copia no contiene la lista de {label}.");
        var items = new List<T>();
        var index = 0;
        foreach (var item in value.EnumerateArray()) items.Add(read(item, $"{itemLabel} nº {JsNumber.ToString(++index)}"));
        return items;
    }

    private static void AssertUniqueIds(IEnumerable<string> ids, string label)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var id in ids)
            if (!seen.Add(id)) throw new BackupError($"Hay {label} con el id repetido «{id}».");
    }

    /// <summary>Que las referencias entre registros sean coherentes.</summary>
    private static void AssertIntegrity(FinanceData data)
    {
        AssertUniqueIds(data.Categories.Select(category => category.Id), "categorías");
        AssertUniqueIds(data.Movements.Select(movement => movement.Id), "movimientos");
        AssertUniqueIds(data.Recurring.Select(rule => rule.Id), "recurrentes");

        var categories = data.Categories.ToDictionary(category => category.Id, StringComparer.Ordinal);
        foreach (var category in data.Categories)
        {
            if (category.ParentId is null) continue;
            if (!categories.TryGetValue(category.ParentId, out var parent) || parent.ParentId is not null || parent.Type != category.Type)
                throw new BackupError($"La subcategoría «{category.Name}» apunta a una categoría principal que no existe.");
        }
        void CheckCategory(string categoryId, string type, string label)
        {
            if (!categories.TryGetValue(categoryId, out var category) || category.Type != type)
                throw new BackupError($"{label} usa una categoría que no existe.");
        }
        for (var i = 0; i < data.Movements.Count; i++)
        {
            var movement = data.Movements[i];
            CheckCategory(movement.CategoryId, movement.Type, $"El movimiento nº {JsNumber.ToString(i + 1)} («{movement.Concept}»)");
        }
        for (var i = 0; i < data.Recurring.Count; i++)
        {
            var rule = data.Recurring[i];
            CheckCategory(rule.CategoryId, rule.Type, $"El recurrente nº {JsNumber.ToString(i + 1)} («{rule.Concept}»)");
        }

        var occurrences = new HashSet<string>(StringComparer.Ordinal);
        foreach (var movement in data.Movements)
        {
            if (movement.RecurringId is null || movement.OccurrenceDate is null) continue;
            if (!occurrences.Add($"{movement.RecurringId}|{movement.OccurrenceDate}"))
                throw new BackupError($"El vencimiento del {movement.OccurrenceDate} de «{movement.Concept}» está duplicado.");
        }
    }

    /// <summary>Lee campos de un registro y lanza un error legible si no son válidos (FieldReader de backup.ts).</summary>
    private sealed class FieldReader
    {
        private readonly JsonElement raw;
        private readonly string label;

        public FieldReader(JsonElement raw, string label)
        {
            if (!IsObject(raw)) throw new BackupError($"{label} no tiene un formato válido.");
            this.raw = raw;
            this.label = label;
        }

        public Exception Fail(string message) => new BackupError($"{label}: {message}");

        public string String(string key, int max, bool allowEmpty = false)
        {
            var value = Get(raw, key);
            if (!IsString(value)) throw Fail($"falta el campo «{key}» o no es texto.");
            var text = Text(value);
            if (!allowEmpty && JsText.Trim(text).Length == 0) throw Fail($"el campo «{key}» está vacío.");
            if (text.Length > max) throw Fail($"el campo «{key}» es demasiado largo.");
            return text;
        }

        public string? NullableString(string key, int max) => IsNullish(Get(raw, key)) ? null : String(key, max);

        public string OneOf(string key, string[] allowed)
        {
            var value = Get(raw, key);
            if (!IsString(value) || !allowed.Contains(Text(value), StringComparer.Ordinal))
                throw Fail($"el campo «{key}» debe ser {string.Join(" o ", allowed.Select(option => $"«{option}»"))}.");
            return Text(value);
        }

        public string Date(string key)
        {
            var value = Get(raw, key);
            if (!IsString(value) || !IsoDates.IsValid(Text(value))) throw Fail($"el campo «{key}» no es una fecha válida (AAAA-MM-DD).");
            return Text(value);
        }

        public string? NullableDate(string key) => IsNullish(Get(raw, key)) ? null : Date(key);

        public long Integer(string key, long min, long max)
        {
            var value = Get(raw, key);
            var number = IsNumber(value) ? JsonInput.Number(value) : double.NaN;
            // Number.isInteger: finito y sin decimales (-0 es 0).
            if (!IsNumber(value) || !double.IsFinite(number) || Math.Floor(number) != number || number < min || number > max)
                throw Fail($"el campo «{key}» debe ser un número entero entre {JsNumber.ToString(min)} y {JsNumber.ToString(max)}.");
            return (long)number;
        }

        public long? NullableInteger(string key, long min, long max) => IsNullish(Get(raw, key)) ? null : Integer(key, min, max);

        public double Number(string key)
        {
            var value = Get(raw, key);
            if (!IsNumber(value) || !double.IsFinite(JsonInput.Number(value))) throw Fail($"el campo «{key}» debe ser un número.");
            return JsonInput.Number(value);
        }

        /// <summary>raw[key] ?? []: una lista de fechas válidas.</summary>
        public IReadOnlyList<string> DateList(string key)
        {
            var value = Get(raw, key);
            if (IsNullish(value)) return [];
            if (!IsArray(value) || !value.EnumerateArray().All(item => IsString(item) && IsoDates.IsValid(Text(item))))
                throw Fail($"el campo «{key}» debe ser una lista de fechas.");
            return [.. value.EnumerateArray().Select(item => Text(item))];
        }
    }
}
