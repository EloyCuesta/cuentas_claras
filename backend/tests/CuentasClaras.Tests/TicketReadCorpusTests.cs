using System.Globalization;
using System.Text.Json;

namespace CuentasClaras.Tests;

/// <summary>TIC-02: C# lee el cuerpo de la lectura igual que Express (el corpus manda), en es-ES y en la invariante.</summary>
public sealed class TicketReadCorpusTests
{
    private static readonly JsonDocument Corpus = CorpusJson.Load("rules-ticket-read.json");
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
        Assert.Equal("cuentas-claras-ticket-read-rules-v1", root.GetProperty("format").GetString());
        Assert.Contains("Sin datos de la instalación", root.GetProperty("provenance").GetString());
        var cases = root.GetProperty("cases").EnumerateArray().ToArray();
        Assert.Equal(90, cases.Length);
        Assert.Equal(cases.Length, cases.Select(test => test.GetProperty("id").GetString()).Distinct().Count());
        var operations = root.GetProperty("operations").EnumerateArray().Select(op => op.GetString()!).ToArray();
        Assert.Equal(operations, cases.Select(test => test.GetProperty("operation").GetString()!).Distinct().Order(StringComparer.Ordinal));
        Assert.Equal(operations.Order(StringComparer.Ordinal), TicketReadCorpus.Ported.Order(StringComparer.Ordinal));
    }

    [Theory]
    [MemberData(nameof(Cases))]
    public void CSharp_da_lo_mismo_que_Express(string cultura, string caso)
    {
        var test = Corpus.RootElement.GetProperty("cases").EnumerateArray().Single(item => item.GetProperty("id").GetString() == caso);
        var previous = (CultureInfo.CurrentCulture, CultureInfo.CurrentUICulture);
        CultureInfo.CurrentCulture = CultureInfo.CurrentUICulture = CultureInfo.GetCultureInfo(cultura);
        try
        {
            var actual = TicketReadCorpus.Run(test.GetProperty("operation").GetString()!, test.GetProperty("input"));
            var difference = CorpusJson.Difference(test.GetProperty("expected"), actual);
            Assert.True(difference is null, $"{caso} ({test.GetProperty("description").GetString()}): {difference}");
        }
        finally
        {
            (CultureInfo.CurrentCulture, CultureInfo.CurrentUICulture) = previous;
        }
    }
}
