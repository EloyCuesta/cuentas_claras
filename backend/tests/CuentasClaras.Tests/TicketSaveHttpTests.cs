using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using CuentasClaras.Application.Common;
using CuentasClaras.Application.Tickets;
using CuentasClaras.Domain.Tickets;
using CuentasClaras.Infrastructure.Common.MySql;
using CuentasClaras.Infrastructure.Tickets;

namespace CuentasClaras.Tests;

/// <summary>
/// Guardar tickets en .NET (TIC-03), por HTTP sobre MySQL real y como invitado: como «API de tickets» de
/// server/modules/tickets/tickets.test.ts (crear productos, aprender, precios y cantidades, decisiones, líneas dudosas y huellas
/// golden) y ticketAtomicity.test.ts (un fallo real de MySQL a mitad no deja nada; dos guardados iguales a la vez, un 201 y un
/// 409; un ticket y un + a la vez no se pisan).
/// </summary>
[Trait("Categoria", TestDatabase.Category)]
public sealed class TicketSaveHttpTests
{
    private const string Now = "2026-11-01T08:00:00.000Z";

    private static string Fixture(string name) => Path.Combine(AppContext.BaseDirectory, "Fixtures", "tickets", name);

    private static readonly byte[] LidlPng = File.ReadAllBytes(Fixture("ticket-lidl-ejemplo.png"));

    /// <summary>El lector falso de las pruebas de Express: lo que leyó el OCR del ticket de ejemplo.</summary>
    private sealed class FixtureReader : ITicketReader
    {
        public Task<IReadOnlyList<IReadOnlyList<OcrLine>>> Read(IReadOnlyList<byte[]> images, IReadOnlyList<TicketSegmentInput>? segments,
            CancellationToken cancellationToken = default)
        {
            using var document = JsonDocument.Parse($"[{File.ReadAllText(Fixture("ticket-lidl-ejemplo.ocr.json"))}]");
            return Task.FromResult(NodeTicketReader.ReadPages(document.RootElement));
        }
    }

    /// <summary>Los ids de la cola primero; después, «ensayo-N» (como prepare() de ticketAtomicity.test.ts).</summary>
    private sealed class QueueThenCounter : IIdGenerator
    {
        private readonly Queue<string> queue = new();
        private int next;

        public void Use(params string[] ids)
        {
            foreach (var id in ids) queue.Enqueue(id);
        }

        public string NewId() => queue.TryDequeue(out var id) ? id : $"ensayo-{Interlocked.Increment(ref next)}";
    }

    private static FixedClock NewClock() => new(DateTimeOffset.Parse(Now, CultureInfo.InvariantCulture).ToUnixTimeMilliseconds()) { TodayDate = "2026-11-01" };

    private static async Task<(TestDatabase Database, MySqlDatabase Opened, TestApi Api)> Start(IIdGenerator? ids = null)
    {
        var database = await TestDatabase.Create();
        var (opened, _) = await database.Open(NewClock());
        return (database, opened, await TestApi.Start(opened, NewClock(), ids, login: false, reader: new FixtureReader()));
    }

    private static async Task<JsonElement> ReadLidl(TestApi api) =>
        await api.Data("POST", "/api/despensa/tickets/leer", new { imagenes = new[] { Convert.ToBase64String(LidlPng) }, hoy = "2026-10-25" });

    /// <summary>saveInput de tickets.test.ts: lo que enviaría la revisión aceptando las sugerencias (o la decisión de <paramref name="decide"/>).</summary>
    private static JsonObject SaveInput(JsonElement draft, Func<string, JsonElement, JsonObject?>? decide = null)
    {
        var ticket = draft.GetProperty("ticket");
        var decisions = new JsonObject();
        foreach (var suggestion in draft.GetProperty("suggestions").EnumerateObject())
        {
            decisions[suggestion.Name] = decide?.Invoke(suggestion.Name, suggestion.Value) ?? suggestion.Value.GetProperty("kind").GetString() switch
            {
                "new" => new JsonObject
                {
                    ["kind"] = "new", ["name"] = suggestion.Value.GetProperty("name").GetString(), ["ownerId"] = null,
                    ["frequency"] = suggestion.Value.GetProperty("frequency").GetString(),
                },
                "ignore" => new JsonObject { ["kind"] = "ignore" },
                _ => new JsonObject { ["kind"] = "item", ["itemId"] = suggestion.Value.GetProperty("itemId").GetString() },
            };
        }
        var lines = new JsonArray();
        foreach (var line in ticket.GetProperty("lines").EnumerateArray())
        {
            var copy = new JsonObject();
            foreach (var name in new[] { "rawName", "quantity", "unitPriceCents", "amountCents", "discountCents", "weightKg", "pricePerKgCents", "taxCode" })
                copy[name] = JsonNode.Parse(line.GetProperty(name).GetRawText());
            copy["occasional"] = false;
            lines.Add(copy);
        }
        var adjustments = new JsonArray();
        foreach (var adjustment in ticket.GetProperty("adjustments").EnumerateArray())
        {
            var copy = JsonNode.Parse(adjustment.GetRawText())!.AsObject();
            copy["needsReview"] = false;
            adjustments.Add(copy);
        }
        return new JsonObject
        {
            ["store"] = ticket.GetProperty("store").GetString(), ["storeName"] = ticket.GetProperty("storeName").GetString(),
            ["address"] = ticket.GetProperty("address").GetString(),
            ["date"] = ticket.GetProperty("date").ValueKind == JsonValueKind.Null ? "2026-10-25" : ticket.GetProperty("date").GetString(),
            ["time"] = JsonNode.Parse(ticket.GetProperty("time").GetRawText()), ["totalCents"] = JsonNode.Parse(ticket.GetProperty("totalCents").GetRawText()),
            ["adjustments"] = adjustments, ["acknowledged"] = true, ["lines"] = lines, ["decisions"] = decisions,
        };
    }

    private static Task<(int Status, JsonElement Body)> Save(TestApi api, JsonNode input) => api.Call("POST", "/api/despensa/tickets", input.ToJsonString());

    private static async Task<JsonElement[]> Items(TestApi api) => [.. (await api.Data("GET", "/api/despensa/productos")).EnumerateArray()];

    private static JsonElement? ByName(JsonElement[] items, string name) =>
        items.Where(item => item.GetProperty("name").GetString() == name).Select(item => (JsonElement?)item).FirstOrDefault();

    [Fact]
    public async Task Guarda_el_ticket_crea_los_productos_recuerda_lo_aprendido_y_no_lo_guarda_dos_veces()
    {
        var (database, _, api) = await Start();
        await using var _db = database;
        await using var _api = api;
        var draft = await ReadLidl(api);
        var input = SaveInput(draft, (key, _) => key == "DETERGENTE LIQUIDO" ? new JsonObject { ["kind"] = "ignore" } : null);
        var (status, body) = await Save(api, input);
        Assert.Equal(201, status);
        var ticket = body.GetProperty("data").GetProperty("ticket");
        Assert.Equal(("Lidl", "2026-10-24", 5251L, 18L), (ticket.GetProperty("storeName").GetString(), ticket.GetProperty("date").GetString(),
            ticket.GetProperty("totalCents").GetInt64(), ticket.GetProperty("linesCount").GetInt64()));
        Assert.Equal(JsonValueKind.Null, ticket.GetProperty("lines").EnumerateArray()
            .Single(line => line.GetProperty("rawName").GetString() == "DETERGENTE LÍQUIDO").GetProperty("itemId").ValueKind);

        var list = await Items(api);
        // 18 líneas: los macarrones dos veces y el detergente no se sigue.
        Assert.Equal(16, list.Length);
        Assert.Equal(body.GetProperty("data").GetProperty("items").GetRawText(), (await api.Data("GET", "/api/despensa/productos")).GetRawText());
        var milk = ByName(list, "Leche semidesnatada")!.Value;
        Assert.Equal(("compras", "ud", 95L), (milk.GetProperty("tracking").GetString(), milk.GetProperty("unit").GetString(), milk.GetProperty("priceCents").GetInt64()));
        var chicken = ByName(list, "Pechuga de pollo")!.Value;
        Assert.Equal(("kg", 693L), (chicken.GetProperty("unit").GetString(), chicken.GetProperty("priceCents").GetInt64()));
        // La promoción general no se asigna al café; el descuento del pollo sí afecta a su precio por kilo.
        var coffee = ByName(list, "Café molido natural")!.Value;
        Assert.Equal((329L, "mensual"), (coffee.GetProperty("priceCents").GetInt64(), coffee.GetProperty("frequency").GetString()));
        Assert.Equal(16, ticket.GetProperty("productsCount").GetInt64());

        var (again, conflict) = await Save(api, input);
        Assert.Equal(409, again);
        Assert.Equal("Este ticket ya está guardado (Lidl, 24/10/2026).", conflict.GetProperty("error").GetProperty("message").GetString());
        var reread = await ReadLidl(api);
        Assert.Equal(ticket.GetProperty("id").GetString(), reread.GetProperty("duplicate").GetProperty("id").GetString());
        // Lo aprendido: la próxima vez todo llega emparejado (y el detergente, sin seguir).
        Assert.Equal($"{{\"kind\":\"item\",\"itemId\":\"{milk.GetProperty("id").GetString()}\",\"how\":\"recordado\"}}",
            reread.GetProperty("suggestions").GetProperty("LECHE SEMIDESNATADA").GetRawText());
        Assert.Equal("{\"kind\":\"ignore\",\"how\":\"recordado\"}", reread.GetProperty("suggestions").GetProperty("DETERGENTE LIQUIDO").GetRawText());
    }

    [Fact]
    public async Task En_los_productos_que_se_cuentan_suma_lo_comprado_y_actualiza_el_precio()
    {
        var (database, _, api) = await Start();
        await using var _db = database;
        await using var _api = api;
        var rice = await api.Data("POST", "/api/despensa/productos", new
        {
            name = "Arroz", ownerId = (string?)null, unit = "paquete", tracking = "cantidad", quantity = 1, target = 3, frequency = "mensual",
            priceCents = 100, notes = "",
        }, 201);
        var draft = await ReadLidl(api);
        Assert.Equal("new", draft.GetProperty("suggestions").GetProperty("ARROZ REDONDO").GetProperty("kind").GetString());
        var (status, _) = await Save(api, SaveInput(draft, (key, _) =>
            key == "ARROZ REDONDO" ? new JsonObject { ["kind"] = "item", ["itemId"] = rice.GetProperty("id").GetString() } : null));
        Assert.Equal(201, status);
        var after = ByName(await Items(api), "Arroz")!.Value;
        Assert.Equal((2.0, 115L, 3L), (after.GetProperty("quantity").GetDouble(), after.GetProperty("priceCents").GetInt64(), after.GetProperty("version").GetInt64()));
    }

    [Fact]
    public async Task Rechaza_decisiones_que_no_encajan_sin_guardar_nada()
    {
        var (database, _, api) = await Start();
        await using var _db = database;
        await using var _api = api;
        var draft = await ReadLidl(api);
        var noDecision = SaveInput(draft);
        noDecision["decisions"]!.AsObject().Remove("LECHE SEMIDESNATADA");
        var (status, body) = await Save(api, noDecision);
        // Lo detecta antes validateTicketSave (como en Express): el mensaje es el suyo.
        Assert.Equal(400, status);
        Assert.StartsWith("El producto «LECHE SEMIDESNATADA»: falta qué hacer", body.GetProperty("error").GetProperty("message").GetString());
        var ghost = SaveInput(draft, (key, _) => key == "LECHE SEMIDESNATADA" ? new JsonObject { ["kind"] = "item", ["itemId"] = "no-existe" } : null);
        (status, body) = await Save(api, ghost);
        Assert.Equal((400, "«LECHE SEMIDESNATADA» está asociado a un producto que ya no existe. Elige otro."),
            (status, body.GetProperty("error").GetProperty("message").GetString()));
        var noPerson = SaveInput(draft, (key, _) => key == "LECHE SEMIDESNATADA"
            ? new JsonObject { ["kind"] = "new", ["name"] = "Leche", ["ownerId"] = "nadie", ["frequency"] = "semanal" } : null);
        (status, body) = await Save(api, noPerson);
        Assert.Equal((400, "El producto es de una persona que no existe. Elige otra o «Compartido»."), (status, body.GetProperty("error").GetProperty("message").GetString()));
        var badDate = SaveInput(draft);
        badDate["date"] = "24/10/2026";
        Assert.Equal(400, (await Save(api, badDate)).Status);
        var noLines = SaveInput(draft);
        noLines["lines"] = new JsonArray();
        Assert.Equal(400, (await Save(api, noLines)).Status);
        Assert.Empty(await Items(api));
        Assert.Equal(0L, await database.Scalar("SELECT COUNT(*) FROM pantry_tickets"));
        Assert.Equal(0L, await database.Scalar("SELECT COUNT(*) FROM pantry_aliases"));
    }

    [Fact]
    public async Task Un_importe_mal_leido_se_guarda_pendiente_con_su_evidencia_y_no_toca_la_despensa_hasta_confirmarlo()
    {
        var (database, _, api) = await Start();
        await using var _db = database;
        await using var _api = api;
        const string Potatoes = "LIDL SUPERMERCADOS S.A.U.\nEUR\nPATATA NUEVA 5 KG   4,95X   2   92,90 A\nTOTAL 9,90\nLidl Pay 9,90\nFECHA: 28/10/26\nHORA: 19:24:38";
        var draft = await api.Data("POST", "/api/despensa/tickets/leer", new { texto = Potatoes, hoy = "2026-10-29" });
        var line = draft.GetProperty("ticket").GetProperty("lines")[0];
        Assert.Equal((990L, 495L, "[\"corregido\",\"dudoso\"]"), (line.GetProperty("amountCents").GetInt64(), line.GetProperty("unitPriceCents").GetInt64(),
            line.GetProperty("flags").GetRawText()));
        JsonObject ToSave(bool confirmed)
        {
            var input = SaveInput(draft);
            foreach (var entry in input["lines"]!.AsArray())
            {
                entry!["confirmed"] = confirmed;
                entry["evidence"] = JsonNode.Parse(line.GetProperty("evidence").GetRawText());
            }
            return input;
        }

        // Sin confirmar: el ticket se guarda (historial), la línea queda pendiente y no crea producto ni precio.
        var (status, body) = await Save(api, ToSave(false));
        Assert.Equal(201, status);
        var saved = body.GetProperty("data").GetProperty("ticket").GetProperty("lines")[0];
        Assert.Equal((990L, "pending", false, JsonValueKind.Null), (saved.GetProperty("amountCents").GetInt64(), saved.GetProperty("reviewStatus").GetString(),
            saved.GetProperty("confirmed").GetBoolean(), saved.GetProperty("itemId").ValueKind));
        var evidence = saved.GetProperty("evidence");
        Assert.Equal(9290, evidence.GetProperty("recognizedCents").GetInt64());
        Assert.StartsWith("{\"kind\":\"units\",\"verdict\":\"calculation\",\"recognizedCents\":9290,\"calculatedCents\":990,",
            evidence.GetProperty("discrepancy").GetRawText());
        Assert.Equal("[{\"cents\":990,\"origin\":\"calculation\"},{\"cents\":9290,\"origin\":\"read\"}]", evidence.GetProperty("options").GetRawText());
        // Se guarda como la deja validateTicketSave, en su orden y sin la posición en la imagen.
        Assert.StartsWith("{\"text\":\"PATATA NUEVA 5 KG   4,95X   2   92,90 A\",\"reread\":null,\"recognizedCents\":9290,\"calculatedCents\":990,\"selectedBy\":",
            (string)(await database.Scalar("SELECT evidence_json FROM pantry_ticket_lines"))!);
        Assert.Null(ByName(await Items(api), "Patata nueva 5 kg"));

        // Confirmado (otra compra): ahora sí crea el producto, con el precio de 9,90 € / 2.
        var confirmed = ToSave(true);
        confirmed["time"] = "20:00";
        confirmed["distinctPurchase"] = true;
        Assert.Equal(201, (await Save(api, confirmed)).Status);
        Assert.Equal(495, ByName(await Items(api), "Patata nueva 5 kg")!.Value.GetProperty("priceCents").GetInt64());
    }

    [Fact]
    public async Task La_API_nunca_acepta_como_fiable_92_90_con_4_95_por_2_aunque_el_cliente_diga_que_esta_confirmado()
    {
        var (database, _, api) = await Start();
        await using var _db = database;
        await using var _api = api;
        var draft = await api.Data("POST", "/api/despensa/tickets/leer",
            new { texto = "LIDL\nEUR\nPATATA NUEVA 5 KG   4,95X   2   92,90 A\nTOTAL 92,90\nFECHA: 28/10/26", hoy = "2026-10-29" });
        var forced = SaveInput(draft);
        foreach (var line in forced["lines"]!.AsArray())
        {
            line!["amountCents"] = 9290;
            line["confirmed"] = true;
        }
        var (status, body) = await Save(api, forced);
        Assert.Equal(201, status);
        var saved = body.GetProperty("data").GetProperty("ticket").GetProperty("lines")[0];
        Assert.Equal((9290L, "pending"), (saved.GetProperty("amountCents").GetInt64(), saved.GetProperty("reviewStatus").GetString()));
        Assert.Null(ByName(await Items(api), "Patata nueva 5 kg"));
    }

    [Fact]
    public async Task Las_huellas_no_cambian_los_tickets_ya_guardados_siguen_contando_como_duplicados()
    {
        // Los valores de tickets.test.ts: calculados con el código de antes de repartir los tickets en casos de uso.
        var (database, _, api) = await Start();
        await using var _db = database;
        await using var _api = api;
        var pasted = await api.Data("POST", "/api/despensa/tickets/leer", new { texto = "  LIDL\nEUR\nPAN   1,00 A\nTOTAL 1,00\nFECHA: 28/10/26 ", hoy = "2026-10-29" });
        Assert.Equal("a8737b2f4204b7b1b9c9b81440ae55228438a252a379693401a3cdfdc19a71e4", pasted.GetProperty("sourceFingerprint").GetString());
        Assert.Equal("74707bc9bd62595e3ac455802d512b5aa806bf0bc49a863157e635ad2b397a5e", (await ReadLidl(api)).GetProperty("sourceFingerprint").GetString());
        var (status, _) = await api.Call("POST", "/api/despensa/tickets", new
        {
            store = "lidl", storeName = "Lidl", address = "", date = "2026-10-28", time = "19:24", totalCents = 100, acknowledged = true,
            lines = new[] { new { rawName = "PAN", quantity = 1, unitPriceCents = (long?)null, amountCents = 100, discountCents = 0, weightKg = (double?)null,
                pricePerKgCents = (long?)null, taxCode = "A", occasional = false } },
            adjustments = new[] { new { id = "a1", label = "Cupón", kind = "coupon", amountCents = -10, needsReview = false } },
            decisions = new Dictionary<string, object> { ["PAN"] = new { kind = "ignore" } },
            sourceFingerprint = pasted.GetProperty("sourceFingerprint").GetString(),
        });
        Assert.Equal(201, status);
        Assert.Equal("4ee26779153a9a0ba92b3af35f8f543155cfe656884bd3d4d5693140d5baeb30|a8737b2f4204b7b1b9c9b81440ae55228438a252a379693401a3cdfdc19a71e4",
            await database.Scalar("SELECT CONCAT(fingerprint, '|', source_fingerprint) FROM pantry_tickets"));
        Assert.Equal("[{\"id\":\"a1\",\"label\":\"Cupón\",\"kind\":\"coupon\",\"amountCents\":-10,\"needsReview\":false}]",
            await database.Scalar("SELECT adjustments_json FROM pantry_tickets"));
    }

    [Fact]
    public async Task Cambia_el_producto_de_una_linea_guardada_y_de_sus_iguales_y_borra_tickets_sin_borrar_productos()
    {
        // TIC-04, como tickets.test.ts.
        var (database, _, api) = await Start();
        await using var _db = database;
        await using var _api = api;
        var draft = await ReadLidl(api);
        var ticket = (await Save(api, SaveInput(draft))).Body.GetProperty("data").GetProperty("ticket");
        var ticketId = ticket.GetProperty("id").GetString()!;
        var list = await Items(api);
        var pasta = ticket.GetProperty("lines").EnumerateArray().First(line => line.GetProperty("rawName").GetString() == "MACARRONES");
        var rice = ByName(list, "Arroz redondo")!.Value.GetProperty("id").GetString();

        var updated = await api.Data("PUT", $"/api/despensa/tickets/{ticketId}/lineas/{pasta.GetProperty("id").GetString()}", new { itemId = rice });
        Assert.Equal(new[] { rice, rice }, updated.GetProperty("lines").EnumerateArray()
            .Where(line => line.GetProperty("rawName").GetString() == "MACARRONES").Select(line => line.GetProperty("itemId").GetString()));
        await api.Fails("PUT", $"/api/despensa/tickets/{ticketId}/lineas/{pasta.GetProperty("id").GetString()}", new { itemId = "no-existe" }, 400, "VALIDATION",
            "Ese producto ya no existe. Elige otro.");
        await api.Fails("PUT", $"/api/despensa/tickets/{ticketId}/lineas/otra", new { itemId = (string?)null }, 404, "NOT_FOUND", "Esa línea del ticket ya no existe.");
        await api.Fails("PUT", $"/api/despensa/tickets/otro/lineas/otra", new { itemId = (string?)null }, 404, "NOT_FOUND", "Ese ticket ya no existe.");
        await api.Fails("PUT", $"/api/despensa/tickets/{ticketId}/lineas/otra", new { }, 400, "VALIDATION", "Falta el campo «itemId» (id del producto o null).");
        Assert.Equal($"{{\"kind\":\"item\",\"itemId\":\"{rice}\",\"how\":\"recordado\"}}",
            (await ReadLidl(api)).GetProperty("suggestions").GetProperty("MACARRONES").GetRawText());
        Assert.Equal(ticketId, Assert.Single((await api.Data("GET", "/api/despensa/tickets")).EnumerateArray()).GetProperty("id").GetString());

        // Borrar un producto deja la línea sin producto; borrar el ticket quita sus compras pero no los productos ni sus cantidades.
        await api.Data("DELETE", $"/api/despensa/productos/{ByName(list, "Yogur griego")!.Value.GetProperty("id").GetString()}");
        var afterDelete = await api.Data("GET", $"/api/despensa/tickets/{ticketId}");
        Assert.Equal(JsonValueKind.Null, afterDelete.GetProperty("lines").EnumerateArray()
            .Single(line => line.GetProperty("rawName").GetString() == "YOGUR GRIEGO").GetProperty("itemId").ValueKind);
        Assert.NotEmpty((await api.Data("GET", "/api/despensa/actividad?hoy=2026-10-30")).GetProperty("purchases").EnumerateArray());
        var itemsBefore = (await api.Data("GET", "/api/despensa/productos")).GetRawText();
        Assert.Equal(JsonValueKind.Null, (await api.Data("DELETE", $"/api/despensa/tickets/{ticketId}")).ValueKind);
        await api.Fails("GET", $"/api/despensa/tickets/{ticketId}", null, 404, "NOT_FOUND", "Ese ticket ya no existe.");
        await api.Fails("DELETE", $"/api/despensa/tickets/{ticketId}", null, 404, "NOT_FOUND", "Ese ticket ya no existe.");
        Assert.Empty((await api.Data("GET", "/api/despensa/actividad?hoy=2026-10-30")).GetProperty("purchases").EnumerateArray());
        Assert.Equal(itemsBefore, (await api.Data("GET", "/api/despensa/productos")).GetRawText());
        Assert.Equal(list.Length - 1, (await Items(api)).Length);
        Assert.Empty((await api.Data("GET", "/api/despensa/tickets")).EnumerateArray());
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Atomicidad (ticketAtomicity.test.ts)

    private static readonly string[] AllTables =
    [
        "pantry_people", "pantry_items", "pantry_settings", "pantry_events", "pantry_tickets", "pantry_ticket_lines", "pantry_aliases",
        "categories", "movements", "recurring_rules", "recurring_excluded_dates", "meta", "schema_migrations", "app_locks",
    ];

    private static async Task<Dictionary<string, string>> Snapshot(TestDatabase database) =>
        (await database.Query($"CHECKSUM TABLE {string.Join(", ", AllTables)}", row => (Table: row.GetString(0), Sum: $"{row.GetValue(1)}")))
            .ToDictionary(row => row.Table[(row.Table.IndexOf('.') + 1)..], row => row.Sum);

    private static JsonObject Line(string rawName, long amountCents) => new()
    {
        ["rawName"] = rawName, ["quantity"] = 1, ["unitPriceCents"] = amountCents, ["amountCents"] = amountCents, ["discountCents"] = 0,
        ["weightKg"] = null, ["pricePerKgCents"] = null, ["taxCode"] = "A", ["occasional"] = false, ["confirmed"] = true,
    };

    private static JsonObject Ticket(JsonObject decisions, params JsonObject[] lines) => new()
    {
        ["store"] = "otra", ["storeName"] = "Tienda inventada", ["address"] = "", ["date"] = "2026-11-01", ["time"] = "10:00",
        ["totalCents"] = lines.Sum(line => (long)line["amountCents"]!), ["lines"] = new JsonArray([.. lines]), ["decisions"] = decisions, ["acknowledged"] = true,
    };

    /// <summary>prepare(): un producto que se cuenta, un ticket y una equivalencia previos, y el ticket que se va a guardar.</summary>
    private static async Task<(JsonElement Item, JsonObject Input)> Prepare(TestApi api)
    {
        var item = await api.Data("POST", "/api/despensa/productos", new { name = "Pan de ensayo", unit = "ud", frequency = "semanal", quantity = 1, target = 4, priceCents = 100 }, 201);
        var previous = Ticket(new JsonObject { ["AZUCAR"] = new JsonObject { ["kind"] = "ignore" } }, Line("AZUCAR", 90));
        previous["date"] = "2026-10-31";
        Assert.Equal(201, (await Save(api, previous)).Status);
        var input = Ticket(new JsonObject
        {
            ["PAN"] = new JsonObject { ["kind"] = "item", ["itemId"] = item.GetProperty("id").GetString() },
            ["TE"] = new JsonObject { ["kind"] = "new", ["name"] = "Té de ensayo", ["ownerId"] = null, ["frequency"] = "mensual" },
        }, Line("PAN", 200), Line("TE", 250));
        input["importId"] = "importacion-sintetica-0001";
        input["sourceFingerprint"] = "origen-sintetico-0001";
        return (item, input);
    }

    private static string Expected(JsonElement item, double quantity, long priceCents, long version)
    {
        var node = JsonNode.Parse(item.GetRawText())!.AsObject();
        node["quantity"] = quantity;
        node["priceCents"] = priceCents;
        node["version"] = version;
        return node.ToJsonString();
    }

    private static async Task<string> ItemJson(TestApi api, string id) =>
        JsonNode.Parse((await Items(api)).Single(entry => entry.GetProperty("id").GetString() == id).GetRawText())!.ToJsonString();

    [Fact]
    public async Task Revierte_todos_los_efectos_ante_un_fallo_real_de_MySQL_en_la_segunda_linea_y_admite_un_unico_reintento()
    {
        var ids = new QueueThenCounter();
        var (database, _, api) = await Start(ids);
        await using var _db = database;
        await using var _api = api;
        var (item, input) = await Prepare(api);
        // La segunda línea se encontrará su id ocupado: una clave primaria repetida, a mitad del guardado, después de crear el
        // producto nuevo, aprender las equivalencias, cambiar precio y cantidad y guardar la cabecera.
        var previousTicket = (string)(await database.Scalar("SELECT id FROM pantry_tickets"))!;
        await database.Execute(
            "INSERT INTO pantry_ticket_lines (id, ticket_id, position, raw_name, name_key, quantity) VALUES ('linea-ocupada', ?, 1, 'OCUPADA', 'OCUPADA', 1)",
            previousTicket);
        var before = await Snapshot(database);
        ids.Use("te-nuevo", "ticket-nuevo", "linea-primera", "linea-ocupada");
        var (status, body) = await Save(api, input);
        Assert.Equal(409, status);
        Assert.Equal("{\"ok\":false,\"error\":{\"code\":\"CONFLICT\",\"message\":\"Los datos no encajan con los que ya están guardados, así que no se ha cambiado nada.\"}}",
            body.GetRawText());
        Assert.Equal(before, await Snapshot(database));

        await database.Execute("DELETE FROM pantry_ticket_lines WHERE id = 'linea-ocupada'");
        Assert.Equal(201, (await Save(api, input)).Status);
        // Cambiar el precio y sumar la cantidad son dos escrituras: cada una incrementa la versión.
        Assert.Equal(Expected(item, 2, 200, 3), await ItemJson(api, item.GetProperty("id").GetString()!));
        Assert.Equal(new[] { "Pan de ensayo", "Té de ensayo" }, (await Items(api)).Select(entry => entry.GetProperty("name").GetString()).Order(StringComparer.Ordinal));
        Assert.Equal((2L, 3L, 3L), ((long)(await database.Scalar("SELECT COUNT(*) FROM pantry_tickets"))!, (long)(await database.Scalar("SELECT COUNT(*) FROM pantry_ticket_lines"))!,
            (long)(await database.Scalar("SELECT COUNT(*) FROM pantry_aliases"))!));
        var after = await Snapshot(database);
        foreach (var table in AllTables.Where(table => !table.StartsWith("pantry_", StringComparison.Ordinal)))
            Assert.True(after[table] == before[table], table);

        var (repeated, conflict) = await Save(api, input);
        Assert.Equal((409, "Este ticket ya está guardado (Tienda inventada, 01/11/2026)."), (repeated, conflict.GetProperty("error").GetProperty("message").GetString()));
        Assert.Equal(after, await Snapshot(database));
    }

    [Fact]
    public async Task Dos_guardados_del_mismo_ticket_a_la_vez_desde_dos_conexiones_un_201_y_un_409_sin_efectos_dobles()
    {
        var (database, _, api) = await Start();
        await using var _db = database;
        await using var _api = api;
        var (second, _) = await database.Open(NewClock());
        await using var other = await TestApi.Start(second, NewClock(), login: false, reader: new FixtureReader());
        var (item, input) = await Prepare(api);
        var results = await Task.WhenAll(Save(api, input), Save(other, input));
        Assert.Equal(new[] { 201, 409 }, results.Select(result => result.Status).Order());
        Assert.Equal("Este ticket ya está guardado (Tienda inventada, 01/11/2026).",
            results.Single(result => result.Status == 409).Body.GetProperty("error").GetProperty("message").GetString());
        Assert.Equal((2L, 3L, 3L), ((long)(await database.Scalar("SELECT COUNT(*) FROM pantry_tickets"))!, (long)(await database.Scalar("SELECT COUNT(*) FROM pantry_ticket_lines"))!,
            (long)(await database.Scalar("SELECT COUNT(*) FROM pantry_aliases"))!));
        // Precio y cantidad una sola vez, y un solo «Té de ensayo».
        Assert.Equal(Expected(item, 2, 200, 3), await ItemJson(api, item.GetProperty("id").GetString()!));
        Assert.Equal(new[] { "Pan de ensayo", "Té de ensayo" }, (await Items(api)).Select(entry => entry.GetProperty("name").GetString()).Order(StringComparer.Ordinal));
    }

    [Fact]
    public async Task Dos_guardados_a_la_vez_de_un_ticket_sin_productos_que_ya_existan_van_en_serie_por_el_bloqueo_tickets()
    {
        // Sin productos que bloquear, solo el bloqueo «tickets» hace que el segundo vea el primero y responda su 409 propio
        // (sin él, chocaría con el índice único de la huella y daría el 409 genérico).
        var (database, _, api) = await Start();
        await using var _db = database;
        await using var _api = api;
        var (second, _) = await database.Open(NewClock());
        await using var other = await TestApi.Start(second, NewClock(), login: false, reader: new FixtureReader());
        for (var round = 0; round < 3; round++)
        {
            var input = Ticket(new JsonObject
            {
                ["LECHE"] = new JsonObject { ["kind"] = "new", ["name"] = $"Leche {round}", ["ownerId"] = null, ["frequency"] = "semanal" },
                ["SAL"] = new JsonObject { ["kind"] = "ignore" },
            }, Line("LECHE", 100 + round), Line("SAL", 50));
            var results = await Task.WhenAll(Save(api, input), Save(other, input));
            Assert.Equal(new[] { 201, 409 }, results.Select(result => result.Status).Order());
            Assert.Equal("Este ticket ya está guardado (Tienda inventada, 01/11/2026).",
                results.Single(result => result.Status == 409).Body.GetProperty("error").GetProperty("message").GetString());
            Assert.Single(await Items(api), item => item.GetProperty("name").GetString() == $"Leche {round}");
        }
    }

    [Fact]
    public async Task Un_ticket_y_un_mas_a_la_vez_sobre_el_mismo_producto_desde_dos_conexiones_no_se_pisan()
    {
        var (database, _, api) = await Start();
        await using var _db = database;
        await using var _api = api;
        var (second, _) = await database.Open(NewClock());
        await using var other = await TestApi.Start(second, NewClock(), login: false, reader: new FixtureReader());
        var (item, input) = await Prepare(api);
        var itemId = item.GetProperty("id").GetString()!;
        var results = await Task.WhenAll(Save(api, input), other.Call("POST", $"/api/despensa/productos/{itemId}/ajustar", new { delta = 1 }));
        Assert.Equal(new[] { 201, 200 }, results.Select(result => result.Status));
        // 1 de antes, +1 del ticket y +1 del botón, en el orden que sea; tres escrituras, tres versiones más.
        Assert.Equal(Expected(item, 3, 200, 4), await ItemJson(api, itemId));
    }
}
