using CuentasClaras.Domain.Finance;

namespace CuentasClaras.Application.Finance;

/// <summary>
/// Persistencia de las finanzas (server/modules/finance/application/ports.ts): categorías, movimientos, recurrentes con
/// sus fechas excluidas y metadatos. Los casos de uso la llaman dentro de IUnitOfWork.Run, con el bloqueo «finance» si
/// escriben; no abre transacciones propias.
/// </summary>
public interface IFinanceStore
{
    /// <summary>Todo, ordenado por id; cada recurrente con sus fechas excluidas.</summary>
    Task<FinanceData> ReadAll();
    /// <summary>Borra las finanzas y escribe <paramref name="data"/>, sin transacción propia (la abre quien llama).</summary>
    Task WriteAll(FinanceData data);

    Task<IReadOnlyList<Category>> ListCategories();
    Task<Category?> GetCategory(string id);
    Task<long> CountChildren(string categoryId);
    /// <summary>Crea o actualiza (mismo id).</summary>
    Task UpsertCategory(Category category);
    /// <summary>Movimientos más recurrentes que usan alguna de esas categorías.</summary>
    Task<long> CountCategoryUsage(IReadOnlyList<string> categoryIds);
    /// <summary>Pasa a otra categoría los movimientos y recurrentes de esas categorías.</summary>
    Task ReassignCategories(IReadOnlyList<string> categoryIds, string replacementId, string now);
    Task DeleteCategories(IReadOnlyList<string> categoryIds);

    Task<Movement?> GetMovement(string id);
    /// <summary>Movimientos de un recurrente (sus vencimientos), por id.</summary>
    Task<IReadOnlyList<Movement>> MovementsOfRule(string ruleId);
    /// <summary>Crea un vencimiento. Lanza AppError CONFLICT si ya existe (índice único recurrente + fecha).</summary>
    Task InsertOccurrence(Movement movement);
    /// <summary>Crea o actualiza (mismo id). Lanza AppError CONFLICT si choca con un vencimiento que ya existe.</summary>
    Task UpsertMovement(Movement movement);
    Task DeleteMovement(string id);
    Task DeletePendingOfRule(string ruleId);

    /// <summary>Los recurrentes, por id, cada uno con sus fechas excluidas.</summary>
    Task<IReadOnlyList<RecurringRule>> ListRules();
    Task<bool> HasRule(string id);
    /// <summary>Crea o actualiza el recurrente, sin tocar sus fechas excluidas.</summary>
    Task UpsertRule(RecurringRule rule);
    /// <summary>Borra el recurrente; sus fechas excluidas se van con él (en cascada).</summary>
    Task DeleteRule(string id);
    /// <summary>Si ya estaba, no hace nada.</summary>
    Task AddExcludedDate(string ruleId, string date);
    Task ClearExcludedDates(string ruleId);

    Task<string?> GetMeta(string key);
    Task SetMeta(string key, string value);
}
