using System.Globalization;
using System.Text.Json;

namespace CuentasClaras.Tests;

/// <summary>
/// TIC-01: C# da exactamente lo que fija el corpus de TypeScript (fixtures/migration/rules-tickets.json),
/// con la cultura es-ES y con la invariante. El corpus manda: si no coincide, se corrige C#.
/// Lo regenera a mano tests/generateTicketRules.ts; estas pruebas nunca lo cambian.
/// </summary>
public sealed class TicketRulesCorpusTests
{
    private static readonly JsonDocument Corpus = CorpusJson.Load("rules-tickets.json");
    private static readonly JsonDocument BaseRules = CorpusJson.Load("rules.json");
    private static readonly string[] Cultures = ["es-ES", ""];

    /// <summary>Lo que aún no está portado (vacío cuando TIC-01 está terminada).</summary>
    private static readonly string[] Pending = [
        "validateTicketSave", "validateLineUpdate",
        "priceFromLines", "quantityFromLines", "newItemUnit", "lineReviewStatus",
        "aliasStoreOf", "fingerprintSource", "pastedTextSource", "imagesSource", "purchasesFromLines",
    ];

    /// <summary>Las operaciones de tickets que ya tenía el corpus de reglas de BASE-01 (rules.json).</summary>
    private static readonly string[] BaseTicketOperations = ["roundRatio", "calculatedAmount", "canApplyLine"];

    public static TheoryData<string, string> Cases()
    {
        var data = new TheoryData<string, string>();
        foreach (var culture in Cultures)
            foreach (var test in Corpus.RootElement.GetProperty("cases").EnumerateArray())
                if (!Pending.Contains(test.GetProperty("operation").GetString()))
                    data.Add(culture, test.GetProperty("id").GetString()!);
        return data;
    }

    public static TheoryData<string, string> BaseCases()
    {
        var data = new TheoryData<string, string>();
        foreach (var culture in Cultures)
            foreach (var test in BaseRules.RootElement.GetProperty("cases").EnumerateArray())
                if (BaseTicketOperations.Contains(test.GetProperty("operation").GetString()))
                    data.Add(culture, test.GetProperty("id").GetString()!);
        return data;
    }

    [Fact]
    public void El_corpus_esta_completo_y_cada_operacion_tiene_su_regla_en_CSharp()
    {
        var root = Corpus.RootElement;
        Assert.Equal("cuentas-claras-ticket-rules-v1", root.GetProperty("format").GetString());
        Assert.Contains("Sin datos de la instalación", root.GetProperty("provenance").GetString());
        var cases = root.GetProperty("cases").EnumerateArray().ToArray();
        Assert.Equal(510, cases.Length);
        Assert.Equal(cases.Length, cases.Select(test => test.GetProperty("id").GetString()).Distinct().Count());
        var operations = root.GetProperty("operations").EnumerateArray().Select(op => op.GetString()!).ToArray();
        Assert.Equal(operations, cases.Select(test => test.GetProperty("operation").GetString()!).Distinct().Order(StringComparer.Ordinal));
        // Cada operación del corpus está portada o pendiente, nunca las dos ni ninguna.
        Assert.Equal(operations.Order(StringComparer.Ordinal), TicketRulesCorpus.Ported.Concat(Pending).Order(StringComparer.Ordinal));
        // Las reglas de tickets de rules.json siguen siendo diez y todas tienen su regla en C#.
        var baseCases = BaseRules.RootElement.GetProperty("cases").EnumerateArray()
            .Where(test => BaseTicketOperations.Contains(test.GetProperty("operation").GetString())).ToArray();
        Assert.Equal(10, baseCases.Length);
        Assert.Equal(BaseTicketOperations.Order(StringComparer.Ordinal), TicketRulesCorpus.BasePorted.Order(StringComparer.Ordinal));
    }

    [Fact]
    public void El_corpus_contiene_las_tres_huellas_golden_de_los_tickets_guardados()
    {
        var golden = new Dictionary<string, string>
        {
            ["huella-golden-texto"] = "a8737b2f4204b7b1b9c9b81440ae55228438a252a379693401a3cdfdc19a71e4",
            ["huella-golden-imagenes"] = "74707bc9bd62595e3ac455802d512b5aa806bf0bc49a863157e635ad2b397a5e",
            ["huella-golden-ticket"] = "4ee26779153a9a0ba92b3af35f8f543155cfe656884bd3d4d5693140d5baeb30",
        };
        foreach (var (id, sha256) in golden)
            Assert.Equal(sha256, Find(Corpus, id).GetProperty("expected").GetProperty("sha256").GetString());
    }

    [Theory]
    [MemberData(nameof(Cases))]
    public void CSharp_da_lo_mismo_que_TypeScript(string cultura, string caso) => Check(Find(Corpus, caso), cultura);

    [Theory]
    [MemberData(nameof(BaseCases))]
    public void CSharp_da_lo_mismo_que_las_reglas_de_tickets_de_BASE_01(string cultura, string caso) =>
        Check(Find(BaseRules, caso), cultura, TicketRulesCorpus.RunBase);

    private static void Check(JsonElement test, string culture) => Check(test, culture, TicketRulesCorpus.Run);

    private static void Check(JsonElement test, string culture, Func<string, JsonElement, System.Text.Json.Nodes.JsonNode?> run)
    {
        var previous = (CultureInfo.CurrentCulture, CultureInfo.CurrentUICulture);
        CultureInfo.CurrentCulture = CultureInfo.CurrentUICulture = CultureInfo.GetCultureInfo(culture);
        try
        {
            var actual = run(test.GetProperty("operation").GetString()!, test.GetProperty("input"));
            var difference = CorpusJson.Difference(test.GetProperty("expected"), actual);
            Assert.True(difference is null, $"{test.GetProperty("id").GetString()} ({test.GetProperty("description").GetString()}): {difference}");
        }
        finally
        {
            (CultureInfo.CurrentCulture, CultureInfo.CurrentUICulture) = previous;
        }
    }

    private static JsonElement Find(JsonDocument corpus, string id) =>
        corpus.RootElement.GetProperty("cases").EnumerateArray().Single(test => test.GetProperty("id").GetString() == id);
}
