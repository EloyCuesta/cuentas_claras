using System.Text.Json;
using CuentasClaras.Infrastructure.Common.MySql;

namespace CuentasClaras.Tests;

/// <summary>
/// Recurrentes, cuotas, exclusiones y generación de vencimientos en .NET (FIN-03), por HTTP sobre MySQL real, con dos
/// conexiones (dos hosts sobre la misma base) donde importa: como server/modules/finance/finance.test.ts.
/// </summary>
[Trait("Categoria", TestDatabase.Category)]
public sealed class RecurringHttpTests
{
    private const string Now = "2026-10-28T08:00:00.000Z";
    private const string Today = "2026-10-28";
    /// <summary>generationHorizon(Today): el final del mes siguiente.</summary>
    private const string Horizon = "2026-11-30";
    private static FixedClock NewClock() => new(DateTimeOffset.Parse(Now, System.Globalization.CultureInfo.InvariantCulture).ToUnixTimeMilliseconds());

    private static Dictionary<string, object?> Rule(string id = "regla", string startDate = "2026-11-01", long amountCents = 65000,
        string categoryId = "g-vivienda-alquiler", int? installments = null, string[]? excludedDates = null, string concept = "Alquiler",
        string type = "gasto", string? endDate = null) => new()
    {
        ["id"] = id, ["concept"] = concept, ["amountCents"] = amountCents, ["type"] = type, ["categoryId"] = categoryId,
        ["frequency"] = "mensual", ["startDate"] = startDate, ["endDate"] = endDate, ["installments"] = installments, ["notes"] = "",
        ["excludedDates"] = excludedDates ?? [], ["createdAt"] = Now, ["updatedAt"] = Now,
    };

    private static object Save(Dictionary<string, object?> rule, string? markPaidBefore = null) =>
        new { rule, horizon = Horizon, markPaidBefore };

    private static async Task<(TestDatabase Database, MySqlDatabase Opened)> Open()
    {
        var database = await TestDatabase.Create();
        var (opened, _) = await database.Open(NewClock());
        return (database, opened);
    }

    private static async Task<long> Created(TestApi api, string method, string path, object body) =>
        (await api.Data(method, path, body)).GetProperty("created").GetInt64();

    private static async Task<JsonElement[]> Movements(TestApi api) =>
        [.. (await api.Data("GET", "/api/data")).GetProperty("movements").EnumerateArray()
            .OrderBy(m => m.GetProperty("occurrenceDate").GetString(), StringComparer.Ordinal)];

    [Fact]
    public async Task Abrir_varias_veces_la_aplicacion_no_duplica_vencimientos()
    {
        var (database, opened) = await Open();
        await using var _ = database;
        await using var api = await TestApi.Start(opened, NewClock());
        Assert.Equal(3, await Created(api, "PUT", "/api/recurring/regla", Save(Rule(startDate: "2026-09-01"))));
        Assert.Equal(0, await Created(api, "POST", "/api/occurrences/generate", new { horizon = Horizon }));
        var (second, _) = await database.Open(NewClock());
        await using var otherTab = await TestApi.Start(second, NewClock());
        var both = await Task.WhenAll(
            Created(api, "POST", "/api/occurrences/generate", new { horizon = Horizon }),
            Created(otherTab, "POST", "/api/occurrences/generate", new { horizon = Horizon }));
        Assert.Equal(new long[] { 0, 0 }, both);
        Assert.Equal(new[] { "2026-09-01", "2026-10-01", "2026-11-01" },
            (await Movements(api)).Select(m => m.GetProperty("occurrenceDate").GetString()));
    }

    [Fact]
    public async Task Dos_conexiones_que_generan_a_la_vez_la_primera_vez_tampoco_duplican()
    {
        var (database, opened) = await Open();
        await using var _ = database;
        await using var api = await TestApi.Start(opened, NewClock());
        var data = await api.Data("GET", "/api/data");
        await api.Data("PUT", "/api/data", new { categories = data.GetProperty("categories"), movements = Array.Empty<object>(), recurring = new[] { Rule(startDate: "2026-10-05") } });
        var (second, _) = await database.Open(NewClock());
        await using var otherTab = await TestApi.Start(second, NewClock());
        var created = await Task.WhenAll(
            Created(api, "POST", "/api/occurrences/generate", new { horizon = Horizon }),
            Created(otherTab, "POST", "/api/occurrences/generate", new { horizon = Horizon }));
        Assert.Equal(new long[] { 0, 2 }, created.Order());
        Assert.Equal(2, (await Movements(api)).Length);
    }

    [Fact]
    public async Task Con_dos_conexiones_guardar_un_recurrente_y_generar_a_la_vez_no_duplica_ni_da_409()
    {
        var (database, opened) = await Open();
        await using var _ = database;
        await using var api = await TestApi.Start(opened, NewClock());
        var data = await api.Data("GET", "/api/data");
        await api.Data("PUT", "/api/data", new { categories = data.GetProperty("categories"), movements = Array.Empty<object>(), recurring = new[] { Rule(startDate: "2026-10-05") } });
        var (second, _) = await database.Open(NewClock());
        await using var otherTab = await TestApi.Start(second, NewClock());
        // Con el bloqueo «finance» van en serie: o genera y después se rehacen los pendientes, o al revés.
        var results = await Task.WhenAll(
            Created(api, "PUT", "/api/recurring/regla", Save(Rule(startDate: "2026-10-05", amountCents: 70000))),
            Created(otherTab, "POST", "/api/occurrences/generate", new { horizon = Horizon }));
        Assert.Equal(2, results[0]);
        Assert.Contains(results[1], new long[] { 0, 2 });
        Assert.Equal(new[] { "2026-10-05 70000", "2026-11-05 70000" },
            (await Movements(api)).Select(m => $"{m.GetProperty("occurrenceDate").GetString()} {m.GetProperty("amountCents").GetInt64()}"));
    }

    [Fact]
    public async Task Pagar_o_eliminar_un_vencimiento_no_hace_que_se_vuelva_a_generar()
    {
        var (database, opened) = await Open();
        await using var _ = database;
        await using var api = await TestApi.Start(opened, NewClock());
        await api.Data("PUT", "/api/recurring/regla", Save(Rule(startDate: "2026-10-01")));
        var movements = await Movements(api);
        var october = JsonSerializer.Deserialize<Dictionary<string, object?>>(movements[0].GetRawText())!;
        october["status"] = "realizado";
        october["paidDate"] = "2026-10-01";
        await api.Data("PUT", $"/api/movements/{october["id"]}", october);
        await api.Data("DELETE", $"/api/movements/{movements[1].GetProperty("id").GetString()}");
        Assert.Equal(0, await Created(api, "POST", "/api/occurrences/generate", new { horizon = Horizon }));
        var data = await api.Data("GET", "/api/data");
        Assert.Equal(new[] { "2026-10-01 realizado" },
            data.GetProperty("movements").EnumerateArray().Select(m => $"{m.GetProperty("occurrenceDate").GetString()} {m.GetProperty("status").GetString()}"));
        Assert.Equal("2026-11-01", Assert.Single(data.GetProperty("recurring")[0].GetProperty("excludedDates").EnumerateArray()).GetString());
    }

    [Fact]
    public async Task Al_editar_un_recurrente_se_rehacen_los_pendientes_y_se_conservan_los_pagados()
    {
        var (database, opened) = await Open();
        await using var _ = database;
        await using var api = await TestApi.Start(opened, NewClock());
        var gym = Rule(concept: "Gimnasio", amountCents: 3000, startDate: "2026-10-01", categoryId: "g-ocio");
        await api.Data("PUT", "/api/recurring/regla", Save(gym));
        var october = JsonSerializer.Deserialize<Dictionary<string, object?>>((await Movements(api))[0].GetRawText())!;
        october["status"] = "realizado";
        october["paidDate"] = "2026-10-01";
        await api.Data("PUT", $"/api/movements/{october["id"]}", october);
        await api.Data("PUT", "/api/recurring/regla", Save(new Dictionary<string, object?>(gym) { ["amountCents"] = 3500 }));
        Assert.Equal(new[] { "2026-10-01 realizado 3000", "2026-11-01 pendiente 3500" },
            (await Movements(api)).Select(m => $"{m.GetProperty("occurrenceDate").GetString()} {m.GetProperty("status").GetString()} {m.GetProperty("amountCents").GetInt64()}"));
    }

    [Fact]
    public async Task Un_prestamo_empezado_se_da_de_alta_con_las_cuotas_pasadas_ya_pagadas_y_los_ids_en_orden()
    {
        var (database, opened) = await Open();
        await using var _ = database;
        var ids = new QueuedIds("id-1", "id-2", "id-3", "id-4", "id-5");
        await using var api = await TestApi.Start(opened, NewClock(), ids);
        var loan = Rule(concept: "Préstamo coche", startDate: "2026-07-15", installments: 12, categoryId: "g-prestamos");
        Assert.Equal(5, await Created(api, "PUT", "/api/recurring/regla", Save(loan, markPaidBefore: Today)));
        Assert.Equal(new[] { "id-1 1 realizado 2026-07-15", "id-2 2 realizado 2026-08-15", "id-3 3 realizado 2026-09-15", "id-4 4 realizado 2026-10-15", "id-5 5 pendiente " },
            (await Movements(api)).Select(m => $"{m.GetProperty("id").GetString()} {m.GetProperty("installmentNumber").GetInt32()} {m.GetProperty("status").GetString()} {m.GetProperty("paidDate").GetString()}"));
        var created = (await Movements(api))[4];
        Assert.Equal("2026-11-15", created.GetProperty("dueDate").GetString());
        Assert.Equal(Now, created.GetProperty("createdAt").GetString());
        Assert.Equal(0, ids.Remaining);
    }

    [Fact]
    public async Task Eliminar_un_recurrente_borra_sus_pendientes_y_conserva_lo_pagado_con_su_vinculo()
    {
        var (database, opened) = await Open();
        await using var _ = database;
        await using var api = await TestApi.Start(opened, NewClock());
        await api.Data("PUT", "/api/recurring/regla", Save(Rule(startDate: "2026-10-01", excludedDates: ["2027-01-01"]), markPaidBefore: "2026-10-02"));
        await api.Data("DELETE", "/api/recurring/regla");
        var data = await api.Data("GET", "/api/data");
        Assert.Empty(data.GetProperty("recurring").EnumerateArray());
        var paid = Assert.Single(data.GetProperty("movements").EnumerateArray());
        Assert.Equal("realizado", paid.GetProperty("status").GetString());
        Assert.Equal("regla", paid.GetProperty("recurringId").GetString());
        Assert.Equal(0L, await database.Scalar("SELECT COUNT(*) FROM recurring_excluded_dates"));
        // Borrar otra vez no falla.
        await api.Data("DELETE", "/api/recurring/regla");
    }

    [Fact]
    public async Task El_dia_31_usa_el_ultimo_dia_del_mes_y_vuelve_al_31_con_las_cuotas_numeradas()
    {
        var (database, opened) = await Open();
        await using var _ = database;
        await using var api = await TestApi.Start(opened, NewClock());
        var rule = Rule(startDate: "2028-01-31", installments: 4, categoryId: "g-prestamos", concept: "Letra");
        var created = (await api.Data("PUT", "/api/recurring/regla", new { rule, horizon = "2028-12-31", markPaidBefore = (string?)null })).GetProperty("created").GetInt64();
        Assert.Equal(4, created);
        Assert.Equal(new[] { "2028-01-31 1", "2028-02-29 2", "2028-03-31 3", "2028-04-30 4" },
            (await Movements(api)).Select(m => $"{m.GetProperty("occurrenceDate").GetString()} {m.GetProperty("installmentNumber").GetInt32()}"));
    }

    [Fact]
    public async Task Valida_el_cuerpo_la_regla_el_id_y_las_fechas_con_los_mensajes_de_Express()
    {
        var (database, opened) = await Open();
        await using var _ = database;
        await using var api = await TestApi.Start(opened, NewClock());
        await api.Fails("PUT", "/api/recurring/regla", null, 400, "VALIDATION", "Falta el cuerpo de la petición en JSON.");
        await api.Fails("PUT", "/api/recurring/regla", new { horizon = Horizon }, 400, "VALIDATION", "El recurrente no tiene un formato válido.");
        await api.Fails("PUT", "/api/recurring/otra", Save(Rule()), 400, "VALIDATION", "El id de la dirección no coincide con el de los datos.");
        await api.Fails("PUT", "/api/recurring/regla", new { rule = Rule() }, 400, "VALIDATION", "El campo «horizon» debe ser una fecha AAAA-MM-DD.");
        await api.Fails("PUT", "/api/recurring/regla", new { rule = Rule(), horizon = Horizon, markPaidBefore = "2026-02-30" }, 400, "VALIDATION",
            "El campo «markPaidBefore» debe ser una fecha AAAA-MM-DD.");
        await api.Fails("PUT", "/api/recurring/regla", Save(Rule(categoryId: "i-nomina")), 400, "VALIDATION",
            "El recurrente es de gastos, pero su categoría es de ingresos.");
        await api.Fails("POST", "/api/occurrences/generate", null, 400, "VALIDATION", "Falta el cuerpo de la petición en JSON.");
        await api.Fails("POST", "/api/occurrences/generate", new { horizon = "30/11/2026" }, 400, "VALIDATION", "El campo «horizon» debe ser una fecha AAAA-MM-DD.");
        await api.Fails("POST", "/api/occurrences/generate", new { horizon = Horizon }, 401, "UNAUTHORIZED", "Hace falta el código de acceso para ver esta sección.", guest: true);
        Assert.Empty((await api.Data("GET", "/api/data")).GetProperty("recurring").EnumerateArray());
    }
}
