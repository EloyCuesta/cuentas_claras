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
/// Ajustes de cantidad, «Marcar todo como comprado» y «Deshacer» en .NET (PAN-02), por HTTP sobre MySQL real y como
/// invitado: como pantry.test.ts («los botones + y −…», «dos móviles que pulsan +…» y «marcar como comprado y deshacer»),
/// con dos conexiones donde importa, más lo que deja un ticket en un producto (IPantryCatalog.ApplyTicketPurchase).
/// </summary>
[Trait("Categoria", TestDatabase.Category)]
public sealed class PantryPurchaseHttpTests
{
    private const string Now = "2026-10-29T08:00:00.000Z";
    private const string UndoConflict =
        "No se puede deshacer: algún producto ha cambiado o se ha borrado después de la compra (quizá desde otro dispositivo). No se ha tocado nada.";

    private static FixedClock NewClock() => new(DateTimeOffset.Parse(Now, CultureInfo.InvariantCulture).ToUnixTimeMilliseconds()) { TodayDate = "2026-10-29" };

    private static async Task<(TestDatabase Database, MySqlDatabase Opened, TestApi Api)> Start()
    {
        var database = await TestDatabase.Create();
        var (opened, _) = await database.Open(NewClock());
        return (database, opened, await TestApi.Start(opened, NewClock(), login: false));
    }

    private static async Task<JsonElement> CreateItem(TestApi api, string name, string unit, double quantity, double target, string tracking = "cantidad") =>
        await api.Data("POST", "/api/despensa/productos", new
        {
            name, ownerId = (string?)null, unit, quantity, target, frequency = "semanal", priceCents = 95, notes = "", tracking,
        }, 201);

    private static string Id(JsonElement element) => element.GetProperty("id").GetString()!;

    private static async Task<JsonElement> Item(TestApi api, string id) =>
        (await api.Data("GET", "/api/despensa/productos")).EnumerateArray().Single(item => Id(item) == id);

    private static (double Quantity, long Version) State(JsonElement item) => (item.GetProperty("quantity").GetDouble(), item.GetProperty("version").GetInt64());

    [Fact]
    public async Task Los_botones_mas_y_menos_ajustan_sobre_el_valor_del_servidor_y_nunca_bajan_de_cero()
    {
        var (database, _, api) = await Start();
        await using var _db = database;
        await using var _api = api;
        var rice = await CreateItem(api, "Arroz", "kg", 0.3, 2);
        var path = $"/api/despensa/productos/{Id(rice)}/ajustar";
        Assert.Equal((0.8, 2L), State(await api.Data("POST", path, new { delta = 0.5 })));
        Assert.Equal((0.0, 3L), State(await api.Data("POST", path, new { delta = -5 })));
        foreach (var delta in new object?[] { 0, null, "1", 1_000_001, double.NaN.ToString(CultureInfo.InvariantCulture) })
            await api.Fails("POST", path, new { delta }, 400, "VALIDATION", "El campo «delta» debe ser un número distinto de 0.");
        await api.Fails("POST", path, null, 400, "VALIDATION", "Falta el cuerpo de la petición en JSON.");
        var eggs = await CreateItem(api, "Huevos", "docena", 1, 2);
        await api.Fails("POST", $"/api/despensa/productos/{Id(eggs)}/ajustar", new { delta = 0.5 }, 400, "VALIDATION",
            "En «docena» la cantidad tiene que ser un número entero.");
        await api.Fails("POST", "/api/despensa/productos/no-existe/ajustar", new { delta = 1 }, 404, "NOT_FOUND",
            "Ese producto ya no existe. Vuelve a cargar la despensa.");
        // Milésimas exactas, sin restos binarios.
        var flour = await CreateItem(api, "Harina", "kg", 0.001, 1);
        Assert.Contains("\"quantity\":0.003,", (await api.Data("POST", $"/api/despensa/productos/{Id(flour)}/ajustar", new { delta = 0.002 })).GetRawText());
    }

    [Fact]
    public async Task Dos_moviles_que_pulsan_mas_a_la_vez_desde_dos_conexiones_no_se_pisan_cuenta_cada_pulsacion()
    {
        var (database, _, api) = await Start();
        await using var _db = database;
        await using var _api = api;
        var (second, _) = await database.Open(NewClock());
        await using var other = await TestApi.Start(second, NewClock(), login: false);
        var bread = await CreateItem(api, "Pan", "ud", 2, 30);
        var path = $"/api/despensa/productos/{Id(bread)}/ajustar";
        // Diez + repartidos entre dos hosts con su propio pool: sin el bloqueo del producto, alguno leería lo mismo que otro.
        var results = await Task.WhenAll(Enumerable.Range(0, 10).Select(i => (i % 2 == 0 ? api : other).Call("POST", path, new { delta = 1 })));
        Assert.All(results, result => Assert.Equal(200, result.Status));
        Assert.Equal(Enumerable.Range(3, 10).Select(n => (double)n),
            results.Select(result => result.Body.GetProperty("data").GetProperty("quantity").GetDouble()).Order());
        Assert.Equal((12.0, 11L), State(await Item(api, Id(bread))));
    }

    [Fact]
    public async Task Comprar_completa_lo_que_se_cuenta_apunta_lo_que_va_por_compras_y_no_reduce_lo_que_sobra()
    {
        var (database, _, api) = await Start();
        await using var _db = database;
        await using var _api = api;
        var milk = await CreateItem(api, "Leche", "l", 2, 6);
        var eggs = await CreateItem(api, "Huevos", "docena", 0, 1);
        var salt = await CreateItem(api, "Sal", "paquete", 3, 1);
        var coffee = await CreateItem(api, "Café", "paquete", 0, 0, tracking: "compras");

        var result = await api.Data("POST", "/api/despensa/comprado", new { ids = new[] { Id(milk), Id(eggs), Id(milk), Id(salt), Id(coffee) }, date = "2026-10-30" });
        var changes = result.GetProperty("changes").EnumerateArray().ToArray();
        // Primero los que se cuentan (en orden de id) y después las compras apuntadas.
        var counted = new[] { milk, eggs }.OrderBy(Id, StringComparer.Ordinal).ToArray();
        Assert.Equal(3, changes.Length);
        for (var i = 0; i < 2; i++)
            Assert.Equal($"{{\"id\":\"{Id(counted[i])}\",\"previousQuantity\":{(Id(counted[i]) == Id(milk) ? 2 : 0)},\"version\":2}}", changes[i].GetRawText());
        Assert.Equal(new[] { "id", "eventId" }, changes[2].EnumerateObject().Select(property => property.Name));
        Assert.Equal(Id(coffee), Id(changes[2]));
        var eventId = changes[2].GetProperty("eventId").GetString();
        Assert.Equal("comprado|2026-10-30|" + Now,
            await database.Scalar("SELECT CONCAT(kind, '|', event_date, '|', created_at) FROM pantry_events WHERE id = ? AND item_id = ?", eventId, Id(coffee)));
        // items: todos, por frecuencia y nombre.
        Assert.Equal(new[] { "Café", "Huevos", "Leche", "Sal" }, result.GetProperty("items").EnumerateArray().Select(item => item.GetProperty("name").GetString()));
        Assert.Equal((6.0, 2L), State(await Item(api, Id(milk))));
        Assert.Equal((1.0, 2L), State(await Item(api, Id(eggs))));
        Assert.Equal((3.0, 1L), State(await Item(api, Id(salt))));
        Assert.Equal((0.0, 1L), State(await Item(api, Id(coffee))));

        // Repetirlo no cambia lo que se cuenta; sin fecha, la compra apuntada lleva la del servidor.
        var again = await api.Data("POST", "/api/despensa/comprado", new { ids = new[] { Id(milk), Id(eggs), Id(coffee) } });
        var bought = Assert.Single(again.GetProperty("changes").EnumerateArray());
        Assert.Equal("2026-10-29", await database.Scalar("SELECT CAST(event_date AS CHAR) FROM pantry_events WHERE id = ?", bought.GetProperty("eventId").GetString()));
    }

    [Fact]
    public async Task Comprar_rechaza_listas_vacias_o_con_ids_que_no_existen_sin_escribir_nada()
    {
        var (database, _, api) = await Start();
        await using var _db = database;
        await using var _api = api;
        var milk = await CreateItem(api, "Leche", "l", 2, 6);
        await api.Fails("POST", "/api/despensa/comprado", new { ids = Array.Empty<string>() }, 400, "VALIDATION", "Indica al menos un producto en «ids».");
        await api.Fails("POST", "/api/despensa/comprado", new { ids = new[] { 42 } }, 400, "VALIDATION", "Cada elemento de «ids» debe ser un id.");
        await api.Fails("POST", "/api/despensa/comprado", new { }, 400, "VALIDATION", "Indica al menos un producto en «ids».");
        await api.Fails("POST", "/api/despensa/comprado", new { ids = new[] { Id(milk) }, date = "2026-02-30" }, 400, "VALIDATION",
            "El campo «date» debe ser una fecha AAAA-MM-DD.");
        await api.Fails("POST", "/api/despensa/comprado", new { ids = new[] { Id(milk), "no-existe" } }, 404, "NOT_FOUND",
            "Algún producto de la lista ya no existe. Vuelve a cargar la despensa; no se ha cambiado nada.");
        Assert.Equal((2.0, 1L), State(await Item(api, Id(milk))));
    }

    [Fact]
    public async Task Deshacer_devuelve_las_cantidades_anteriores_borra_las_compras_apuntadas_y_persiste()
    {
        var (database, _, api) = await Start();
        await using var _db = database;
        await using var _api = api;
        var milk = await CreateItem(api, "Leche", "l", 2, 6);
        var eggs = await CreateItem(api, "Huevos", "docena", 0, 1);
        var coffee = await CreateItem(api, "Café", "paquete", 0, 0, tracking: "compras");
        var changes = (await api.Data("POST", "/api/despensa/comprado", new { ids = new[] { Id(milk), Id(eggs), Id(coffee) }, date = "2026-10-30" }))
            .GetProperty("changes").GetRawText();

        var undone = await api.Data("POST", "/api/despensa/comprado/deshacer", $"{{\"changes\":{changes}}}");
        Assert.Equal(3, undone.GetArrayLength());
        var milkAfter = await Item(api, Id(milk));
        Assert.Equal((2.0, 3L), State(milkAfter));
        Assert.Equal(("Leche", 6.0), (milkAfter.GetProperty("name").GetString(), milkAfter.GetProperty("target").GetDouble()));
        Assert.Equal((0.0, 3L), State(await Item(api, Id(eggs))));
        Assert.Equal(0L, await database.Scalar("SELECT COUNT(*) FROM pantry_events"));

        // Guardado en MySQL: otro host sobre la misma base lo ve igual, y deshacer dos veces no vuelve a aplicar nada.
        var (second, _) = await database.Open(NewClock());
        await using var reopened = await TestApi.Start(second, NewClock(), login: false);
        Assert.Equal((2.0, 3L), State(await Item(reopened, Id(milk))));
        await reopened.Fails("POST", "/api/despensa/comprado/deshacer", $"{{\"changes\":{changes}}}", 409, "CONFLICT", UndoConflict);
    }

    [Fact]
    public async Task Si_algo_cambio_despues_de_la_compra_409_sin_revertir_nada_a_medias_ni_pisar_el_cambio()
    {
        var (database, _, api) = await Start();
        await using var _db = database;
        await using var _api = api;
        var milk = await CreateItem(api, "Leche", "l", 2, 6);
        var eggs = await CreateItem(api, "Huevos", "docena", 0, 1);
        var coffee = await CreateItem(api, "Café", "paquete", 0, 0, tracking: "compras");
        var changes = (await api.Data("POST", "/api/despensa/comprado", new { ids = new[] { Id(milk), Id(eggs), Id(coffee) } })).GetProperty("changes").GetRawText();
        // Mientras, desde otro móvil alguien gasta la docena de huevos.
        await api.Data("POST", $"/api/despensa/productos/{Id(eggs)}/ajustar", new { delta = -1 });
        await api.Fails("POST", "/api/despensa/comprado/deshacer", $"{{\"changes\":{changes}}}", 409, "CONFLICT", UndoConflict);
        Assert.Equal((6.0, 2L), State(await Item(api, Id(milk))));
        Assert.Equal((0.0, 3L), State(await Item(api, Id(eggs))));
        Assert.Equal(1L, await database.Scalar("SELECT COUNT(*) FROM pantry_events"));
        // Una compra apuntada que ya no está también es un cambio posterior.
        await database.Execute("DELETE FROM pantry_events");
        using var parsed = JsonDocument.Parse(changes);
        var onlyEvent = parsed.RootElement.EnumerateArray().Single(change => change.TryGetProperty("eventId", out _)).GetRawText();
        await api.Fails("POST", "/api/despensa/comprado/deshacer", $"{{\"changes\":[{onlyEvent}]}}", 409, "CONFLICT", UndoConflict);

        await api.Fails("POST", "/api/despensa/comprado/deshacer", new { changes = Array.Empty<object>() }, 400, "VALIDATION",
            "Indica los cambios que hay que deshacer en «changes».");
        await api.Fails("POST", "/api/despensa/comprado/deshacer", new { changes = new object[] { new { id = Id(milk), previousQuantity = 2, version = 0 } } }, 400,
            "VALIDATION", "El campo «version» no es válido.");
        await api.Fails("POST", "/api/despensa/comprado/deshacer",
            new { changes = new object[] { new { id = Id(milk), eventId = "e" }, new { id = Id(milk), eventId = "f" } } }, 400, "VALIDATION",
            "Cada cambio debe tener un «id» distinto.");
        // La cantidad anterior tiene que valer para la unidad: si no, 400 y nada cambia.
        await api.Fails("POST", "/api/despensa/comprado/deshacer", new { changes = new object[] { new { id = Id(eggs), previousQuantity = 0.5, version = 3 } } },
            400, "VALIDATION", "En «docena» la cantidad tiene que ser un número entero.");
        Assert.Equal((0.0, 3L), State(await Item(api, Id(eggs))));
    }

    [Fact]
    public async Task Deshacer_y_pulsar_mas_a_la_vez_desde_dos_conexiones_nunca_pierde_un_cambio()
    {
        var (database, _, api) = await Start();
        await using var _db = database;
        await using var _api = api;
        var (second, _) = await database.Open(NewClock());
        await using var other = await TestApi.Start(second, NewClock(), login: false);
        for (var round = 0; round < 5; round++)
        {
            var milk = await CreateItem(api, $"Leche {round}", "l", 2, 6);
            var changes = (await api.Data("POST", "/api/despensa/comprado", new { ids = new[] { Id(milk) } })).GetProperty("changes").GetRawText();
            var (undo, plus) = (api.Call("POST", "/api/despensa/comprado/deshacer", $"{{\"changes\":{changes}}}"),
                other.Call("POST", $"/api/despensa/productos/{Id(milk)}/ajustar", new { delta = 1 }));
            await Task.WhenAll(undo, plus);
            var final = State(await Item(api, Id(milk)));
            Assert.Equal(200, (await plus).Status);
            var plusQuantity = (await plus).Body.GetProperty("data").GetProperty("quantity").GetDouble();
            if ((await undo).Status == 200)
                // Deshacer primero (vuelve a 2) y el + suma sobre eso.
                Assert.Equal(((3.0, 4L), 3.0), (final, plusQuantity));
            else
            {
                // El + primero (7): deshacer ve otra versión y no toca nada.
                Assert.Equal(409, (await undo).Status);
                Assert.Equal(((7.0, 3L), 7.0), (final, plusQuantity));
            }
        }
    }

    [Fact]
    public async Task Lo_que_deja_un_ticket_cambia_el_precio_y_suma_lo_comprado_solo_si_se_cuenta()
    {
        var (database, opened, api) = await Start();
        await using var _db = database;
        await using var _api = api;
        var clock = NewClock();
        var store = new MySqlPantryStore(opened);
        var unitOfWork = new MySqlUnitOfWork(opened);
        IPantryCatalog catalog = new PantryCatalog(store, new PantryQueries(store), new CreateItem(store, clock, new UuidGenerator(), unitOfWork),
            new ApplyTicketPurchase(store, clock, unitOfWork));
        var rice = await CreateItem(api, "Arroz", "kg", 0.3, 2);
        var coffee = await CreateItem(api, "Café", "paquete", 0, 0, tracking: "compras");
        var eggs = await CreateItem(api, "Huevos", "docena", 1, 2);

        await unitOfWork.Run(async () =>
        {
            await catalog.LockItems([Id(rice), Id(coffee), Id(eggs)]);
            await catalog.ApplyTicketPurchase(Id(rice), new PantryTicketPurchase(120, 0.1 + 0.2));
            await catalog.ApplyTicketPurchase(Id(coffee), new PantryTicketPurchase(95, 1));
            // Medio paquete de huevos no es una cantidad válida: se queda como estaba, sin error.
            await catalog.ApplyTicketPurchase(Id(eggs), new PantryTicketPurchase(null, 0.5));
        }, LockName.Tickets, TestContext.Current.CancellationToken);

        var riceAfter = await Item(api, Id(rice));
        Assert.Equal((0.6, 3L, 120L), (riceAfter.GetProperty("quantity").GetDouble(), riceAfter.GetProperty("version").GetInt64(), riceAfter.GetProperty("priceCents").GetInt64()));
        // El mismo precio no sube la versión, y lo que va por compras no cuenta cantidades.
        Assert.Equal((0.0, 1L), State(await Item(api, Id(coffee))));
        Assert.Equal((1.0, 1L), State(await Item(api, Id(eggs))));
        var error = await Assert.ThrowsAsync<AppError>(() => catalog.ApplyTicketPurchase("no-existe", new PantryTicketPurchase(1, 1)));
        Assert.Equal(("NOT_FOUND", "Ese producto ya no existe. Vuelve a cargar la despensa."), (error.Code, error.Message));
    }
}
