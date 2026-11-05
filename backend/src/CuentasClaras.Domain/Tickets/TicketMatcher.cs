using System.Text.RegularExpressions;
using CuentasClaras.Domain.Common;

namespace CuentasClaras.Domain.Tickets;

/// <summary>Equivalencia guardada (pantry_aliases): línea de ticket (clave) → producto, o null si no se sigue.</summary>
public sealed record AliasRecord(string Key, string? ItemId);

/// <summary>Lo que el emparejamiento necesita de un producto de la despensa: su id y su nombre (Domain.Tickets no conoce Domain.Pantry).</summary>
public sealed record CatalogItem(string Id, string Name);

/// <summary>Lo que emparejar mira de una línea del ticket.</summary>
public sealed record SuggestionLine(string Key, string RawName);

/// <summary>Qué hacer con un producto del ticket, según lo aprendido.</summary>
public abstract record TicketSuggestion(string Kind);

/// <summary>recordado: ya se emparejó en otro ticket; parecido: casi igual a uno recordado (error del OCR); nombre: se parece al nombre del producto.</summary>
public sealed record ItemSuggestion(string ItemId, string How) : TicketSuggestion("item");

public sealed record IgnoreSuggestion(string How) : TicketSuggestion("ignore");

public sealed record NewSuggestion(string Name, string Frequency) : TicketSuggestion("new");

/// <summary>
/// Qué hacer con cada producto de un ticket (shared/tickets/ticketMatch.ts). La app aprende: al guardar
/// un ticket recuerda, para esa tienda, que «LECHE SEMI HACEND 1L» es la Leche (o que esa línea no se
/// sigue), y el siguiente ticket ya llega emparejado.
/// </summary>
public static class TicketMatcher
{
    private const double AliasSimilarity = 0.85;
    private const double NameSimilarity = 0.8;
    private static readonly Regex Numbers = JsRegex.Create(@"\d+");

    private sealed record Match<T>(T Option, double Score, double Margin);

    /// <summary>bestMatch: el destino (producto) más parecido y cuánto le saca al segundo. Las cifras (tallas, porcentajes, variedades) tienen que ser las mismas.</summary>
    private static Match<T>? BestMatch<T>(string key, IEnumerable<T> options, Func<T, string> keyOf, Func<T, string?> targetOf)
    {
        // Un Map de TypeScript: cada destino conserva el sitio de la primera vez que aparece.
        var order = new List<string>();
        var perTarget = new Dictionary<string, (T Option, double Score)>(StringComparer.Ordinal);
        var digits = DigitsOf(key);
        foreach (var option in options)
        {
            var target = targetOf(option);
            if (target is null) continue;
            var other = keyOf(option);
            if (digits != DigitsOf(other)) continue;
            var score = TicketText.Similarity(key, other);
            if (!perTarget.TryGetValue(target, out var current)) order.Add(target);
            else if (!(score > current.Score)) continue;
            perTarget[target] = (option, score);
        }
        // sort de JavaScript es estable: a igual puntuación, el orden de inserción.
        var ranked = order.Select(target => perTarget[target]).OrderByDescending(entry => entry.Score).ToList();
        if (ranked.Count == 0) return null;
        return new Match<T>(ranked[0].Option, ranked[0].Score, ranked[0].Score - (ranked.Count > 1 ? ranked[1].Score : 0));
    }

    private static string DigitsOf(string key) => string.Join('|', Numbers.Matches(key).Select(match => match.Value));

    /// <summary>
    /// suggestForTicket: una sugerencia por cada clave distinta del ticket, en el orden del Map de
    /// TypeScript (primero las emparejadas, después las nuevas). Las variantes del mismo producto dentro
    /// del ticket se proponen como productos nuevos distintos hasta que la persona las asocie.
    /// </summary>
    public static IReadOnlyList<KeyValuePair<string, TicketSuggestion>> SuggestForTicket(
        IReadOnlyList<SuggestionLine> lines, IReadOnlyList<AliasRecord> aliases, IReadOnlyList<CatalogItem> items)
    {
        var existing = items.Select(item => item.Id).ToHashSet(StringComparer.Ordinal);
        var known = aliases.Where(alias => alias.ItemId is null || existing.Contains(alias.ItemId)).ToList();
        // new Map(...): con claves repetidas vale la última.
        var byKey = new Dictionary<string, AliasRecord>(StringComparer.Ordinal);
        foreach (var alias in known) byKey[alias.Key] = alias;

        // Claves en orden de aparición, con su primer nombre.
        var keys = new List<SuggestionLine>();
        foreach (var line in lines)
            if (!keys.Any(entry => entry.Key == line.Key)) keys.Add(line);

        var result = new List<KeyValuePair<string, TicketSuggestion>>();
        var unmatched = new List<SuggestionLine>();
        foreach (var entry in keys)
        {
            if (byKey.TryGetValue(entry.Key, out var exact))
            {
                result.Add(new(entry.Key, exact.ItemId is null ? new IgnoreSuggestion("recordado") : new ItemSuggestion(exact.ItemId, "recordado")));
                continue;
            }
            var alias = BestMatch(entry.Key, known.Where(a => a.ItemId is not null), a => a.Key, a => a.ItemId);
            if (alias is not null && alias.Score >= AliasSimilarity && alias.Margin >= 0.05 && !string.IsNullOrEmpty(alias.Option.ItemId))
            {
                result.Add(new(entry.Key, new ItemSuggestion(alias.Option.ItemId, "parecido")));
                continue;
            }
            var item = BestMatch(entry.Key, items, i => TicketText.NameKey(i.Name), i => i.Id);
            if (item is not null && item.Score >= NameSimilarity && item.Margin >= 0.05)
            {
                result.Add(new(entry.Key, new ItemSuggestion(item.Option.Id, "nombre")));
                continue;
            }
            unmatched.Add(entry);
        }
        foreach (var entry in unmatched)
            result.Add(new(entry.Key, new NewSuggestion(TicketText.PrettyName(entry.RawName), TicketText.GuessFrequency(entry.RawName))));
        return result;
    }
}
