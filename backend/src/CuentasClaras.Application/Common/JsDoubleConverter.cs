using System.Text.Json;
using System.Text.Json.Serialization;
using CuentasClaras.Domain.Common;

namespace CuentasClaras.Application.Common;

/// <summary>
/// Los double de las respuestas como los escribe JSON.stringify: el decimal más corto que vuelve al mismo número
/// (0.8, no 0.80), -0 como 0 y NaN o ±Infinity como null. Las cantidades en milésimas, los pesos y el orden de las
/// categorías viajan así; los céntimos y demás enteros son long y no pasan por aquí.
/// </summary>
public sealed class JsDoubleConverter : JsonConverter<double>
{
    public override double Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) => reader.GetDouble();

    public override void Write(Utf8JsonWriter writer, double value, JsonSerializerOptions options)
    {
        if (!double.IsFinite(value))
        {
            writer.WriteNullValue();
            return;
        }
        writer.WriteRawValue(JsNumber.ToString(value), skipInputValidation: true);
    }
}
