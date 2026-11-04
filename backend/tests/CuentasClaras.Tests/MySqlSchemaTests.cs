using CuentasClaras.Infrastructure.Common.MySql;
using MySqlConnector;

namespace CuentasClaras.Tests;

/// <summary>
/// El esquema actual leído y escrito desde C#, con los tipos de docs/migration/DATA.md: céntimos, milésimas, DATE,
/// nulos, claves que comparan como SQLite, índices únicos y JSON como texto exacto.
/// </summary>
[Trait("Categoria", TestDatabase.Category)]
public sealed class MySqlSchemaTests
{
    private static CancellationToken Token => TestContext.Current.CancellationToken;

    [Fact]
    public async Task Cada_conexion_fija_utf8mb4_0900_bin_el_modo_estricto_y_REPEATABLE_READ_tambien_al_reutilizarla()
    {
        await using var test = await TestDatabase.Create();
        var (database, _) = await test.Open();
        // Dos veces: la segunda conexión sale del pool, que reinicia la sesión al devolverla.
        for (var round = 0; round < 2; round++)
        {
            var session = (await database.Rows(
                "SELECT @@collation_connection, @@character_set_client, @@character_set_results, @@sql_mode, @@transaction_isolation", [],
                reader => (reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.GetString(3), reader.GetString(4)), Token))[0];
            Assert.Equal(("utf8mb4_0900_bin", "utf8mb4", "utf8mb4",
                "ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION",
                "REPEATABLE-READ"), session);
        }
        // Un texto suelto también compara con la colación de la aplicación.
        Assert.Equal(new long[] { 0, 0, 0 }, (await database.Rows("SELECT 'pina' = 'piña', 'abc' = 'abc ', 'a' = 'A'", [],
            reader => new[] { reader.GetInt64(0), reader.GetInt64(1), reader.GetInt64(2) }, Token))[0]);
    }

    [Fact]
    public async Task Solo_admite_texto_numeros_finitos_y_null_como_parametros_nunca_una_fecha_de_NET()
    {
        await using var test = await TestDatabase.Create();
        var (database, _) = await test.Open();
        foreach (var value in new object[] { new DateTime(2026, 11, 4), new DateOnly(2026, 11, 4), DateTimeOffset.UnixEpoch, true, double.NaN })
        {
            var error = await Assert.ThrowsAsync<ArgumentException>(() => database.Rows("SELECT ?", [value], reader => reader.GetValue(0), Token));
            Assert.Contains("Parámetro SQL no admitido", error.Message);
        }
        string?[] expected = ["texto", "1", "99999999999", "0.001", "0.5", null];
        Assert.Equal(expected,
            (await database.Rows("SELECT ?, ?, ?, ?, ?, ?", ["texto", 1, 99_999_999_999L, 0.001m, 0.5, null],
                reader => Enumerable.Range(0, 6).Select(index => reader.IsDBNull(index) ? null
                    : Convert.ToString(reader.GetValue(index), System.Globalization.CultureInfo.InvariantCulture)).ToArray(), Token))[0]);
    }

    [Fact]
    public async Task Guarda_centimos_milesimas_pesos_y_el_orden_sin_perder_precision()
    {
        await using var test = await TestDatabase.Create();
        var (database, _) = await test.Open();
        // MAX_CENTS de shared/common/money.ts y las devoluciones en negativo de los tickets.
        await database.Run("INSERT INTO categories (id, name, type, parent_id, order_index, budget_cents) VALUES (?, ?, ?, NULL, ?, ?)",
            ["c1", "Máximo", "gasto", 0.1 + 0.2, 99_999_999_999L], Token);
        await database.Run("INSERT INTO pantry_tickets (id, store, store_name, purchase_date, total_cents, fingerprint, created_at) " +
            "VALUES ('t1', 'otra', 'Otra', '2026-11-01', ?, 'f1', 'x')", [-10_000_000L], Token);
        await database.Run("INSERT INTO pantry_items (id, name, unit, quantity, target, frequency, created_at, updated_at) " +
            "VALUES ('a', 'A', 'kg', ?, ?, 'semanal', 'x', 'x'), ('b', 'B', 'kg', ?, ?, 'semanal', 'x', 'x')",
            [0.001m, 999_999.999m, 1_000_000m, 0m], Token);
        await database.Run("INSERT INTO pantry_ticket_lines (id, ticket_id, position, raw_name, name_key, quantity, weight_kg) " +
            "VALUES ('l1', 't1', 0, 'PERA', 'pera', 1, ?), ('l2', 't1', 1, 'MELON', 'melon', 1, ?)", [0.005m, 1000m], Token);

        var category = (await database.Rows("SELECT order_index, budget_cents FROM categories WHERE id = 'c1'", [],
            reader => (reader.GetDouble(0), MySqlRead.Integer(reader, "budget_cents")), Token))[0];
        Assert.Equal((0.1 + 0.2, 99_999_999_999L), category);
        Assert.Equal(-10_000_000L, (await database.Rows("SELECT total_cents FROM pantry_tickets", [],
            reader => MySqlRead.NullableInteger(reader, "total_cents"), Token))[0]);
        Assert.Equal([(0.001m, 999_999.999m), (1_000_000m, 0m)], await database.Rows("SELECT quantity, target FROM pantry_items ORDER BY id", [],
            reader => (MySqlRead.Decimal(reader, "quantity"), MySqlRead.Decimal(reader, "target")), Token));
        Assert.Equal([0.005m, 1000m], await database.Rows("SELECT weight_kg FROM pantry_ticket_lines ORDER BY position", [],
            reader => MySqlRead.NullableDecimal(reader, "weight_kg")!.Value, Token));
        // Las sumas en milésimas son exactas: 0,001 + 1.000.000 sin redondeos de double.
        Assert.Equal(1_000_000.001m, (await database.Rows("SELECT SUM(quantity) FROM pantry_items", [], reader => reader.GetDecimal(0), Token))[0]);
    }

    [Fact]
    public async Task Las_fechas_son_DATE_se_leen_como_AAAA_MM_DD_sin_desplazamiento_y_una_fecha_imposible_se_rechaza()
    {
        await using var test = await TestDatabase.Create();
        var (database, _) = await test.Open();
        // Bisiesto, fin de año y los cambios de hora de Europa/Madrid: ningún día se mueve.
        string[] dates = ["2024-02-29", "1999-12-31", "2026-03-29", "2026-10-25", "2026-01-01"];
        await database.Run("INSERT INTO pantry_items (id, name, unit, quantity, target, frequency, created_at, updated_at) " +
            "VALUES ('i', 'Leche', 'l', 1, 2, 'semanal', 'x', 'x')", [], Token);
        for (var index = 0; index < dates.Length; index++)
            await database.Run("INSERT INTO pantry_events (id, item_id, kind, event_date, created_at) VALUES (?, 'i', 'queda', ?, 'x')",
                [$"e{index}", dates[index]], Token);
        Assert.Equal(dates, await database.Rows("SELECT event_date FROM pantry_events ORDER BY id", [],
            reader => MySqlRead.Date(reader, "event_date"), Token));
        var impossible = await Assert.ThrowsAsync<MySqlException>(() => database.Run(
            "INSERT INTO pantry_events (id, item_id, kind, event_date, created_at) VALUES ('x', 'i', 'queda', '2026-02-30', 'x')", [], Token));
        Assert.Equal(1292, impossible.Number);
    }

    [Fact]
    public async Task Los_nulos_se_leen_como_null_y_los_valores_presentes_tal_cual()
    {
        await using var test = await TestDatabase.Create();
        var (database, _) = await test.Open();
        await database.Run("INSERT INTO pantry_tickets (id, store, store_name, purchase_date, purchase_time, total_cents, fingerprint, created_at) " +
            "VALUES ('t1', 'otra', 'Otra', '2026-11-01', NULL, NULL, 'f1', 'x'), ('t2', 'lidl', 'Lidl', '2026-11-02', '09:30', 0, 'f2', 'x')", [], Token);
        await database.Run("INSERT INTO pantry_settings (id, monthly_budget_cents, last_review_date) VALUES (1, NULL, NULL)", [], Token);
        (string, string?, long?, string?, string?)[] expected = [("t1", null, null, null, null), ("t2", "09:30", 0L, null, null)];
        Assert.Equal(expected, await database.Rows(
            "SELECT id, purchase_time, total_cents, import_id, source_fingerprint FROM pantry_tickets ORDER BY id", [],
            reader => (MySqlRead.Text(reader, "id"), MySqlRead.NullableText(reader, "purchase_time"), MySqlRead.NullableInteger(reader, "total_cents"),
                MySqlRead.NullableText(reader, "import_id"), MySqlRead.NullableText(reader, "source_fingerprint")), Token));
        Assert.Equal(((long?)null, (string?)null), (await database.Rows("SELECT monthly_budget_cents, last_review_date FROM pantry_settings", [],
            reader => (MySqlRead.NullableInteger(reader, "monthly_budget_cents"), MySqlRead.NullableDate(reader, "last_review_date")), Token))[0]);
    }

    [Fact]
    public async Task Las_claves_comparan_como_SQLite_mayusculas_tildes_y_espacios_finales_cuentan()
    {
        await using var test = await TestDatabase.Create();
        var (database, _) = await test.Open();
        string[] ids = ["pina", "piña", "PINA", "abc", "abc "];
        foreach (var id in ids)
            await database.Run("INSERT INTO pantry_people (id, name, created_at) VALUES (?, 'Persona', 'x')", [id], Token);
        Assert.Equal(ids.Order(StringComparer.Ordinal), await database.Rows("SELECT id FROM pantry_people ORDER BY id", [],
            reader => MySqlRead.Text(reader, "id"), Token));
        Assert.Equal(["abc"], await database.Rows("SELECT id FROM pantry_people WHERE id = ?", ["abc"], reader => reader.GetString(0), Token));
        var repeated = await Assert.ThrowsAsync<MySqlException>(() =>
            database.Run("INSERT INTO pantry_people (id, name, created_at) VALUES ('piña', 'Otra', 'x')", [], Token));
        Assert.Equal(1062, repeated.Number);
        Assert.True(MySqlErrors.IsConstraintViolation(repeated));
    }

    [Fact]
    public async Task Los_indices_unicos_rechazan_un_valor_repetido_y_admiten_varios_null()
    {
        await using var test = await TestDatabase.Create();
        var (database, _) = await test.Open();
        const string ticket = "INSERT INTO pantry_tickets (id, store, store_name, purchase_date, fingerprint, created_at, import_id) " +
            "VALUES (?, 'otra', 'Otra', '2026-11-01', ?, 'x', ?)";
        await database.Run(ticket, ["t1", "f1", null], Token);
        await database.Run(ticket, ["t2", "f2", null], Token);
        await database.Run(ticket, ["t3", "f3", "imp-1"], Token);
        foreach (var (id, fingerprint, import, key) in new[] { ("t4", "f1", (string?)null, "pantry_tickets_fingerprint"), ("t5", "f5", "imp-1", "pantry_ticket_import") })
        {
            var error = await Assert.ThrowsAsync<MySqlException>(() => database.Run(ticket, [id, fingerprint, import], Token));
            Assert.Equal(1062, error.Number);
            Assert.Contains(key, error.Message);
        }
        // Un vencimiento no existe dos veces: (recurring_id, occurrence_date).
        const string movement = "INSERT INTO movements (id, concept, amount_cents, type, category_id, status, due_date, recurring_id, occurrence_date, created_at, updated_at) " +
            "VALUES (?, 'Cuota', 100, 'gasto', 'g-vivienda-luz', 'pendiente', '2026-12-01', 'r1', '2026-12-01', 'x', 'x')";
        await database.Run(movement, ["m1"], Token);
        Assert.Equal(1062, (await Assert.ThrowsAsync<MySqlException>(() => database.Run(movement, ["m2"], Token))).Number);
    }

    [Fact]
    public async Task Los_JSON_y_los_instantes_se_guardan_como_texto_exacto()
    {
        await using var test = await TestDatabase.Create();
        var (database, _) = await test.Open();
        // Espacios, orden de claves, escapes y tildes tal cual: el tipo JSON de MySQL los normalizaría.
        const string adjustments = "[{\"importe\": -120,  \"concepto\":\"Descuento \\u00f1 ñ\"}, {\"b\":1,\"a\":2}]";
        var evidence = "{\"texto\":\"" + new string('x', 70_000) + "\"}";
        const string instant = "2026-11-04T17:13:15.121Z";
        await database.Run("INSERT INTO pantry_tickets (id, store, store_name, purchase_date, fingerprint, created_at, adjustments_json) " +
            "VALUES ('t1', 'otra', 'Otra', '2026-11-01', 'f1', ?, ?)", [instant, adjustments], Token);
        await database.Run("INSERT INTO pantry_ticket_lines (id, ticket_id, position, raw_name, name_key, quantity, evidence_json) " +
            "VALUES ('l1', 't1', 0, 'X', 'x', 1, ?)", [evidence], Token);
        Assert.Equal((instant, adjustments, "[]"), (await database.Rows("SELECT created_at, adjustments_json, issues_json FROM pantry_tickets", [],
            reader => (MySqlRead.Text(reader, "created_at"), MySqlRead.Text(reader, "adjustments_json"), MySqlRead.Text(reader, "issues_json")), Token))[0]);
        Assert.Equal(evidence, (await database.Rows("SELECT evidence_json FROM pantry_ticket_lines", [],
            reader => MySqlRead.NullableText(reader, "evidence_json"), Token))[0]);
    }

    [Fact]
    public async Task Las_restricciones_llegan_como_errores_de_restriccion()
    {
        await using var test = await TestDatabase.Create();
        var (database, _) = await test.Open();
        var check = await Assert.ThrowsAsync<MySqlException>(() => database.Run(
            "INSERT INTO movements (id, concept, amount_cents, type, category_id, status, due_date, created_at, updated_at) " +
            "VALUES ('m1', 'Cero', 0, 'gasto', 'g-vivienda-luz', 'pendiente', '2026-12-01', 'x', 'x')", [], Token));
        var foreign = await Assert.ThrowsAsync<MySqlException>(() => database.Run(
            "INSERT INTO movements (id, concept, amount_cents, type, category_id, status, due_date, created_at, updated_at) " +
            "VALUES ('m1', 'Sin categoría', 1, 'gasto', 'no-existe', 'pendiente', '2026-12-01', 'x', 'x')", [], Token));
        Assert.Equal((3819, 1452), (check.Number, foreign.Number));
        Assert.True(MySqlErrors.IsConstraintViolation(check) && MySqlErrors.IsConstraintViolation(foreign));
    }
}
