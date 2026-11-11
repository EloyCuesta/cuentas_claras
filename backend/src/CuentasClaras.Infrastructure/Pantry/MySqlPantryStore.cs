using System.Globalization;
using CuentasClaras.Application.Pantry;
using CuentasClaras.Domain.Common;
using CuentasClaras.Domain.Pantry;
using CuentasClaras.Infrastructure.Common.MySql;
using MySqlConnector;

namespace CuentasClaras.Infrastructure.Pantry;

/// <summary>
/// La despensa en MySQL (pantry_people y pantry_items), con el SQL de
/// server/modules/pantry/adapters/mysql/MysqlPantryRepository.ts. Solo SQL y conversión de filas: las comprobaciones,
/// los mensajes, las transacciones y cuándo se bloquea están en los casos de uso. Todo con parámetros, también IN (...).
/// quantity y target son DECIMAL(10,3): se leen y se escriben como el texto decimal exacto, sin restos binarios.
/// </summary>
public sealed class MySqlPantryStore(MySqlDatabase database) : IPantryStore
{
    private const string PersonColumns = "id, name, created_at";
    private const string ItemColumns =
        "id, name, owner_id, unit, tracking, quantity, target, frequency, price_cents, notes, version, created_at, updated_at";

    private const string InsertItemSql = $"INSERT INTO pantry_items ({ItemColumns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)";
    private const string UpdateItemSql =
        "UPDATE pantry_items SET name = ?, owner_id = ?, unit = ?, tracking = ?, quantity = ?, target = ?, frequency = ?, price_cents = ?, notes = ?, "
        + "version = version + 1, updated_at = ? WHERE id = ?";

    /// <summary>"?, ?, ?" con tantos parámetros como valores (para IN (...)).</summary>
    private static string Placeholders(int count) => string.Join(", ", Enumerable.Repeat("?", count));

    /// <summary>Una cantidad para DECIMAL(10,3): el texto que escribiría JavaScript, como decimal exacto.</summary>
    private static decimal Exact(double value) => decimal.Parse(JsNumber.ToString(value), NumberStyles.Float, CultureInfo.InvariantCulture);

    /// <summary>Un DECIMAL como número de JavaScript: el doble más cercano a su texto (parseFloat, como mysql2 con decimalNumbers).</summary>
    private static double Number(MySqlDataReader row, string column) =>
        double.Parse(MySqlRead.Decimal(row, column).ToString(CultureInfo.InvariantCulture), NumberStyles.Float, CultureInfo.InvariantCulture);

    private static PantryPerson ToPerson(MySqlDataReader row) =>
        new(MySqlRead.Text(row, "id"), MySqlRead.Text(row, "name"), MySqlRead.Text(row, "created_at"));

    private static PantryItem ToItem(MySqlDataReader row) => new(
        MySqlRead.Text(row, "id"), MySqlRead.Text(row, "name"), MySqlRead.NullableText(row, "owner_id"), MySqlRead.Text(row, "unit"),
        MySqlRead.Text(row, "tracking"), Number(row, "quantity"), Number(row, "target"), MySqlRead.Text(row, "frequency"),
        MySqlRead.NullableInteger(row, "price_cents"), MySqlRead.Text(row, "notes"), MySqlRead.Integer(row, "version"),
        MySqlRead.Text(row, "created_at"), MySqlRead.Text(row, "updated_at"));

    /// <summary>Los campos que se escriben de un producto, en el orden de ItemColumns (de name a notes) y de UpdateItemSql.</summary>
    private static object?[] InputValues(PantryItemInput input) =>
        [input.Name, input.OwnerId, input.Unit, input.Tracking, Exact(input.Quantity), Exact(input.Target), input.Frequency, input.PriceCents, input.Notes];

    // Personas -------------------------------------------------------------------------------------------------------

    public async Task<IReadOnlyList<PantryPerson>> ListPeople() =>
        await database.Rows($"SELECT {PersonColumns} FROM pantry_people", [], ToPerson);

    public async Task<PantryPerson?> GetPerson(string id) =>
        (await database.Rows($"SELECT {PersonColumns} FROM pantry_people WHERE id = ?", [id], ToPerson)).FirstOrDefault();

    public Task InsertPerson(PantryPerson person) =>
        database.Run("INSERT INTO pantry_people (id, name, created_at) VALUES (?, ?, ?)", [person.Id, person.Name, person.CreatedAt]);

    public Task RenamePerson(string id, string name) => database.Run("UPDATE pantry_people SET name = ? WHERE id = ?", [name, id]);

    public Task DeletePerson(string id) => database.Run("DELETE FROM pantry_people WHERE id = ?", [id]);

    public async Task<long> CountItemsOf(string personId) =>
        (await database.Rows("SELECT COUNT(*) AS n FROM pantry_items WHERE owner_id = ?", [personId], row => MySqlRead.Integer(row, "n"))).Single();

    // Productos ------------------------------------------------------------------------------------------------------

    public async Task LockItems(IReadOnlyCollection<string> ids)
    {
        if (ids.Count == 0) return;
        // InnoDB bloquea las filas según recorre la clave primaria: en orden de id, también con IN (...).
        await database.Rows($"SELECT id FROM pantry_items WHERE id IN ({Placeholders(ids.Count)}) ORDER BY id FOR UPDATE",
            [.. ids], row => MySqlRead.Text(row, "id"));
    }

    public async Task<IReadOnlyList<PantryItem>> ListItems() => await database.Rows($"SELECT {ItemColumns} FROM pantry_items", [], ToItem);

    public async Task<PantryItem?> GetItem(string id) =>
        (await database.Rows($"SELECT {ItemColumns} FROM pantry_items WHERE id = ?", [id], ToItem)).FirstOrDefault();

    public Task InsertItem(string id, PantryItemInput input, string now) => database.Run(InsertItemSql, [id, .. InputValues(input), now, now]);

    public Task UpdateItem(string id, PantryItemInput input, string now) => database.Run(UpdateItemSql, [.. InputValues(input), now, id]);

    public Task DeleteItem(string id) => database.Run("DELETE FROM pantry_items WHERE id = ?", [id]);
}
