using CuentasClaras.Domain.Common;

namespace CuentasClaras.Domain.Tickets;

/// <summary>Una línea de ticket que cuenta para el ritmo: con producto, verificada y no «para una ocasión» (lo filtra la consulta).</summary>
/// <param name="Date">La fecha del ticket.</param>
/// <param name="Store">El nombre de la tienda.</param>
/// <param name="RecordedAt">Cuándo se guardó el ticket, para ordenar lo que pasó el mismo día.</param>
public sealed record PurchaseLine(
    string TicketId, string ItemId, long Quantity, long? AmountCents, long DiscountCents, double? WeightKg, string Date, string Store, string RecordedAt);

/// <summary>
/// Una compra de un producto sacada de un ticket, con los campos de PantryPurchase de
/// shared/pantry/types.ts. Es un tipo propio de Tickets: la despensa lo leerá por un puerto de lectura
/// (ARCHITECTURE.md), no importando Domain.Tickets.
/// </summary>
/// <param name="Amount">Kilos (Measure «kg») o unidades («ud»); null si no se sabe.</param>
/// <param name="CostCents">Lo que costó, ya con descuentos; null si no se sabe.</param>
public sealed record TicketPurchase(string ItemId, string Date, double? Amount, string? Measure, long? CostCents, string? Store, string? TicketId, string RecordedAt);

/// <summary>Del historial de tickets a las compras de cada producto, para el ritmo (server/modules/tickets/domain/purchaseHistory.ts).</summary>
public static class PurchaseHistory
{
    /// <summary>
    /// purchasesFromLines: una compra por producto y ticket (las líneas repetidas se suman), sin las
    /// devoluciones y en el orden en que aparece cada una. Cuánto: kilos si todas sus líneas se pesan,
    /// unidades si ninguna, y si no, no se sabe. Lo que costó, si se sabe el importe de todas.
    /// </summary>
    public static IReadOnlyList<TicketPurchase> PurchasesFromLines(IReadOnlyList<PurchaseLine> lines)
    {
        var order = new List<string>();
        var grouped = new Dictionary<string, List<PurchaseLine>>(StringComparer.Ordinal);
        foreach (var line in lines)
        {
            if (line.AmountCents is < 0) continue;
            var key = $"{line.TicketId}|{line.ItemId}";
            if (!grouped.TryGetValue(key, out var rows))
            {
                grouped[key] = rows = [];
                order.Add(key);
            }
            rows.Add(line);
        }
        return [.. order.Select(key =>
        {
            var rows = grouped[key];
            var first = rows[0];
            var weighted = rows.All(row => row.WeightKg is not null);
            var counted = rows.All(row => row.WeightKg is null);
            double? amount = null;
            if (weighted)
            {
                // De izquierda a derecha, como reduce: la suma de dobles depende del orden.
                double kilos = 0;
                foreach (var row in rows) kilos += row.WeightKg!.Value;
                amount = JsNumber.Round(kilos * 1000) / 1000;
            }
            else if (counted)
            {
                double units = 0;
                foreach (var row in rows) units += row.Quantity;
                amount = units;
            }
            long? costCents = rows.Any(row => row.AmountCents is null) ? null : rows.Sum(row => row.AmountCents!.Value - row.DiscountCents);
            return new TicketPurchase(first.ItemId, first.Date, amount, weighted ? "kg" : counted ? "ud" : null, costCents, first.Store, first.TicketId, first.RecordedAt);
        })];
    }
}
