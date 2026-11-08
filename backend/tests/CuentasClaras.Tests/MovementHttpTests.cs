using System.Text.Json;
using CuentasClaras.Application.Finance;
using CuentasClaras.Domain.Finance;
using CuentasClaras.Infrastructure.Common.MySql;
using CuentasClaras.Infrastructure.Finance;

namespace CuentasClaras.Tests;

/// <summary>
/// Movimientos, pagos, borrado y restauración de las finanzas en .NET (FIN-02), por HTTP sobre MySQL real, con los
/// mensajes de Express (server/modules/finance/finance.test.ts y server/app.test.ts).
/// </summary>
[Trait("Categoria", TestDatabase.Category)]
public sealed class MovementHttpTests
{
    private const string Now = "2026-11-01T08:00:00.000Z";
    private static readonly FixedClock Clock = new(DateTimeOffset.Parse(Now, System.Globalization.CultureInfo.InvariantCulture).ToUnixTimeMilliseconds());

    private static Dictionary<string, object?> Movement(string id, string concept = "Compra", long amountCents = 1234, string categoryId = "g-alimentacion",
        string type = "gasto", string status = "realizado", string? paidDate = "2026-10-10", string? dueDate = null,
        string? recurringId = null, string? occurrenceDate = null) => new()
    {
        ["id"] = id, ["concept"] = concept, ["amountCents"] = amountCents, ["type"] = type, ["categoryId"] = categoryId,
        ["status"] = status, ["paidDate"] = paidDate, ["dueDate"] = dueDate, ["notes"] = "", ["recurringId"] = recurringId,
        ["occurrenceDate"] = occurrenceDate, ["installmentNumber"] = null, ["createdAt"] = Now, ["updatedAt"] = Now,
    };

    private static async Task<(TestDatabase Database, TestApi Api)> Start()
    {
        var database = await TestDatabase.Create();
        var (opened, _) = await database.Open(Clock);
        return (database, await TestApi.Start(opened, Clock));
    }

    private static async Task<JsonElement[]> Movements(TestApi api) =>
        [.. (await api.Data("GET", "/api/data")).GetProperty("movements").EnumerateArray()];

    [Fact]
    public async Task Crear_reintentar_y_pagar_es_siempre_el_mismo_movimiento()
    {
        var (database, api) = await Start();
        await using var _ = database;
        await using var __ = api;
        var pending = Movement("mov-1", status: "pendiente", paidDate: null, dueDate: "2026-11-15");
        await api.Data("PUT", "/api/movements/mov-1", pending);
        // El mismo alta otra vez (un reintento tras una recarga fallida): sigue habiendo uno.
        await api.Data("PUT", "/api/movements/mov-1", pending);
        Assert.Single(await Movements(api));
        var paid = new Dictionary<string, object?>(pending) { ["status"] = "realizado", ["paidDate"] = "2026-11-01", ["updatedAt"] = "2026-11-01T09:00:00.000Z" };
        await api.Data("PUT", "/api/movements/mov-1", paid);
        var stored = Assert.Single(await Movements(api));
        Assert.Equal("realizado", stored.GetProperty("status").GetString());
        Assert.Equal("2026-11-01", stored.GetProperty("paidDate").GetString());
        Assert.Equal("2026-11-15", stored.GetProperty("dueDate").GetString());
        Assert.Equal("2026-11-01T09:00:00.000Z", stored.GetProperty("updatedAt").GetString());
        Assert.True(JsonElement.DeepEquals(JsonSerializer.SerializeToElement(paid), stored), stored.ToString());
    }

    [Fact]
    public async Task Rechaza_una_categoria_que_no_existe_o_de_otro_tipo_y_el_id_distinto()
    {
        var (database, api) = await Start();
        await using var _ = database;
        await using var __ = api;
        await api.Fails("PUT", "/api/movements/mov-1", Movement("mov-1", categoryId: "no-existe"), 400, "VALIDATION", "El movimiento usa una categoría que no existe.");
        await api.Fails("PUT", "/api/movements/mov-1", Movement("mov-1", categoryId: "i-nomina"), 400, "VALIDATION",
            "El movimiento es de gastos, pero su categoría es de ingresos.");
        await api.Fails("PUT", "/api/movements/mov-1", Movement("mov-1", categoryId: "g-ocio", type: "ingreso"), 400, "VALIDATION",
            "El movimiento es de ingresos, pero su categoría es de gastos.");
        await api.Fails("PUT", "/api/movements/otro", Movement("mov-1"), 400, "VALIDATION", "El id de la dirección no coincide con el de los datos.");
        await api.Fails("PUT", "/api/movements/mov-1", Movement("mov-1", amountCents: 0), 400, "VALIDATION",
            "El movimiento: el campo «amountCents» debe ser un número entero entre 1 y 99999999999.");
        await api.Fails("PUT", "/api/movements/mov-1", null, 400, "VALIDATION", "El movimiento no tiene un formato válido.");
        Assert.Empty(await Movements(api));
    }

    [Fact]
    public async Task Un_movimiento_que_pasaria_a_ser_un_vencimiento_que_ya_existe_da_409_y_no_pisa_ninguno()
    {
        var (database, api) = await Start();
        await using var _ = database;
        await using var __ = api;
        var november = Movement("mov-nov", status: "pendiente", paidDate: null, dueDate: "2026-11-01", recurringId: "r1", occurrenceDate: "2026-11-01");
        var december = Movement("mov-dic", status: "pendiente", paidDate: null, dueDate: "2026-12-01", recurringId: "r1", occurrenceDate: "2026-12-01");
        await api.Data("PUT", "/api/movements/mov-nov", november);
        await api.Data("PUT", "/api/movements/mov-dic", december);
        var clash = new Dictionary<string, object?>(december) { ["occurrenceDate"] = "2026-11-01", ["concept"] = "Choca" };
        await api.Fails("PUT", "/api/movements/mov-dic", clash, 409, "CONFLICT", "Ese vencimiento ya existe, así que no se ha creado otro.");
        // Un alta nueva que choca con un vencimiento tampoco se guarda.
        var duplicate = new Dictionary<string, object?>(november) { ["id"] = "mov-otro" };
        await api.Fails("PUT", "/api/movements/mov-otro", duplicate, 409, "CONFLICT", "Ese vencimiento ya existe, así que no se ha creado otro.");
        var stored = await Movements(api);
        Assert.Equal(2, stored.Length);
        Assert.True(JsonElement.DeepEquals(JsonSerializer.SerializeToElement(december), stored.Single(m => m.GetProperty("id").GetString() == "mov-dic")));
        Assert.True(JsonElement.DeepEquals(JsonSerializer.SerializeToElement(november), stored.Single(m => m.GetProperty("id").GetString() == "mov-nov")));
    }

    [Fact]
    public async Task Borrar_un_vencimiento_lo_excluye_solo_si_su_recurrente_sigue_existiendo()
    {
        var (database, api) = await Start();
        await using var _ = database;
        await using var __ = api;
        await database.Execute(
            "INSERT INTO recurring_rules (id, concept, amount_cents, type, category_id, frequency, start_date, end_date, installments, notes, created_at, updated_at) " +
            "VALUES ('regla', 'Cuota', 5000, 'gasto', 'g-prestamos', 'mensual', '2026-01-31', NULL, NULL, '', 'antes', 'antes')");
        await api.Data("PUT", "/api/movements/v-feb", Movement("v-feb", categoryId: "g-prestamos", status: "pendiente", paidDate: null, dueDate: "2026-02-28",
            recurringId: "regla", occurrenceDate: "2026-02-28"));
        await api.Data("PUT", "/api/movements/v-huerfano", Movement("v-huerfano", categoryId: "g-prestamos", recurringId: "regla-borrada", occurrenceDate: "2026-01-31"));

        await api.Data("DELETE", "/api/movements/v-feb");
        await api.Data("DELETE", "/api/movements/v-huerfano");
        // Repetir el borrado no falla.
        await api.Data("DELETE", "/api/movements/v-feb");
        await api.Data("DELETE", "/api/movements/no-existe");

        Assert.Empty(await Movements(api));
        var excluded = await database.Query("SELECT rule_id, date FROM recurring_excluded_dates ORDER BY rule_id, date",
            row => $"{MySqlRead.Text(row, "rule_id")} {MySqlRead.Date(row, "date")}");
        Assert.Equal(new[] { "regla 2026-02-28" }, excluded);
        var rule = (await api.Data("GET", "/api/data")).GetProperty("recurring")[0];
        Assert.Equal("2026-02-28", rule.GetProperty("excludedDates")[0].GetString());
    }

    [Fact]
    public async Task Guarda_los_centimos_exactos_y_editar_o_borrar_cambia_lo_guardado()
    {
        var (database, api) = await Start();
        await using var _ = database;
        await using var __ = api;
        await api.Data("PUT", "/api/movements/maximo", Movement("maximo", concept: "Máximo", amountCents: FinanceRequests.MaxCents));
        await api.Data("PUT", "/api/movements/minimo", Movement("minimo", concept: "Un céntimo", amountCents: 1));
        await api.Data("PUT", "/api/movements/minimo", Movement("minimo", concept: "Un céntimo", amountCents: 7550));
        var amounts = (await Movements(api)).ToDictionary(m => m.GetProperty("id").GetString()!, m => m.GetProperty("amountCents").GetInt64());
        Assert.Equal(99_999_999_999, amounts["maximo"]);
        Assert.Equal(7550, amounts["minimo"]);
        await api.Data("DELETE", "/api/movements/maximo");
        Assert.Equal("minimo", Assert.Single(await Movements(api)).GetProperty("id").GetString());
    }

    [Fact]
    public async Task Restaurar_sustituye_las_finanzas_enteras_y_no_toca_los_metadatos()
    {
        var (database, api) = await Start();
        await using var _ = database;
        await using var __ = api;
        await api.Data("PUT", "/api/movements/se-va", Movement("se-va"));
        await api.Data("PUT", "/api/meta/lastBackupAt", new { value = Now });
        var data = new
        {
            categories = new object[]
            {
                new { id = "g-casa", name = "Casa", type = "gasto", parentId = (string?)null, order = 1.5, budgetCents = 12345L },
                new { id = "g-casa-luz", name = "Luz", type = "gasto", parentId = "g-casa", order = 0, budgetCents = (long?)null },
            },
            movements = new object[] { Movement("queda", categoryId: "g-casa-luz") },
            recurring = new object[]
            {
                new
                {
                    id = "r-casa", concept = "Alquiler", amountCents = 65000L, type = "gasto", categoryId = "g-casa", frequency = "mensual",
                    startDate = "2026-01-31", endDate = (string?)null, installments = (int?)null, notes = "", excludedDates = new[] { "2026-02-28" },
                    createdAt = Now, updatedAt = Now,
                },
            },
        };
        // Las subcategorías van antes que su principal: se guardan igual (primero las principales).
        var reversed = new { data.recurring, data.movements, categories = data.categories.Reverse().ToArray() };
        await api.Data("PUT", "/api/data", reversed);
        var stored = await api.Data("GET", "/api/data");
        Assert.True(JsonElement.DeepEquals(JsonSerializer.SerializeToElement(data), stored), stored.ToString());
        Assert.Equal(Now, (await api.Data("GET", "/api/meta/lastBackupAt")).GetProperty("value").GetString());
    }

    [Fact]
    public async Task Restaurar_valida_todo_antes_de_tocar_nada()
    {
        var (database, api) = await Start();
        await using var _ = database;
        await using var __ = api;
        await api.Data("PUT", "/api/movements/se-queda", Movement("se-queda"));
        await api.Fails("PUT", "/api/data", null, 400, "VALIDATION", "No se han recibido los datos.");
        await api.Fails("PUT", "/api/data", new { categories = Array.Empty<object>(), movements = Array.Empty<object>() }, 400, "VALIDATION",
            "La copia no contiene la lista de recurrentes.");
        await api.Fails("PUT", "/api/data", new { categories = Array.Empty<object>(), movements = new[] { Movement("m") }, recurring = Array.Empty<object>() },
            400, "VALIDATION", "El movimiento nº 1 («Compra») usa una categoría que no existe.");
        Assert.Equal("se-queda", Assert.Single(await Movements(api)).GetProperty("id").GetString());
    }

    [Fact]
    public async Task Una_restauracion_que_falla_a_medias_no_cambia_nada()
    {
        await using var database = await TestDatabase.Create();
        var (opened, _) = await database.Open(Clock);
        var store = new MySqlFinanceStore(opened);
        var unitOfWork = new MySqlUnitOfWork(opened);
        await new SaveMovement(store, unitOfWork).Execute(new Movement("se-conserva", "Se conserva", 500, "gasto", "g-ocio", "realizado",
            "2026-10-01", null, "", null, null, null, Now, Now));
        var before = await new FinanceQueries(store, unitOfWork).LoadAll();
        // Sin validar: un movimiento con una categoría inexistente hace fallar la clave foránea dentro de la transacción.
        var broken = new FinanceData(DefaultCategories.All, [new Movement("roto", "Roto", 1, "gasto", "no-existe", "realizado",
            "2026-10-01", null, "", null, null, null, Now, Now)], []);
        await Assert.ThrowsAnyAsync<Exception>(() => new RestoreBackup(store, unitOfWork).Execute(broken));
        var after = await new FinanceQueries(store, unitOfWork).LoadAll();
        Assert.Equal(JsonSerializer.Serialize(before), JsonSerializer.Serialize(after));
    }
}
