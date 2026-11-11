using System.Globalization;
using System.Text.Json;

namespace CuentasClaras.Tests;

/// <summary>
/// PAN-01 y siguientes: C# da exactamente lo que fija el corpus de TypeScript (fixtures/migration/rules-pantry.json),
/// con la cultura es-ES y con la invariante. El corpus manda: si no coincide, se corrige C#. Lo regenera a mano
/// tests/generatePantryRules.ts; estas pruebas nunca lo cambian.
/// </summary>
public sealed class PantryRulesCorpusTests
{
    private static readonly JsonDocument Corpus = CorpusJson.Load("rules-pantry.json");
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
        Assert.Equal("cuentas-claras-pantry-rules-v1", root.GetProperty("format").GetString());
        Assert.Contains("Sin datos de la instalación", root.GetProperty("provenance").GetString());
        var cases = root.GetProperty("cases").EnumerateArray().ToArray();
        Assert.Equal(186, cases.Length);
        Assert.Equal(cases.Length, cases.Select(test => test.GetProperty("id").GetString()).Distinct().Count());
        var operations = root.GetProperty("operations").EnumerateArray().Select(op => op.GetString()!).ToArray();
        Assert.Equal(operations, cases.Select(test => test.GetProperty("operation").GetString()!).Distinct().Order(StringComparer.Ordinal));
        Assert.Equal(operations.Order(StringComparer.Ordinal), PantryRulesCorpus.Ported.Order(StringComparer.Ordinal));
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
            var actual = PantryRulesCorpus.Run(test.GetProperty("operation").GetString()!, test.GetProperty("input"));
            var difference = CorpusJson.Difference(test.GetProperty("expected"), actual);
            Assert.True(difference is null, $"{caso} ({test.GetProperty("description").GetString()}): {difference}");
        }
        finally
        {
            (CultureInfo.CurrentCulture, CultureInfo.CurrentUICulture) = previous;
        }
    }
}

/// <summary>
/// Domain.Tickets no puede usar Domain.Pantry (ArchitectureTests), así que repite en TicketVocabulary lo poco que necesita
/// de la despensa. Desde PAN-01 existe Domain.Pantry: los dos tienen que decir lo mismo.
/// </summary>
public sealed class TicketVocabularyTests
{
    [Fact]
    public void El_vocabulario_de_los_tickets_coincide_con_las_reglas_de_la_despensa()
    {
        Assert.Equal(CuentasClaras.Domain.Pantry.PantryRules.Frequencies, CuentasClaras.Domain.Tickets.TicketVocabulary.Frequencies);
        Assert.Equal(CuentasClaras.Domain.Pantry.PantryRules.MaxPantryCents, CuentasClaras.Domain.Tickets.TicketVocabulary.MaxPantryCents);
        Assert.Equal(CuentasClaras.Domain.Pantry.PantryRules.PantryNameMax, CuentasClaras.Domain.Tickets.TicketVocabulary.PantryNameMax);
        foreach (var unit in new[] { CuentasClaras.Domain.Tickets.TicketVocabulary.Kilos, CuentasClaras.Domain.Tickets.TicketVocabulary.Grams,
            CuentasClaras.Domain.Tickets.TicketVocabulary.Units })
            Assert.True(CuentasClaras.Domain.Pantry.PantryRules.IsUnit(unit), unit);
    }
}
