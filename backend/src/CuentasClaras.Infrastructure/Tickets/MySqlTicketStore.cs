using System.Globalization;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;
using CuentasClaras.Application.Common;
using CuentasClaras.Application.Tickets;
using CuentasClaras.Domain.Common;
using CuentasClaras.Domain.Tickets;
using CuentasClaras.Infrastructure.Common.MySql;
using MySqlConnector;

namespace CuentasClaras.Infrastructure.Tickets;

/// <summary>
/// Tickets de la compra en MySQL (pantry_tickets, pantry_ticket_lines y pantry_aliases), con el SQL de
/// server/modules/tickets/adapters/mysql/MysqlTicketRepository.ts. Solo SQL y conversión de filas. Ajustes, avisos y
/// evidencia se guardan como el JSON tal cual y se devuelven igual. Las consultas de varios tickets, o de la primera de
/// varias, llevan un ORDER BY completo (al final, por id).
/// </summary>
public sealed class MySqlTicketStore(MySqlDatabase database) : ITicketStore
{
    private const string TicketColumns =
        "t.id, t.store, t.store_name, t.address, t.purchase_date, t.purchase_time, t.total_cents, t.created_at, t.adjustments_json, t.issues_json";
    private const string LineColumns =
        "id, ticket_id, position, raw_name, name_key, quantity, unit_price_cents, amount_cents, discount_cents, weight_kg, price_per_kg_cents, tax_code, item_id, occasional, review_status, confirmed, evidence_json";

    /// <summary>
    /// Resumen de un ticket: cuántas líneas tiene y cuántos productos distintos de la despensa (solo líneas verificadas).
    /// Agrupar por la clave primaria deja elegir el resto de columnas de t aunque el modo sea ONLY_FULL_GROUP_BY.
    /// </summary>
    private const string Summary =
        $"SELECT {TicketColumns}, COUNT(l.id) AS lines_count, "
        + "COUNT(DISTINCT CASE WHEN l.review_status = 'verified' AND l.amount_cents >= 0 THEN l.item_id END) AS products_count "
        + "FROM pantry_tickets t LEFT JOIN pantry_ticket_lines l ON l.ticket_id = t.id";

    private const string InsertTicketSql =
        "INSERT INTO pantry_tickets (id, store, store_name, address, purchase_date, purchase_time, total_cents, fingerprint, created_at, adjustments_json, "
        + "issues_json, import_id, source_fingerprint) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
    private const string InsertLineSql = $"INSERT INTO pantry_ticket_lines ({LineColumns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
    // La clave de pantry_aliases es (store, name_key) y no tiene otra única: ON DUPLICATE KEY UPDATE no puede pisar otra fila.
    private const string UpsertAliasSql =
        "INSERT INTO pantry_aliases (store, name_key, item_id, ignored, updated_at) VALUES (?, ?, ?, ?, ?) AS new "
        + "ON DUPLICATE KEY UPDATE item_id = new.item_id, ignored = new.ignored, updated_at = new.updated_at";

    /// <summary>JSON.stringify: camelCase, los números como JavaScript y sin escapar las letras con tilde.</summary>
    private static readonly JsonSerializerOptions StoredJson = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        Converters = { new JsDoubleConverter() },
    };

    /// <summary>La evidencia tal como la deja validateTicketSave (sin el origen de la imagen), en su orden.</summary>
    private sealed record StoredEvidence(
        string Text, string? Reread, long? RecognizedCents, long? CalculatedCents, string SelectedBy, IReadOnlyList<string> Issues,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Normalized,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] TicketDiscrepancyView? Discrepancy,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyList<TicketAmountOptionView>? Options);

    private static string EvidenceJson(Domain.Tickets.TicketEvidence evidence) => JsonSerializer.Serialize(new StoredEvidence(
        evidence.Text, evidence.Reread, evidence.RecognizedCents, evidence.CalculatedCents, evidence.SelectedBy, evidence.Issues, evidence.Normalized,
        evidence.Discrepancy is { } discrepancy
            ? new TicketDiscrepancyView(discrepancy.Kind, discrepancy.Verdict, discrepancy.RecognizedCents, discrepancy.CalculatedCents,
                discrepancy.Explanation, discrepancy.Reasons)
            : null,
        evidence.Options?.Select(option => new TicketAmountOptionView(option.Cents, option.Origin)).ToList()), StoredJson);

    /// <summary>Un peso para DECIMAL(7,3): el texto que escribiría JavaScript, como decimal exacto.</summary>
    private static decimal? Exact(double? value) =>
        value is { } number ? decimal.Parse(JsNumber.ToString(number), NumberStyles.Float, CultureInfo.InvariantCulture) : null;

    private static TicketSummaryView ToSummary(MySqlDataReader row) => new(
        MySqlRead.Text(row, "id"), MySqlRead.Text(row, "store"), MySqlRead.Text(row, "store_name"), MySqlRead.Text(row, "address"),
        MySqlRead.Date(row, "purchase_date"), MySqlRead.NullableText(row, "purchase_time"), MySqlRead.NullableInteger(row, "total_cents"),
        MySqlRead.Integer(row, "lines_count"), MySqlRead.Integer(row, "products_count"), MySqlRead.Text(row, "created_at"));

    /// <summary>El JSON guardado (JSON.parse al leer, como Express).</summary>
    private static JsonElement Json(string text)
    {
        using var document = JsonDocument.Parse(text);
        return document.RootElement.Clone();
    }

    /// <summary>Un DECIMAL como número de JavaScript: el doble más cercano a su texto (parseFloat, como mysql2 con decimalNumbers).</summary>
    private static double? Number(MySqlDataReader row, string column) => MySqlRead.NullableDecimal(row, column) is { } value
        ? double.Parse(value.ToString(CultureInfo.InvariantCulture), NumberStyles.Float, CultureInfo.InvariantCulture)
        : null;

    private static TicketLineView ToLine(MySqlDataReader row) => new(
        MySqlRead.Text(row, "id"), (int)MySqlRead.Integer(row, "position"), MySqlRead.Text(row, "raw_name"), MySqlRead.Integer(row, "quantity"),
        MySqlRead.NullableInteger(row, "unit_price_cents"), MySqlRead.NullableInteger(row, "amount_cents"), MySqlRead.Integer(row, "discount_cents"),
        Number(row, "weight_kg"), MySqlRead.NullableInteger(row, "price_per_kg_cents"), MySqlRead.NullableText(row, "tax_code"),
        MySqlRead.NullableText(row, "item_id"), MySqlRead.Integer(row, "occasional") == 1, MySqlRead.Text(row, "review_status"),
        MySqlRead.Integer(row, "confirmed") == 1,
        MySqlRead.NullableText(row, "evidence_json") is { Length: > 0 } evidence ? Json(evidence) : null);

    private async Task<TicketSummaryView?> FirstSummary(string where, IReadOnlyList<object?> parameters) =>
        (await database.Rows($"{Summary} WHERE {where} GROUP BY t.id ORDER BY t.id LIMIT 1", parameters, ToSummary)).FirstOrDefault();

    public async Task<IReadOnlyList<AliasRecord>> Aliases(string aliasStore) => await database.Rows(
        "SELECT name_key, item_id FROM pantry_aliases WHERE store = ? ORDER BY name_key", [aliasStore],
        row => new AliasRecord(MySqlRead.Text(row, "name_key"), MySqlRead.NullableText(row, "item_id")));

    public Task<TicketSummaryView?> FindByImport(string importId, string sourceFingerprint) =>
        FirstSummary("t.import_id = ? OR t.source_fingerprint = ?", [importId, sourceFingerprint]);

    public Task<TicketSummaryView?> FindByFingerprint(string fingerprint) => FirstSummary("t.fingerprint = ?", [fingerprint]);

    // <=> compara también NULL con NULL, como «IS ?» en SQLite.
    public async Task<IReadOnlyList<TicketSummaryView>> Candidates(string date, long? totalCents) => await database.Rows(
        $"{Summary} WHERE t.purchase_date = ? AND t.total_cents <=> ? GROUP BY t.id ORDER BY t.id", [date, totalCents], ToSummary);

    public async Task<TicketView?> GetTicket(string id)
    {
        var rows = await database.Rows($"{Summary} WHERE t.id = ? GROUP BY t.id", [id],
            row => (Summary: ToSummary(row), Adjustments: Json(MySqlRead.Text(row, "adjustments_json")), Issues: Json(MySqlRead.Text(row, "issues_json"))));
        if (rows.Count == 0) return null;
        var (summary, adjustments, issues) = rows[0];
        var lines = await database.Rows($"SELECT {LineColumns} FROM pantry_ticket_lines WHERE ticket_id = ? ORDER BY position", [id], ToLine);
        return new TicketView(summary.Id, summary.Store, summary.StoreName, summary.Address, summary.Date, summary.Time, summary.TotalCents,
            summary.LinesCount, summary.ProductsCount, summary.CreatedAt, lines, adjustments, issues);
    }

    // `ignored` = 1 cuando el nombre se ha marcado como «no seguir» (sin producto).
    public Task UpsertAlias(string aliasStore, string nameKey, string? itemId, string now) =>
        database.Run(UpsertAliasSql, [aliasStore, nameKey, itemId, itemId is null ? 1 : 0, now]);

    public Task InsertTicket(TicketToInsert ticket) => database.Run(InsertTicketSql,
    [
        ticket.Id, ticket.Store, ticket.StoreName, ticket.Address, ticket.Date, ticket.Time, ticket.TotalCents, ticket.Fingerprint, ticket.CreatedAt,
        JsonSerializer.Serialize(ticket.Adjustments.Select(TicketAdjustmentView.From).ToList(), StoredJson),
        JsonSerializer.Serialize(ticket.Issues, StoredJson), ticket.ImportId, ticket.SourceFingerprint,
    ]);

    public Task InsertLine(LineToInsert line) => database.Run(InsertLineSql,
    [
        line.Id, line.TicketId, line.Position, line.RawName, line.NameKey, line.Quantity, line.UnitPriceCents, line.AmountCents, line.DiscountCents,
        Exact(line.WeightKg), line.PricePerKgCents, line.TaxCode, line.ItemId, line.Occasional ? 1 : 0, line.ReviewStatus, line.Confirmed ? 1 : 0,
        line.Evidence is { } evidence ? EvidenceJson(evidence) : null,
    ]);
}
