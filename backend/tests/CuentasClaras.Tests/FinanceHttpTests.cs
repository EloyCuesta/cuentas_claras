using System.Text.Json;
using CuentasClaras.Application.Common;
using CuentasClaras.Application.Finance;
using CuentasClaras.Domain.Finance;
using CuentasClaras.Infrastructure.Common.MySql;
using CuentasClaras.Infrastructure.Finance;

namespace CuentasClaras.Tests;

/// <summary>
/// Las finanzas de .NET por HTTP sobre MySQL real (FIN-01): lectura de /api/data, categorías con su sustitución y
/// metadatos, con los mensajes de Express. Reproducen las pruebas de server/modules/finance/finance.test.ts y de
/// server/app.test.ts que tocan estas rutas; cada una crea su base cuentas_test_* y la borra.
/// </summary>
[Trait("Categoria", TestDatabase.Category)]
public sealed class FinanceHttpTests
{
    private const string Now = "2026-11-01T08:00:00.000Z";
    private static readonly FixedClock Clock = new(DateTimeOffset.Parse(Now, System.Globalization.CultureInfo.InvariantCulture).ToUnixTimeMilliseconds());

    private static object Category(string id, string name, string type = "gasto", string? parentId = null, double order = 0, long? budgetCents = null) =>
        new { id, name, type, parentId, order, budgetCents };

    private static async Task Movement(TestDatabase database, string id, string categoryId, string type = "gasto") =>
        await database.Execute(
            "INSERT INTO movements (id, concept, amount_cents, type, category_id, status, paid_date, due_date, notes, recurring_id, occurrence_date, installment_number, created_at, updated_at) " +
            "VALUES (?, ?, 1234, ?, ?, 'realizado', '2026-10-01', NULL, '', NULL, NULL, NULL, 'antes', 'antes')",
            id, $"Concepto {id}", type, categoryId);

    private static async Task Rule(TestDatabase database, string id, string categoryId) =>
        await database.Execute(
            "INSERT INTO recurring_rules (id, concept, amount_cents, type, category_id, frequency, start_date, end_date, installments, notes, created_at, updated_at) " +
            "VALUES (?, 'Cuota', 5000, 'gasto', ?, 'mensual', '2026-01-31', NULL, NULL, '', 'antes', 'antes')", id, categoryId);

    private static async Task<(TestDatabase Database, TestApi Api)> Start()
    {
        var database = await TestDatabase.Create();
        var (opened, _) = await database.Open(Clock);
        return (database, await TestApi.Start(opened, Clock));
    }

    private static string[] Ids(JsonElement list) => [.. list.EnumerateArray().Select(item => item.GetProperty("id").GetString()!)];

    [Fact]
    public async Task Empieza_sin_movimientos_con_las_categorias_iniciales_y_solo_con_finanzas()
    {
        var (database, api) = await Start();
        await using var _ = database;
        await using var __ = api;
        var data = await api.Data("GET", "/api/data");
        Assert.Equal(new[] { "categories", "movements", "recurring" }, data.EnumerateObject().Select(property => property.Name));
        Assert.Equal(DefaultCategories.All.Select(category => category.Id).Order(StringComparer.Ordinal), Ids(data.GetProperty("categories")));
        Assert.Empty(data.GetProperty("movements").EnumerateArray());
        Assert.Empty(data.GetProperty("recurring").EnumerateArray());
        var luz = data.GetProperty("categories").EnumerateArray().Single(category => category.GetProperty("id").GetString() == "g-vivienda-luz");
        Assert.True(JsonElement.DeepEquals(
            JsonSerializer.SerializeToElement(new { id = "g-vivienda-luz", name = "Luz", type = "gasto", parentId = "g-vivienda", order = 1, budgetCents = (long?)null }), luz),
            luz.ToString());
        await api.Fails("GET", "/api/data", null, 401, "UNAUTHORIZED", "Hace falta el código de acceso para ver esta sección.", guest: true);
    }

    [Fact]
    public async Task Guarda_el_orden_fraccionario_y_los_presupuestos_tal_cual_incluidos_cero_y_el_maximo()
    {
        var (database, api) = await Start();
        await using var _ = database;
        await using var __ = api;
        await api.Data("PUT", "/api/categories/g-cero", Category("g-cero", "Cero", order: 2.75, budgetCents: 0));
        await api.Data("PUT", "/api/categories/g-maximo", Category("g-maximo", "Máximo", order: -1.5, budgetCents: FinanceRequests.MaxCents));
        await api.Data("PUT", "/api/categories/g-cero", Category("g-cero", "Cero editada", order: 0.1, budgetCents: null));
        var categories = (await api.Data("GET", "/api/data")).GetProperty("categories").EnumerateArray().ToArray();
        var cero = categories.Single(category => category.GetProperty("id").GetString() == "g-cero");
        var maximo = categories.Single(category => category.GetProperty("id").GetString() == "g-maximo");
        Assert.Equal("{\"id\":\"g-cero\",\"name\":\"Cero editada\",\"type\":\"gasto\",\"parentId\":null,\"order\":0.1,\"budgetCents\":null}", cero.GetRawText());
        Assert.Equal(-1.5, maximo.GetProperty("order").GetDouble());
        Assert.Equal(99_999_999_999, maximo.GetProperty("budgetCents").GetInt64());
    }

    [Fact]
    public async Task Los_ids_distinguen_mayusculas_tildes_y_espacios_finales_y_se_ordenan_como_en_SQLite()
    {
        var (database, api) = await Start();
        await using var _ = database;
        await using var __ = api;
        string[] ids = ["x-pina", "x-piña", "x-PINA", "x-pina "];
        foreach (var id in ids) await api.Data("PUT", $"/api/categories/{Uri.EscapeDataString(id)}", Category(id, $"Nombre {id}"));
        var stored = Ids((await api.Data("GET", "/api/data")).GetProperty("categories")).Where(id => id.StartsWith("x-", StringComparison.Ordinal));
        Assert.Equal(ids.Order(StringComparer.Ordinal), stored);
    }

    [Fact]
    public async Task Solo_permite_un_nivel_de_subcategorias_del_mismo_tipo_y_no_cambia_de_tipo()
    {
        var (database, api) = await Start();
        await using var _ = database;
        await using var __ = api;
        await api.Fails("PUT", "/api/categories/g-sub", Category("g-sub", "Sub", parentId: "g-no-existe"), 400, "VALIDATION", "La categoría principal no existe.");
        await api.Fails("PUT", "/api/categories/g-sub", Category("g-sub", "Sub", parentId: "g-sub"), 400, "VALIDATION", "La categoría principal no existe.");
        await api.Fails("PUT", "/api/categories/g-nieta", Category("g-nieta", "Nieta", parentId: "g-vivienda-luz"), 400, "VALIDATION", "Solo hay un nivel de subcategorías.");
        await api.Fails("PUT", "/api/categories/g-cruzada", Category("g-cruzada", "Cruzada", parentId: "i-nomina"), 400, "VALIDATION",
            "La subcategoría debe ser del mismo tipo que su categoría principal.");
        await api.Fails("PUT", "/api/categories/g-vivienda", Category("g-vivienda", "Vivienda", parentId: "g-coche"), 400, "VALIDATION",
            "Una categoría con subcategorías no puede pasar a ser subcategoría.");
        await api.Fails("PUT", "/api/categories/g-ocio", Category("g-ocio", "Ocio", type: "ingreso"), 409, "CONFLICT",
            "No se puede cambiar una categoría de gastos a ingresos ni al revés.");
        await api.Data("PUT", "/api/categories/g-ocio-cine", Category("g-ocio-cine", "Cine", parentId: "g-ocio"));
        var cine = (await api.Data("GET", "/api/data")).GetProperty("categories").EnumerateArray().Single(category => category.GetProperty("id").GetString() == "g-ocio-cine");
        Assert.Equal("g-ocio", cine.GetProperty("parentId").GetString());
    }

    [Fact]
    public async Task Valida_el_cuerpo_antes_que_el_id_de_la_url()
    {
        var (database, api) = await Start();
        await using var _ = database;
        await using var __ = api;
        await api.Fails("PUT", "/api/categories/g-x", null, 400, "VALIDATION", "La categoría no tiene un formato válido.");
        await api.Fails("PUT", "/api/categories/g-x", "[]", 400, "VALIDATION", "La categoría no tiene un formato válido.");
        await api.Fails("PUT", "/api/categories/g-x", Category("g-x", "  "), 400, "VALIDATION", "La categoría: el campo «name» está vacío.");
        await api.Fails("PUT", "/api/categories/g-x", Category("g-x", "X", type: "otro"), 400, "VALIDATION", "La categoría: el campo «type» debe ser «ingreso» o «gasto».");
        await api.Fails("PUT", "/api/categories/g-x", Category("g-x", "X", budgetCents: -1), 400, "VALIDATION",
            "La categoría: el campo «budgetCents» debe ser un número entero entre 0 y 99999999999.");
        await api.Fails("PUT", "/api/categories/otro-id", Category("g-x", "X"), 400, "VALIDATION", "El id de la dirección no coincide con el de los datos.");
        // Un parámetro de la ruta se decodifica antes de compararlo.
        await api.Data("PUT", "/api/categories/g-con%20espacio", Category("g-con espacio", "Con espacio"));
        Assert.Contains("g-con espacio", Ids((await api.Data("GET", "/api/data")).GetProperty("categories")));
    }

    [Fact]
    public async Task Eliminar_una_categoria_en_uso_exige_destino_y_pasa_movimientos_y_recurrentes_con_sus_subcategorias()
    {
        var (database, api) = await Start();
        await using var _ = database;
        await using var __ = api;
        await Movement(database, "mov-luz", "g-vivienda-luz");
        await Movement(database, "mov-vivienda", "g-vivienda");
        await Rule(database, "regla-agua", "g-vivienda-agua");
        await Movement(database, "mov-ocio", "g-ocio");

        await api.Fails("DELETE", "/api/categories/g-vivienda", null, 409, "CONFLICT", "La categoría tiene movimientos: elige a qué categoría pasarlos.");
        await api.Data("DELETE", "/api/categories/g-vivienda?replacementId=g-otros");

        var data = await api.Data("GET", "/api/data");
        Assert.DoesNotContain(Ids(data.GetProperty("categories")), id => id.StartsWith("g-vivienda", StringComparison.Ordinal));
        var movements = data.GetProperty("movements").EnumerateArray().ToDictionary(movement => movement.GetProperty("id").GetString()!);
        Assert.Equal("g-otros", movements["mov-luz"].GetProperty("categoryId").GetString());
        Assert.Equal("g-otros", movements["mov-vivienda"].GetProperty("categoryId").GetString());
        Assert.Equal(Now, movements["mov-luz"].GetProperty("updatedAt").GetString());
        Assert.Equal("antes", movements["mov-luz"].GetProperty("createdAt").GetString());
        Assert.Equal("g-ocio", movements["mov-ocio"].GetProperty("categoryId").GetString());
        Assert.Equal("antes", movements["mov-ocio"].GetProperty("updatedAt").GetString());
        var rule = data.GetProperty("recurring").EnumerateArray().Single();
        Assert.Equal("g-otros", rule.GetProperty("categoryId").GetString());
        Assert.Equal(Now, rule.GetProperty("updatedAt").GetString());
    }

    [Fact]
    public async Task El_destino_tiene_que_existir_ser_del_mismo_tipo_y_no_estar_entre_las_que_se_borran()
    {
        var (database, api) = await Start();
        await using var _ = database;
        await using var __ = api;
        await Movement(database, "mov-luz", "g-vivienda-luz");
        foreach (var replacement in new[] { "g-no-existe", "i-nomina", "g-vivienda-agua", "g-vivienda" })
            await api.Fails("DELETE", $"/api/categories/g-vivienda?replacementId={replacement}", null, 400, "VALIDATION", "La categoría de destino no es válida.");
        foreach (var query in new[] { "?replacementId=", "?replacementId", "?replacementId=g-otros&replacementId=g-ocio" })
            await api.Fails("DELETE", $"/api/categories/g-vivienda{query}", null, 400, "VALIDATION", "El parámetro «replacementId» no es válido.");
        var data = await api.Data("GET", "/api/data");
        Assert.Contains("g-vivienda-luz", Ids(data.GetProperty("categories")));
        Assert.Equal("g-vivienda-luz", data.GetProperty("movements")[0].GetProperty("categoryId").GetString());
    }

    [Fact]
    public async Task Borrar_una_categoria_sin_uso_o_que_no_existe_responde_bien()
    {
        var (database, api) = await Start();
        await using var _ = database;
        await using var __ = api;
        await api.Data("DELETE", "/api/categories/g-no-existe");
        await api.Data("DELETE", "/api/categories/g-seguros");
        // Un destino que no hace falta no se comprueba si la categoría no existe.
        await api.Data("DELETE", "/api/categories/g-no-existe?replacementId=i-nomina");
        var ids = Ids((await api.Data("GET", "/api/data")).GetProperty("categories"));
        Assert.DoesNotContain(ids, id => id.StartsWith("g-seguros", StringComparison.Ordinal));
        Assert.Equal(DefaultCategories.All.Count - 5, ids.Length);
    }

    [Fact]
    public async Task Un_fallo_a_mitad_de_la_sustitucion_no_deja_nada_cambiado()
    {
        await using var database = await TestDatabase.Create();
        var (opened, _) = await database.Open(Clock);
        await Movement(database, "mov-luz", "g-vivienda-luz");
        var store = new FailingDelete(new MySqlFinanceStore(opened));
        var deleteCategory = new DeleteCategory(store, Clock, new MySqlUnitOfWork(opened));

        await Assert.ThrowsAsync<InvalidOperationException>(() => deleteCategory.Execute("g-vivienda", "g-otros"));
        Assert.True(store.Reassigned);
        Assert.Equal("g-vivienda-luz", await database.Scalar("SELECT category_id FROM movements WHERE id = 'mov-luz'"));
        Assert.Equal("antes", await database.Scalar("SELECT updated_at FROM movements WHERE id = 'mov-luz'"));
        Assert.Equal(6L, await database.Scalar("SELECT COUNT(*) FROM categories WHERE id LIKE 'g-vivienda%'"));
    }

    [Fact]
    public async Task Las_categorias_iniciales_no_reaparecen_al_volver_a_abrir()
    {
        await using var database = await TestDatabase.Create();
        var (opened, _) = await database.Open(Clock);
        await using (var api = await TestApi.Start(opened, Clock))
            await api.Data("DELETE", "/api/categories/i-extra");
        var (reopened, _) = await database.Open(Clock);
        await using var again = await TestApi.Start(reopened, Clock);
        var ids = Ids((await again.Data("GET", "/api/data")).GetProperty("categories"));
        Assert.DoesNotContain("i-extra", ids);
        Assert.Equal(DefaultCategories.All.Count - 1, ids.Length);
    }

    [Fact]
    public async Task Los_metadatos_se_guardan_con_su_clave_y_un_texto_de_hasta_100()
    {
        var (database, api) = await Start();
        await using var _ = database;
        await using var __ = api;
        Assert.Equal(JsonValueKind.Null, (await api.Data("GET", "/api/meta/lastBackupAt")).GetProperty("value").ValueKind);
        await api.Data("PUT", "/api/meta/lastBackupAt", new { value = Now });
        Assert.Equal(Now, (await api.Data("GET", "/api/meta/lastBackupAt")).GetProperty("value").GetString());
        await api.Data("PUT", "/api/meta/browserImportAt", new { value = new string('x', 100) });
        Assert.Equal(100, (await api.Data("GET", "/api/meta/browserImportAt")).GetProperty("value").GetString()!.Length);
        await api.Data("PUT", "/api/meta/lastBackupAt", new { value = "" });
        Assert.Equal("", (await api.Data("GET", "/api/meta/lastBackupAt")).GetProperty("value").GetString());

        await api.Fails("GET", "/api/meta/no-existe", null, 404, "NOT_FOUND", "No existe el dato «no-existe».");
        // La clave se comprueba antes que el cuerpo.
        await api.Fails("PUT", "/api/meta/no-existe", null, 404, "NOT_FOUND", "No existe el dato «no-existe».");
        await api.Fails("PUT", "/api/meta/lastBackupAt", null, 400, "VALIDATION", "Falta el cuerpo de la petición en JSON.");
        await api.Fails("PUT", "/api/meta/lastBackupAt", new { value = new string('x', 101) }, 400, "VALIDATION",
            "El campo «value» debe ser un texto de 100 caracteres como máximo.");
        await api.Fails("PUT", "/api/meta/lastBackupAt", new { value = 42 }, 400, "VALIDATION",
            "El campo «value» debe ser un texto de 100 caracteres como máximo.");
        await api.Fails("GET", "/api/meta/lastBackupAt", null, 401, "UNAUTHORIZED", "Hace falta el código de acceso para ver esta sección.", guest: true);
    }

    [Fact]
    public async Task Un_escape_mal_formado_en_la_ruta_da_el_error_interno_de_Express_salvo_sin_sesion()
    {
        var (database, api) = await Start();
        await using var _ = database;
        await using var __ = api;
        await api.Fails("GET", "/api/meta/%E0%A4%A", null, 500, "INTERNAL", "Error interno del servidor. Revisa la consola donde se ejecuta npm run dev.");
        await api.Fails("DELETE", "/api/categories/%C3", null, 500, "INTERNAL", "Error interno del servidor. Revisa la consola donde se ejecuta npm run dev.");
        await api.Fails("GET", "/api/meta/%E0%A4%A", null, 401, "UNAUTHORIZED", "Hace falta el código de acceso para ver esta sección.", guest: true);
    }

    /// <summary>Falla al borrar, después de reasignar: la transacción tiene que deshacer la reasignación.</summary>
    private sealed class FailingDelete(IFinanceStore inner) : IFinanceStore
    {
        public bool Reassigned { get; private set; }
        public Task<FinanceData> ReadAll() => inner.ReadAll();
        public Task<IReadOnlyList<Category>> ListCategories() => inner.ListCategories();
        public Task<Category?> GetCategory(string id) => inner.GetCategory(id);
        public Task<long> CountChildren(string categoryId) => inner.CountChildren(categoryId);
        public Task UpsertCategory(Category category) => inner.UpsertCategory(category);
        public Task<long> CountCategoryUsage(IReadOnlyList<string> categoryIds) => inner.CountCategoryUsage(categoryIds);
        public async Task ReassignCategories(IReadOnlyList<string> categoryIds, string replacementId, string now)
        {
            await inner.ReassignCategories(categoryIds, replacementId, now);
            Reassigned = true;
        }
        public Task DeleteCategories(IReadOnlyList<string> categoryIds) => throw new InvalidOperationException("fallo sintético al borrar");
        public Task<string?> GetMeta(string key) => inner.GetMeta(key);
        public Task SetMeta(string key, string value) => inner.SetMeta(key, value);
    }
}
