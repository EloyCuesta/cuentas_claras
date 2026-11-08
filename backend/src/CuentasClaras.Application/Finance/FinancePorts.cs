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

    Task<string?> GetMeta(string key);
    Task SetMeta(string key, string value);
}
