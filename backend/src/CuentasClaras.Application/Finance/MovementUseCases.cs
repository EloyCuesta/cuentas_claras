using System.Text.Json;
using CuentasClaras.Application.Common;
using CuentasClaras.Domain.Finance;

namespace CuentasClaras.Application.Finance;

/// <summary>Un movimiento o un recurrente usa una categoría que existe y es de su mismo tipo (requireCategory.ts).</summary>
internal static class CategoryCheck
{
    private static string TypeLabel(string type) => type == "gasto" ? "gastos" : "ingresos";

    /// <summary><paramref name="label"/> empieza el mensaje: «El movimiento», «El recurrente».</summary>
    public static async Task Require(IFinanceStore store, string categoryId, string type, string label)
    {
        var category = await store.GetCategory(categoryId) ?? throw new AppError("VALIDATION", $"{label} usa una categoría que no existe.");
        if (category.Type != type)
            throw new AppError("VALIDATION", $"{label} es de {TypeLabel(type)}, pero su categoría es de {TypeLabel(category.Type)}.");
    }
}

/// <summary>
/// Crear o actualizar un movimiento (SaveMovement.ts): mismo id, mismo movimiento. Marcar como pagado es esto mismo:
/// cambia el estado y la fecha de pago, no crea otro. 409 si se convertiría en un vencimiento que ya existe.
/// </summary>
public sealed class SaveMovement(IFinanceStore store, IUnitOfWork unitOfWork)
{
    /// <summary>PUT /api/movements/:id: el cuerpo se valida antes de comparar su id con el de la URL.</summary>
    public Task Handle(string id, JsonElement body)
    {
        var movement = FinanceRequests.Valid(FinanceRequests.ValidateMovement(body));
        FinanceRequests.SameId(movement.Id, id);
        return Execute(movement);
    }

    public Task Execute(Movement movement) => unitOfWork.Run(async () =>
    {
        await CategoryCheck.Require(store, movement.CategoryId, movement.Type, "El movimiento");
        await store.UpsertMovement(movement);
    }, LockName.Finance);
}

/// <summary>
/// Eliminar un movimiento (DeleteMovement.ts). Si era un vencimiento de un recurrente que sigue existiendo, se recuerda
/// su fecha para no volver a crearlo. Si no existe, no hace nada.
/// </summary>
public sealed class DeleteMovement(IFinanceStore store, IUnitOfWork unitOfWork)
{
    public Task Execute(string id) => unitOfWork.Run(async () =>
    {
        var movement = await store.GetMovement(id);
        if (movement is null) return;
        if (movement.RecurringId is { } ruleId && movement.OccurrenceDate is { } date && await store.HasRule(ruleId))
            await store.AddExcludedDate(ruleId, date);
        await store.DeleteMovement(id);
    }, LockName.Finance);
}

/// <summary>
/// Restaurar una copia de seguridad (RestoreBackup.ts): sustituye todas las finanzas, entero o nada. La copia llega
/// validada con las reglas de la web (validateFinanceData); si aun así algo no encaja (una clave foránea), no cambia nada.
/// No toca la despensa ni los metadatos.
/// </summary>
public sealed class RestoreBackup(IFinanceStore store, IUnitOfWork unitOfWork)
{
    /// <summary>PUT /api/data: el cuerpo son los datos tal cual (no el archivo de copia).</summary>
    public Task Handle(JsonElement body) => Execute(FinanceRequests.Valid(FinanceRequests.ValidateFinanceData(body)));

    public Task Execute(FinanceData data) => unitOfWork.Run(() => store.WriteAll(data), LockName.Finance);
}
