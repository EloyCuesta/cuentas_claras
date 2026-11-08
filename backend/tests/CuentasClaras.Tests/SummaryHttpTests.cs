using System.Text.Json;

namespace CuentasClaras.Tests;

/// <summary>
/// Las consultas de resumen de .NET (FIN-04), por HTTP sobre MySQL real: se restauran los datos de los casos «api-*» del
/// corpus de finanzas (los calculó TypeScript con shared/finance/summaryViews.ts) y la respuesta tiene que ser
/// exactamente su resultado. También el acceso, los parámetros y que consultar no guarda nada.
/// </summary>
[Trait("Categoria", TestDatabase.Category)]
public sealed class SummaryHttpTests
{
    private static readonly JsonDocument Corpus = CorpusJson.Load("rules-finance.json");
    private static readonly FixedClock Clock = new(DateTimeOffset.Parse("2026-10-28T08:00:00.000Z", System.Globalization.CultureInfo.InvariantCulture).ToUnixTimeMilliseconds());

    private static JsonElement Case(string id) =>
        Corpus.RootElement.GetProperty("cases").EnumerateArray().Single(test => test.GetProperty("id").GetString() == id);

    private static async Task<(TestDatabase Database, TestApi Api)> Start()
    {
        var database = await TestDatabase.Create();
        var (opened, _) = await database.Open(Clock);
        return (database, await TestApi.Start(opened, Clock));
    }

    [Theory]
    [InlineData("api-mes-octubre", "/api/summary/month?year=2026&month=10&hoy=2026-10-28")]
    [InlineData("api-mes-diciembre", "/api/summary/month?year=2026&month=12&hoy=2026-10-28")]
    [InlineData("api-ano-2026", "/api/summary/year?year=2026&hoy=2026-10-28")]
    public async Task Responde_lo_mismo_que_calcula_TypeScript_con_los_datos_guardados(string caso, string path)
    {
        var (database, api) = await Start();
        await using var _ = database;
        await using var __ = api;
        var test = Case(caso);
        await api.Data("PUT", "/api/data", test.GetProperty("input").GetProperty("data").GetRawText());
        var before = (await api.Data("GET", "/api/data")).GetRawText();
        var view = await api.Data("GET", path);
        var difference = CorpusJson.Difference(test.GetProperty("expected"), System.Text.Json.Nodes.JsonNode.Parse(view.GetRawText()));
        Assert.True(difference is null, $"{caso}: {difference}");
        // Consultar (también lo proyectado) no guarda nada.
        Assert.Equal(before, (await api.Data("GET", "/api/data")).GetRawText());
    }

    [Fact]
    public async Task Exige_sesion_y_valida_los_parametros_en_orden()
    {
        var (database, api) = await Start();
        await using var _ = database;
        await using var __ = api;
        const string unauthorized = "Hace falta el código de acceso para ver esta sección.";
        await api.Fails("GET", "/api/summary/month?year=2026&month=10&hoy=2026-10-28", null, 401, "UNAUTHORIZED", unauthorized, guest: true);
        await api.Fails("GET", "/api/summary/year?year=2026&hoy=2026-10-28", null, 401, "UNAUTHORIZED", unauthorized, guest: true);
        // Sin sesión, ni siquiera se miran los parámetros.
        await api.Fails("GET", "/api/summary/month", null, 401, "UNAUTHORIZED", unauthorized, guest: true);

        const string year = "El parámetro «year» debe ser un año entre 1900 y 2999.";
        const string month = "El parámetro «month» debe ser un mes entre 1 y 12.";
        const string today = "El parámetro «hoy» debe ser una fecha AAAA-MM-DD.";
        foreach (var query in new[] { "", "year=&", "year=26&", "year=1899&", "year=3000&", "year=2026&year=2027&", "year=%EF%BC%92%EF%BC%90%EF%BC%92%EF%BC%96&", "year=2026.0&" })
            await api.Fails("GET", $"/api/summary/month?{query}month=10&hoy=2026-10-28", null, 400, "VALIDATION", year);
        foreach (var query in new[] { "month=0", "month=13", "month=", "month=1.5", "month=10&month=11" })
            await api.Fails("GET", $"/api/summary/month?year=2026&{query}&hoy=2026-10-28", null, 400, "VALIDATION", month);
        foreach (var query in new[] { "", "&hoy=2026-02-30", "&hoy=28/10/2026", "&hoy=2026-10-28&hoy=2026-10-29" })
            await api.Fails("GET", $"/api/summary/month?year=2026&month=10{query}", null, 400, "VALIDATION", today);
        await api.Fails("GET", "/api/summary/year?hoy=2026-10-28", null, 400, "VALIDATION", year);
        await api.Fails("GET", "/api/summary/year?year=2026", null, 400, "VALIDATION", today);
        // Un mes de una cifra vale, como en la web.
        var view = await api.Data("GET", "/api/summary/month?year=2026&month=3&hoy=2026-10-28");
        Assert.Equal("{\"kind\":\"mensual\",\"year\":2026,\"month\":3}", view.GetProperty("period").GetRawText());
        Assert.Equal("{\"kind\":\"anual\",\"year\":2026}", (await api.Data("GET", "/api/summary/year?year=2026&hoy=2026-10-28")).GetProperty("period").GetRawText());
    }
}
