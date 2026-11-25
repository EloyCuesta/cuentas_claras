using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using CuentasClaras.Api.Composition;
using CuentasClaras.Application.Common;

namespace CuentasClaras.Tests;

/// <summary>
/// Los contratos HTTP de BASE-01 (fixtures/migration/http-*.json) sobre Kestrel y MySQL reales, como
/// server/migrationContracts.test.ts sobre Express: una base cuentas_test_* nueva por escenario, el reloj, la fecha y los
/// ids del escenario, y respuestas completas comparadas sin regenerar expectativas. http-testing.json no está: .NET no
/// tiene la ruta de reinicio de pruebas (HttpTests comprueba que no existe).
/// Desde TIC-04 .NET tiene todas las rutas y se reproducen todos los escenarios: la lista de activos y MissingRoutes, que
/// servían mientras faltaban rutas, se quitaron en CUT-PREP.
/// </summary>
[Trait("Categoria", TestDatabase.Category)]
public sealed class HttpContractTests
{
    private static readonly string[] Modules = ["health", "finance", "pantry", "tickets"];

    private static readonly Dictionary<string, JsonDocument> Fixtures =
        Modules.ToDictionary(module => module, module => CorpusJson.Load($"http-{module}.json"));

    public static TheoryData<string, string> Scenarios()
    {
        var data = new TheoryData<string, string>();
        foreach (var module in Modules)
            foreach (var scenario in Fixtures[module].RootElement.GetProperty("scenarios").EnumerateArray())
                data.Add(module, scenario.GetProperty("name").GetString()!);
        return data;
    }

    [Fact]
    public void Los_corpus_son_los_de_BASE_01_con_datos_inventados()
    {
        var names = new List<string>();
        foreach (var fixture in Fixtures.Values)
        {
            Assert.Equal("cuentas-claras-http-v1", fixture.RootElement.GetProperty("format").GetString());
            Assert.Contains("inventados", fixture.RootElement.GetProperty("provenance").GetString());
            names.AddRange(fixture.RootElement.GetProperty("scenarios").EnumerateArray().Select(scenario => scenario.GetProperty("name").GetString()!));
        }
        // Salud 1, finanzas 3, despensa 1 y tickets 1 (el acceso lo ejecuta HttpTests), con nombres únicos.
        Assert.Equal(6, names.Count);
        Assert.Equal(names.Count, names.Distinct(StringComparer.Ordinal).Count());
    }

    /// <summary>Las dos consultas de resumen solo existen en .NET (FIN-04): las prueba SummaryHttpTests, no los contratos de Express.</summary>
    private static readonly (string Method, string Pattern)[] DotnetOnly = [("GET", "/api/summary/month"), ("GET", "/api/summary/year")];

    [Fact]
    public void Atiende_exactamente_los_39_pares_de_Express_y_cada_uno_tiene_un_paso_2xx_en_los_contratos()
    {
        var routes = ApiHost.ModuleRoutes();
        var all = ApiHost.HostRoutes.Concat(routes.Registered.Select(route => (route.Method, route.Pattern)))
            .Except(DotnetOnly).Select(route => $"{route.Method} {route.Pattern}").ToHashSet(StringComparer.Ordinal);
        Assert.Equal(39, all.Count);

        // Cada paso de los contratos (también los del acceso) va a una ruta conocida; las que responden 2xx, apuntadas.
        var withSuccess = new HashSet<string>(StringComparer.Ordinal);
        using var auth = CorpusJson.Load("http-auth.json");
        foreach (var fixture in Fixtures.Values.Append(auth))
            foreach (var scenario in fixture.RootElement.GetProperty("scenarios").EnumerateArray())
                foreach (var step in scenario.GetProperty("steps").EnumerateArray())
                {
                    var request = step.GetProperty("request");
                    var method = request.GetProperty("method").GetString()!;
                    var path = request.GetProperty("path").GetString()!.Split('?', 2)[0].TrimEnd('/');
                    var pattern = ApiHost.HostRoutes.FirstOrDefault(route => route.Method == method && route.Pattern.Equals(path, StringComparison.OrdinalIgnoreCase)).Pattern
                        ?? routes.Find(method, path)?.Pattern;
                    var status = step.GetProperty("expected").GetProperty("status").GetInt32();
                    if (pattern is not null && status is >= 200 and < 300) withSuccess.Add($"{method} {pattern}");
                }
        Assert.Equal(all.Order(StringComparer.Ordinal), withSuccess.Order(StringComparer.Ordinal));
    }

    [Theory]
    [MemberData(nameof(Scenarios))]
    public async Task Reproduce_el_escenario_sin_regenerar_expectativas(string modulo, string escenario)
    {
        var scenario = Fixtures[modulo].RootElement.GetProperty("scenarios").EnumerateArray()
            .Single(item => item.GetProperty("name").GetString() == escenario);
        await Run(scenario);
    }

    private static async Task Run(JsonElement scenario)
    {
        var setup = scenario.GetProperty("setup");
        Assert.False(setup.GetProperty("testMode").GetBoolean(), "El modo de pruebas de Express no existe en .NET.");
        var clock = new ContractClock(DateTimeOffset.Parse(setup.GetProperty("now").GetString()!, CultureInfo.InvariantCulture).ToUnixTimeMilliseconds(),
            setup.GetProperty("today").GetString()!);
        var ids = new QueuedIds([.. setup.GetProperty("ids").EnumerateArray().Select(id => id.GetString()!)]);

        await using var database = await TestDatabase.Create();
        var (opened, _) = await database.Open(clock);
        await using var api = await TestApi.Start(opened, clock, ids, login: setup.GetProperty("login").GetBoolean(),
            code: setup.GetProperty("accessCode").GetString()!);
        var name = scenario.GetProperty("name").GetString();
        foreach (var step in scenario.GetProperty("steps").EnumerateArray())
        {
            if (step.TryGetProperty("advanceMs", out var advance)) clock.Now += advance.GetInt64();
            var request = step.GetProperty("request");
            var guest = request.TryGetProperty("guest", out var isGuest) && isGuest.GetBoolean();
            using var response = await api.Send(request.GetProperty("method").GetString()!, request.GetProperty("path").GetString()!,
                request.TryGetProperty("body", out var body) ? body.GetRawText() : null, guest);
            var expected = step.GetProperty("expected");
            var label = $"{name}: {step.GetProperty("name").GetString()}";
            var text = await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken);
            Assert.True(expected.GetProperty("status").GetInt32() == (int)response.StatusCode, $"{label}: {(int)response.StatusCode} {text}");
            using var actual = JsonDocument.Parse(text);
            Assert.True(JsonElement.DeepEquals(expected.GetProperty("body"), actual.RootElement), $"{label}: {actual.RootElement}");
            foreach (var header in expected.GetProperty("headers").EnumerateObject())
            {
                var value = TestApi.Header(response, header.Name);
                if (header.Name == "set-cookie" && value is not null && !value.StartsWith("cc_sesion=;", StringComparison.Ordinal))
                {
                    Assert.Matches("^cc_sesion=[0-9a-f]{64};", value);
                    value = Regex.Replace(value, "^cc_sesion=[0-9a-f]{64};", "cc_sesion=<token>;");
                }
                Assert.True((header.Value.ValueKind == JsonValueKind.Null ? null : header.Value.GetString()) == value, $"{label}: {header.Name} = {value}");
            }
            if (TestApi.Header(response, "set-cookie") is { } cookie)
                api.Cookie = cookie.StartsWith("cc_sesion=;", StringComparison.Ordinal) ? null : cookie.Split(';')[0];
        }
        Assert.True(ids.Remaining == 0, $"{name}: sobran {ids.Remaining} ids de preparación.");
    }

    /// <summary>El reloj del escenario: el instante de «now» más lo adelantado, y la fecha de «today».</summary>
    private sealed class ContractClock(long now, string today) : IClock
    {
        public long Now { get; set; } = now;
        public long NowMs() => Now;
        public string Today() => today;
    }
}
