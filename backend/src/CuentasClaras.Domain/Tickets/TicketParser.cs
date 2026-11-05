using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using CuentasClaras.Domain.Common;

namespace CuentasClaras.Domain.Tickets;

/// <summary>
/// Analizador de tickets (shared/tickets/ticketParse.ts): de las líneas del OCR, o del texto pegado,
/// a tienda, fecha, total y productos. Pensado para Lidl, con un modo genérico para otras tiendas.
/// El importe de cada producto se elige entre los leídos y los que se pueden calcular, y lo que no
/// se puede asegurar se marca para revisar. El total nunca decide un importe.
///
/// Se porta función a función y en el mismo orden que el TypeScript. Las expresiones regulares sin
/// la bandera u se copian tal cual y las traduce <see cref="JsRegex"/>; las que usan \p{L} con la
/// bandera u se programan por puntos de código (<see cref="ReplaceLookalikes"/>, letterCount, la dirección).
/// </summary>
public static class TicketParser
{
    // -------------------------------------------------------------------------------------------
    // Lectura de importes

    private sealed class Candidate(long cents, double score, bool read)
    {
        public long Cents { get; } = cents;
        public double Score { get; set; } = score;
        /// <summary>Leído tal cual del ticket (no calculado con la cantidad o el peso).</summary>
        public bool Read { get; set; } = read;
    }

    /// <summary>TAX_MAP: la letra del IVA y lo que el OCR lee en su lugar.</summary>
    private static string? TaxOf(string? character) => character switch
    {
        "A" or "4" => "A",
        "B" or "8" or "6" or "5" or "3" or "E" => "B",
        "C" or "c" or "€" or "¢" or "(" => "C",
        _ => null,
    };

    private static string? FirstUnit(string text) => text.Length == 0 ? null : text[..1];

    // Detrás del importe puede venir pegada la letra del IVA, una cifra mal leída o ambas («1,758»,
    // «1,155A», «1,15-»). Con dos cifras pegadas («1,2398») ya no se interpreta.
    private static readonly Regex AmountToken = JsRegex.Create(@"^(-?)(\d{1,4})[,.:;](\d{2})(\d?[A-Za-z€¢(]?|-[€¢]?)$");
    private static readonly Regex CleanGlue = JsRegex.Create(@"^[A-Za-z€¢(]$");
    // La relectura a veces duplica la x («3,95Xx»).
    private static readonly Regex UnitToken = JsRegex.Create(@"^(\d{1,4})[,.:;](\d{2})[xX×%*]{1,2}$");
    private static readonly Regex QtyToken = JsRegex.Create(@"^\d{1,3}$");
    private static readonly Regex LooseAmountToken = JsRegex.Create(@"^(\d{3,4})\D?$");
    private static readonly Regex NotDigit = JsRegex.Create(@"\D");
    private static readonly Regex DigitOrHyphen = JsRegex.Create(@"[\d-]");
    private static readonly Regex OneDigit = JsRegex.Create(@"^\d$");
    private static readonly Regex AnyDigit = JsRegex.Create(@"\d");
    private static readonly Regex DigitThenSeparator = JsRegex.Create(@"\d[,.]");
    private static readonly Regex TrailingSigns = JsRegex.Create("""^[,.;:'`"´·]+$""");
    private static readonly Regex Multiplier = JsRegex.Create(@"^[xX×*]{1,2}$");

    private static long ToCents(string integer, string decimals) => (long)(JsNumber.Parse(integer) * 100 + JsNumber.Parse(decimals));

    private sealed record AmountTokenValue(long Cents, bool Clean, string Glued, string RawDigits);

    private static AmountTokenValue? ReadAmountToken(string token)
    {
        var match = AmountToken.Match(token);
        if (!match.Success) return null;
        var value = ToCents(match.Groups[2].Value, match.Groups[3].Value);
        var glued = match.Groups[4].Value;
        return new AmountTokenValue(match.Groups[1].Value.Length > 0 ? -value : value, glued.Length == 0 || CleanGlue.IsMatch(glued), glued,
            $"{match.Groups[2].Value}{match.Groups[3].Value}{NotDigit.Replace(glued, "")}");
    }

    private static bool IsTaxToken(string token) => token.Length <= 2 && !DigitThenSeparator.IsMatch(token) && TaxOf(FirstUnit(token)) is not null;

    private sealed record TailReading(
        IReadOnlyList<string> NameTokens, AmountTokenValue? Amount, long? LooseAmountCents, long? UnitCents, long? Quantity, string? Tax, string? TaxRaw);

    /// <summary>readTail: el final de una línea, «… 3,95x 2 7,90 B».</summary>
    private static TailReading ReadTail(IReadOnlyList<string> allTokens)
    {
        // Signos sueltos al final («7,90 ,»): restos del OCR, no forman parte de la línea.
        var end = allTokens.Count;
        while (end > 1 && TrailingSigns.IsMatch(allTokens[end - 1])) end--;
        var tokens = allTokens.Take(end).ToArray();
        var i = tokens.Length - 1;
        string? tax = null;
        string? taxRaw = null;
        if (i > 0 && IsTaxToken(tokens[i]) && (ReadAmountToken(tokens[i - 1]) is not null || LooseAmountToken.IsMatch(tokens[i - 1])))
        {
            tax = TaxOf(FirstUnit(tokens[i]));
            taxRaw = FirstUnit(tokens[i]);
            i--;
        }
        AmountTokenValue? amount = null;
        long? looseAmountCents = null;
        var token = i >= 0 ? tokens[i] : null;
        if (token is not null && (amount = ReadAmountToken(token)) is not null)
        {
            // «1,155A»: la letra pegada manda sobre la cifra mal leída.
            if (tax is null && amount.Glued.Length > 0)
            {
                var letter = FirstUnit(DigitOrHyphen.Replace(amount.Glued, ""));
                var glued0 = FirstUnit(amount.Glued);
                tax = TaxOf(letter ?? glued0) ?? TaxOf(glued0);
                if (tax is not null) taxRaw = TaxOf(letter ?? "") is not null ? letter : glued0;
                // «1,798» sin letra de IVA aparte: el 8 es la B leída como cifra, no una cifra de más.
                if (OneDigit.IsMatch(amount.Glued) && tax is not null) amount = amount with { Clean = true, Glued = "", RawDigits = JsText.Slice(amount.RawDigits, 0, -1) };
            }
            i--;
        }
        else if (token is not null && LooseAmountToken.IsMatch(token) && i > 0)
        {
            looseAmountCents = (long)JsNumber.Parse(LooseAmountToken.Match(token).Groups[1].Value);
            i--;
        }

        long? unitCents = null;
        long? quantity = null;
        if (amount is null && looseAmountCents is null)
        {
            // Importe ilegible («4,95X 2 9,?0 A»): el precio y la cantidad se leen igual, para no meterlos
            // en el nombre y para poder proponer el calculado. La letra del IVA, si está, también.
            var j = i;
            if (j >= 3 && IsTaxToken(tokens[j]) && AnyDigit.IsMatch(tokens[j - 1])) j--;
            var unit = j >= 2 && HasNoLetter(tokens[j]) && !QtyToken.IsMatch(tokens[j]) ? UnitToken.Match(tokens[j - 2]) : null;
            if (unit is { Success: true } && QtyToken.IsMatch(tokens[j - 1]))
            {
                if (j != i)
                {
                    tax = TaxOf(FirstUnit(tokens[i]));
                    taxRaw = FirstUnit(tokens[i]);
                }
                unitCents = ToCents(unit.Groups[1].Value, unit.Groups[2].Value);
                quantity = (long)JsNumber.Parse(tokens[j - 1]);
                i = j - 3;
            }
        }
        if (amount is not null || looseAmountCents is not null)
        {
            var unit = i >= 1 ? UnitToken.Match(tokens[i - 1]) : null;
            AmountTokenValue? beforeX;
            if (unit is { Success: true } && QtyToken.IsMatch(tokens[i]))
            {
                unitCents = ToCents(unit.Groups[1].Value, unit.Groups[2].Value);
                quantity = (long)JsNumber.Parse(tokens[i]);
                i -= 2;
            }
            else if (i >= 2 && QtyToken.IsMatch(tokens[i]) && Multiplier.IsMatch(tokens[i - 1]) && (beforeX = ReadAmountToken(tokens[i - 2])) is { Clean: true })
            {
                unitCents = beforeX.Cents;
                quantity = (long)JsNumber.Parse(tokens[i]);
                i -= 3;
            }
            else if (i >= 1 && QtyToken.IsMatch(tokens[i]) && amount is not null)
            {
                // «3,95 2 7,90»: sin la x, solo si la multiplicación cuadra.
                var plain = ReadAmountToken(tokens[i - 1]);
                if (plain is { Clean: true } && plain.Cents * JsNumber.Parse(tokens[i]) == amount.Cents)
                {
                    unitCents = plain.Cents;
                    quantity = (long)JsNumber.Parse(tokens[i]);
                    i -= 2;
                }
            }
        }
        return new TailReading([.. tokens.Take(Math.Max(0, i + 1))], amount, looseAmountCents, unitCents, quantity, tax, taxRaw);
    }

    /// <summary>/^[^\p{L}]+$/u: no vacío y sin letras (por puntos de código).</summary>
    private static bool HasNoLetter(string token) => token.Length > 0 && !JsText.CodePoints(token).Any(JsText.IsLetter);

    // -------------------------------------------------------------------------------------------
    // Limpieza de líneas

    /// <summary>Letras que el OCR pone en lugar de cifras. Solo se cambian dentro de algo con forma de importe.</summary>
    private static char DigitLookalike(char letter) => letter switch
    {
        'O' or 'o' => '0',
        'I' or 'l' => '1',
        'S' => '5',
        'B' => '8',
        'Z' => '2',
        _ => letter,
    };

    private static bool IsLookalikeInteger(char unit) => unit is >= '0' and <= '9' or 'O' or 'o' or 'I' or 'l' or 'S' or 'Z' or 'B';
    private static bool IsLookalikeLastDigit(char unit) => unit is >= '0' and <= '9' or 'O' or 'o' or 'I' or 'S' or 'Z';
    private static bool IsLetterOrAsciiDigit(int codePoint) => JsText.IsLetter(codePoint) || JsText.IsAsciiDigit(codePoint);

    /// <summary>
    /// replaceLookalikes: un importe con letras parecidas a cifras («5,O8», «I,29», «3,79B») pasa a cifras.
    /// Es LOOKALIKE_AMOUNT de TypeScript, /(?&lt;![\p{L}\d])([0-9OoIlSZB]{1,4})([,.:;])([0-9OoIlSZB])([0-9OoISZ])(?=[xX×*]|[ABC]?(?![\p{L}\d]))/gu,
    /// programada a mano porque las búsquedas hacia atrás y hacia delante miran puntos de código: una
    /// letra fuera del plano básico («𝐀») también es una letra. La segunda cifra decimal nunca es una B
    /// («3,7B» es el IVA) ni una «l» («1,5l» es litro y medio), y hace falta al menos una cifra de verdad.
    /// </summary>
    private static (string Text, bool Replaced) ReplaceLookalikes(string text)
    {
        var result = new StringBuilder(text.Length);
        var replaced = false;
        var position = 0;
        var copied = 0;
        while (position < text.Length)
        {
            var end = MatchLookalike(text, position);
            if (end < 0)
            {
                position++;
                continue;
            }
            var integerLength = 0;
            while (IsLookalikeInteger(text[position + integerLength])) integerLength++;
            var integer = text.Substring(position, integerLength);
            var separator = text[position + integerLength];
            var digits = integer + text[position + integerLength + 1] + text[position + integerLength + 2];
            result.Append(text, copied, position - copied);
            if (!digits.Any(unit => unit is >= '0' and <= '9')) result.Append(text, position, end - position);
            else
            {
                var fixedDigits = new string([.. digits.Select(unit => unit is 'O' or 'o' or 'I' or 'l' or 'S' or 'Z' or 'B' ? DigitLookalike(unit) : unit)]);
                if (fixedDigits != digits) replaced = true;
                result.Append(fixedDigits, 0, integerLength).Append(separator).Append(fixedDigits, integerLength, fixedDigits.Length - integerLength);
            }
            copied = end;
            position = end;
        }
        result.Append(text, copied, text.Length - copied);
        return (result.ToString(), replaced);
    }

    /// <summary>Dónde acaba LOOKALIKE_AMOUNT si encaja empezando en <paramref name="start"/>, o −1.</summary>
    private static int MatchLookalike(string text, int start)
    {
        if (start > 0 && IsLetterOrAsciiDigit(JsText.CodePointBefore(text, start))) return -1;
        var run = 0;
        while (start + run < text.Length && run <= 4 && IsLookalikeInteger(text[start + run])) run++;
        // El entero es de 1 a 4 de esas letras y lo que sigue tiene que ser el separador.
        if (run is 0 or > 4) return -1;
        var at = start + run;
        // Separador, primera cifra decimal y segunda.
        if (at + 2 >= text.Length) return -1;
        if (text[at] is not (',' or '.' or ':' or ';')) return -1;
        if (!IsLookalikeInteger(text[at + 1]) || !IsLookalikeLastDigit(text[at + 2])) return -1;
        var end = at + 3;
        if (end < text.Length && text[end] is 'x' or 'X' or '×' or '*') return end;
        if (end < text.Length && text[end] is 'A' or 'B' or 'C' && (end + 1 >= text.Length || !IsLetterOrAsciiDigit(JsText.CodePointAt(text, end + 1)))) return end;
        if (end >= text.Length || !IsLetterOrAsciiDigit(JsText.CodePointAt(text, end))) return end;
        return -1;
    }

    private static readonly Regex MinusBeforeDigit = JsRegex.Create(@"[−–](?=\s*\d)");
    private static readonly Regex Dashes = JsRegex.Create(@"[—–_|]+");
    private static readonly Regex SpacedSeparator = JsRegex.Create(@"(\d)\s*([,.:;])\s+(?=\d)");
    private static readonly Regex SpaceBeforeSeparator = JsRegex.Create(@"(\d)\s+([,.])(?=\d{2}(?:\b|[xX×]))");
    private static readonly Regex GluedQuantity = JsRegex.Create(@"(\d[,.:;]\d{2}\s*[xX×*]{1,2})(?=\d{1,3}(?!\d|[,.:;]\d))");
    private static readonly Regex TrailingSpaces = JsRegex.Create(@"\s+$");
    private static readonly Regex SeparatorBeforeAny = JsRegex.Create(@"(\d)\s*([,.:;])\s+(?=\S)");
    private static readonly Regex Spaces = JsRegex.Create(@"\s+");
    private static readonly Regex Gap = JsRegex.Create(@"\S(\s{3,})\S");

    /// <summary>cleanText: «0, 99x» → «0,99x», «2 ,84X» → «2,84X», rayas y subrayados → espacio.</summary>
    private static string CleanText(string text)
    {
        var spaced = MinusBeforeDigit.Replace(text, "-");
        spaced = Dashes.Replace(spaced, " ");
        spaced = SpacedSeparator.Replace(spaced, "$1$2");
        spaced = SpaceBeforeSeparator.Replace(spaced, "$1$2");
        // «2,84x2» → «2,84x 2»: la cantidad pegada al multiplicador.
        spaced = GluedQuantity.Replace(spaced, "$1 ");
        return TrailingSpaces.Replace(ReplaceLookalikes(spaced).Text, "");
    }

    private static bool HasLookalikeDigits(string text) => ReplaceLookalikes(SeparatorBeforeAny.Replace(text, "$1$2")).Replaced;

    private static IReadOnlyList<string> TokensOf(string text) => [.. Spaces.Split(JsText.Trim(text)).Where(token => token.Length > 0)];

    private static int LetterCount(string text) => JsText.CountLetters(text);

    /// <summary>Donde empieza el primer hueco grande (3 o más espacios): separa la columna del nombre de la de los importes.</summary>
    private static int? FirstGapTokenIndex(string text)
    {
        var gap = Gap.Match(text);
        return gap.Success ? TokensOf(text[..(gap.Index + 1)]).Count : null;
    }

    private static readonly Regex Separator = JsRegex.Create(@"^[\s\-=*_.·•]*$");
    private static readonly Regex WeightLine = JsRegex.Create(@"(\d{1,3})\s?[,.]\s?(\d{3})\s*kg\b.*?[xX×*]\s*(\d{1,4})\s?[,.:;]\s?(\d{2})", ignoreCase: true);
    private static readonly Regex DiscountLine = JsRegex.Create(@"^\s*(desc\b|desc\.|desc,|dto\b|descuento|promo\b|cup[oó]n|ahorro)", ignoreCase: true);
    private static readonly Regex TotalLine = JsRegex.Create(@"^\s*TOTAL\b(?!\s*(oferta|desc|ahorro))", ignoreCase: true);
    private static readonly Regex HeaderWords = JsRegex.Create(@"^\s*(descripci[oó]n|cantidad|p\.?\s*unit|precio|importe|eur)\b", ignoreCase: true);
    private static readonly Regex PaymentLine = JsRegex.Create(@"^\s*(Lidl\s*Pay|tarjeta|efectivo|cambio|pagado|pago\b|m[eé]todo de pago|comercio:|num\.?\s*operaci[oó]n|FECHA:|HORA:|CAJA:|IMPORTE:)", ignoreCase: true);
    private static readonly Regex FiscalLine = JsRegex.Create(@"^\s*(IVA\b|I\.?V\.?A\.?\s|TIPO\s+IVA|BASE\s+IMP|CUOTA\b|[ABC]\s+\d{1,2}[,.]?\d*\s*%)", ignoreCase: true);
    private static readonly Regex PromotionalLine = JsRegex.Create(@"^\s*(ofertas?\b|puntos?\b|recompensas?\b|gracias\b|atenci[oó]n\b|compra realizada|pr[oó]xima compra|v[aá]lido|www\.|tel[eé]fono|ahorro\s+total|total\s+(ahorro|desc|oferta)|has ahorrado)", ignoreCase: true);

    private static bool IsSeparator(string text) => Separator.IsMatch(text);

    /// <summary>endsProducts: una línea de pago, de impuestos o de publicidad cierra la lista de productos.</summary>
    public static bool EndsProducts(string text) => PaymentLine.IsMatch(text) || FiscalLine.IsMatch(text) || PromotionalLine.IsMatch(text);

    // -------------------------------------------------------------------------------------------
    // Varias capturas de un mismo ticket

    /// <summary>
    /// mergePages: une las líneas de varias capturas y quita las que una captura repite de la anterior
    /// (al menos dos seguidas e iguales, para no borrar productos repetidos de verdad). Las franjas de
    /// una misma imagen se emparejan por su posición, nunca solo por el nombre.
    /// </summary>
    public static IReadOnlyList<OcrLine> MergePages(IReadOnlyList<IReadOnlyList<OcrLine>> pages)
    {
        var merged = new List<OcrLine>();
        bool Same(OcrLine a, OcrLine b)
        {
            var x = ReadTail(TokensOf(CleanText(a.Text)));
            var y = ReadTail(TokensOf(CleanText(b.Text)));
            return TicketText.NameKey(a.Text) != "" && TicketText.Similarity(a.Text, b.Text) >= 0.95 &&
                x.Amount?.Cents == y.Amount?.Cents && x.Quantity == y.Quantity && x.UnitCents == y.UnitCents && x.Tax == y.Tax;
        }
        foreach (var page in pages)
        {
            if (page.Count > 0 && page[0].Source is { } first && merged.Any(line => line.Source?.ImageIndex == first.ImageIndex))
            {
                foreach (var line in page)
                {
                    var source = line.Source;
                    var duplicate = source is null ? -1 : merged.FindIndex(l => l.Source is { } other && other.ImageIndex == source.ImageIndex &&
                        Math.Abs((other.Box.Y0 + other.Box.Y1) / 2 - (source.Box.Y0 + source.Box.Y1) / 2) < Math.Max(4, (source.Box.Y1 - source.Box.Y0) / 2));
                    if (duplicate >= 0)
                    {
                        if ((line.Confidence ?? 0) > (merged[duplicate].Confidence ?? 0)) merged[duplicate] = line;
                    }
                    else merged.Add(line);
                }
                continue;
            }
            var overlap = 0;
            for (var k = Math.Min(Math.Min(merged.Count, page.Count), 40); k >= 2; k--)
            {
                var all = true;
                for (var j = 0; j < k && all; j++) all = Same(merged[merged.Count - k + j], page[j]);
                if (all && page.Take(k).Select(l => TicketText.NameKey(l.Text)).Distinct(StringComparer.Ordinal).Count() >= 2)
                {
                    overlap = k;
                    break;
                }
            }
            merged.AddRange(page.Skip(overlap));
        }
        return merged;
    }

    // -------------------------------------------------------------------------------------------
    // Cabecera: tienda, dirección, fecha, hora

    private static readonly Regex LidlWord = JsRegex.Create(@"\bLIDL\b", ignoreCase: true);
    private static readonly Regex CompanySuffix = JsRegex.Create(@"\b(S\.?\s?A\.?\s?U?\.?|S\.?\s?L\.?\s?U?\.?)\s*$", ignoreCase: true);
    private static readonly Regex TrailingPunctuation = JsRegex.Create(@"[,.\s]+$");
    private static readonly Regex LidlHeader = JsRegex.Create(@"LIDL\s+SUPERMERCADOS", ignoreCase: true);
    private static readonly Regex AddressEnd = JsRegex.Create(@"\bNIF\b|www\.|^\s*EUR\s*$", ignoreCase: true);
    private static readonly Regex LabeledDate = JsRegex.Create(@"FECHA\W*(\d{2})[/.-](\d{2})[/.-](\d{2,4})", ignoreCase: true);
    private static readonly Regex LabeledTime = JsRegex.Create(@"HORA\W*(\d{2})[:.](\d{2})", ignoreCase: true);
    private static readonly Regex FooterDate = JsRegex.Create(@"\b(\d{2})[/.-](\d{2})[/.-](\d{2}|\d{4})\b(?:\s+(\d{2}):(\d{2}))?");

    private static string DetectStore(IReadOnlyList<OcrLine> lines) => lines.Take(15).Any(line => LidlWord.IsMatch(line.Text)) ? "lidl" : "otra";

    private static string StoreNameOf(string store, IReadOnlyList<OcrLine> lines)
    {
        if (store == "lidl") return "Lidl";
        var first = lines.FirstOrDefault(line => LetterCount(line.Text) >= 3);
        if (first is null) return "Tienda";
        var name = JsText.Trim(TrailingPunctuation.Replace(CompanySuffix.Replace(first.Text, "", 1), "", 1));
        // charAt(0).toLocaleUpperCase('es') + slice(1).toLocaleLowerCase('es'), por unidades UTF-16.
        var pretty = name.Length == 0 ? "" : JsCase.ToUpper(name[..1]) + JsCase.ToLower(name[1..]);
        var cut = JsText.Slice(pretty, 0, 60);
        return cut.Length > 0 ? cut : "Tienda";
    }

    /// <summary>/(\d{5})(?=\p{L})/u, la primera vez: un espacio entre el código postal y la letra pegada.</summary>
    private static string SpaceAfterPostalCode(string text)
    {
        for (var start = 0; start + 5 < text.Length; start++)
        {
            var digits = true;
            for (var k = 0; k < 5 && digits; k++) digits = text[start + k] is >= '0' and <= '9';
            if (digits && JsText.IsLetter(JsText.CodePointAt(text, start + 5)))
                return text[..(start + 5)] + " " + text[(start + 5)..];
        }
        return text;
    }

    private static string AddressOf(string store, IReadOnlyList<OcrLine> lines)
    {
        if (store != "lidl") return "";
        var header = -1;
        for (var index = 0; index < lines.Count && header < 0; index++) if (LidlHeader.IsMatch(lines[index].Text)) header = index;
        if (header == -1) return "";
        var parts = new List<string>();
        foreach (var line in lines.Skip(header + 1).Take(4))
        {
            if (AddressEnd.IsMatch(line.Text)) break;
            var text = JsText.Trim(Spaces.Replace(SpaceAfterPostalCode(line.Text), " "));
            if (text.Length > 0) parts.Add(text);
        }
        return JsText.Slice(string.Join(", ", parts.Take(2)), 0, 120);
    }

    private static string? ReadDate(string day, string month, string year)
    {
        var fullYear = year.Length == 2 ? 2000 + JsNumber.Parse(year) : JsNumber.Parse(year);
        var iso = IsoDates.ToIsoDate((int)fullYear, (int)JsNumber.Parse(month), (int)JsNumber.Parse(day));
        return IsoDates.IsValid(iso) ? iso : null;
    }

    private static (string? Date, string? Time) DateAndTime(IReadOnlyList<OcrLine> lines)
    {
        string? date = null;
        string? time = null;
        foreach (var line in lines)
        {
            var labeledDate = LabeledDate.Match(line.Text);
            if (labeledDate.Success && date is null) date = ReadDate(labeledDate.Groups[1].Value, labeledDate.Groups[2].Value, labeledDate.Groups[3].Value);
            var labeledTime = LabeledTime.Match(line.Text);
            if (labeledTime.Success && time is null && JsNumber.Parse(labeledTime.Groups[1].Value) < 24 && JsNumber.Parse(labeledTime.Groups[2].Value) < 60)
                time = $"{labeledTime.Groups[1].Value}:{labeledTime.Groups[2].Value}";
        }
        if (date is null || time is null)
        {
            // Pie del ticket («4017 564330/01 28.10.26 19:22») u otras tiendas («28/10/2026 19:24»).
            foreach (var line in lines)
            {
                var match = FooterDate.Match(line.Text);
                if (!match.Success) continue;
                var found = ReadDate(match.Groups[1].Value, match.Groups[2].Value, match.Groups[3].Value);
                if (found is null) continue;
                date ??= found;
                if (time is null && match.Groups[4].Success && match.Groups[4].Value.Length > 0 &&
                    JsNumber.Parse(match.Groups[4].Value) < 24 && JsNumber.Parse(match.Groups[5].Value) < 60)
                    time = $"{match.Groups[4].Value}:{match.Groups[5].Value}";
                if (date is not null && time is not null) break;
            }
        }
        return (date, time);
    }

    // -------------------------------------------------------------------------------------------
    // Productos

    private sealed class WorkLine
    {
        public required int Position { get; init; }
        public required string RawName { get; init; }
        public required long Quantity { get; init; }
        public required long? UnitCents { get; init; }
        public double? WeightKg { get; set; }
        public long? PricePerKgCents { get; set; }
        public required string? TaxCode { get; init; }
        /// <summary>Importes leídos (nunca calculados), con su puntuación.</summary>
        public required List<Candidate> Amount { get; init; }
        public required AmountTokenValue? TextReading { get; init; }
        public required AmountTokenValue? RereadReading { get; init; }
        /// <summary>Las dos pasadas del OCR leyeron igual el precio y la cantidad (o el peso y el precio por kilo).</summary>
        public required bool InputsStable { get; set; }
        public required OcrConfidence Confidence { get; set; }
        public List<List<Candidate>> Discounts { get; } = [];
        public required OcrLine Source { get; init; }
        public List<string> Issues { get; } = [];
        /// <summary>Indicios de que el importe puede tener una cifra confundida. Una multiplicación que coincide los resuelve.</summary>
        public required List<string> AmountDoubts { get; init; }
    }

    private static void AddCandidate(List<Candidate> list, long cents, double score, bool read = true)
    {
        var existing = list.Find(candidate => candidate.Cents == cents);
        if (existing is not null)
        {
            existing.Score += score;
            existing.Read |= read;
        }
        else list.Add(new Candidate(cents, score, read));
    }

    private static double? MinConfidence(IEnumerable<double?> values)
    {
        var known = values.Where(value => value is not null).Select(value => value!.Value).ToArray();
        return known.Length > 0 ? known.Min() : null;
    }

    private static readonly Regex AmountShape = JsRegex.Create(@"\d[,.:;]\d{2}");
    private static readonly Regex HasMultiplier = JsRegex.Create(@"[xX×*]");
    private static readonly Regex UnitWithX = JsRegex.Create(@"\d[,.:;]\d{2}[xX×*]");
    private static readonly Regex AmountAtEnd = JsRegex.Create(@"\d[,.:;]\d{2}$");
    private static readonly Regex QuantityWord = JsRegex.Create(@"^\d{1,3}$");

    /// <summary>wordConfidence: la confianza de Tesseract en el importe y en el precio × cantidad, si el OCR la da por palabra.</summary>
    private static OcrConfidence WordConfidence(OcrLine line)
    {
        var words = (line.Words ?? []).Select(word => (Text: CleanText(word.Text), word.Confidence)).ToArray();
        double? amount = null;
        var amountIndex = -1;
        for (var i = words.Length - 1; i >= 0; i--)
        {
            if (AmountShape.IsMatch(words[i].Text) && !HasMultiplier.IsMatch(words[i].Text))
            {
                amount = words[i].Confidence;
                amountIndex = i;
                break;
            }
        }
        var unitIndex = -1;
        for (var i = 0; i < words.Length && unitIndex < 0; i++)
        {
            if (i < amountIndex && (UnitWithX.IsMatch(words[i].Text) ||
                (AmountAtEnd.IsMatch(words[i].Text) && Multiplier.IsMatch(i + 1 < words.Length ? words[i + 1].Text : ""))))
                unitIndex = i;
        }
        if (unitIndex == -1) return new OcrConfidence(amount);
        var quantity = words.Skip(unitIndex + 1).Take(Math.Max(0, amountIndex - unitIndex - 1)).Where(word => QuantityWord.IsMatch(word.Text)).Select(word => (double?)word.Confidence).FirstOrDefault();
        return new OcrConfidence(amount, MinConfidence([words[unitIndex].Confidence, quantity]));
    }

    private sealed record WeightReading(double WeightKg, long PricePerKgCents, bool Agreed, double? Confidence);

    private static WeightReading? ReadWeight(OcrLine line)
    {
        var reads = new List<(double WeightKg, long PricePerKgCents)>();
        foreach (var text in new[] { line.Reread, line.Text })
        {
            var match = string.IsNullOrEmpty(text) ? null : WeightLine.Match(text);
            if (match is { Success: true })
                reads.Add((JsNumber.Parse($"{match.Groups[1].Value}.{match.Groups[2].Value}"), ToCents(match.Groups[3].Value, match.Groups[4].Value)));
        }
        if (reads.Count == 0) return null;
        var agreed = reads.Count == 2 && reads[0].WeightKg == reads[1].WeightKg && reads[0].PricePerKgCents == reads[1].PricePerKgCents;
        var confidence = MinConfidence((line.Words ?? []).Where(word => AnyDigit.IsMatch(word.Text)).Select(word => (double?)word.Confidence));
        return new WeightReading(reads[0].WeightKg, reads[0].PricePerKgCents, agreed, confidence);
    }

    private static readonly Regex TrailingNamePunctuation = JsRegex.Create(@"[,;:]+$");

    private static WorkLine? ReadItemLine(OcrLine line, int position)
    {
        var text = CleanText(line.Text);
        var tokens = TokensOf(text);
        if (tokens.Count == 0) return null;
        var fromText = ReadTail(tokens);
        var fromReread = !string.IsNullOrEmpty(line.Reread) ? ReadTail(TokensOf(CleanText(line.Reread))) : null;

        // El nombre no pasa del primer hueco grande: lo de después son importes (aunque estén mal leídos).
        var uncut = fromText.NameTokens;
        var nameTokens = uncut.ToList();
        var gap = FirstGapTokenIndex(text);
        if (gap is { } cut && cut < nameTokens.Count) nameTokens = nameTokens.Take(cut).ToList();
        // Sin importe al final, se quitan los restos con cifras y signos («1-29:B»).
        if (fromText.Amount is null)
        {
            // «PAN 3 KG 1,2? A»: la letra del IVA detrás de un importe ilegible tampoco es del nombre.
            if (nameTokens.Count > 2 && IsTaxToken(nameTokens[^1]) && nameTokens[^1].Length == 1 && AnyDigit.IsMatch(nameTokens[^2])) nameTokens.RemoveAt(nameTokens.Count - 1);
            while (nameTokens.Count > 1 && AnyDigit.IsMatch(nameTokens[^1]) && HasNonLetterNonDigit(nameTokens[^1])) nameTokens.RemoveAt(nameTokens.Count - 1);
        }
        // Otras tiendas ponen la cantidad delante: «2 YOGUR GRIEGO 1,20 2,40» o «1 PAN BARRA 0,60».
        long? leadingQuantity = null;
        long? leadingUnitCents = null;
        if (nameTokens.Count >= 2 && QtyToken.IsMatch(nameTokens[0]) && LetterCount(nameTokens[1]) > 0)
        {
            var count = (long)JsNumber.Parse(nameTokens[0]);
            var unit = ReadAmountToken(uncut[^1]);
            if (unit is { Clean: true } && fromText.Amount is not null && unit.Cents * count == fromText.Amount.Cents)
            {
                leadingQuantity = count;
                leadingUnitCents = unit.Cents;
                nameTokens.RemoveAt(0);
                if (nameTokens.Count == uncut.Count - 1) nameTokens.RemoveAt(nameTokens.Count - 1);
            }
            else if (count is >= 1 and <= 99)
            {
                leadingQuantity = count;
                nameTokens.RemoveAt(0);
            }
        }
        var rawName = JsText.Trim(TrailingNamePunctuation.Replace(string.Join(' ', nameTokens), "", 1));
        if (LetterCount(rawName) < 2) return null;

        var amount = new List<Candidate>();
        // La relectura de solo cifras confunde 9 con 3 y la B con 5 («3,73 5» por «3,79B»); la lectura
        // normal suele fallar añadiendo una cifra pegada («2,792 A»). Un importe limpio en la lectura
        // normal manda; si no lo es, manda la relectura. La multiplicación no puntúa aquí.
        if (fromReread?.Amount is { } rereadAmount) AddCandidate(amount, rereadAmount.Cents, rereadAmount.Clean ? 2 : 1.5);
        if (fromText.Amount is { } textAmount) AddCandidate(amount, textAmount.Cents, textAmount.Clean ? 2.5 : 0.7);
        if (fromReread is { LooseAmountCents: { } rereadLoose }) AddCandidate(amount, rereadLoose, 0.4);
        if (fromText.LooseAmountCents is { } textLoose) AddCandidate(amount, textLoose, 0.4);

        // Cantidad y precio unitario: de las dos lecturas, la que cuadra con algún importe leído; si ninguna, la normal.
        var options = new[] { fromText, fromReread }.Where(reading => reading is { UnitCents: not null, Quantity: not null }).Select(reading => reading!).ToArray();
        var consistent = options.FirstOrDefault(reading => amount.Any(candidate => candidate.Cents == reading.UnitCents!.Value * reading.Quantity!.Value));
        var chosen = consistent ?? options.FirstOrDefault();
        var unitCents = chosen?.UnitCents ?? leadingUnitCents;
        var quantity = chosen?.Quantity is > 0 ? chosen.Quantity.Value : (leadingQuantity ?? 1);
        var plainUnit = fromReread is not null && fromReread.UnitCents is null ? ReadPlainUnit(fromReread) : null;
        var inputsStable = (options.Length == 2 && options[0].UnitCents == options[1].UnitCents && options[0].Quantity == options[1].Quantity) ||
            (plainUnit is not null && plainUnit.Value.UnitCents == unitCents && plainUnit.Value.Quantity == quantity);

        var amountDoubts = new List<string>();
        var taxCode = fromReread?.Tax ?? fromText.Tax;
        // «3,73 5» en vez de «3,79B»: si la letra del IVA solo aparece como cifra, el OCR ha leído la
        // línea como si fueran cifras y el importe puede tener otra cifra confundida.
        if (taxCode is not null && !new[] { fromText, fromReread }.Any(reading => reading?.TaxRaw is { Length: > 0 } raw && JsText.CodePoints(raw).Any(JsText.IsLetter)))
            amountDoubts.Add($"La letra del IVA se ha leído como la cifra «{fromText.TaxRaw ?? fromReread?.TaxRaw}»: puede haber otra cifra confundida en el importe");
        if (fromText.Amount is null && fromReread?.Amount is not null) amountDoubts.Add("El importe solo se lee en la relectura de cifras");
        if (HasLookalikeDigits(line.Text) || (!string.IsNullOrEmpty(line.Reread) && HasLookalikeDigits(line.Reread))) amountDoubts.Add("Se han interpretado letras como cifras");

        return new WorkLine
        {
            Position = position,
            RawName = rawName,
            Quantity = quantity,
            UnitCents = unitCents,
            WeightKg = null,
            PricePerKgCents = null,
            TaxCode = taxCode,
            Amount = amount,
            TextReading = fromText.Amount,
            RereadReading = fromReread?.Amount,
            InputsStable = inputsStable,
            Confidence = WordConfidence(line),
            Source = line,
            AmountDoubts = amountDoubts,
        };
    }

    /// <summary>/[^\p{L}\d]/u: algún punto de código que no es letra ni cifra ASCII.</summary>
    private static bool HasNonLetterNonDigit(string token) => JsText.CodePoints(token).Any(codePoint => !IsLetterOrAsciiDigit(codePoint));

    /// <summary>readPlainUnit: «3,95 2 7,20 B» (sin la x): precio y cantidad aunque no cuadren, solo para comparar lecturas.</summary>
    private static (long UnitCents, long Quantity)? ReadPlainUnit(TailReading reading)
    {
        var tokens = reading.NameTokens;
        if (tokens.Count < 2) return null;
        var quantity = tokens[^1];
        var unit = ReadAmountToken(tokens[^2]);
        return unit is { Clean: true } && QtyToken.IsMatch(quantity) ? (unit.Cents, (long)JsNumber.Parse(quantity)) : null;
    }

    private static List<Candidate> ReadDiscount(OcrLine line)
    {
        var candidates = new List<Candidate>();
        foreach (var (text, score) in new[] { (line.Reread, 2.0), (line.Text, 1.0) })
        {
            if (string.IsNullOrEmpty(text)) continue;
            var tokens = TokensOf(CleanText(text));
            for (var i = tokens.Count - 1; i >= 0; i--)
            {
                if (ReadAmountToken(tokens[i]) is { } amount)
                {
                    AddCandidate(candidates, Math.Abs(amount.Cents), score);
                    break;
                }
            }
        }
        return candidates;
    }

    // -------------------------------------------------------------------------------------------
    // Selección local: el total nunca modifica un dato de producto.

    /// <summary>Por puntuación, de mayor a menor, y a igual puntuación por céntimos: estable, como Array.sort.</summary>
    private static List<Candidate> Sorted(IEnumerable<Candidate> candidates) => [.. candidates.OrderByDescending(c => c.Score).ThenBy(c => c.Cents)];

    private static AmountReading AsReading(AmountTokenValue token)
    {
        var gluedDigits = NotDigit.Replace(token.Glued, "").Length;
        return new AmountReading(token.Cents, token.RawDigits, !token.Clean,
            $"{(token.Cents < 0 ? "-" : "")}{JsText.Slice(token.RawDigits, 0, -2 - gluedDigits)},{JsText.Slice(token.RawDigits, -2 - gluedDigits)}");
    }

    private static ParsedTicketLine SelectLine(WorkLine line)
    {
        var reads = Sorted(line.Amount);
        var textToken = line.TextReading;
        var rereadToken = line.RereadReading;
        var readings = new[] { textToken, rereadToken }.Where(token => token is not null).Select(token => AsReading(token!)).ToList();
        var chosen = reads.Count > 0 ? reads[0] : null;
        // La lectura elegida, con sus cifras en bruto (una lectura sin coma, «378», cuenta como deformada).
        var recognized = chosen is null ? null :
            readings.FirstOrDefault(reading => reading.Cents == chosen.Cents) ?? new AmountReading(chosen.Cents, TicketEvidenceRules.PrintedDigits(chosen.Cents), true);
        var flags = new List<string>();
        void Flag(string flag)
        {
            if (!flags.Contains(flag)) flags.Add(flag);
        }
        var issues = new List<string>(line.Issues);
        var options = new List<TicketAmountOption>();
        long? amount = recognized?.Cents;
        var selectedBy = rereadToken is not null && textToken?.Cents != amount && rereadToken.Cents == amount ? "reread" : "read";
        TicketDiscrepancy? discrepancy = null;

        var weighted = line.WeightKg is not null && line.PricePerKgCents is not null;
        var grams = weighted ? (long)JsNumber.Round(line.WeightKg!.Value * 1000) : 0;
        var sign = (recognized?.Cents ?? 0) < 0 ? -1 : 1;
        long? calculated = weighted ? sign * TicketArithmetic.RoundRatio((double)grams * line.PricePerKgCents!.Value, 1000)
            : line.UnitCents is { } unit ? sign * unit * line.Quantity : null;
        var common = recognized is null ? null : new AmountEvidence(
            recognized, readings.Count > 0 ? readings : [recognized], line.InputsStable,
            readings.Count == 2 && readings[0].Cents == readings[1].Cents, line.Confidence);

        if (calculated is not null && recognized is null)
        {
            // Importe ilegible: se propone el cálculo, pero es un dato sugerido, no leído.
            amount = calculated;
            selectedBy = "calculation";
            Flag("deducido");
            options.Add(new TicketAmountOption(calculated.Value, "calculation"));
            issues.Add($"No se lee el importe; {(weighted ? "peso × precio por kilo" : "precio × cantidad")} da {Money.FormatEuros(calculated.Value)}: confírmalo");
        }
        else if (calculated is not null && common is not null && calculated != recognized!.Cents)
        {
            discrepancy = (weighted
                ? TicketEvidenceRules.AssessWeight(common, grams, line.PricePerKgCents!.Value)
                : TicketEvidenceRules.AssessUnits(common, line.UnitCents!.Value, line.Quantity))!;
            issues.Add(discrepancy.Explanation);
            var read = new TicketAmountOption(recognized.Cents, selectedBy == "reread" ? "reread" : "read");
            if (discrepancy.Verdict == "calculation")
            {
                amount = calculated;
                selectedBy = readings.Any(reading => reading.Cents == calculated) && textToken?.Cents != calculated ? "reread" : "calculation";
                Flag("corregido");
                options.Add(new TicketAmountOption(calculated.Value, "calculation"));
                options.Add(read);
            }
            else if (discrepancy.Verdict == "read")
            {
                options.Add(read);
                options.Add(new TicketAmountOption(calculated.Value, "calculation"));
            }
            else
            {
                // Ambiguo: no se elige ninguna cifra. Las dos quedan a mano en la revisión.
                amount = null;
                options.Add(new TicketAmountOption(calculated.Value, "calculation"));
                options.Add(read);
            }
        }
        else if (calculated is null && reads.Count > 1)
        {
            issues.Add("Las lecturas del importe no coinciden");
            // Botones solo para lecturas con forma de importe («2,99»), nunca para cifras sueltas sin coma («373»).
            if (textToken is not null && rereadToken is not null && textToken.Cents != rereadToken.Cents)
            {
                var both = new List<TicketAmountOption> { new(textToken.Cents, "read"), new(rereadToken.Cents, "reread") };
                if (selectedBy == "reread") both.Reverse();
                options.AddRange(both);
            }
        }
        if (calculated is null && textToken is not null && rereadToken is null && !string.IsNullOrEmpty(line.Source.Reread))
        {
            // Relectura con cifras que no se puede interpretar («2795» frente a «3,72B»): las dos pasadas no coinciden.
            var digits = NotDigit.Replace(line.Source.Reread, "");
            if (digits.Length >= 3 && !digits.StartsWith(JsText.Slice(textToken.RawDigits, 0, 3), StringComparison.Ordinal))
                issues.Add($"La relectura de cifras no confirma el importe («{JsText.Trim(line.Source.Reread)}»)");
        }
        if (calculated is null)
        {
            // «2,939»: el OCR vio una cifra de más. Quitar la última es una suposición, así que una
            // lectura deformada no confirma el importe aunque otra lectura coincida.
            var deformed = new[] { textToken, rereadToken }.FirstOrDefault(token => token is not null && !token.Clean && AnyDigit.IsMatch(token.Glued));
            if (deformed is not null) issues.Add($"Una lectura del importe tiene cifras de más («{AsReading(deformed).Printed}»): confirma el importe");
        }

        if (amount is null && discrepancy is null)
        {
            Flag("ilegible");
            issues.Add("No se lee el importe");
        }
        // Una multiplicación que coincide con el importe leído es una comprobación independiente: resuelve la baja confianza.
        var verifiedByArithmetic = calculated is not null && recognized is not null && calculated == recognized.Cents;
        if ((line.Source.Confidence ?? 100) < 75 && !verifiedByArithmetic) issues.Add("Lectura de baja confianza");
        if (!verifiedByArithmetic) issues.AddRange(line.AmountDoubts);
        long discountCents = 0;
        foreach (var discount in line.Discounts)
        {
            var choices = Sorted(discount);
            discountCents += choices.Count > 0 ? choices[0].Cents : 0;
            if (choices.Count == 0 || choices.Count > 1) issues.Add("Descuento ilegible o ambiguo");
        }
        if (amount is not null && discountCents > Math.Max(0, amount.Value)) issues.Add("Descuento mayor que el importe");
        if (issues.Count > 0 && !flags.Contains("ilegible")) Flag("dudoso");
        return new ParsedTicketLine(line.Position, line.RawName, TicketText.NameKey(line.RawName), line.Quantity, line.UnitCents, amount, discountCents,
            line.WeightKg, line.PricePerKgCents, line.TaxCode, flags,
            new TicketEvidence(line.Source.Text, line.Source.Reread, textToken?.Cents ?? recognized?.Cents, calculated, selectedBy,
                [.. issues.Distinct(StringComparer.Ordinal)], CleanText(line.Source.Text), discrepancy, options.Count > 0 ? options : null, line.Source.Source));
    }

    // -------------------------------------------------------------------------------------------
    // Total

    private static readonly Regex PaymentTotal = JsRegex.Create(@"^\s*(IMPORTE|Lidl\s*Pay|TARJETA|Suma)\b", ignoreCase: true);

    private static long? LastAmount(string? text)
    {
        if (string.IsNullOrEmpty(text)) return null;
        var tokens = TokensOf(CleanText(text));
        for (var i = tokens.Count - 1; i >= 0; i--)
            if (ReadAmountToken(tokens[i]) is { } amount) return amount.Cents;
        return null;
    }

    private static long? ReadTotal(IReadOnlyList<OcrLine> lines, int? totalIndex)
    {
        var votes = new List<Candidate>();
        if (totalIndex is { } index)
        {
            var fromReread = LastAmount(lines[index].Reread);
            var fromText = LastAmount(lines[index].Text);
            if (fromText is not null) return fromText;
            if (fromReread is not null) return fromReread;
        }
        foreach (var line in lines.Skip(totalIndex ?? 0))
        {
            if (PaymentTotal.IsMatch(line.Text) && LastAmount(line.Text) is { } value) AddCandidate(votes, value, 1);
        }
        var sorted = Sorted(votes);
        return sorted.Count > 0 ? sorted[0].Cents : null;
    }

    // -------------------------------------------------------------------------------------------

    private static readonly Regex EurLine = JsRegex.Create(@"^\s*EUR\s*$", ignoreCase: true);
    private static readonly Regex StartsWithDigit = JsRegex.Create(@"^\s*\d");
    private static readonly Regex SavingsLine = JsRegex.Create(@"^\s*(ahorro|ahorrado|resumen)\b", ignoreCase: true);
    private static readonly Regex ArticleDiscount = JsRegex.Create(@"^\s*(desc[.,]?|dto[.,]?|descuento art[ií]culo)\s+-", ignoreCase: true);
    private static readonly Regex Coupon = JsRegex.Create(@"cup[oó]n", ignoreCase: true);
    private static readonly Regex Promotion = JsRegex.Create(@"promo", ignoreCase: true);
    private static readonly Regex AmountLike = JsRegex.Create(@"\d[,.:;]?\d");
    private static readonly Regex PaymentOrTotal = JsRegex.Create(@"^\s*(Lidl\s*Pay|IMPORTE:|TOTAL\b)", ignoreCase: true);
    private static readonly Regex TotalStart = JsRegex.Create(@"^\s*TOTAL\b", ignoreCase: true);

    /// <summary>parseTicket: analiza las líneas leídas de una o varias capturas (o el texto pegado, una línea por renglón).</summary>
    public static ParsedTicket ParseTicket(IReadOnlyList<IReadOnlyList<OcrLine>> pages)
    {
        var lines = MergePages(pages).Where(line => JsText.Trim(line.Text) != "").ToList();
        var store = DetectStore(lines);
        var issues = new List<string>();
        var adjustments = new List<TicketAdjustment>();
        var work = new List<WorkLine>();
        var state = "header";
        var previousWasItem = false;
        int? totalIndex = null;
        var promoIndex = lines.Count;
        for (var i = 0; i < lines.Count; i++)
        {
            var line = lines[i];
            if (PromotionalLine.IsMatch(line.Text) && state != "header") promoIndex = Math.Min(promoIndex, i);
            if (TotalLine.IsMatch(line.Text) && state != "header" && totalIndex is null && i < promoIndex)
            {
                totalIndex = i;
                state = "closed";
            }
            if (state == "closed") continue;
            if (EndsProducts(line.Text))
            {
                if (state != "header") state = "closed";
                continue;
            }
            if (EurLine.IsMatch(line.Text))
            {
                state = "products";
                continue;
            }
            if (HeaderWords.IsMatch(line.Text) || IsSeparator(line.Text)) continue;
            if (state == "header")
            {
                // Sin la cabecera «EUR», el primer producto es la primera línea con nombre e importe, de
                // cualquiera de las dos lecturas: si la normal sale deformada («1,7298»), la relectura vale.
                var headTail = ReadTail(TokensOf(CleanText(line.Text)));
                var rereadAmount = !string.IsNullOrEmpty(line.Reread) ? ReadTail(TokensOf(CleanText(line.Reread))).Amount : null;
                var looksLikeAmount = headTail.Amount is not null ||
                    (rereadAmount is not null && AmountLike.IsMatch(headTail.NameTokens.Count > 0 ? headTail.NameTokens[^1] : ""));
                if (!looksLikeAmount || LetterCount(string.Join(' ', headTail.NameTokens)) < 2 || DiscountLine.IsMatch(line.Text) || TotalLine.IsMatch(line.Text)) continue;
                state = "products";
            }
            var previous = work.Count > 0 ? work[^1] : null;
            var weight = ReadWeight(line);
            if (weight is not null && StartsWithDigit.IsMatch(line.Text))
            {
                if (previous is not null && previousWasItem && previous.WeightKg is null)
                {
                    previous.WeightKg = weight.WeightKg;
                    previous.PricePerKgCents = weight.PricePerKgCents;
                    previous.InputsStable = weight.Agreed;
                    previous.Confidence = new OcrConfidence(previous.Confidence.Amount, weight.Confidence);
                }
                else issues.Add("Línea de peso sin producto identificable");
                continue;
            }
            if (DiscountLine.IsMatch(line.Text))
            {
                if (SavingsLine.IsMatch(line.Text))
                {
                    previousWasItem = false;
                    continue;
                }
                var discount = ReadDiscount(line);
                // Un «Desc.» o «Dto.» corto debajo es el descuento del artículo; un cupón o una promoción
                // con nombre nunca se asigna por cercanía.
                if (ArticleDiscount.IsMatch(CleanText(line.Text)) && previous is not null && previousWasItem)
                    previous.Discounts.Add(discount);
                else
                {
                    var kind = Coupon.IsMatch(line.Text) ? "coupon" : Promotion.IsMatch(line.Text) ? "promotion" : "discount";
                    adjustments.Add(new TicketAdjustment($"adjustment-{JsNumber.ToString(i)}", JsText.Slice(JsText.Trim(line.Text), 0, 120), kind,
                        discount.Count > 0 ? -Sorted(discount)[0].Cents : null, true, line.Text));
                    state = "adjustments";
                }
                previousWasItem = false;
                continue;
            }
            if (work.Count >= 300)
            {
                issues.Add("El ticket supera las 300 líneas; lectura incompleta");
                state = "closed";
                continue;
            }
            var item = ReadItemLine(line, work.Count);
            if (item is not null)
            {
                work.Add(item);
                previousWasItem = true;
                state = "products";
                continue;
            }
            var tail = ReadTail(TokensOf(CleanText(line.Text)));
            if (previous is not null && previousWasItem && previous.Amount.Count == 0 && tail.Amount is not null) AddCandidate(previous.Amount, tail.Amount.Cents, 1);
            else previousWasItem = false;
        }
        var metadata = lines.Take(promoIndex).ToList();
        var totalCents = ReadTotal(metadata, totalIndex);
        if (totalIndex is null) issues.Add(totalCents is null ? "No se ha encontrado el total" : "Total obtenido del pago: confirma que es el importe completo");
        if (state != "closed") issues.Add("No se ha identificado el final del ticket; podría estar recortado");
        var parsed = work.Select(SelectLine).ToList();
        // Si se dejó de leer por tamaño faltan líneas: la suma no demuestra nada aunque haya total.
        var check = CheckTicket(parsed.Select(l => new CheckLine(l.AmountCents, l.DiscountCents, l.Flags.Count > 0)).ToList(), totalCents,
            adjustments.Select(a => a.AmountCents).ToList(), incomplete: work.Count >= 300);
        if (check.Status == "no_cuadra") issues.Add("Los importes no cuadran con el total");
        if (check.Status == "pendiente") issues.Add("La suma coincide con el total, pero hay líneas dudosas: dos errores pueden compensarse");
        for (var p = 1; p < pages.Count; p++)
        {
            var previousPage = pages[p - 1];
            var next = pages[p];
            if (previousPage.Count > 0 && next.Count > 0 && next[0].Source is null && TicketText.NameKey(previousPage[^1].Text) == TicketText.NameKey(next[0].Text))
            {
                if (TicketText.NameKey(next[0].Text) == TicketText.NameKey(next.Count > 1 ? next[1].Text : "")) issues.Add("Solapamiento ambiguo: se han conservado los productos repetidos");
            }
        }
        var taxGroups = ReadTaxGroups(metadata.Skip(totalIndex ?? 0).ToList());
        var taxCheck = CheckTaxGroups(parsed.Select(l => new TaxLine(l.AmountCents, l.DiscountCents, l.TaxCode)).ToList(), taxGroups,
            adjustments.Select(a => a.AmountCents).ToList());
        foreach (var group in taxCheck.Groups)
        {
            if (taxCheck.Conclusive && group.DifferenceCents is not null and not 0)
                issues.Add($"El desglose de IVA {group.Code} suma {Money.FormatEuros(group.GrossCents)} y sus artículos {Money.FormatEuros(group.LinesCents!.Value)}: alguno de esos importes puede estar mal leído");
        }
        if (check.Status == "cuadra" && taxCheck.Mismatches > 0) check = check with { Status = "pendiente" };
        var confidences = work.Select(w => w.Source.Confidence).Where(c => c is not null).Select(c => c!.Value).ToArray();
        if (confidences.Length >= 3 && (double)confidences.Count(c => c < 60) / confidences.Length >= 0.3)
            issues.Add("Muchas líneas se leen con poca nitidez: la imagen puede tener poca resolución. Prueba con la captura original o una foto más cercana");
        var paymentTotals = metadata.Where(l => PaymentOrTotal.IsMatch(l.Text))
            .Select(l => ReadTotal([l], TotalStart.IsMatch(l.Text) ? 0 : null)).Where(n => n is not null).ToList();
        if (paymentTotals.Distinct().Count() > 1) issues.Add("Los totales de compra y pago no coinciden");
        var (date, time) = DateAndTime(metadata);
        if (date is null) issues.Add("No se ha reconocido la fecha de compra");
        return new ParsedTicket(store, StoreNameOf(store, lines), AddressOf(store, lines), date, time, totalCents, parsed, check, adjustments,
            [.. issues.Distinct(StringComparer.Ordinal)], taxGroups, PaymentMethodOf(metadata.Skip(totalIndex ?? 0).ToList()));
    }

    // -------------------------------------------------------------------------------------------
    // Pie del ticket: desglose de IVA y medio de pago

    // «Cc 21%»: a veces el OCR duplica la letra en minúscula.
    private static readonly Regex TaxGroupLine = JsRegex.Create(@"^\s*(?:IVA\s+)?([ABC])[abc]?\s+(\d{1,2})(?:[,.](\d{1,2}))?\s*%\s+(.+)$");

    /// <summary>
    /// readTaxGroups: el desglose de IVA. Solo se acepta un grupo coherente por sí mismo (una de sus
    /// cifras es la cuota, base × tipo ±1 céntimo, y con tres cifras la tercera es la suma).
    /// </summary>
    public static IReadOnlyList<TicketTaxGroup> ReadTaxGroups(IReadOnlyList<OcrLine> lines)
    {
        var groups = new List<TicketTaxGroup>();
        foreach (var line in lines)
        {
            var match = TaxGroupLine.Match(CleanText(line.Text));
            if (!match.Success) continue;
            var code = JsCase.ToUpper(match.Groups[1].Value);
            if (groups.Any(g => g.Code == code)) continue;
            var rateBasisPoints = (long)(JsNumber.Parse(match.Groups[2].Value) * 100 + JsNumber.Parse((match.Groups[3].Success ? match.Groups[3].Value : "0").PadRight(2, '0')));
            var amounts = TokensOf(match.Groups[4].Value).Select(ReadAmountToken).Where(a => a is { Clean: true, Cents: >= 0 }).Select(a => a!.Cents).ToList();
            TicketTaxGroup? found = null;
            foreach (var @base in amounts)
            {
                foreach (var tax in amounts)
                {
                    if (@base == tax || found is not null) continue;
                    if (Math.Abs(TicketArithmetic.RoundRatio((double)@base * rateBasisPoints, 10_000) - tax) <= 1)
                        found = new TicketTaxGroup(code, rateBasisPoints, @base, tax, @base + tax);
                }
            }
            // Con tres cifras, la tercera debe ser la suma: si no lo es, el grupo no se usa.
            if (found is not null && amounts.Count >= 3 && !amounts.Contains(found.GrossCents)) found = null;
            if (found is not null) groups.Add(found);
        }
        return groups;
    }

    /// <summary>
    /// checkTaxGroups: cada grupo del desglose frente a la suma de sus artículos. No cambia ninguna cifra
    /// y no es concluyente con ajustes generales o artículos sin letra.
    /// </summary>
    public static TaxGroupsCheck CheckTaxGroups(IReadOnlyList<TaxLine> lines, IReadOnlyList<TicketTaxGroup>? groups = null, IReadOnlyList<long?>? adjustments = null)
    {
        groups ??= [];
        adjustments ??= [];
        var conclusive = groups.Count > 0 && lines.All(l => l.TaxCode is not null) && !adjustments.Any(a => (a ?? 1) != 0) &&
            lines.All(l => groups.Any(g => g.Code == l.TaxCode));
        var checks = groups.Select(group =>
        {
            var own = lines.Where(l => l.TaxCode == group.Code).ToList();
            long? linesCents = own.Any(l => l.AmountCents is null) ? null : own.Sum(l => l.AmountCents!.Value - l.DiscountCents);
            return new TaxGroupCheck(group.Code, group.GrossCents, linesCents, linesCents is null ? null : group.GrossCents - linesCents);
        }).ToList();
        return new TaxGroupsCheck(conclusive, conclusive ? checks.Count(c => c.DifferenceCents is not null and not 0) : 0, checks);
    }

    private static readonly Regex LidlPay = JsRegex.Create(@"Lidl\s*Pay", ignoreCase: true);
    private static readonly Regex Card = JsRegex.Create(@"\b(tarjeta|visa|mastercard|maestro|d[eé]bito|cr[eé]dito|contactless)\b", ignoreCase: true);
    private static readonly Regex Cash = JsRegex.Create(@"\b(efectivo|entregado)\b", ignoreCase: true);

    private static string? PaymentMethodOf(IReadOnlyList<OcrLine> lines)
    {
        foreach (var line in lines)
        {
            if (LidlPay.IsMatch(line.Text)) return "Lidl Pay";
            if (Card.IsMatch(line.Text)) return "Tarjeta";
            if (Cash.IsMatch(line.Text)) return "Efectivo";
        }
        return null;
    }

    /// <summary>
    /// checkTicket: la suma de las líneas y si cuadra con el total. Sirve también tras editar importes
    /// en la revisión. Nunca cambia una cifra: solo dice qué pasa.
    /// </summary>
    public static TicketCheck CheckTicket(IReadOnlyList<CheckLine> lines, long? totalCents, IReadOnlyList<long?>? adjustments = null, bool incomplete = false)
    {
        adjustments ??= [];
        var linesTotalCents = lines.Sum(line => (line.AmountCents ?? 0) - line.DiscountCents) + adjustments.Sum(a => a ?? 0);
        var unreadable = lines.Count(line => line.AmountCents is null) + adjustments.Count(a => a is null);
        var pending = lines.Count(line => line.Pending);
        long? differenceCents = totalCents is null ? null : totalCents - linesTotalCents;
        var status = totalCents is null ? "sin_total"
            : unreadable > 0 || incomplete ? "incompleto"
                : differenceCents != 0 ? "no_cuadra"
                    : pending > 0 ? "pendiente" : "cuadra";
        return new TicketCheck(status, linesTotalCents, differenceCents, unreadable, pending);
    }

    /// <summary>CHECK_LABELS: el texto de cada estado de la comprobación.</summary>
    public static IReadOnlyList<KeyValuePair<string, string>> CheckLabels { get; } =
    [
        new("cuadra", "Cuadra con el total"),
        new("pendiente", "Pendiente de confirmar"),
        new("no_cuadra", "No cuadra"),
        new("incompleto", "Incompleto"),
        new("sin_total", "Sin total"),
    ];

    private static readonly Regex LineBreak = new(@"\r?\n", RegexOptions.CultureInvariant);

    /// <summary>linesFromText: el texto pegado (un ticket por email, por ejemplo) como si fuera una captura.</summary>
    public static IReadOnlyList<OcrLine> LinesFromText(string text) => [.. LineBreak.Split(text).Select(line => new OcrLine(line, null))];
}
