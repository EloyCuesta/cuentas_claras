using System.Text.Json;
using CuentasClaras.Application.Common;
using CuentasClaras.Domain.Common;
using CuentasClaras.Domain.Pantry;

namespace CuentasClaras.Application.Pantry;

/// <summary>Añadir una persona (CreatePerson.ts): el servidor pone el id y la fecha.</summary>
public sealed class CreatePerson(IPantryStore store, IClock clock, IIdGenerator ids, IUnitOfWork unitOfWork)
{
    /// <summary>POST /api/despensa/personas: { name }, sin espacios a los lados y de 1 a 40 caracteres.</summary>
    public Task<PantryPersonView> Handle(JsonElement body) => Execute(PantryRequests.Valid(PantryRequests.ValidatePerson(body)));

    public Task<PantryPersonView> Execute(string name) => unitOfWork.Run(async () =>
    {
        var person = new PantryPerson(ids.NewId(), name, clock.NowIso());
        await store.InsertPerson(person);
        return PantryPersonView.From(person);
    });
}

/// <summary>Cambiar el nombre de una persona (RenamePerson.ts).</summary>
public sealed class RenamePerson(IPantryStore store, IUnitOfWork unitOfWork)
{
    /// <summary>PUT /api/despensa/personas/:id: el cuerpo se valida antes de buscar la persona.</summary>
    public Task<PantryPersonView> Handle(string id, JsonElement body) => Execute(id, PantryRequests.Valid(PantryRequests.ValidatePerson(body)));

    public Task<PantryPersonView> Execute(string id, string name) => unitOfWork.Run(async () =>
    {
        await PantryRequire.Person(store, id);
        await store.RenamePerson(id, name);
        return PantryPersonView.From(await PantryRequire.Person(store, id));
    });
}

/// <summary>Borrar una persona (DeletePerson.ts): no mientras tenga productos (409), y la base de datos también lo impide.</summary>
public sealed class DeletePerson(IPantryStore store, IUnitOfWork unitOfWork)
{
    public Task Execute(string id) => unitOfWork.Run(async () =>
    {
        var person = await PantryRequire.Person(store, id);
        var count = await store.CountItemsOf(id);
        if (count > 0)
            throw new AppError("CONFLICT",
                $"«{person.Name}» tiene {(count == 1 ? "un producto" : $"{JsNumber.ToString(count)} productos")}. Pásalos a otra persona o a «Compartido», o elimínalos, antes de borrarla.");
        await store.DeletePerson(id);
    });
}
