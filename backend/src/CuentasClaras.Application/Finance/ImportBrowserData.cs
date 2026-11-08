using System.Text.Json;
using CuentasClaras.Application.Common;
using CuentasClaras.Domain.Finance;
using static CuentasClaras.Application.Common.JsonInput;

namespace CuentasClaras.Application.Finance;

/// <summary>POST /api/import: { categories, movements, recurring } importados.</summary>
public sealed record ImportSummaryView(int Categories, int Movements, int Recurring);

/// <summary>
/// Importar los datos que había en el navegador (ImportBrowserData.ts; versiones anteriores, con IndexedDB), solo si
/// aquí todavía no hay nada del usuario: así nunca se mezclan ni se duplican (409 si ya hay datos). Conserva la fecha de
/// la última copia, si no había otra, y anota cuándo se importó. No es el importador SQLite→MySQL de tools/importer.
/// </summary>
public sealed class ImportBrowserData(IFinanceStore store, IClock clock, IUnitOfWork unitOfWork)
{
    /// <summary>{ data, lastBackupAt }: los datos se validan enteros y lastBackupAt es un texto, null o no está.</summary>
    public Task<ImportSummaryView> Handle(JsonElement body)
    {
        var request = FinanceRequests.ReadBody(body);
        var data = FinanceRequests.Valid(FinanceRequests.ValidateFinanceData(Get(request, "data")));
        var lastBackupAt = Get(request, "lastBackupAt");
        if (!IsNullish(lastBackupAt) && !IsString(lastBackupAt))
            throw new AppError("VALIDATION", "El campo «lastBackupAt» debe ser texto.");
        return Execute(data, IsString(lastBackupAt) ? Text(lastBackupAt) : null);
    }

    public Task<ImportSummaryView> Execute(FinanceData data, string? lastBackupAt) => unitOfWork.Run(async () =>
    {
        if (BackupRules.HasUserData(await store.ReadAll()))
            throw new AppError("CONFLICT", "La base de datos ya tiene datos, así que no se han importado los del navegador.");
        await store.WriteAll(data);
        if (!string.IsNullOrEmpty(lastBackupAt) && string.IsNullOrEmpty(await store.GetMeta("lastBackupAt")))
            await store.SetMeta("lastBackupAt", lastBackupAt);
        await store.SetMeta("browserImportAt", clock.NowIso());
        return new ImportSummaryView(data.Categories.Count, data.Movements.Count, data.Recurring.Count);
    }, LockName.Finance);
}
