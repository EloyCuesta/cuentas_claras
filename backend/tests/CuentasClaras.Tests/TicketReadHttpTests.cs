using System.Buffers.Binary;
using System.Globalization;
using System.Text.Json;
using CuentasClaras.Application.Tickets;
using CuentasClaras.Domain.Tickets;
using CuentasClaras.Infrastructure.Tickets;

namespace CuentasClaras.Tests;

/// <summary>
/// La lectura de tickets en .NET (TIC-02), por HTTP sobre MySQL real y como invitado: como «API de tickets» de
/// server/modules/tickets/tickets.test.ts, con un lector falso que devuelve el OCR guardado del ticket de ejemplo
/// (fixtures/tickets/ticket-lidl-ejemplo.ocr.json). Validación y límites de las imágenes y las franjas, duplicados por
/// origen, por contenido y posibles, y el primer paso del contrato http-tickets.json, exacto.
/// </summary>
[Trait("Categoria", TestDatabase.Category)]
public sealed class TicketReadHttpTests
{
    private const string Now = "2026-11-01T08:00:00.000Z";
    private const string Blurry = "No se ha podido leer la imagen. Prueba con otra captura más nítida.";

    private static string Fixture(string name) => Path.Combine(AppContext.BaseDirectory, "Fixtures", "tickets", name);

    private static readonly byte[] LidlPng = File.ReadAllBytes(Fixture("ticket-lidl-ejemplo.png"));

    private static IReadOnlyList<IReadOnlyList<OcrLine>> LidlOcr()
    {
        using var document = JsonDocument.Parse(File.ReadAllText(Fixture("ticket-lidl-ejemplo.ocr.json")));
        return NodeTicketReader.ReadPages(JsonDocument.Parse($"[{document.RootElement.GetRawText()}]").RootElement);
    }

    /// <summary>Un lector falso: devuelve siempre las mismas páginas (o falla) y apunta lo que le piden.</summary>
    private sealed class FakeReader(IReadOnlyList<IReadOnlyList<OcrLine>>? pages, bool fails = false) : ITicketReader
    {
        public List<(IReadOnlyList<byte[]> Images, IReadOnlyList<TicketSegmentInput>? Segments)> Calls { get; } = [];

        public Task<IReadOnlyList<IReadOnlyList<OcrLine>>> Read(IReadOnlyList<byte[]> images, IReadOnlyList<TicketSegmentInput>? segments,
            CancellationToken cancellationToken = default)
        {
            Calls.Add((images, segments));
            return fails ? Task.FromException<IReadOnlyList<IReadOnlyList<OcrLine>>>(new InvalidOperationException("x")) : Task.FromResult(pages!);
        }
    }

    private static async Task<(TestDatabase Database, TestApi Api)> Start(ITicketReader reader, string today = "2026-11-01", params string[] ids)
    {
        var database = await TestDatabase.Create();
        var clock = new FixedClock(DateTimeOffset.Parse(Now, CultureInfo.InvariantCulture).ToUnixTimeMilliseconds()) { TodayDate = today };
        var (opened, _) = await database.Open(clock);
        return (database, await TestApi.Start(opened, clock, ids.Length > 0 ? new QueuedIds(ids) : null, login: false, reader: reader));
    }

    /// <summary>La cabecera de un PNG de ese tamaño (imageInfo solo lee la cabecera), con relleno hasta <paramref name="bytes"/>.</summary>
    private static byte[] Png(uint width, uint height, int bytes = 64)
    {
        var buffer = new byte[Math.Max(bytes, 24)];
        new byte[] { 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, (byte)'I', (byte)'H', (byte)'D', (byte)'R' }.CopyTo(buffer, 0);
        BinaryPrimitives.WriteUInt32BigEndian(buffer.AsSpan(16), width);
        BinaryPrimitives.WriteUInt32BigEndian(buffer.AsSpan(20), height);
        return buffer;
    }

    /// <summary>Una cabecera JPEG mínima: SOI, un APP0 y el SOF0 con alto y ancho.</summary>
    private static byte[] Jpeg(ushort width, ushort height)
    {
        var bytes = new List<byte> { 0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08 };
        bytes.AddRange([(byte)(height >> 8), (byte)height, (byte)(width >> 8), (byte)width]);
        bytes.AddRange(new byte[12]);
        return [.. bytes];
    }

    private static string Base64(byte[] bytes) => Convert.ToBase64String(bytes);

    [Fact]
    public async Task Lee_el_texto_del_contrato_de_tickets_con_la_misma_respuesta_que_Express()
    {
        using var contract = CorpusJson.Load("http-tickets.json");
        var scenario = contract.RootElement.GetProperty("scenarios")[0];
        var step = scenario.GetProperty("steps")[0];
        Assert.Equal("/api/despensa/tickets/leer", step.GetProperty("request").GetProperty("path").GetString());
        var (database, api) = await Start(new FakeReader(null), "2026-11-01", "00000000-0000-4000-8000-000000000001");
        await using var _db = database;
        await using var _api = api;
        using var response = await api.Send("POST", "/api/despensa/tickets/leer", step.GetProperty("request").GetProperty("body").GetRawText());
        Assert.Equal(200, (int)response.StatusCode);
        using var actual = JsonDocument.Parse(await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        Assert.True(JsonElement.DeepEquals(step.GetProperty("expected").GetProperty("body"), actual.RootElement), actual.RootElement.GetRawText());
        Assert.Equal("no-store", TestApi.Header(response, "cache-control"));
    }

    [Fact]
    public async Task Lee_un_ticket_sin_guardar_nada_y_propone_productos_nuevos_con_nombres_legibles()
    {
        var reader = new FakeReader(LidlOcr());
        var (database, api) = await Start(reader);
        await using var _db = database;
        await using var _api = api;
        var draft = await api.Data("POST", "/api/despensa/tickets/leer", new { imagenes = new[] { Base64(LidlPng) }, hoy = "2026-10-25" });
        var ticket = draft.GetProperty("ticket");
        Assert.Equal(("lidl", "2026-10-24", "18:05", 5251L), (ticket.GetProperty("store").GetString(), ticket.GetProperty("date").GetString(),
            ticket.GetProperty("time").GetString(), ticket.GetProperty("totalCents").GetInt64()));
        // La suma coincide; las tres lecturas con cifras de más quedan por confirmar.
        var check = ticket.GetProperty("check");
        Assert.Equal(("pendiente", 0L, 3), (check.GetProperty("status").GetString(), check.GetProperty("differenceCents").GetInt64(), check.GetProperty("pending").GetInt32()));
        Assert.Equal(JsonValueKind.Null, draft.GetProperty("duplicate").ValueKind);
        Assert.Equal("{\"kind\":\"new\",\"name\":\"Leche semidesnatada\",\"frequency\":\"semanal\"}",
            draft.GetProperty("suggestions").GetProperty("LECHE SEMIDESNATADA").GetRawText());
        Assert.Equal("mensual", draft.GetProperty("suggestions").GetProperty("PAPEL HIGIENICO 12R").GetProperty("frequency").GetString());
        // La huella del origen son los bytes de la imagen; el lector recibe esos mismos bytes y ninguna franja.
        var (images, segments) = Assert.Single(reader.Calls);
        Assert.Equal(LidlPng, Assert.Single(images));
        Assert.Null(segments);
        Assert.Equal(new Sha256Hasher().Sha256Hex(TicketIdentity.ImagesSource([LidlPng])), draft.GetProperty("sourceFingerprint").GetString());
        Assert.Matches("^[0-9a-f-]{36}$", draft.GetProperty("importId").GetString());
        // No guarda nada.
        Assert.Equal(0L, await database.Scalar("SELECT COUNT(*) FROM pantry_tickets"));
        Assert.Equal(0L, await database.Scalar("SELECT COUNT(*) FROM pantry_items"));
    }

    [Fact]
    public async Task Valida_las_imagenes_y_el_texto_y_explica_un_fallo_del_OCR()
    {
        var (database, api) = await Start(new FakeReader(LidlOcr()));
        await using var _db = database;
        await using var _api = api;
        const string Path = "/api/despensa/tickets/leer";
        await api.Fails("POST", Path, null, 400, "VALIDATION", "Falta el cuerpo de la petición en JSON.");
        await api.Fails("POST", Path, new { }, 400, "VALIDATION", "Elige al menos una imagen del ticket.");
        await api.Fails("POST", Path, new { imagenes = Array.Empty<string>() }, 400, "VALIDATION", "Elige al menos una imagen del ticket.");
        await api.Fails("POST", Path, new { imagenes = new[] { Base64("hola"u8.ToArray()) } }, 400, "VALIDATION", "La imagen 1 no es una imagen PNG o JPEG.");
        await api.Fails("POST", Path, new { imagenes = new object[] { Base64(LidlPng), 5 } }, 400, "VALIDATION", "La imagen 2 no es válida.");
        await api.Fails("POST", Path, new { imagenes = Enumerable.Repeat(Base64(LidlPng), 7) }, 400, "VALIDATION",
            "Se pueden leer como máximo 6 imágenes o franjas de un mismo ticket.");
        await api.Fails("POST", Path, new { texto = "   " }, 400, "VALIDATION", "Pega el texto del ticket.");
        await api.Fails("POST", Path, new { texto = new string('x', 20_001) }, 400, "VALIDATION", "El texto del ticket es demasiado largo.");
        await api.Fails("POST", Path, new { texto = "Hola\nAdiós" }, 400, "VALIDATION",
            "No se ha encontrado ningún producto en el ticket. Prueba con una captura más nítida o pega el texto.");
        var pasted = await api.Data("POST", Path, new { texto = "MERCADONA, S.A.\n28/10/2026 19:24\n1 PAN BARRA   0,60\nTOTAL   0,60", hoy = "2026-10-28" });
        Assert.Equal(("otra", "Mercadona", 60L), (pasted.GetProperty("ticket").GetProperty("store").GetString(),
            pasted.GetProperty("ticket").GetProperty("storeName").GetString(), pasted.GetProperty("ticket").GetProperty("totalCents").GetInt64()));

        // Un fallo del OCR se explica sin tumbar el servidor.
        var (brokenDatabase, broken) = await Start(new FakeReader(null, fails: true));
        await using var _brokenDb = brokenDatabase;
        await using var _broken = broken;
        await broken.Fails("POST", Path, new { imagenes = new[] { Base64(LidlPng) } }, 400, "VALIDATION", Blurry);
    }

    [Fact]
    public async Task Limita_el_tamano_y_los_pixeles_y_acepta_PNG_JPEG_y_data_URL()
    {
        var reader = new FakeReader(LidlOcr());
        var (database, api) = await Start(reader);
        await using var _db = database;
        await using var _api = api;
        const string Path = "/api/despensa/tickets/leer";
        await api.Fails("POST", Path, new { imagenes = new[] { Base64(Png(9000, 10)) } }, 400, "VALIDATION", "La imagen 1 es demasiado grande para leerla.");
        await api.Fails("POST", Path, new { imagenes = new[] { Base64(Png(10, 40_001)) } }, 400, "VALIDATION", "La imagen 1 es demasiado grande para leerla.");
        await api.Fails("POST", Path, new { imagenes = new[] { Base64(LidlPng), Base64(Png(7000, 7000)) } }, 400, "VALIDATION",
            "La imagen 2 es demasiado grande para leerla.");
        await api.Fails("POST", Path, new { imagenes = new[] { Base64(Png(100, 100, 8 * 1024 * 1024 + 1)) } }, 400, "VALIDATION",
            "La imagen 1 es demasiado grande (máximo 8 MB).");
        var big = Base64(Png(100, 100, 7 * 1024 * 1024));
        await api.Fails("POST", Path, new { imagenes = new[] { big, big, big } }, 400, "VALIDATION",
            "Las imágenes superan 20 MB. Recorta los márgenes o el contenido publicitario.");
        Assert.Empty(reader.Calls);

        // Un JPEG y una data URL (el prefijo no cuenta), con un carácter suelto que el decodificador de Node se salta.
        var jpeg = Jpeg(640, 480);
        await api.Data("POST", Path, new { imagenes = new[] { "data:image/png;base64," + Base64(LidlPng), Base64(jpeg).Insert(4, "*") } });
        var (images, _) = Assert.Single(reader.Calls);
        Assert.Equal(LidlPng, images[0]);
        Assert.Equal(jpeg, images[1]);
    }

    [Fact]
    public async Task Las_franjas_tienen_que_ir_seguidas_y_ser_de_la_misma_imagen()
    {
        var reader = new FakeReader(LidlOcr());
        var (database, api) = await Start(reader);
        await using var _db = database;
        await using var _api = api;
        const string Path = "/api/despensa/tickets/leer";
        object Franja(byte[] image, int imageIndex, int segmentIndex, int offsetY, int fullHeight) =>
            new { image = Base64(image), imageIndex, segmentIndex, offsetY, fullHeight };
        var top = Png(100, 60);
        var bottom = Png(100, 40);

        await api.Data("POST", Path, new { franjas = new[] { Franja(top, 0, 0, 0, 100), Franja(bottom, 0, 1, 60, 100), Franja(Png(80, 50), 1, 0, 0, 50) } });
        var (images, segments) = Assert.Single(reader.Calls);
        Assert.Equal(3, images.Count);
        Assert.Equal(new[] { new TicketSegmentInput(0, 0, 0, 100), new TicketSegmentInput(0, 1, 60, 100), new TicketSegmentInput(1, 0, 0, 50) }, segments);

        const string Unordered = "Las franjas deben estar ordenadas y pertenecer a la misma imagen.";
        await api.Fails("POST", Path, new { franjas = new[] { Franja(bottom, 0, 1, 60, 100) } }, 400, "VALIDATION", Unordered);
        await api.Fails("POST", Path, new { franjas = new[] { Franja(top, 0, 0, 0, 100), Franja(Png(90, 40), 0, 1, 60, 100) } }, 400, "VALIDATION", Unordered);
        // Como en Express, el desplazamiento tiene que crecer (pueden solaparse) y la franja caber en la imagen entera.
        await api.Fails("POST", Path, new { franjas = new[] { Franja(top, 0, 0, 0, 100), Franja(bottom, 0, 1, 0, 100) } }, 400, "VALIDATION", Unordered);
        await api.Fails("POST", Path, new { franjas = new[] { Franja(top, 0, 0, 0, 100), Franja(bottom, 0, 1, 70, 100) } }, 400, "VALIDATION", Unordered);
        await api.Data("POST", Path, new { franjas = new[] { Franja(top, 0, 0, 0, 100), Franja(bottom, 0, 1, 50, 100) } });
        await api.Fails("POST", Path, new { franjas = new[] { Franja(Png(100, 4097), 0, 0, 0, 5000) } }, 400, "VALIDATION", Unordered);
        await api.Fails("POST", Path, new { franjas = new[] { Franja(top, 6, 0, 0, 100) } }, 400, "VALIDATION", "Las coordenadas de las franjas no son válidas.");
        await api.Fails("POST", Path, new { franjas = new[] { new { image = Base64(top), imageIndex = 0, segmentIndex = 0, offsetY = 0, fullHeight = 1.5 } } },
            400, "VALIDATION", "Las coordenadas de las franjas no son válidas.");
        await api.Fails("POST", Path, new { franjas = new object[] { new { imageIndex = 0 } } }, 400, "VALIDATION", "La imagen 1 no es válida.");
        await api.Fails("POST", Path, new { franjas = Enumerable.Repeat(Franja(top, 0, 0, 0, 100), 25) }, 400, "VALIDATION",
            "Se pueden leer como máximo 24 imágenes o franjas de un mismo ticket.");
        Assert.Equal(2, reader.Calls.Count);
    }

    private const string Pan = "LIDL\nEUR\nPAN ENSAYO 1,00 A\nTOTAL 1,00\nFECHA: 31/10/26";

    private static async Task SeedTicket(TestDatabase database, string id, string fingerprint, string? sourceFingerprint, string rawName, string? time = null) =>
        await SeedTicketLines(database, id, fingerprint, sourceFingerprint, time, (rawName, 100));

    private static async Task SeedTicketLines(TestDatabase database, string id, string fingerprint, string? sourceFingerprint, string? time,
        params (string RawName, long AmountCents)[] lines)
    {
        await database.Execute(
            "INSERT INTO pantry_tickets (id, store, store_name, purchase_date, purchase_time, total_cents, fingerprint, created_at, source_fingerprint) " +
            "VALUES (?, 'lidl', 'Lidl', '2026-10-31', ?, 100, ?, ?, ?)", id, time, fingerprint, Now, sourceFingerprint);
        for (var i = 0; i < lines.Length; i++)
            await database.Execute(
                "INSERT INTO pantry_ticket_lines (id, ticket_id, position, raw_name, name_key, quantity, amount_cents, tax_code) VALUES (?, ?, ?, ?, ?, 1, ?, 'A')",
                $"{id}-{i}", id, i, lines[i].RawName, lines[i].RawName, lines[i].AmountCents);
    }

    [Fact]
    public async Task Reconoce_el_mismo_origen_el_mismo_contenido_con_una_huella_antigua_y_el_posible_duplicado()
    {
        var (database, api) = await Start(new FakeReader(null));
        await using var _db = database;
        await using var _api = api;
        const string Path = "/api/despensa/tickets/leer";
        var first = await api.Data("POST", Path, new { texto = Pan, hoy = "2026-11-01" });
        Assert.Equal(JsonValueKind.Null, first.GetProperty("duplicate").ValueKind);
        Assert.Equal(JsonValueKind.Null, first.GetProperty("possibleDuplicate").ValueKind);

        // El mismo texto (con otros espacios) ya guardado desde otra lectura: el resumen del guardado.
        await SeedTicket(database, "t-1", "huella-1", first.GetProperty("sourceFingerprint").GetString(), "LECHE");
        var same = await api.Data("POST", Path, new { texto = Pan + "\n\n", hoy = "2026-11-01" });
        Assert.Equal(
            $"{{\"id\":\"t-1\",\"store\":\"lidl\",\"storeName\":\"Lidl\",\"address\":\"\",\"date\":\"2026-10-31\",\"time\":null,\"totalCents\":100,\"linesCount\":1,\"productsCount\":0,\"createdAt\":\"{Now}\"}}",
            same.GetProperty("duplicate").GetRawText());
        Assert.Equal(JsonValueKind.Null, same.GetProperty("possibleDuplicate").ValueKind);

        // Otro texto con el mismo contenido que un ticket guardado con una huella antigua: el ticket entero, con sus líneas.
        await database.Execute("DELETE FROM pantry_tickets");
        await SeedTicket(database, "t-2", "huella-antigua", null, "PAN ENSAYO");
        var content = await api.Data("POST", Path, new { texto = Pan.Replace("LIDL\nEUR", "LIDL\nCALLE INVENTADA 1\nEUR"), hoy = "2026-11-01" });
        var duplicate = content.GetProperty("duplicate");
        Assert.Equal("t-2", duplicate.GetProperty("id").GetString());
        var line = Assert.Single(duplicate.GetProperty("lines").EnumerateArray());
        Assert.Equal("{\"id\":\"t-2-0\",\"position\":0,\"rawName\":\"PAN ENSAYO\",\"quantity\":1,\"unitPriceCents\":null,\"amountCents\":100,\"discountCents\":0,\"weightKg\":null,\"pricePerKgCents\":null,\"taxCode\":\"A\",\"itemId\":null,\"occasional\":false,\"reviewStatus\":\"verified\",\"confirmed\":false}",
            line.GetRawText());
        Assert.Equal("[]", duplicate.GetProperty("adjustments").GetRawText());

        // Otra compra en la misma tienda, el mismo día y por lo mismo, sin hora: puede ser el mismo ticket.
        await database.Execute("DELETE FROM pantry_tickets");
        await SeedTicket(database, "t-3", "huella-3", null, "LECHE");
        var possible = await api.Data("POST", Path, new { texto = Pan, hoy = "2026-11-01" });
        Assert.Equal(JsonValueKind.Null, possible.GetProperty("duplicate").ValueKind);
        Assert.Equal("t-3", possible.GetProperty("possibleDuplicate").GetProperty("id").GetString());
        // A otra hora ya no lo es.
        await database.Execute("UPDATE pantry_tickets SET purchase_time = '09:00'");
        var other = await api.Data("POST", Path, new { texto = Pan + "\nHORA: 12:34:00", hoy = "2026-11-01" });
        Assert.Equal(JsonValueKind.Null, other.GetProperty("possibleDuplicate").ValueKind);
    }
}

/// <summary>
/// El worker real del OCR (TIC-02): el mismo tesseract.js que Express, lanzado por NodeTicketReader con node --import tsx desde
/// la raíz del repositorio. Lee los dos tickets inventados de fixtures/tickets/ y comprueba lo mismo que el OCR real de
/// server/modules/tickets/tickets.test.ts. Necesita Node y node_modules; tarda unos segundos por imagen.
/// </summary>
[Trait("Categoria", "Ocr")]
public sealed class OcrWorkerTests
{
    private static string Fixture(string name) => Path.Combine(AppContext.BaseDirectory, "Fixtures", "tickets", name);

    private static string RepositoryRoot()
    {
        for (var directory = AppContext.BaseDirectory; directory is not null; directory = Path.GetDirectoryName(directory))
            if (File.Exists(Path.Combine(directory, "package.json")) && Directory.Exists(Path.Combine(directory, "node_modules"))) return directory;
        throw new InvalidOperationException("No se encuentra la raíz del repositorio (package.json y node_modules).");
    }

    private static NodeTicketReader NewReader(TextWriter? log = null)
    {
        var root = RepositoryRoot();
        return new NodeTicketReader(new OcrWorkerSettings("node", Path.Combine(root, OcrWorkerSettings.DefaultScript), root, TimeSpan.FromMinutes(3)), log);
    }

    [Fact]
    public async Task Lee_la_captura_del_ticket_de_ejemplo_los_importes_suman_el_total()
    {
        await using var reader = NewReader();
        var ticket = TicketParser.ParseTicket(await reader.Read([File.ReadAllBytes(Fixture("ticket-lidl-ejemplo.png"))], null, TestContext.Current.CancellationToken));
        using var truth = JsonDocument.Parse(File.ReadAllText(Fixture("ticket-lidl-ejemplo.json")));
        Assert.Contains(ticket.Check.Status, new[] { "cuadra", "pendiente" });
        Assert.Equal(0, ticket.Check.DifferenceCents);
        foreach (var line in ticket.Lines.Where(line => line.Flags.Count > 0))
        {
            Assert.True(line.WeightKg is null && line.UnitPriceCents is null, line.RawName);
            Assert.True(line.Evidence.Issues.Count > 0, line.RawName);
        }
        Assert.Equal(truth.RootElement.GetProperty("totalCents").GetInt64(), ticket.TotalCents);
        Assert.Equal(truth.RootElement.GetProperty("lines").EnumerateArray().Select(line => (line.GetProperty("rawName").GetString()!, (long?)line.GetProperty("amountCents").GetInt64())),
            ticket.Lines.Select(line => (line.RawName, line.AmountCents)));
        // Cada línea dice de qué imagen sale y dónde está.
        Assert.All(ticket.Lines, line => Assert.Equal(0, line.Evidence.Source?.ImageIndex));
    }

    [Fact]
    public async Task Lee_multiplicaciones_pesos_IVA_y_publicidad_del_ticket_sintetico_sin_aceptar_un_importe_erroneo_en_silencio()
    {
        await using var reader = NewReader();
        var ticket = TicketParser.ParseTicket(await reader.Read([File.ReadAllBytes(Fixture("ticket-torrelavega-sintetico.png"))], null, TestContext.Current.CancellationToken));
        using var truth = JsonDocument.Parse(File.ReadAllText(Fixture("ticket-torrelavega-sintetico.json")));
        Assert.Equal((truth.RootElement.GetProperty("totalCents").GetInt64(), "2026-10-28", "19:24", "Lidl Pay"),
            (ticket.TotalCents!.Value, ticket.Date, ticket.Time, ticket.PaymentMethod));
        Assert.Equal(new[] { "A", "B", "C" }, ticket.TaxGroups.Select(group => group.Code));
        var real = truth.RootElement.GetProperty("lines").EnumerateArray().ToArray();
        Assert.Equal(real.Select(line => line.GetProperty("rawName").GetString()), ticket.Lines.Select(line => line.RawName));
        for (var i = 0; i < real.Length; i++)
        {
            var line = ticket.Lines[i];
            Assert.Equal((real[i].GetProperty("quantity").GetInt64(), LongOrNull(real[i], "unitPriceCents"), DoubleOrNull(real[i], "weightKg")),
                (line.Quantity, line.UnitPriceCents, line.WeightKg));
            if (line.AmountCents != real[i].GetProperty("amountCents").GetInt64()) Assert.True(line.Flags.Count > 0, line.RawName);
        }
        Assert.DoesNotContain(ticket.Lines, line => line.RawName.Contains("CHOCOLATE", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Una_imagen_que_no_puede_leer_falla_y_lo_explica_y_el_proceso_sigue_sirviendo()
    {
        var log = new StringWriter();
        await using var reader = NewReader(TextWriter.Synchronized(log));
        // Una cabecera PNG sin imagen detrás: el worker responde con un error y sigue vivo.
        var png = new byte[64];
        new byte[] { 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, (byte)'I', (byte)'H', (byte)'D', (byte)'R', 0, 0, 0, 10, 0, 0, 0, 10 }.CopyTo(png, 0);
        await Assert.ThrowsAnyAsync<Exception>(() => reader.Read([png], null, TestContext.Current.CancellationToken));
        Assert.Contains("[api] No se ha podido leer el ticket", log.ToString());
        var pages = await reader.Read([File.ReadAllBytes(Fixture("ticket-lidl-ejemplo.png"))], null, TestContext.Current.CancellationToken);
        Assert.NotEmpty(Assert.Single(pages));
    }

    [Fact]
    public async Task Sin_el_worker_explica_la_causa_y_falla()
    {
        var log = new StringWriter();
        await using var reader = new NodeTicketReader(new OcrWorkerSettings("node", Path.Combine(Path.GetTempPath(), "no-existe-ocrWorker.ts"), Path.GetTempPath(),
            TimeSpan.FromSeconds(30)), log);
        await Assert.ThrowsAsync<FileNotFoundException>(() => reader.Read([new byte[24]], null, TestContext.Current.CancellationToken));
        Assert.Contains("No se encuentra el lector de tickets", log.ToString());
    }

    private static long? LongOrNull(JsonElement element, string name) =>
        element.GetProperty(name).ValueKind == JsonValueKind.Null ? null : element.GetProperty(name).GetInt64();

    private static double? DoubleOrNull(JsonElement element, string name) =>
        element.GetProperty(name).ValueKind == JsonValueKind.Null ? null : element.GetProperty(name).GetDouble();
}
