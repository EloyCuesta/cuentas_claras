using System.Globalization;
using System.Text.Json;

namespace CuentasClaras.Tests;

/// <summary>
/// FIN-01 y siguientes: C# da exactamente lo que fija el corpus de TypeScript (fixtures/migration/rules-finance.json),
/// con la cultura es-ES y con la invariante. El corpus manda: si no coincide, se corrige C#. Lo regenera a mano
/// tests/generateFinanceRules.ts; estas pruebas nunca lo cambian.
/// </summary>
public sealed class FinanceRulesCorpusTests
{
    private static readonly JsonDocument Corpus = CorpusJson.Load("rules-finance.json");
    private static readonly string[] Cultures = ["es-ES", ""];

    public static TheoryData<string, string> Cases()
    {
        var data = new TheoryData<string, string>();
        foreach (var culture in Cultures)
            foreach (var test in Corpus.RootElement.GetProperty("cases").EnumerateArray())
                data.Add(culture, test.GetProperty("id").GetString()!);
        return data;
    }

    [Fact]
    public void El_corpus_esta_completo_y_cada_operacion_tiene_su_regla_en_CSharp()
    {
        var root = Corpus.RootElement;
        Assert.Equal("cuentas-claras-finance-rules-v1", root.GetProperty("format").GetString());
        Assert.Contains("Sin datos de la instalación", root.GetProperty("provenance").GetString());
        var cases = root.GetProperty("cases").EnumerateArray().ToArray();
        Assert.Equal(197, cases.Length);
        Assert.Equal(cases.Length, cases.Select(test => test.GetProperty("id").GetString()).Distinct().Count());
        var operations = root.GetProperty("operations").EnumerateArray().Select(op => op.GetString()!).ToArray();
        Assert.Equal(operations, cases.Select(test => test.GetProperty("operation").GetString()!).Distinct().Order(StringComparer.Ordinal));
        Assert.Equal(operations.Order(StringComparer.Ordinal), FinanceRulesCorpus.Ported.Order(StringComparer.Ordinal));
    }

    [Theory]
    [MemberData(nameof(Cases))]
    public void CSharp_da_lo_mismo_que_TypeScript(string cultura, string caso)
    {
        var test = Corpus.RootElement.GetProperty("cases").EnumerateArray().Single(item => item.GetProperty("id").GetString() == caso);
        var previous = (CultureInfo.CurrentCulture, CultureInfo.CurrentUICulture);
        CultureInfo.CurrentCulture = CultureInfo.CurrentUICulture = CultureInfo.GetCultureInfo(cultura);
        try
        {
            var actual = FinanceRulesCorpus.Run(test.GetProperty("operation").GetString()!, test.GetProperty("input"));
            var difference = CorpusJson.Difference(test.GetProperty("expected"), actual);
            Assert.True(difference is null, $"{caso} ({test.GetProperty("description").GetString()}): {difference}");
        }
        finally
        {
            (CultureInfo.CurrentCulture, CultureInfo.CurrentUICulture) = previous;
        }
    }
}
