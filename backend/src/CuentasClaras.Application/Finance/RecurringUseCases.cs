using System.Text.Json;
using CuentasClaras.Application.Common;
using CuentasClaras.Domain.Finance;
using static CuentasClaras.Application.Common.JsonInput;

namespace CuentasClaras.Application.Finance;

/// <summary>
/// Guardar un recurrente y rehacer sus vencimientos pendientes hasta el horizonte (SaveRecurring.ts); los pagados no se
/// tocan. Con markPaidBefore, los vencimientos anteriores a esa fecha se crean ya pagados, en su fecha: un préstamo
/// empezado. Con el bloqueo «finance», generar a la vez desde otra pestaña espera y no duplica (ni da 409). Devuelve
/// cuántos vencimientos ha creado.
/// </summary>
public sealed class SaveRecurring(IFinanceStore store, IClock clock, IIdGenerator ids, IUnitOfWork unitOfWork)
{
    /// <summary>PUT /api/recurring/:id con { rule, horizon, markPaidBefore }: el horizonte lo calcula la web con su fecha de hoy.</summary>
    public Task<int> Handle(string id, JsonElement body)
    {
        var request = FinanceRequests.ReadBody(body);
        var rule = FinanceRequests.Valid(FinanceRequests.ValidateRecurring(Get(request, "rule")));
        FinanceRequests.SameId(rule.Id, id);
        var horizon = FinanceRequests.ReadDate(Get(request, "horizon"), "horizon");
        var markPaidBefore = FinanceRequests.ReadOptionalDate(Get(request, "markPaidBefore"), "markPaidBefore");
        return Execute(rule, horizon, markPaidBefore);
    }

    public Task<int> Execute(RecurringRule rule, string horizon, string? markPaidBefore) => unitOfWork.Run(async () =>
    {
        await CategoryCheck.Require(store, rule.CategoryId, rule.Type, "El recurrente");
        await store.UpsertRule(rule);
        await store.ClearExcludedDates(rule.Id);
        foreach (var date in rule.ExcludedDates) await store.AddExcludedDate(rule.Id, date);

        // Los vencimientos pendientes se rehacen con los datos nuevos; los pagados se conservan.
        var kept = (await store.MovementsOfRule(rule.Id)).Where(movement => movement.Status != "pendiente").ToList();
        await store.DeletePendingOfRule(rule.Id);

        var planned = RecurringRules.PlanOccurrences(rule, kept, horizon, clock.NowIso(), ids.NewId);
        foreach (var movement in planned)
        {
            // Un préstamo empezado: lo anterior a markPaidBefore se crea ya pagado, en su fecha.
            var paidAlready = !string.IsNullOrEmpty(markPaidBefore) && string.CompareOrdinal(movement.OccurrenceDate, markPaidBefore) < 0;
            await store.InsertOccurrence(paidAlready ? movement with { Status = "realizado", PaidDate = movement.OccurrenceDate } : movement);
        }
        return planned.Count;
    }, LockName.Finance);
}

/// <summary>
/// Eliminar un recurrente y sus vencimientos pendientes (DeleteRecurring.ts). Los pagados se conservan, con su
/// recurringId aunque el recurrente ya no exista (por eso movements.recurring_id no es clave foránea).
/// </summary>
public sealed class DeleteRecurring(IFinanceStore store, IUnitOfWork unitOfWork)
{
    public Task Execute(string id) => unitOfWork.Run(async () =>
    {
        // Sus fechas excluidas se borran en cascada; los vencimientos pagados se conservan.
        await store.DeleteRule(id);
        await store.DeletePendingOfRule(id);
    }, LockName.Finance);
}

/// <summary>
/// Crear los vencimientos que falten hasta el horizonte (GenerateOccurrences.ts), que calcula la web con su fecha de hoy.
/// Nunca duplica: lo ya creado y las fechas excluidas se saltan. Si dos pestañas generan a la vez, el bloqueo «finance»
/// las pone en serie y la segunda ve lo que creó la primera (crea 0, sin 409); el índice único (recurrente + fecha) lo
/// impide además en la base de datos. Devuelve cuántos ha creado.
/// </summary>
public sealed class GenerateOccurrences(IFinanceStore store, IClock clock, IIdGenerator ids, IUnitOfWork unitOfWork)
{
    /// <summary>POST /api/occurrences/generate con { horizon }.</summary>
    public Task<int> Handle(JsonElement body) => Execute(FinanceRequests.ReadDate(Get(FinanceRequests.ReadBody(body), "horizon"), "horizon"));

    public Task<int> Execute(string horizon) => unitOfWork.Run(async () =>
    {
        var now = clock.NowIso();
        var created = 0;
        foreach (var rule in await store.ListRules())
        {
            var own = await store.MovementsOfRule(rule.Id);
            foreach (var movement in RecurringRules.PlanOccurrences(rule, own, horizon, now, ids.NewId))
            {
                await store.InsertOccurrence(movement);
                created++;
            }
        }
        return created;
    }, LockName.Finance);
}
