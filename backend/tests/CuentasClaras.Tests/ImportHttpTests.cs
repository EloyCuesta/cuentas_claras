using System.Text.Json;
using CuentasClaras.Domain.Finance;

namespace CuentasClaras.Tests;

/// <summary>
/// La importación de los datos del navegador y el aislamiento de la restauración financiera en .NET (FIN-05), por HTTP
/// sobre MySQL real: como finance.test.ts («importación de los datos del navegador») y pantry.test.ts («la despensa no
/// se mezcla con las finanzas»), más la comparación de todas las tablas de la despensa y los tickets.
/// </summary>
[Trait("Categoria", TestDatabase.Category)]
public sealed class ImportHttpTests
{
    private const string Now = "2026-10-28T08:00:00.000Z";
    private static FixedClock NewClock() => new(DateTimeOffset.Parse(Now, System.Globalization.CultureInfo.InvariantCulture).ToUnixTimeMilliseconds());

    private static readonly string[] PantryAndTicketTables =
        ["pantry_people", "pantry_items", "pantry_settings", "pantry_events", "pantry_tickets", "pantry_ticket_lines", "pantry_aliases"];

    private static object Movement(string id, string concept) => new
    {
        id, concept, amountCents = 5430L, type = "gasto", categoryId = "g-alimentacion-supermercado", status = "realizado",
        paidDate = "2026-10-12", dueDate = (string?)null, notes = "", recurringId = (string?)null, occurrenceDate = (string?)null,
        installmentNumber = (int?)null, createdAt = Now, updatedAt = Now,
    };

    private static object[] Defaults() => [.. DefaultCategories.All.Select(category => (object)new
    {
        id = category.Id, name = category.Name, type = category.Type, parentId = category.ParentId, order = category.Order, budgetCents = category.BudgetCents,
    })];

    private static object BrowserData(string concept = "Del navegador") => new
    {
        categories = Defaults(),
        movements = new[] { Movement("del-navegador", concept) },
        recurring = new[]
        {
            new
            {
                id = "regla-navegador", concept = "Alquiler", amountCents = 65000L, type = "gasto", categoryId = "g-vivienda-alquiler",
                frequency = "mensual", startDate = "2026-10-01", endDate = (string?)null, installments = (int?)null, notes = "",
                excludedDates = Array.Empty<string>(), createdAt = Now, updatedAt = Now,
            },
        },
    };

    private static async Task<(TestDatabase Database, TestApi Api)> Start()
    {
        var database = await TestDatabase.Create();
        var (opened, _) = await database.Open(NewClock());
        return (database, await TestApi.Start(opened, NewClock()));
    }

    /// <summary>Filas sintéticas en todas las tablas de la despensa y los tickets, por SQL.</summary>
    private static async Task SeedPantryAndTickets(TestDatabase database)
    {
        await database.Execute("INSERT INTO pantry_people (id, name, created_at) VALUES ('p-1', 'Persona de ensayo', ?)", Now);
        await database.Execute(
            "INSERT INTO pantry_items (id, name, owner_id, unit, quantity, target, frequency, price_cents, notes, version, created_at, updated_at, tracking) " +
            "VALUES ('i-1', 'Proteína', 'p-1', 'bolsa', 0.125, 1, 'semanal', NULL, '', 3, ?, ?, 'cantidad')", Now, Now);
        await database.Execute("INSERT INTO pantry_settings (id, monthly_budget_cents, last_review_date) VALUES (1, 30000, '2026-10-20')");
        await database.Execute("INSERT INTO pantry_events (id, item_id, kind, event_date, created_at) VALUES ('e-1', 'i-1', 'poco', '2026-10-21', ?)", Now);
        await database.Execute(
            "INSERT INTO pantry_tickets (id, store, store_name, address, purchase_date, purchase_time, total_cents, fingerprint, created_at, adjustments_json, issues_json, import_id, source_fingerprint) " +
            "VALUES ('t-1', 'lidl', 'Tienda inventada', '', '2026-10-22', '18:05', 1234, 'huella-de-ensayo', ?, '[]', '[]', NULL, NULL)", Now);
        await database.Execute(
            "INSERT INTO pantry_ticket_lines (id, ticket_id, position, raw_name, name_key, quantity, unit_price_cents, amount_cents, discount_cents, weight_kg, price_per_kg_cents, tax_code, item_id, occasional, review_status, confirmed, evidence_json) " +
            "VALUES ('l-1', 't-1', 0, 'PROTEINA', 'PROTEINA', 1, 1234, 1234, 0, NULL, NULL, 'A', 'i-1', 0, 'verified', 1, NULL)");
        await database.Execute("INSERT INTO pantry_aliases (store, name_key, item_id, ignored, updated_at) VALUES ('lidl', 'PROTEINA', 'i-1', 0, ?)", Now);
    }

    private static async Task<string> Checksums(TestDatabase database) => string.Join(" ", await database.Query(
        $"CHECKSUM TABLE {string.Join(", ", PantryAndTicketTables)}", row => $"{row.GetString(0)}={row.GetValue(1)}"));

    [Fact]
    public async Task Importa_si_no_hay_datos_del_usuario_y_anota_la_fecha_aunque_haya_despensa()
    {
        var (database, api) = await Start();
        await using var _ = database;
        await using var __ = api;
        // Los productos de la despensa no cuentan como datos del usuario.
        await SeedPantryAndTickets(database);
        var (status, envelope) = await api.Call("POST", "/api/import", new { data = BrowserData(), lastBackupAt = "2026-10-01T10:00:00.000Z" });
        Assert.Equal(201, status);
        Assert.Equal("{\"categories\":27,\"movements\":1,\"recurring\":1}", envelope.GetProperty("data").GetRawText());
        var data = await api.Data("GET", "/api/data");
        Assert.Equal("Del navegador", Assert.Single(data.GetProperty("movements").EnumerateArray()).GetProperty("concept").GetString());
        Assert.Equal("2026-10-01T10:00:00.000Z", (await api.Data("GET", "/api/meta/lastBackupAt")).GetProperty("value").GetString());
        Assert.Equal(Now, (await api.Data("GET", "/api/meta/browserImportAt")).GetProperty("value").GetString());
    }

    [Fact]
    public async Task No_importa_nada_si_ya_hay_datos_nunca_mezcla_ni_duplica()
    {
        var (database, api) = await Start();
        await using var _ = database;
        await using var __ = api;
        await api.Data("PUT", "/api/movements/ya-estaba", Movement("ya-estaba", "Ya estaba"));
        await api.Fails("POST", "/api/import", new { data = BrowserData(), lastBackupAt = (string?)null }, 409, "CONFLICT",
            "La base de datos ya tiene datos, así que no se han importado los del navegador.");
        Assert.Equal("Ya estaba", Assert.Single((await api.Data("GET", "/api/data")).GetProperty("movements").EnumerateArray()).GetProperty("concept").GetString());
        Assert.Equal(JsonValueKind.Null, (await api.Data("GET", "/api/meta/browserImportAt")).GetProperty("value").ValueKind);
        // Una categoría cambiada también cuenta.
        await api.Data("DELETE", "/api/movements/ya-estaba");
        await api.Data("PUT", "/api/categories/g-ocio", new { id = "g-ocio", name = "Ocio y cultura", type = "gasto", parentId = (string?)null, order = 7, budgetCents = (long?)null });
        await api.Fails("POST", "/api/import", new { data = BrowserData() }, 409, "CONFLICT",
            "La base de datos ya tiene datos, así que no se han importado los del navegador.");
    }

    [Fact]
    public async Task Conserva_la_fecha_de_copia_que_ya_habia_y_valida_el_cuerpo()
    {
        var (database, api) = await Start();
        await using var _ = database;
        await using var __ = api;
        await api.Data("PUT", "/api/meta/lastBackupAt", new { value = "2026-09-01T00:00:00.000Z" });
        await api.Fails("POST", "/api/import", null, 400, "VALIDATION", "Falta el cuerpo de la petición en JSON.");
        await api.Fails("POST", "/api/import", new { lastBackupAt = "x" }, 400, "VALIDATION", "No se han recibido los datos.");
        await api.Fails("POST", "/api/import", new { data = BrowserData(), lastBackupAt = 5 }, 400, "VALIDATION", "El campo «lastBackupAt» debe ser texto.");
        await api.Fails("POST", "/api/import", new { data = new { categories = Defaults(), movements = new[] { Movement("m", "Sin categoría") }.Select(m => m).ToArray() }, lastBackupAt = "x" },
            400, "VALIDATION", "La copia no contiene la lista de recurrentes.");
        Assert.Equal(201, (await api.Call("POST", "/api/import", new { data = BrowserData(), lastBackupAt = "2026-10-01T10:00:00.000Z" })).Status);
        // Ya había una fecha de copia: no se pisa.
        Assert.Equal("2026-09-01T00:00:00.000Z", (await api.Data("GET", "/api/meta/lastBackupAt")).GetProperty("value").GetString());
    }

    [Fact]
    public async Task Restaurar_e_importar_dejan_intactas_todas_las_tablas_de_la_despensa_y_los_tickets()
    {
        var (database, api) = await Start();
        await using var _ = database;
        await using var __ = api;
        await SeedPantryAndTickets(database);
        var before = await Checksums(database);

        Assert.Equal(201, (await api.Call("POST", "/api/import", new { data = BrowserData(), lastBackupAt = (string?)null })).Status);
        await api.Data("PUT", "/api/data", new { categories = Defaults(), movements = new[] { Movement("de-la-copia", "De la copia") }, recurring = Array.Empty<object>() });

        Assert.Equal(before, await Checksums(database));
        var data = await api.Data("GET", "/api/data");
        Assert.Equal(new[] { "categories", "movements", "recurring" }, data.EnumerateObject().Select(property => property.Name));
        Assert.DoesNotContain("Proteína", data.GetRawText());
        Assert.Equal("De la copia", Assert.Single(data.GetProperty("movements").EnumerateArray()).GetProperty("concept").GetString());
        Assert.Empty(data.GetProperty("recurring").EnumerateArray());
        Assert.Equal(1L, await database.Scalar("SELECT COUNT(*) FROM pantry_items WHERE id = 'i-1' AND version = 3"));
    }
}
