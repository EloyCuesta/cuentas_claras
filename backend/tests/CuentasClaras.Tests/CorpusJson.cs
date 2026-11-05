using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace CuentasClaras.Tests;

/// <summary>
/// Leer las entradas del corpus de reglas y comparar lo que da C# con lo que guardó TypeScript.
/// La comparación es estricta: mismas claves (una propiedad que TypeScript omite no puede venir a
/// null), listas en el mismo orden, textos iguales unidad a unidad y números iguales como dobles.
/// </summary>
internal static class CorpusJson
{
    public static JsonDocument Load(string fileName)
    {
        var path = Path.Combine(AppContext.BaseDirectory, "Fixtures", fileName);
        return JsonDocument.Parse(File.ReadAllText(path), new JsonDocumentOptions { MaxDepth = 256 });
    }

    public static bool Has(JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out _);

    /// <summary>La propiedad, o un elemento Undefined si no está (o si no es un objeto), como undefined en JavaScript.</summary>
    public static JsonElement Get(JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value) ? value : default;

    /// <summary>Un texto del JSON, también con sustitutos sueltos («\ud800»), que GetString no admite.</summary>
    public static string Text(JsonElement element)
    {
        try
        {
            return element.GetString() ?? throw new InvalidOperationException("Se esperaba un texto.");
        }
        catch (InvalidOperationException) when (element.ValueKind == JsonValueKind.String)
        {
            return Unescape(element.GetRawText());
        }
    }

    public static string Text(JsonElement element, string name) => Text(Get(element, name));

    public static string? TextOrNull(JsonElement element, string name) =>
        Get(element, name) is { ValueKind: JsonValueKind.String } value ? Text(value) : null;

    public static long Long(JsonElement element, string name) => checked((long)Get(element, name).GetDouble());

    public static long? LongOrNull(JsonElement element, string name) =>
        Get(element, name) is { ValueKind: JsonValueKind.Number } value ? checked((long)value.GetDouble()) : null;

    public static double Double(JsonElement element, string name) => Get(element, name).GetDouble();

    public static double? DoubleOrNull(JsonElement element, string name) =>
        Get(element, name) is { ValueKind: JsonValueKind.Number } value ? value.GetDouble() : null;

    public static bool? BoolOrNull(JsonElement element, string name) =>
        Get(element, name) is { ValueKind: JsonValueKind.True or JsonValueKind.False } value ? value.GetBoolean() : null;

    public static IEnumerable<JsonElement> Items(JsonElement element, string name) =>
        Get(element, name) is { ValueKind: JsonValueKind.Array } value ? value.EnumerateArray() : [];

    public static JsonValue Number(double value) => JsonValue.Create(value);

    public static JsonValue Number(long value) => JsonValue.Create((double)value);

    public static JsonNode? Number(long? value) => value is { } number ? JsonValue.Create((double)number) : null;

    public static JsonNode? Number(double? value) => value is { } number ? JsonValue.Create(number) : null;

    public static JsonNode? String(string? value) => value is null ? null : JsonValue.Create(value);

    public static JsonArray Array(IEnumerable<JsonNode?> items) => new([.. items]);

    public static JsonArray Strings(IEnumerable<string> items) => Array(items.Select(String));

    /// <summary>Un objeto con sus propiedades en orden; las que vienen con <see cref="Omit"/> no se escriben (undefined en TypeScript).</summary>
    public static JsonObject Object(params (string Name, object? Value)[] properties)
    {
        var result = new JsonObject();
        foreach (var (name, value) in properties)
        {
            if (value is Omitted) continue;
            result[name] = value switch
            {
                null => null,
                JsonNode node => node,
                string text => JsonValue.Create(text),
                bool flag => JsonValue.Create(flag),
                int number => JsonValue.Create((double)number),
                long number => JsonValue.Create((double)number),
                double number => JsonValue.Create(number),
                _ => throw new InvalidOperationException($"Tipo sin JSON en el corpus: {value.GetType()}"),
            };
        }
        return result;
    }

    /// <summary>Una propiedad que TypeScript deja undefined y JSON.stringify no escribe.</summary>
    public static readonly object Omit = new Omitted();

    public static object OrOmit(object? value) => value ?? Omit;

    /// <summary>La primera diferencia entre lo esperado y lo obtenido, o null si son iguales.</summary>
    public static string? Difference(JsonElement expected, JsonNode? actual, string path = "$")
    {
        switch (expected.ValueKind)
        {
            case JsonValueKind.Null:
                return actual is null ? null : $"{path}: se esperaba null y C# da {Show(actual)}";
            case JsonValueKind.True:
            case JsonValueKind.False:
                return actual is JsonValue flag && flag.TryGetValue<bool>(out var value) && value == expected.GetBoolean()
                    ? null : $"{path}: se esperaba {expected.GetRawText()} y C# da {Show(actual)}";
            case JsonValueKind.Number:
                return actual is JsonValue number && number.TryGetValue<double>(out var got) && got == expected.GetDouble()
                    ? null : $"{path}: se esperaba {expected.GetRawText()} y C# da {Show(actual)}";
            case JsonValueKind.String:
                var text = Text(expected);
                return actual is JsonValue str && str.TryGetValue<string>(out var gotText) && string.Equals(gotText, text, StringComparison.Ordinal)
                    ? null : $"{path}: se esperaba {expected.GetRawText()} y C# da {Show(actual)}";
            case JsonValueKind.Array:
                if (actual is not JsonArray array) return $"{path}: se esperaba una lista y C# da {Show(actual)}";
                var expectedLength = expected.GetArrayLength();
                if (array.Count != expectedLength) return $"{path}: se esperaban {expectedLength} elementos y C# da {array.Count}: {Show(actual)}";
                var index = 0;
                foreach (var item in expected.EnumerateArray())
                {
                    if (Difference(item, array[index], $"{path}[{index}]") is { } difference) return difference;
                    index++;
                }
                return null;
            case JsonValueKind.Object:
                if (actual is not JsonObject obj) return $"{path}: se esperaba un objeto y C# da {Show(actual)}";
                var names = expected.EnumerateObject().Select(property => property.Name).ToHashSet(StringComparer.Ordinal);
                var extra = obj.Select(property => property.Key).Where(name => !names.Contains(name)).ToArray();
                if (extra.Length > 0) return $"{path}: C# da propiedades que TypeScript no tiene: {string.Join(", ", extra)}";
                foreach (var property in expected.EnumerateObject())
                {
                    if (!obj.ContainsKey(property.Name)) return $"{path}: falta la propiedad «{property.Name}»";
                    if (Difference(property.Value, obj[property.Name], $"{path}.{property.Name}") is { } difference) return difference;
                }
                return null;
            default:
                return $"{path}: valor JSON no comparable ({expected.ValueKind})";
        }
    }

    private static string Show(JsonNode? node)
    {
        if (node is null) return "null";
        try
        {
            var text = node.ToJsonString(new JsonSerializerOptions { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping });
            return text.Length > 600 ? text[..600] + "…" : text;
        }
        catch (Exception error) when (error is InvalidOperationException or ArgumentException)
        {
            return "(texto con sustitutos sueltos)";
        }
    }

    /// <summary>Decodifica el texto JSON de una cadena (con comillas) como JSON.parse.</summary>
    private static string Unescape(string raw)
    {
        var result = new StringBuilder(raw.Length);
        for (var index = 1; index < raw.Length - 1; index++)
        {
            var unit = raw[index];
            if (unit != '\\')
            {
                result.Append(unit);
                continue;
            }
            var escaped = raw[++index];
            switch (escaped)
            {
                case 'b': result.Append('\b'); break;
                case 'f': result.Append('\f'); break;
                case 'n': result.Append('\n'); break;
                case 'r': result.Append('\r'); break;
                case 't': result.Append('\t'); break;
                case 'u':
                    result.Append((char)int.Parse(raw.AsSpan(index + 1, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture));
                    index += 4;
                    break;
                default: result.Append(escaped); break;
            }
        }
        return result.ToString();
    }

    private sealed class Omitted;
}
