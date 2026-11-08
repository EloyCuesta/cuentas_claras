using System.Text.Json;
using CuentasClaras.Application.Common;
using CuentasClaras.Domain.Finance;

namespace CuentasClaras.Application.Finance;

/// <summary>
/// Crear o actualizar una categoría (SaveCategory.ts): un solo nivel de subcategorías, del mismo tipo que su principal;
/// una categoría con subcategorías no pasa a ser subcategoría, y una categoría no cambia de gastos a ingresos ni al revés.
/// </summary>
public sealed class SaveCategory(IFinanceStore store, IUnitOfWork unitOfWork)
{
    /// <summary>PUT /api/categories/:id: el cuerpo se valida antes de comparar su id con el de la URL.</summary>
    public Task Handle(string id, JsonElement body)
    {
        var category = FinanceRequests.Valid(FinanceRequests.ValidateCategory(body));
        FinanceRequests.SameId(category.Id, id);
        return Execute(category);
    }

    public Task Execute(Category category) => unitOfWork.Run(async () =>
    {
        if (category.ParentId is not null)
        {
            var parent = await store.GetCategory(category.ParentId);
            if (category.ParentId == category.Id || parent is null)
                throw new AppError("VALIDATION", "La categoría principal no existe.");
            if (parent.ParentId is not null) throw new AppError("VALIDATION", "Solo hay un nivel de subcategorías.");
            if (parent.Type != category.Type)
                throw new AppError("VALIDATION", "La subcategoría debe ser del mismo tipo que su categoría principal.");
            if (await store.CountChildren(category.Id) > 0)
                throw new AppError("VALIDATION", "Una categoría con subcategorías no puede pasar a ser subcategoría.");
        }
        var existing = await store.GetCategory(category.Id);
        if (existing is not null && existing.Type != category.Type)
            throw new AppError("CONFLICT", "No se puede cambiar una categoría de gastos a ingresos ni al revés.");
        await store.UpsertCategory(category);
    }, LockName.Finance);
}

/// <summary>
/// Eliminar una categoría y sus subcategorías (DeleteCategory.ts). Si alguna está en uso, sus movimientos y recurrentes
/// pasan a <c>replacementId</c>, que entonces es obligatoria (409 si falta) y debe ser del mismo tipo y no estar entre las
/// que se borran. Todo se comprueba antes de escribir, y reasignar y borrar van en la misma transacción.
/// </summary>
public sealed class DeleteCategory(IFinanceStore store, IClock clock, IUnitOfWork unitOfWork)
{
    public Task Execute(string id, string? replacementId) => unitOfWork.Run(async () =>
    {
        var all = await store.ListCategories();
        var removed = CategoryRules.WithDescendants(all, id);
        var target = all.FirstOrDefault(category => category.Id == id);
        var replacement = !string.IsNullOrEmpty(replacementId) ? all.FirstOrDefault(category => category.Id == replacementId) : null;
        // Las comprobaciones se hacen antes de escribir nada.
        if (target is not null && !string.IsNullOrEmpty(replacementId)
            && (replacement is null || replacement.Type != target.Type || removed.Contains(replacementId, StringComparer.Ordinal)))
            throw new AppError("VALIDATION", "La categoría de destino no es válida.");

        var affected = await store.CountCategoryUsage(removed);
        if (affected > 0 && string.IsNullOrEmpty(replacementId))
            throw new AppError("CONFLICT", "La categoría tiene movimientos: elige a qué categoría pasarlos.");
        if (affected > 0 && !string.IsNullOrEmpty(replacementId)) await store.ReassignCategories(removed, replacementId, clock.NowIso());
        await store.DeleteCategories(removed);
    }, LockName.Finance);
}
