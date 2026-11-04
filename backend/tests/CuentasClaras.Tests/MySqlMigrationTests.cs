using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using CuentasClaras.Domain.Finance;
using CuentasClaras.Infrastructure.Common.MySql;

namespace CuentasClaras.Tests;

/// <summary>Las migraciones compartidas con Express (database/mysql/) aplicadas desde .NET, contra MySQL de verdad.</summary>
public sealed class MySqlMigrationTests
{
    private static readonly string[] AppTables =
    [
        "categories", "meta", "movements", "pantry_aliases", "pantry_events", "pantry_items", "pantry_people",
        "pantry_settings", "pantry_ticket_lines", "pantry_tickets", "recurring_excluded_dates", "recurring_rules",
    ];
    private static readonly string[] AllTables = [.. AppTables.Append("app_locks").Append("schema_migrations").Order(StringComparer.Ordinal)];

    [Fact]
    public void Separa_un_archivo_en_sentencias_sin_los_comentarios_y_exige_el_punto_y_coma_final()
    {
        Assert.Equal(["CREATE TABLE a (\n  x INT\n)", "INSERT INTO a VALUES (1)"],
            MySqlMigrations.SplitStatements("-- comentario; con punto y coma\r\nCREATE TABLE a (\n  x INT\n);\n\n-- otro\nINSERT INTO a VALUES (1);\n"));
        var error = Assert.Throws<InvalidOperationException>(() => MySqlMigrations.SplitStatements("CREATE TABLE a (x INT)"));
        Assert.Contains("Falta el «;» final", error.Message);
    }

    [Fact]
    public void Incrusta_los_archivos_publicados_sin_cambios_y_la_primera_migracion_es_la_5()
    {
        Assert.Equal([(5, "esquema inicial", "005-esquema-inicial.sql")],
            MySqlMigrations.All.Select(migration => (migration.Version, migration.Name, migration.File)));
        Assert.Equal(5, MySqlMigrations.LatestVersion);
        // Las mismas huellas que server/common/mysql/migrations.test.ts (texto con saltos \n): un cambio va en una migración nueva.
        var hashes = MySqlMigrations.EmbeddedFiles().ToDictionary(file => file,
            file => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(MySqlMigrations.ReadEmbedded(file)))));
        Assert.Equal(new Dictionary<string, string>
        {
            ["migrations/005-esquema-inicial.sql"] = "7d1782a5b37cf15a2ebb34b83a34558bb6ef24616bd2b30591f0c9c326fe6af0",
            ["schema_migrations.sql"] = "3bcc3de7446105d332753e7131fadfa91827e3c5fd76d8117378196daca38d84",
        }, hashes);
        // Y son los del repositorio, no los de una compilación anterior.
        var folder = Path.Combine(RepositoryRoot(), "database", "mysql");
        var onDisk = Directory.GetFiles(folder, "*.sql", SearchOption.AllDirectories)
            .Select(path => Path.GetRelativePath(folder, path).Replace('\\', '/')).Order(StringComparer.Ordinal);
        Assert.Equal(onDisk, MySqlMigrations.EmbeddedFiles());
        foreach (var file in MySqlMigrations.EmbeddedFiles())
            Assert.Equal(File.ReadAllText(Path.Combine(folder, file)).Replace("\r\n", "\n"), MySqlMigrations.ReadEmbedded(file));
    }

    [Fact]
    public void Las_categorias_iniciales_son_las_del_contrato_de_Express()
    {
        using var fixture = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "http-testing.json")));
        var step = fixture.RootElement.GetProperty("scenarios").EnumerateArray()
            .SelectMany(scenario => scenario.GetProperty("steps").EnumerateArray())
            .Single(item => item.GetProperty("name").GetString() == "finanzas vuelven a categorías iniciales");
        var expected = step.GetProperty("expected").GetProperty("body").GetProperty("data").GetProperty("categories")
            .EnumerateArray().Select(item => new Category(item.GetProperty("id").GetString()!, item.GetProperty("name").GetString()!,
                item.GetProperty("type").GetString()!, item.GetProperty("parentId").GetString(), item.GetProperty("order").GetDouble(),
                item.GetProperty("budgetCents").ValueKind == JsonValueKind.Null ? null : item.GetProperty("budgetCents").GetInt64()))
            .OrderBy(category => category.Id, StringComparer.Ordinal);
        Assert.Equal(expected, DefaultCategories.All.OrderBy(category => category.Id, StringComparer.Ordinal));
        // Una principal siempre antes que sus subcategorías: la clave foránea lo exige al sembrar.
        var seen = new HashSet<string>();
        foreach (var category in DefaultCategories.All)
        {
            Assert.True(category.ParentId is null || seen.Contains(category.ParentId), category.Id);
            seen.Add(category.Id);
        }
    }

    [Fact]
    public void La_clave_de_GET_LOCK_es_la_de_Express()
    {
        // Calculadas con la fórmula de server/common/mysql/migrations.ts (SHA-256 del nombre, 24 hexadecimales).
        Assert.Equal("cuentas_claras_migraciones_c68469ad972082049923972f", MySqlMigrations.LockKey("cuentas_claras"));
        Assert.Equal("cuentas_claras_migraciones_92ae551f94998aa2fd98a2e2", MySqlMigrations.LockKey("cuentas_test_data01"));
    }

    [Fact, Trait("Categoria", TestDatabase.Category)]
    public async Task Una_base_nueva_recibe_las_tablas_los_bloqueos_las_categorias_iniciales_y_su_historial()
    {
        await using var test = await TestDatabase.Create();
        var (_, version) = await test.Open();
        Assert.Equal(5, version);
        Assert.Equal(AllTables, await test.Tables());
        Assert.Equal((long)DefaultCategories.All.Count, await test.Scalar("SELECT COUNT(*) FROM categories"));
        Assert.Equal([(5, "esquema inicial", "2026-11-03T20:00:00.000Z", "2026-11-03T20:00:00.000Z")], await History(test));
        Assert.Equal(["finance", "tickets"], await test.Query("SELECT name FROM app_locks ORDER BY name", reader => reader.GetString(0)));
    }

    [Fact, Trait("Categoria", TestDatabase.Category)]
    public async Task Dos_inicializaciones_sobre_una_copia_sintetica_conservan_sus_filas_y_su_historial()
    {
        await using var test = await TestDatabase.Create();
        var (first, _) = await test.Open();
        foreach (var sql in SyntheticRows) await first.Run(sql, [], TestContext.Current.CancellationToken);
        var before = await Snapshot(test);
        Assert.Equal(DefaultCategories.All.Count - 1 + 2, before.Rows["categories"]);
        Assert.Equal(3, before.Rows["pantry_tickets"]);
        await first.DisposeAsync();

        for (var reopen = 1; reopen <= 2; reopen++)
        {
            var clock = new FixedClock(1_793_822_400_000 + reopen);
            var (database, version) = await test.Open(clock);
            Assert.Equal(5, version);
            var after = await Snapshot(test);
            Assert.Equal(before.History, after.History);
            Assert.Equal(before.Rows, after.Rows);
            Assert.Equal(before.Checksums, after.Checksums);
            await database.DisposeAsync();
        }
        // La categoría borrada no vuelve: sembrar es solo de una base nueva.
        Assert.Equal(0L, await test.Scalar("SELECT COUNT(*) FROM categories WHERE id = 'g-ocio'"));
    }

    [Fact, Trait("Categoria", TestDatabase.Category)]
    public async Task Sin_sembrar_lo_que_hace_el_importador_la_base_nueva_queda_sin_datos()
    {
        await using var test = await TestDatabase.Create();
        await test.Open(seed: false);
        foreach (var table in AppTables) Assert.Equal(0L, await test.Scalar($"SELECT COUNT(*) FROM {table}"));
        Assert.Equal(2L, await test.Scalar("SELECT COUNT(*) FROM app_locks"));
    }

    [Fact, Trait("Categoria", TestDatabase.Category)]
    public async Task Dos_arranques_que_abren_a_la_vez_la_misma_base_nueva_la_migran_una_sola_vez()
    {
        await using var test = await TestDatabase.Create();
        var opened = await Task.WhenAll(test.Open(), test.Open());
        Assert.Equal([5, 5], opened.Select(result => result.SchemaVersion));
        Assert.Equal((long)DefaultCategories.All.Count, await test.Scalar("SELECT COUNT(*) FROM categories"));
        Assert.Equal(1L, await test.Scalar("SELECT COUNT(*) FROM schema_migrations"));
    }

    [Fact, Trait("Categoria", TestDatabase.Category)]
    public async Task Espera_mientras_otro_proceso_tiene_el_bloqueo_de_migraciones_de_Express()
    {
        await using var test = await TestDatabase.Create();
        var express = await test.Connect();
        var key = MySqlMigrations.LockKey(test.Name);
        Assert.Equal(1L, (await MySqlCommands.Query(express, null, "SELECT GET_LOCK(?, 0)", [key], reader => reader.GetInt64(0), TestContext.Current.CancellationToken))[0]);
        var opening = test.Open();
        await Task.Delay(500, TestContext.Current.CancellationToken);
        Assert.False(opening.IsCompleted);
        Assert.Empty(await test.Tables());
        await MySqlCommands.Query(express, null, "SELECT RELEASE_LOCK(?)", [key], reader => reader.GetValue(0), TestContext.Current.CancellationToken);
        Assert.Equal(5, (await opening).SchemaVersion);
    }

    [Fact, Trait("Categoria", TestDatabase.Category)]
    public async Task Se_niega_a_abrir_una_base_de_una_version_mas_nueva_sin_modificarla()
    {
        await using var test = await TestDatabase.Create();
        var (database, _) = await test.Open();
        await database.Run("INSERT INTO schema_migrations (version, name, started_at, applied_at) VALUES (99, 'futura', 'x', 'x')", [], TestContext.Current.CancellationToken);
        var error = await Assert.ThrowsAsync<DatabaseSetupException>(() => test.Open());
        Assert.Contains("versión más nueva de Cuentas claras (esquema 99)", error.Message);
        Assert.Equal(99, Convert.ToInt32(await test.Scalar("SELECT MAX(version) FROM schema_migrations")));
    }

    [Fact, Trait("Categoria", TestDatabase.Category)]
    public async Task Una_migracion_que_falla_a_medias_queda_anotada_y_la_siguiente_apertura_lo_explica_sin_continuar()
    {
        await using var test = await TestDatabase.Create();
        MySqlMigration[] broken = [new(5, "esquema inicial", "005-esquema-inicial.sql", ["CREATE TABLE a (x INT)", "CREATE TABLE a (x INT)"])];
        var failed = await Assert.ThrowsAsync<DatabaseSetupException>(() => test.Open(migrations: broken));
        Assert.Matches("^La migración 5 \\(«esquema inicial»\\) ha fallado en la sentencia 2 de 2: .*a medias", failed.Message);
        // El DDL ya confirmado se queda: la primera tabla existe y la migración no tiene applied_at.
        Assert.Equal(["a", "schema_migrations"], await test.Tables());
        var reopened = await Assert.ThrowsAsync<DatabaseSetupException>(() => test.Open());
        Assert.Matches("^La migración 5 \\(«esquema inicial»\\) empezó el 2026-11-03T20:00:00.000Z y no terminó", reopened.Message);
        Assert.Equal(["a", "schema_migrations"], await test.Tables());
    }

    [Fact, Trait("Categoria", TestDatabase.Category)]
    public async Task No_aplica_el_esquema_sobre_una_base_con_tablas_que_no_son_de_Cuentas_claras()
    {
        await using var test = await TestDatabase.Create();
        await MySqlCommands.Execute(await test.Connect(), null, "CREATE TABLE otra_app (id INT PRIMARY KEY)", [], TestContext.Current.CancellationToken);
        var error = await Assert.ThrowsAsync<DatabaseSetupException>(() => test.Open());
        Assert.Contains("tiene tablas (otra_app) pero no el historial de Cuentas claras", error.Message);
        Assert.Equal(["otra_app"], await test.Tables());
    }

    /// <summary>Filas inventadas en todas las tablas de la aplicación, con los casos de borde de DATA.md.</summary>
    private static readonly string[] SyntheticRows =
    [
        "DELETE FROM categories WHERE id = 'g-ocio'",
        "INSERT INTO categories (id, name, type, parent_id, order_index, budget_cents) VALUES ('cat-propia', 'Piña', 'gasto', NULL, 9.5, 12345), ('cat-propia ', 'Piña con espacio', 'gasto', NULL, 10, NULL)",
        "INSERT INTO recurring_rules VALUES ('r1', 'Alquiler', 99999999999, 'gasto', 'g-vivienda-alquiler', 'mensual', '2024-01-31', NULL, 12, 'nota ñ', '2026-01-01T00:00:00.000Z', 'x')",
        "INSERT INTO recurring_excluded_dates VALUES ('r1', '2024-02-29')",
        "INSERT INTO movements VALUES ('m1', 'Cuota', 1, 'gasto', 'g-vivienda-alquiler', 'pendiente', NULL, '2026-12-31', '', 'r1', '2026-12-31', 3, 'a', 'b'), ('m2', 'Huérfano', 500, 'ingreso', 'i-nomina', 'realizado', '2026-01-01', NULL, '', 'regla-borrada', '2025-12-31', NULL, 'a', 'b')",
        "INSERT INTO meta (`key`, value) VALUES ('lastBackupAt', '2026-11-03T20:00:00.000Z')",
        "INSERT INTO pantry_people VALUES ('p1', 'Ana', 'x')",
        "INSERT INTO pantry_items VALUES ('i1', 'Leche', 'p1', 'l', 0.001, 999999.999, 'semanal', 10000000, '', 7, 'x', 'y', 'cantidad'), ('I1', 'Pan', NULL, 'ud', 1000000, 0, 'ocasional', NULL, 'nota', 1, 'x', 'y', 'compras')",
        "INSERT INTO pantry_settings VALUES (1, 0, '2026-11-02')",
        "INSERT INTO pantry_events VALUES ('e1', 'i1', 'comprado', '2026-11-01', 'x')",
        "INSERT INTO pantry_tickets VALUES ('t1', 'lidl', 'Lidl', 'Calle Ñ', '2026-11-01', '18:05', -10000000, 'lidl|2026-11-01|18:05|-100000,00', 'x', '[{\"concepto\": \"Descuento ñ\",  \"importe\": -120}]', '[]', NULL, NULL), ('t2', 'otra', 'Otra', '', '2026-11-02', NULL, NULL, 'f2', 'x', '[]', '[\"línea dudosa\"]', 'imp-1', 'src-1'), ('t3', 'otra', 'Otra', '', '2026-11-02', NULL, 0, 'f3', 'x', '[]', '[]', NULL, NULL)",
        "INSERT INTO pantry_ticket_lines VALUES ('l1', 't1', 0, 'LECHE', 'leche', 2, 95, 190, 10, 0.005, 1999, 'A', 'i1', 0, 'pending', 1, '{\"texto\":\"LECHE  2 x 0,95\"}'), ('l2', 't1', 1, 'PAN', 'pan', 1, NULL, NULL, 0, NULL, NULL, NULL, NULL, 1, 'verified', 0, NULL)",
        "INSERT INTO pantry_aliases VALUES ('lidl', 'leche', 'i1', 0, 'x'), ('lidl', 'bolsa', NULL, 1, 'x')",
    ];

    /// <summary>Historial completo, filas y CHECKSUM TABLE de las catorce tablas.</summary>
    private sealed record DatabaseSnapshot(
        IReadOnlyList<(int, string, string, string?)> History, IReadOnlyDictionary<string, long> Rows, IReadOnlyDictionary<string, long> Checksums);

    private static async Task<DatabaseSnapshot> Snapshot(TestDatabase test)
    {
        var rows = new SortedDictionary<string, long>(StringComparer.Ordinal);
        var checksums = new SortedDictionary<string, long>(StringComparer.Ordinal);
        foreach (var table in AllTables)
        {
            rows[table] = (long)(await test.Scalar($"SELECT COUNT(*) FROM {table}"))!;
            checksums[table] = (await test.Query($"CHECKSUM TABLE {table}", reader => reader.GetInt64(1)))[0];
        }
        return new DatabaseSnapshot(await History(test), rows, checksums);
    }

    private static async Task<IReadOnlyList<(int, string, string, string?)>> History(TestDatabase test) => await test.Query(
        "SELECT version, name, started_at, applied_at FROM schema_migrations ORDER BY version",
        reader => (reader.GetInt32(0), reader.GetString(1), reader.GetString(2), reader.IsDBNull(3) ? null : reader.GetString(3)));

    private static string RepositoryRoot()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
            if (File.Exists(Path.Combine(directory.FullName, "backend", "CuentasClaras.slnx"))) return directory.FullName;
        throw new InvalidOperationException("No se encuentra la solución del repositorio.");
    }
}
