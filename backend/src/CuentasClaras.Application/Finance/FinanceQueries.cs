using System.Text.Json;
using CuentasClaras.Application.Common;
using CuentasClaras.Domain.Finance;
using static CuentasClaras.Application.Common.JsonInput;

namespace CuentasClaras.Application.Finance;

/// <summary>Lecturas de las finanzas (server/modules/finance/application/queries.ts).</summary>
public sealed class FinanceQueries(IFinanceStore store, IUnitOfWork unitOfWork)
{
    /// <summary>
    /// Todas las categorías, movimientos y recurrentes, leídos en una transacción sin bloqueo: con REPEATABLE READ, las
    /// lecturas ven la misma foto coherente.
    /// </summary>
    public async Task<FinanceDataView> LoadAll() => FinanceDataView.From(await unitOfWork.Run(store.ReadAll));

    /// <summary>GET /api/meta/:key, sin transacción: una clave desconocida es un 404.</summary>
    public async Task<MetaView> GetMeta(string key) => new(await store.GetMeta(Meta.RequireKey(key)));
}

/// <summary>Los metadatos de la API: las claves conocidas y el valor que admite PUT.</summary>
public static class Meta
{
    /// <summary>readKey de meta.ts: solo lastBackupAt y browserImportAt.</summary>
    public static string RequireKey(string key) =>
        MetaKeys.All.Contains(key, StringComparer.Ordinal) ? key : throw new AppError("NOT_FOUND", $"No existe el dato «{key}».");

    /// <summary>El cuerpo de PUT /api/meta/:key: { value } con un texto de hasta 100 caracteres.</summary>
    public static string ReadValue(JsonElement body)
    {
        var value = Get(FinanceRequests.ReadBody(body), "value");
        if (!IsString(value) || Text(value).Length > 100)
            throw new AppError("VALIDATION", "El campo «value» debe ser un texto de 100 caracteres como máximo.");
        return Text(value);
    }
}

/// <summary>Guardar un dato auxiliar (la fecha de la última copia descargada), con el bloqueo «finance».</summary>
public sealed class SetMeta(IFinanceStore store, IUnitOfWork unitOfWork)
{
    /// <summary>PUT /api/meta/:key: la clave primero (404) y después el cuerpo (400).</summary>
    public Task Handle(string key, JsonElement body)
    {
        var known = Meta.RequireKey(key);
        var value = Meta.ReadValue(body);
        return Execute(known, value);
    }

    public Task Execute(string key, string value) => unitOfWork.Run(() => store.SetMeta(key, value), LockName.Finance);
}
