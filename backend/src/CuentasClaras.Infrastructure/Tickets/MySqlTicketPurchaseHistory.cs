using System.Globalization;
using CuentasClaras.Application.Pantry.Contracts;
using CuentasClaras.Domain.Tickets;
using CuentasClaras.Infrastructure.Common.MySql;
using MySqlConnector;

namespace CuentasClaras.Infrastructure.Tickets;

/// <summary>
/// Las compras de los tickets para la actividad de la despensa (IPantryPurchaseHistory, PAN-03): el SQL de
/// purchaseLinesSince de server/modules/tickets/adapters/mysql/MysqlTicketRepository.ts (líneas con producto, verificadas
/// y no «para una ocasión», desde una fecha) y PurchaseHistory.PurchasesFromLines, como activity() de Express. Así la
/// despensa recibe las compras sin conocer los tickets.
/// </summary>
public sealed class MySqlTicketPurchaseHistory(MySqlDatabase database) : IPantryPurchaseHistory
{
    private const string LinesSinceSql =
        "SELECT l.ticket_id, l.item_id, l.quantity, l.amount_cents, l.discount_cents, l.weight_kg, t.purchase_date, t.store_name, t.created_at "
        + "FROM pantry_ticket_lines l JOIN pantry_tickets t ON t.id = l.ticket_id "
        + "WHERE l.item_id IS NOT NULL AND l.occasional = 0 AND l.review_status = 'verified' AND t.purchase_date >= ? "
        + "ORDER BY t.purchase_date, l.position, t.created_at, t.id";

    /// <summary>Un DECIMAL como número de JavaScript: el doble más cercano a su texto (parseFloat, como mysql2 con decimalNumbers).</summary>
    private static double? Number(MySqlDataReader row, string column) => MySqlRead.NullableDecimal(row, column) is { } value
        ? double.Parse(value.ToString(CultureInfo.InvariantCulture), NumberStyles.Float, CultureInfo.InvariantCulture)
        : null;

    private static PurchaseLine ToLine(MySqlDataReader row) => new(
        MySqlRead.Text(row, "ticket_id"), MySqlRead.Text(row, "item_id"), MySqlRead.Integer(row, "quantity"), MySqlRead.NullableInteger(row, "amount_cents"),
        MySqlRead.Integer(row, "discount_cents"), Number(row, "weight_kg"), MySqlRead.Date(row, "purchase_date"), MySqlRead.Text(row, "store_name"),
        MySqlRead.Text(row, "created_at"));

    public async Task<IReadOnlyList<PantryPurchaseView>> PurchasesSince(string date)
    {
        var lines = await database.Rows(LinesSinceSql, [date], ToLine);
        return [.. PurchaseHistory.PurchasesFromLines(lines).Select(purchase => new PantryPurchaseView(
            purchase.ItemId, purchase.Date, purchase.Amount, purchase.Measure, purchase.CostCents, purchase.Store, purchase.TicketId, purchase.RecordedAt))];
    }
}
