using System.Globalization;
using System.Text.Json;

namespace CuentasClaras.Tests;

/// <summary>
/// Revisiones, presupuesto, repaso de la semana y actividad de la despensa en .NET (PAN-03), por HTTP sobre MySQL real y
/// como invitado, con los mensajes de Express. La actividad se prueba con tickets sembrados por SQL: sus compras llegan a
/// la despensa por IPantryPurchaseHistory, que implementa Tickets.
/// </summary>
[Trait("Categoria", TestDatabase.Category)]
public sealed class PantryReviewHttpTests
{
    private const string Now = "2026-10-29T08:00:00.000Z";

    private static FixedClock NewClock() => new(DateTimeOffset.Parse(Now, CultureInfo.InvariantCulture).ToUnixTimeMilliseconds()) { TodayDate = "2026-10-29" };

    private static async Task<(TestDatabase Database, TestApi Api)> Start()
    {
        var database = await TestDatabase.Create();
        var (opened, _) = await database.Open(NewClock());
        return (database, await TestApi.Start(opened, NewClock(), login: false));
    }

    private static async Task<string> CreateItem(TestApi api, string name, string tracking = "compras") =>
        (await api.Data("POST", "/api/despensa/productos", new
        {
            name, ownerId = (string?)null, unit = "ud", quantity = 0, target = tracking == "compras" ? 0 : 1, frequency = "semanal", priceCents = (long?)null,
            notes = "", tracking,
        }, 201)).GetProperty("id").GetString()!;

    [Fact]
    public async Task Apunta_y_deshace_revisiones_con_la_fecha_del_navegador()
    {
        var (database, api) = await Start();
        await using var _db = database;
        await using var _api = api;
        var milk = await CreateItem(api, "Leche");
        var path = $"/api/despensa/productos/{milk}/revision";
        var low = await api.Data("POST", path, new { kind = "poco", date = "2026-10-31" }, 201);
        Assert.Equal($"{{\"id\":\"{low.GetProperty("id").GetString()}\",\"itemId\":\"{milk}\",\"kind\":\"poco\",\"date\":\"2026-10-31\",\"createdAt\":\"{Now}\"}}",
            low.GetRawText());
        // Una revisión no cambia el producto.
        Assert.Equal(1, Assert.Single((await api.Data("GET", "/api/despensa/productos")).EnumerateArray()).GetProperty("version").GetInt64());

        await api.Fails("POST", path, new { kind = "mucho", date = "2026-10-31" }, 400, "VALIDATION", "El campo «kind» debe ser «queda», «poco», «se_acabo» o «comprado».");
        await api.Fails("POST", path, new { kind = "queda" }, 400, "VALIDATION", "Falta el campo «date» (AAAA-MM-DD).");
        await api.Fails("POST", path, new { kind = "queda", date = "31/10/2026" }, 400, "VALIDATION", "El campo «date» debe ser una fecha AAAA-MM-DD.");
        // El cuerpo se valida antes de buscar el producto.
        await api.Fails("POST", "/api/despensa/productos/no-existe/revision", new { kind = "x" }, 400, "VALIDATION",
            "El campo «kind» debe ser «queda», «poco», «se_acabo» o «comprado».");
        await api.Fails("POST", "/api/despensa/productos/no-existe/revision", new { kind = "queda", date = "2026-10-31" }, 404, "NOT_FOUND",
            "Ese producto ya no existe. Vuelve a cargar la despensa.");

        var eventPath = $"/api/despensa/revisiones/{low.GetProperty("id").GetString()}";
        Assert.Equal(JsonValueKind.Null, (await api.Data("DELETE", eventPath)).ValueKind);
        await api.Fails("DELETE", eventPath, null, 404, "NOT_FOUND", "Esa revisión ya no existe.");
        // Borrar el producto borra sus revisiones.
        await api.Data("POST", path, new { kind = "se_acabo", date = "2026-10-31" }, 201);
        await api.Data("DELETE", $"/api/despensa/productos/{milk}");
        Assert.Equal(0L, await database.Scalar("SELECT COUNT(*) FROM pantry_events"));
    }

    [Fact]
    public async Task Consulta_fija_y_quita_el_presupuesto_y_apunta_el_repaso_distinguiendo_0_de_sin_presupuesto()
    {
        var (database, api) = await Start();
        await using var _db = database;
        await using var _api = api;
        const string Empty = "{\"monthlyBudgetCents\":null,\"lastReviewDate\":null}";
        Assert.Equal(Empty, (await api.Data("GET", "/api/despensa/presupuesto")).GetRawText());
        Assert.Equal("{\"monthlyBudgetCents\":0,\"lastReviewDate\":null}", (await api.Data("PUT", "/api/despensa/presupuesto", new { monthlyBudgetCents = 0 })).GetRawText());
        Assert.Equal("{\"monthlyBudgetCents\":25000,\"lastReviewDate\":null}",
            (await api.Data("PUT", "/api/despensa/presupuesto", new { monthlyBudgetCents = 25000 })).GetRawText());
        await api.Fails("PUT", "/api/despensa/presupuesto", new { monthlyBudgetCents = -1 }, 400, "VALIDATION",
            "El campo «monthlyBudgetCents» debe ser un número entero de céntimos entre 0 y 10000000, o null.");
        await api.Fails("PUT", "/api/despensa/presupuesto", new { }, 400, "VALIDATION", "Falta el campo «monthlyBudgetCents» (número de céntimos o null).");
        await api.Fails("PUT", "/api/despensa/presupuesto", null, 400, "VALIDATION", "Falta el cuerpo de la petición en JSON.");

        Assert.Equal("{\"monthlyBudgetCents\":25000,\"lastReviewDate\":\"2026-10-31\"}",
            (await api.Data("PUT", "/api/despensa/repaso", new { date = "2026-10-31" })).GetRawText());
        await api.Fails("PUT", "/api/despensa/repaso", new { }, 400, "VALIDATION", "Falta el campo «date» (AAAA-MM-DD).");
        await api.Fails("PUT", "/api/despensa/repaso", new { date = "2026-13-01" }, 400, "VALIDATION", "El campo «date» debe ser una fecha AAAA-MM-DD.");
        Assert.Equal("{\"monthlyBudgetCents\":null,\"lastReviewDate\":\"2026-10-31\"}",
            (await api.Data("PUT", "/api/despensa/presupuesto", new { monthlyBudgetCents = (long?)null })).GetRawText());
        Assert.Equal(1L, await database.Scalar("SELECT COUNT(*) FROM pantry_settings"));
    }

    /// <summary>Un ticket sintético con sus líneas, por SQL (los tickets en .NET son de TIC-03).</summary>
    private static async Task SeedTicket(TestDatabase database, string id, string date, string createdAt, params (string? ItemId, long Quantity, long? AmountCents, long Discount, string? WeightKg, int Occasional, string Review)[] lines)
    {
        await database.Execute(
            "INSERT INTO pantry_tickets (id, store, store_name, purchase_date, total_cents, fingerprint, created_at) VALUES (?, 'lidl', 'Tienda inventada', ?, NULL, ?, ?)",
            id, date, $"huella-{id}", createdAt);
        for (var i = 0; i < lines.Length; i++)
        {
            var line = lines[i];
            await database.Execute(
                "INSERT INTO pantry_ticket_lines (id, ticket_id, position, raw_name, name_key, quantity, amount_cents, discount_cents, weight_kg, item_id, occasional, review_status) " +
                "VALUES (?, ?, ?, 'LINEA', 'LINEA', ?, ?, ?, ?, ?, ?, ?)",
                $"{id}-{i}", id, i, line.Quantity, line.AmountCents, line.Discount, line.WeightKg, line.ItemId, line.Occasional, line.Review);
        }
    }

    [Fact]
    public async Task La_actividad_junta_las_compras_de_los_tickets_y_las_revisiones_de_los_ultimos_400_dias()
    {
        var (database, api) = await Start();
        await using var _db = database;
        await using var _api = api;
        var bread = await CreateItem(api, "Pan");
        var apples = await CreateItem(api, "Manzanas");
        var rice = await CreateItem(api, "Arroz");
        // Fuera de la ventana (hoy − 400 días = 2025-09-24) y justo dentro.
        await SeedTicket(database, "t-viejo", "2025-09-23", "2025-09-23T10:00:00.000Z", (bread, 1, 120, 0, null, 0, "verified"));
        await SeedTicket(database, "t-borde", "2025-09-24", "2025-09-24T10:00:00.000Z", (bread, 2, 240, 10, null, 0, "verified"));
        // Pan dos veces en el mismo ticket se suma; las manzanas pesadas en kilos; el arroz con una línea sin importe; y lo que no cuenta:
        // devoluciones, «para una ocasión», pendiente de revisar y sin producto.
        await SeedTicket(database, "t-1", "2026-10-20", "2026-10-20T18:00:00.000Z",
            (bread, 1, 120, 0, null, 0, "verified"),
            (apples, 1, 199, 0, "0.700", 0, "verified"),
            (bread, 2, 240, 20, null, 0, "verified"),
            (apples, 1, 150, 0, "0.450", 0, "verified"),
            (rice, 1, null, 0, null, 0, "verified"),
            (rice, 1, 95, 0, null, 0, "verified"),
            (bread, 1, -120, 0, null, 0, "verified"),
            (apples, 1, 300, 0, "1.000", 1, "verified"),
            (rice, 1, 95, 0, null, 0, "pending"),
            (null, 1, 50, 0, null, 0, "verified"));
        // Mismo día, guardado antes: va primero.
        await SeedTicket(database, "t-0", "2026-10-20", "2026-10-20T09:00:00.000Z", (rice, 3, 300, 0, null, 0, "verified"));
        await api.Data("POST", $"/api/despensa/productos/{bread}/revision", new { kind = "se_acabo", date = "2026-10-25" }, 201);
        await api.Data("POST", $"/api/despensa/productos/{apples}/revision", new { kind = "queda", date = "2025-09-23" }, 201);

        var activity = await api.Data("GET", "/api/despensa/actividad?hoy=2026-10-29");
        var purchases = activity.GetProperty("purchases").EnumerateArray().Select(purchase => purchase.GetRawText()).ToArray();
        string Purchase(string item, string date, string amount, string measure, string cost, string ticket, string at) =>
            $"{{\"itemId\":\"{item}\",\"date\":\"{date}\",\"amount\":{amount},\"measure\":{measure},\"costCents\":{cost},\"store\":\"Tienda inventada\",\"ticketId\":\"{ticket}\",\"recordedAt\":\"{at}\"}}";
        Assert.Equal(new[]
        {
            Purchase(bread, "2025-09-24", "2", "\"ud\"", "230", "t-borde", "2025-09-24T10:00:00.000Z"),
            // Mismo día y posición 0: primero el ticket guardado antes (t-0).
            Purchase(rice, "2026-10-20", "3", "\"ud\"", "300", "t-0", "2026-10-20T09:00:00.000Z"),
            Purchase(bread, "2026-10-20", "3", "\"ud\"", "340", "t-1", "2026-10-20T18:00:00.000Z"),
            Purchase(apples, "2026-10-20", "1.15", "\"kg\"", "349", "t-1", "2026-10-20T18:00:00.000Z"),
            Purchase(rice, "2026-10-20", "2", "\"ud\"", "null", "t-1", "2026-10-20T18:00:00.000Z"),
        }, purchases);
        var events = activity.GetProperty("events").EnumerateArray().ToArray();
        Assert.Equal(("se_acabo", bread), (Assert.Single(events).GetProperty("kind").GetString(), events[0].GetProperty("itemId").GetString()));

        // Sin hoy, con uno que no es una fecha o repetido, la fecha del servidor (2026-10-29): lo mismo.
        foreach (var query in new[] { "", "?hoy=ayer", "?hoy=2026-10-29&hoy=2026-10-29" })
            Assert.Equal(activity.GetRawText(), (await api.Data("GET", $"/api/despensa/actividad{query}")).GetRawText());
        // Con otro hoy, otra ventana.
        Assert.Equal(4, (await api.Data("GET", "/api/despensa/actividad?hoy=2026-10-30")).GetProperty("purchases").GetArrayLength());
    }
}
