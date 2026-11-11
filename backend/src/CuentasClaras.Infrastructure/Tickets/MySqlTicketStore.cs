using System.Globalization;
using System.Text.Json;
using CuentasClaras.Application.Tickets;
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
}
