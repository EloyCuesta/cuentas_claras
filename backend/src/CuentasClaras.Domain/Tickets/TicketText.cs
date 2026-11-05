using System.Text;
using System.Text.RegularExpressions;
using CuentasClaras.Domain.Common;

namespace CuentasClaras.Domain.Tickets;

/// <summary>
/// Texto de los tickets (shared/tickets/ticketText.ts): normalizar nombres para emparejarlos,
/// compararlos aunque el OCR se equivoque en alguna letra y ponerlos bonitos al crear un producto.
/// </summary>
public static class TicketText
{
    private static readonly Regex NotKey = JsRegex.Create("[^A-Z0-9]+");
    private static readonly Regex Spaces = JsRegex.Create(@"\s+");
    /// <summary>Tallas que se quedan en mayúsculas: «HUEVOS CAMPEROS L» → «Huevos camperos L».</summary>
    private static readonly Regex SizeWord = JsRegex.Create("^(?:[B-DF-NP-TV-XZ]|X{1,3}[SL])$");

    /// <summary>
    /// nameKey: mayúsculas, sin tildes ni signos («Jamón serrano reser.» → «JAMON SERRANO RESER»). Es la
    /// clave de pantry_aliases y de las huellas: tiene que dar lo mismo que JavaScript carácter a carácter.
    /// </summary>
    public static string NameKey(string text)
    {
        var decomposed = JsText.Normalize(text, NormalizationForm.FormD);
        var withoutMarks = new StringBuilder(decomposed.Length);
        foreach (var unit in decomposed)
            if (unit is < (char)0x0300 or > (char)0x036F) withoutMarks.Append(unit);
        return JsText.Trim(NotKey.Replace(JsCase.ToUpper(withoutMarks.ToString()), " "));
    }

    /// <summary>
    /// similarity: parecido entre dos nombres (0 a 1), el mayor entre la distancia de edición y el
    /// coeficiente de Dice sobre pares de letras. Una letra cambiada por el OCR da más de 0,9.
    /// </summary>
    public static double Similarity(string a, string b)
    {
        var keyA = NameKey(a);
        var keyB = NameKey(b);
        if (keyA == keyB) return 1;
        var compactA = Spaces.Replace(keyA, "");
        var compactB = Spaces.Replace(keyB, "");
        var longest = Math.Max(compactA.Length, compactB.Length);
        var edit = longest == 0 ? 0 : 1 - (double)EditDistance(compactA, compactB) / longest;
        return Math.Max(edit, Dice(keyA, keyB));
    }

    /// <summary>prettyName: «PAN DE MOLDE INTEGRA» → «Pan de molde integra», con las minúsculas y mayúsculas de JavaScript en español.</summary>
    public static string PrettyName(string raw)
    {
        var words = JsText.Trim(Spaces.Replace(raw, " ")).Split(' ');
        var lower = string.Join(' ', words.Select(word => SizeWord.IsMatch(word) ? word : JsCase.ToLower(word)));
        // charAt(0) es la primera unidad UTF-16, no el primer carácter: una letra fuera del plano básico no cambia.
        return lower.Length == 0 ? "" : JsCase.ToUpper(lower[..1]) + lower[1..];
    }

    /// <summary>Palabras de lo que se compra una vez al mes (una primera suposición hasta conocer el ritmo).</summary>
    private static readonly string[] MonthlyWords =
    [
        "ACEITE", "ARROZ", "AZUCAR", "HARINA", "SAL", "CAFE", "INFUSION", "TE ", "CACAO", "PASTA", "MACARRON", "ESPAGUETI", "FIDEO",
        "NOODLES", "LEGUMBRE", "GARBANZO", "LENTEJA", "ALUBIA", "CONSERVA", "ATUN", "SARDINA", "MEJILLON", "ACEITUNA", "PEPINILLO",
        "PIMIENTO", "TOMATE TRITURADO", "TOMATE FRITO", "MELOCOTON EN", "CALDO", "VINAGRE", "ESPECIA", "PIMIENTA", "MAYONESA", "KETCHUP",
        "MOSTAZA", "PAPEL", "SERVILLETA", "DETERGENTE", "SUAVIZANTE", "LEJIA", "LAVAVAJILLAS", "FRIEGASUELOS", "LIMPIA", "BAYETA",
        "ESTROPAJO", "BOLSA BASURA", "GEL", "CHAMPU", "DENTIFRICO", "PASTA DIENTES", "CEPILLO", "DESODORANTE", "COMPRESA", "PANAL",
        "TOALLITA", "ALGODON", "BASTONC", "PILAS", "ALUMINIO", "FILM", "CONGELAD",
    ];

    /// <summary>guessFrequency: «mensual» si alguna palabra del nombre empieza como una de las mensuales.</summary>
    public static string GuessFrequency(string raw)
    {
        var key = $" {NameKey(raw)} ";
        return MonthlyWords.Any(word => key.Contains(" " + word, StringComparison.Ordinal)) ? TicketVocabulary.Monthly : TicketVocabulary.Weekly;
    }

    /// <summary>Distancia de edición (letras cambiadas, añadidas o quitadas), por unidades UTF-16.</summary>
    private static int EditDistance(string a, string b)
    {
        var previous = Enumerable.Range(0, b.Length + 1).ToArray();
        for (var i = 1; i <= a.Length; i++)
        {
            var current = new int[b.Length + 1];
            current[0] = i;
            for (var j = 1; j <= b.Length; j++)
                current[j] = Math.Min(Math.Min(previous[j] + 1, current[j - 1] + 1), previous[j - 1] + (a[i - 1] == b[j - 1] ? 0 : 1));
            previous = current;
        }
        return previous[b.Length];
    }

    private static Dictionary<string, int> Bigrams(string text)
    {
        var compact = Spaces.Replace(text, "");
        var result = new Dictionary<string, int>(StringComparer.Ordinal);
        for (var i = 0; i < compact.Length - 1; i++)
        {
            var pair = compact.Substring(i, 2);
            result[pair] = result.GetValueOrDefault(pair) + 1;
        }
        return result;
    }

    private static double Dice(string keyA, string keyB)
    {
        var pairsA = Bigrams(keyA);
        var pairsB = Bigrams(keyB);
        var sizeA = pairsA.Values.Sum();
        var sizeB = pairsB.Values.Sum();
        if (sizeA == 0 || sizeB == 0) return 0;
        var shared = pairsA.Sum(pair => Math.Min(pair.Value, pairsB.GetValueOrDefault(pair.Key)));
        return (2.0 * shared) / (sizeA + sizeB);
    }
}
