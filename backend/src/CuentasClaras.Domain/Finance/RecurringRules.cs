using CuentasClaras.Domain.Common;

namespace CuentasClaras.Domain.Finance;

/// <summary>
/// Pagos recurrentes y cuotas (shared/finance/recurring.ts). Cada vencimiento es un movimiento pendiente normal, marcado
/// con recurringId + occurrenceDate; esa pareja es única. Las fechas se calculan siempre desde la de inicio, así que un
/// día 31 vuelve a ser 31 en los meses que lo tienen.
/// </summary>
public static class RecurringRules
{
    /// <summary>Tope de seguridad: 100 años de cuotas mensuales (MAX_OCCURRENCES).</summary>
    public const int MaxOccurrences = 1200;

    /// <summary>Prefijo del id de una proyección («proyeccion:&lt;recurrente&gt;:&lt;fecha&gt;»): no está guardada.</summary>
    public const string ProjectionPrefix = "proyeccion:";

    /// <summary>FREQUENCY_MONTHS.</summary>
    public static int FrequencyMonths(string frequency) => frequency switch
    {
        "mensual" => 1,
        "trimestral" => 3,
        "semestral" => 6,
        "anual" => 12,
        _ => throw new ArgumentOutOfRangeException(nameof(frequency), frequency, "Frecuencia desconocida."),
    };

    /// <summary>generationHorizon: hasta qué fecha se crean vencimientos, el final del mes siguiente a hoy.</summary>
    public static string GenerationHorizon(string today) => IsoDates.EndOfNextMonth(today);

    /// <summary>
    /// scheduleDates: las fechas programadas hasta <paramref name="until"/> (incluida), respetando la fecha de fin y el
    /// número de cuotas.
    /// </summary>
    public static IReadOnlyList<string> ScheduleDates(string startDate, string? endDate, int? installments, string frequency, string until)
    {
        var step = FrequencyMonths(frequency);
        var dates = new List<string>();
        var limit = Math.Min(installments ?? MaxOccurrences, MaxOccurrences);
        for (var index = 0; index < limit; index++)
        {
            var date = IsoDates.AddMonthsClamped(startDate, index * step);
            if (endDate is not null && string.CompareOrdinal(date, endDate) > 0) break;
            if (string.CompareOrdinal(date, until) > 0) break;
            dates.Add(date);
        }
        return dates;
    }

    public static IReadOnlyList<string> ScheduleDates(RecurringRule rule, string until) =>
        ScheduleDates(rule.StartDate, rule.EndDate, rule.Installments, rule.Frequency, until);

    private static Movement OccurrenceFromRule(RecurringRule rule, string date, int index, string now, string id) => new(
        id, rule.Concept, rule.AmountCents, rule.Type, rule.CategoryId, "pendiente", null, date, rule.Notes, rule.Id, date,
        rule.Installments is not null ? index + 1 : null, now, now);

    /// <summary>
    /// planOccurrences: los vencimientos que faltan por crear para una regla, sin tocar nada. <paramref name="existing"/>
    /// son los movimientos ya guardados; las fechas ya creadas y las excluidas se saltan. Los ids se piden en orden de fecha
    /// y solo para lo que se planifica.
    /// </summary>
    public static IReadOnlyList<Movement> PlanOccurrences(RecurringRule rule, IReadOnlyList<Movement> existing, string horizon, string now, Func<string> newId)
    {
        var taken = new HashSet<string>(StringComparer.Ordinal);
        foreach (var movement in existing)
            if (movement.RecurringId == rule.Id && !string.IsNullOrEmpty(movement.OccurrenceDate)) taken.Add(movement.OccurrenceDate);
        var excluded = new HashSet<string>(rule.ExcludedDates, StringComparer.Ordinal);
        var planned = new List<Movement>();
        var dates = ScheduleDates(rule, horizon);
        for (var index = 0; index < dates.Count; index++)
        {
            var date = dates[index];
            if (taken.Contains(date) || excluded.Contains(date)) continue;
            planned.Add(OccurrenceFromRule(rule, date, index, now, newId()));
        }
        return planned;
    }

    /// <summary>
    /// projectOccurrences: los vencimientos que tendrán los recurrentes después del horizonte, hasta <paramref name="until"/>
    /// (incluida). Se calculan al vuelo y nunca se guardan; su id es «proyeccion:&lt;recurrente&gt;:&lt;fecha&gt;» y su
    /// instante, el updatedAt de la regla.
    /// </summary>
    public static IReadOnlyList<Movement> ProjectOccurrences(IReadOnlyList<RecurringRule> rules, IReadOnlyList<Movement> movements, string horizon, string until)
    {
        if (string.CompareOrdinal(until, horizon) <= 0) return [];
        var projected = new List<Movement>();
        foreach (var rule in rules)
            foreach (var movement in PlanOccurrences(rule, movements, until, rule.UpdatedAt, () => ""))
                if (string.CompareOrdinal(movement.OccurrenceDate, horizon) > 0)
                    projected.Add(movement with { Id = $"{ProjectionPrefix}{rule.Id}:{movement.OccurrenceDate}" });
        return projected;
    }

    /// <summary>isProjected: el movimiento es una proyección de un recurrente (no está guardado).</summary>
    public static bool IsProjected(Movement movement) => movement.Id.StartsWith(ProjectionPrefix, StringComparison.Ordinal);
}
