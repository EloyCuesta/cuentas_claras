using System.Globalization;
using System.Text.Json;
using CuentasClaras.Application.Common;
using CuentasClaras.Application.Pantry;
using CuentasClaras.Application.Pantry.Contracts;
using CuentasClaras.Infrastructure.Common;
using CuentasClaras.Infrastructure.Common.MySql;
using CuentasClaras.Infrastructure.Pantry;

namespace CuentasClaras.Tests;

/// <summary>
/// Personas y productos de la despensa en .NET (PAN-01), por HTTP sobre MySQL real y como invitado (la despensa es
/// pública): como server/modules/pantry/pantry.test.ts, con los mismos mensajes. Incluye la edición con expectedVersion
/// desde dos conexiones y el contrato IPantryCatalog que usarán los tickets.
/// </summary>
[Trait("Categoria", TestDatabase.Category)]
public sealed class PantryHttpTests
{
    private const string Now = "2026-10-29T08:00:00.000Z";
    private const string Stale =
        "Este producto ha cambiado desde que lo abriste (quizá desde otro dispositivo), así que no se ha guardado. Vuelve a cargarlo para ver cómo está ahora.";
    private const string VersionError = "El campo «expectedVersion» debe ser la versión del producto (un número entero mayor que 0).";

    private static FixedClock NewClock() => new(DateTimeOffset.Parse(Now, CultureInfo.InvariantCulture).ToUnixTimeMilliseconds());

    /// <summary>La leche de pantry.test.ts, con cambios: un valor null se envía como null y <see cref="Missing"/> quita el campo.</summary>
    private static Dictionary<string, object?> Milk(params (string Key, object? Value)[] changes)
    {
        var body = new Dictionary<string, object?>
        {
            ["name"] = "Leche", ["ownerId"] = null, ["unit"] = "l", ["quantity"] = 2, ["target"] = 6, ["frequency"] = "semanal",
            ["priceCents"] = 95, ["notes"] = "",
        };
        foreach (var (key, value) in changes)
        {
            if (ReferenceEquals(value, Missing)) body.Remove(key);
            else body[key] = value;
        }
        return body;
    }

    private static readonly object Missing = new();

    private static async Task<(TestDatabase Database, TestApi Api, FixedClock Clock)> Start()
    {
        var database = await TestDatabase.Create();
        var clock = NewClock();
        var (opened, _) = await database.Open(clock);
        return (database, await TestApi.Start(opened, clock, login: false), clock);
    }

    private static async Task<JsonElement> CreateItem(TestApi api, params (string Key, object? Value)[] changes) =>
        await api.Data("POST", "/api/despensa/productos", Milk(changes), 201);

    private static async Task<JsonElement> CreatePerson(TestApi api, string name) =>
        await api.Data("POST", "/api/despensa/personas", new { name }, 201);

    private static async Task<JsonElement[]> Items(TestApi api) => [.. (await api.Data("GET", "/api/despensa/productos")).EnumerateArray()];

    private static string Id(JsonElement element) => element.GetProperty("id").GetString()!;

    [Fact]
    public async Task Un_invitado_gestiona_personas_crear_listar_por_nombre_renombrar_y_borrar()
    {
        var (database, api, _) = await Start();
        await using var _db = database;
        await using var _api = api;
        var eloy = await CreatePerson(api, "  Eloy ");
        Assert.Equal("Eloy", eloy.GetProperty("name").GetString());
        Assert.Matches("^[0-9a-f-]{36}$", Id(eloy));
        Assert.Equal(Now, eloy.GetProperty("createdAt").GetString());
        Assert.Equal(new[] { "id", "name", "createdAt" }, eloy.EnumerateObject().Select(property => property.Name));
        await CreatePerson(api, "Ana");
        Assert.Equal(new[] { "Ana", "Eloy" },
            (await api.Data("GET", "/api/despensa/personas")).EnumerateArray().Select(person => person.GetProperty("name").GetString()));

        Assert.Equal("Eloy C.", (await api.Data("PUT", $"/api/despensa/personas/{Id(eloy)}", new { name = "Eloy C." })).GetProperty("name").GetString());
        await api.Fails("PUT", "/api/despensa/personas/no-existe", new { name = "X" }, 404, "NOT_FOUND", "Esa persona ya no existe. Vuelve a cargar la despensa.");
        // El cuerpo se valida antes de buscar la persona.
        await api.Fails("PUT", "/api/despensa/personas/no-existe", new { name = 5 }, 400, "VALIDATION", "La persona: falta el nombre.");
        await api.Fails("POST", "/api/despensa/personas", new { name = "" }, 400, "VALIDATION", "La persona: el nombre está vacío.");
        await api.Fails("POST", "/api/despensa/personas", new { name = new string('x', 41) }, 400, "VALIDATION",
            "La persona: el nombre puede tener como máximo 40 caracteres.");
        await api.Fails("POST", "/api/despensa/personas", null, 400, "VALIDATION", "Falta el cuerpo de la petición en JSON.");

        Assert.Equal(JsonValueKind.Null, (await api.Data("DELETE", $"/api/despensa/personas/{Id(eloy)}")).ValueKind);
        await api.Fails("DELETE", $"/api/despensa/personas/{Id(eloy)}", null, 404, "NOT_FOUND", "Esa persona ya no existe. Vuelve a cargar la despensa.");
    }

    [Fact]
    public async Task No_deja_borrar_una_persona_con_productos_y_no_cambia_nada()
    {
        var (database, api, _) = await Start();
        await using var _db = database;
        await using var _api = api;
        var eloy = await CreatePerson(api, "Eloy");
        await CreateItem(api, ("name", "Proteína"), ("ownerId", Id(eloy)), ("unit", "bolsa"), ("quantity", 0), ("target", 1));
        await api.Fails("DELETE", $"/api/despensa/personas/{Id(eloy)}", null, 409, "CONFLICT",
            "«Eloy» tiene un producto. Pásalos a otra persona o a «Compartido», o elimínalos, antes de borrarla.");
        await CreateItem(api, ("name", "Avena"), ("ownerId", Id(eloy)), ("unit", "bolsa"), ("quantity", 0), ("target", 1));
        await api.Fails("DELETE", $"/api/despensa/personas/{Id(eloy)}", null, 409, "CONFLICT",
            "«Eloy» tiene 2 productos. Pásalos a otra persona o a «Compartido», o elimínalos, antes de borrarla.");
        Assert.Equal(eloy.GetRawText(), Assert.Single((await api.Data("GET", "/api/despensa/personas")).EnumerateArray()).GetRawText());
        Assert.Equal(2, (await Items(api)).Length);
    }

    [Fact]
    public async Task Crea_edita_y_borra_productos_el_servidor_pone_id_version_y_fechas()
    {
        var (database, api, clock) = await Start();
        await using var _db = database;
        await using var _api = api;
        var created = await CreateItem(api, ("name", " Leche "), ("notes", " entera "));
        Assert.Equal(
            $"{{\"id\":\"{Id(created)}\",\"name\":\"Leche\",\"ownerId\":null,\"unit\":\"l\",\"tracking\":\"cantidad\",\"quantity\":2,\"target\":6," +
            $"\"frequency\":\"semanal\",\"priceCents\":95,\"notes\":\"entera\",\"version\":1,\"createdAt\":\"{Now}\",\"updatedAt\":\"{Now}\"}}",
            created.GetRawText());

        clock.Now += 1000;
        var edited = await api.Data("PUT", $"/api/despensa/productos/{Id(created)}", Milk(("target", 8), ("priceCents", null), ("expectedVersion", 1)));
        Assert.Equal(8, edited.GetProperty("target").GetDouble());
        Assert.Equal(JsonValueKind.Null, edited.GetProperty("priceCents").ValueKind);
        Assert.Equal(2, edited.GetProperty("version").GetInt64());
        Assert.Equal(Now, edited.GetProperty("createdAt").GetString());
        Assert.Equal("2026-10-29T08:00:01.000Z", edited.GetProperty("updatedAt").GetString());

        await api.Fails("PUT", "/api/despensa/productos/no-existe", Milk(("expectedVersion", 1)), 404, "NOT_FOUND",
            "Ese producto ya no existe. Vuelve a cargar la despensa.");
        Assert.Equal(JsonValueKind.Null, (await api.Data("DELETE", $"/api/despensa/productos/{Id(created)}")).ValueKind);
        await api.Fails("DELETE", $"/api/despensa/productos/{Id(created)}", null, 404, "NOT_FOUND", "Ese producto ya no existe. Vuelve a cargar la despensa.");
        Assert.Empty(await Items(api));
    }

    [Fact]
    public async Task Valida_unidades_frecuencias_cantidades_duenos_precios_y_opcionales_con_los_mensajes_de_Express()
    {
        var (database, api, _) = await Start();
        await using var _db = database;
        await using var _api = api;
        (string Key, object? Value)[][] bad =
        [
            [("unit", "barril")],
            [("frequency", "diaria")],
            [("quantity", -1)],
            [("target", double.MaxValue)],
            [("quantity", 1.5), ("unit", "ud")],
            [("quantity", 0.0001), ("unit", "kg")],
            [("priceCents", 1.5)],
            [("priceCents", -5)],
            [("ownerId", "no-existe")],
            [("name", "")],
            [("notes", new string('x', 121))],
            [("tracking", "a ojo")],
        ];
        string[] messages =
        [
            "El campo «unit» debe ser «ud», «g», «kg», «ml», «l», «paquete», «lata», «botella», «bolsa», «docena».",
            "El campo «frequency» debe ser «semanal», «mensual», «ocasional».",
            "Cantidad actual: La cantidad no puede ser negativa.",
            "Objetivo: La cantidad es demasiado grande.",
            "Cantidad actual: En «ud» la cantidad tiene que ser un número entero.",
            "Cantidad actual: Usa como máximo 3 decimales.",
            "El campo «priceCents» debe ser un número entero de céntimos entre 0 y 10000000, o null.",
            "El campo «priceCents» debe ser un número entero de céntimos entre 0 y 10000000, o null.",
            "El producto es de una persona que no existe. Elige otra o «Compartido».",
            "El producto: el nombre está vacío.",
            "Las notas pueden tener como máximo 120 caracteres.",
            "El campo «tracking» debe ser «compras» o «cantidad».",
        ];
        for (var i = 0; i < bad.Length; i++)
            await api.Fails("POST", "/api/despensa/productos", Milk(bad[i]), 400, "VALIDATION", messages[i]);
        await api.Fails("POST", "/api/despensa/productos", null, 400, "VALIDATION", "Falta el cuerpo de la petición en JSON.");
        Assert.Empty(await Items(api));

        // Existencias por encima del objetivo, precio 0 y sin notas ni tracking: válido (se cuenta).
        var ok = await CreateItem(api, ("quantity", 9), ("target", 6), ("priceCents", 0), ("notes", Missing), ("tracking", Missing));
        Assert.Equal((9.0, 6.0, 0L, "", "cantidad"), (ok.GetProperty("quantity").GetDouble(), ok.GetProperty("target").GetDouble(),
            ok.GetProperty("priceCents").GetInt64(), ok.GetProperty("notes").GetString(), ok.GetProperty("tracking").GetString()));
        // Cambiar a una unidad entera con cantidades decimales se rechaza sin redondear.
        var kg = await CreateItem(api, ("name", "Arroz"), ("unit", "kg"), ("quantity", 1.5), ("target", 2));
        await api.Fails("PUT", $"/api/despensa/productos/{Id(kg)}",
            Milk(("name", "Arroz"), ("unit", "paquete"), ("quantity", 1.5), ("target", 2), ("expectedVersion", 1)), 400, "VALIDATION",
            "Cantidad actual: En «paquete» la cantidad tiene que ser un número entero.");
        var rice = (await Items(api)).Single(item => Id(item) == Id(kg));
        Assert.Equal(("kg", 1.5), (rice.GetProperty("unit").GetString(), rice.GetProperty("quantity").GetDouble()));
    }

    [Fact]
    public async Task Editar_exige_la_version_con_la_que_se_abrio_400_sin_ella_404_antes_que_409_y_409_sin_escribir_nada()
    {
        var (database, api, _) = await Start();
        await using var _db = database;
        await using var _api = api;
        var created = await CreateItem(api);
        var path = $"/api/despensa/productos/{Id(created)}";
        foreach (var version in new object?[] { Missing, null, 0, -1, 1.5, "1", JsNumberMaxSafe + 1 })
            await api.Fails("PUT", path, Milk(("target", 8), ("expectedVersion", version)), 400, "VALIDATION", VersionError);
        // El resto del cuerpo se valida antes, y todo antes de buscar el producto.
        await api.Fails("PUT", "/api/despensa/productos/no-existe", Milk(("unit", "barril")), 400, "VALIDATION",
            "El campo «unit» debe ser «ud», «g», «kg», «ml», «l», «paquete», «lata», «botella», «bolsa», «docena».");
        await api.Fails("PUT", "/api/despensa/productos/no-existe", Milk(), 400, "VALIDATION", VersionError);
        await api.Fails("PUT", "/api/despensa/productos/no-existe", Milk(("expectedVersion", 7)), 404, "NOT_FOUND",
            "Ese producto ya no existe. Vuelve a cargar la despensa.");

        // Otro móvil lo cambia (versión 2): la edición abierta con la versión 1 ya no se guarda, aunque el dueño tampoco exista.
        await database.Execute("UPDATE pantry_items SET quantity = 3, version = version + 1 WHERE id = ?", Id(created));
        await api.Fails("PUT", path, Milk(("target", 8), ("expectedVersion", 1)), 409, "CONFLICT", Stale);
        await api.Fails("PUT", path, Milk(("ownerId", "no-existe"), ("expectedVersion", 1)), 409, "CONFLICT", Stale);
        var unchanged = Assert.Single(await Items(api));
        Assert.Equal((3.0, 6.0, 2L), (unchanged.GetProperty("quantity").GetDouble(), unchanged.GetProperty("target").GetDouble(),
            unchanged.GetProperty("version").GetInt64()));
        // Con la versión actual, sí; y la anterior deja de valer.
        await api.Fails("PUT", path, Milk(("ownerId", "no-existe"), ("expectedVersion", 2)), 400, "VALIDATION",
            "El producto es de una persona que no existe. Elige otra o «Compartido».");
        var saved = await api.Data("PUT", path, Milk(("target", 8), ("expectedVersion", 2)));
        Assert.Equal((2.0, 8.0, 3L), (saved.GetProperty("quantity").GetDouble(), saved.GetProperty("target").GetDouble(), saved.GetProperty("version").GetInt64()));
        await api.Fails("PUT", path, Milk(("target", 9), ("expectedVersion", 2)), 409, "CONFLICT", Stale);
    }

    private const double JsNumberMaxSafe = 9007199254740991;

    [Fact]
    public async Task Dos_moviles_que_editan_a_la_vez_el_mismo_producto_desde_dos_conexiones_uno_guarda_y_el_otro_recibe_409()
    {
        var (database, api, clock) = await Start();
        await using var _db = database;
        await using var _api = api;
        var (second, _) = await database.Open(clock);
        await using var other = await TestApi.Start(second, clock, login: false);
        for (var round = 0; round < 5; round++)
        {
            var opened = await CreateItem(api, ("name", $"Pan {round}"), ("unit", "ud"), ("quantity", 2), ("target", 4));
            var path = $"/api/despensa/productos/{Id(opened)}";
            var results = await Task.WhenAll(
                api.Call("PUT", path, Milk(("name", $"Pan {round}"), ("unit", "ud"), ("target", 10), ("expectedVersion", 1))),
                other.Call("PUT", path, Milk(("name", $"Pan {round}"), ("unit", "ud"), ("target", 20), ("expectedVersion", 1))));
            Assert.Equal(new[] { 200, 409 }, results.Select(result => result.Status).Order());
            var winner = results.Single(result => result.Status == 200).Body.GetProperty("data");
            Assert.Equal(2, winner.GetProperty("version").GetInt64());
            Assert.Equal(winner.GetRawText(), (await Items(api)).Single(item => Id(item) == Id(opened)).GetRawText());
        }
    }

    [Fact]
    public async Task Guarda_las_milesimas_y_los_centimos_exactos_y_ordena_por_frecuencia_y_nombre_como_TypeScript()
    {
        var (database, api, _) = await Start();
        await using var _db = database;
        await using var _api = api;
        var flour = await CreateItem(api, ("name", "Harina"), ("unit", "kg"), ("quantity", 0.001), ("target", 999_999.999), ("priceCents", 10_000_000));
        Assert.Contains("\"quantity\":0.001,\"target\":999999.999", flour.GetRawText());
        Assert.Equal(10_000_000, flour.GetProperty("priceCents").GetInt64());
        Assert.Equal("0.001|999999.999",
            await database.Scalar("SELECT CONCAT(quantity, '|', target) FROM pantry_items WHERE id = ?", Id(flour)));
        // En utf8mb4_0900_bin son tres nombres distintos; se ordenan con localeCompare('es'): sin mayúsculas ni tildes primero.
        foreach (var name in new[] { "pina", "piña", "PINA" }) await CreateItem(api, ("name", name));
        await CreateItem(api, ("name", "Ñame"), ("frequency", "ocasional"));
        await CreateItem(api, ("name", "Nata"), ("frequency", "ocasional"));
        await CreateItem(api, ("name", "árbol"), ("frequency", "mensual"));
        Assert.Equal(new[] { "Harina", "pina", "PINA", "piña", "árbol", "Nata", "Ñame" },
            (await Items(api)).Select(item => item.GetProperty("name").GetString()));
        var people = new List<string>();
        foreach (var name in new[] { "Íñigo", "Iñigo", "iñigo" }) people.Add((await CreatePerson(api, name)).GetProperty("name").GetString()!);
        Assert.Equal(new[] { "Íñigo", "Iñigo", "iñigo" }, people);
        Assert.Equal(new[] { "iñigo", "Iñigo", "Íñigo" },
            (await api.Data("GET", "/api/despensa/personas")).EnumerateArray().Select(person => person.GetProperty("name").GetString()));
        // Un nombre de 40 letras con tildes cabe: el límite cuenta caracteres, no bytes.
        await CreatePerson(api, new string('Ñ', 40));
        await api.Fails("POST", "/api/despensa/personas", new { name = new string('Ñ', 41) }, 400, "VALIDATION",
            "La persona: el nombre puede tener como máximo 40 caracteres.");
    }

    [Fact]
    public async Task El_catalogo_para_los_tickets_bloquea_lee_crea_y_se_une_a_la_transaccion_de_fuera()
    {
        await using var database = await TestDatabase.Create();
        var clock = NewClock();
        var (opened, _) = await database.Open(clock);
        await using var _opened = opened;
        var store = new MySqlPantryStore(opened);
        var unitOfWork = new MySqlUnitOfWork(opened);
        var queries = new PantryQueries(store);
        IPantryCatalog catalog = new PantryCatalog(store, queries, new CreateItem(store, clock, new UuidGenerator(), unitOfWork));
        var input = new NewPantryItem("Leche", null, "l", "compras", 0, 0, "semanal", null, "");

        var created = await unitOfWork.Run(async () =>
        {
            var item = await catalog.CreateItem(input);
            await catalog.LockItems([item.Id, "no-existe"]);
            Assert.Equal(item, await catalog.GetItem(item.Id));
            return item;
        }, LockName.Tickets, TestContext.Current.CancellationToken);
        Assert.Equal((1L, Now, "compras"), (created.Version, created.CreatedAt, created.Tracking));
        Assert.Null(await catalog.GetItem("no-existe"));
        var error = await Assert.ThrowsAsync<AppError>(() => catalog.CreateItem(input with { OwnerId = "no-existe" }));
        Assert.Equal(("VALIDATION", "El producto es de una persona que no existe. Elige otra o «Compartido»."), (error.Code, error.Message));

        // Si el ticket falla después, el producto que creó no se queda.
        await Assert.ThrowsAsync<InvalidOperationException>(() => unitOfWork.Run(async () =>
        {
            await catalog.CreateItem(input with { Name = "Pan" });
            throw new InvalidOperationException("fallo a mitad del ticket");
        }, LockName.Tickets, TestContext.Current.CancellationToken));
        Assert.Equal(new[] { "Leche" }, (await catalog.ListItems()).Select(item => item.Name));
    }
}
