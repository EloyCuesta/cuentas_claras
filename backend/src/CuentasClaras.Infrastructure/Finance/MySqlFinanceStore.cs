using CuentasClaras.Application.Finance;
using CuentasClaras.Domain.Finance;
using CuentasClaras.Infrastructure.Common.MySql;
using MySqlConnector;

namespace CuentasClaras.Infrastructure.Finance;

/// <summary>
/// Las finanzas en MySQL (categories, movements, recurring_rules, recurring_excluded_dates y meta), con el SQL de
/// server/modules/finance/adapters/mysql/MysqlFinanceStore.ts. Solo SQL y conversión de filas: las reglas, las
/// transacciones y el bloqueo «finance» están en los casos de uso. Todo con parámetros, también las listas IN (...);
/// «key» va entre comillas invertidas.
/// </summary>
public sealed class MySqlFinanceStore(MySqlDatabase database) : IFinanceStore
{
    private const string CategoryColumns = "id, name, type, parent_id, order_index, budget_cents";
    private const string MovementColumns =
        "id, concept, amount_cents, type, category_id, status, paid_date, due_date, notes, recurring_id, occurrence_date, installment_number, created_at, updated_at";
    private const string RuleColumns = "id, concept, amount_cents, type, category_id, frequency, start_date, end_date, installments, notes, created_at, updated_at";

    /// <summary>INSERT … AS new ON DUPLICATE KEY UPDATE de todas las columnas menos el id: solo para tablas sin otra clave única.</summary>
    private static string UpsertSql(string table, string columns)
    {
        var names = columns.Split(", ");
        return $"INSERT INTO {table} ({columns}) VALUES ({Placeholders(names.Length)}) AS new ON DUPLICATE KEY UPDATE "
            + string.Join(", ", names.Where(name => name != "id").Select(name => $"{name} = new.{name}"));
    }

    private static readonly string UpsertCategorySql = UpsertSql("categories", CategoryColumns);

    /// <summary>"?, ?, ?" con tantos parámetros como valores (para VALUES e IN (...)).</summary>
    private static string Placeholders(int count) => string.Join(", ", Enumerable.Repeat("?", count));

    private static Category ToCategory(MySqlDataReader row) => new(
        MySqlRead.Text(row, "id"), MySqlRead.Text(row, "name"), MySqlRead.Text(row, "type"), MySqlRead.NullableText(row, "parent_id"),
        row.GetDouble(row.GetOrdinal("order_index")), MySqlRead.NullableInteger(row, "budget_cents"));

    private static Movement ToMovement(MySqlDataReader row) => new(
        MySqlRead.Text(row, "id"), MySqlRead.Text(row, "concept"), MySqlRead.Integer(row, "amount_cents"), MySqlRead.Text(row, "type"),
        MySqlRead.Text(row, "category_id"), MySqlRead.Text(row, "status"), MySqlRead.NullableDate(row, "paid_date"),
        MySqlRead.NullableDate(row, "due_date"), MySqlRead.Text(row, "notes"), MySqlRead.NullableText(row, "recurring_id"),
        MySqlRead.NullableDate(row, "occurrence_date"), (int?)MySqlRead.NullableInteger(row, "installment_number"),
        MySqlRead.Text(row, "created_at"), MySqlRead.Text(row, "updated_at"));

    private static object?[] CategoryValues(Category category) =>
        [category.Id, category.Name, category.Type, category.ParentId, category.Order, category.BudgetCents];

    /// <summary>Fechas excluidas de cada recurrente, en orden.</summary>
    private async Task<Dictionary<string, List<string>>> ExcludedByRule()
    {
        var excluded = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        var rows = await database.Rows("SELECT rule_id, date FROM recurring_excluded_dates ORDER BY rule_id, date", [],
            row => (Rule: MySqlRead.Text(row, "rule_id"), Date: MySqlRead.Date(row, "date")));
        foreach (var (rule, date) in rows)
        {
            if (!excluded.TryGetValue(rule, out var dates)) excluded[rule] = dates = [];
            dates.Add(date);
        }
        return excluded;
    }

    private async Task<IReadOnlyList<RecurringRule>> AllRules()
    {
        var excluded = await ExcludedByRule();
        return await database.Rows($"SELECT {RuleColumns} FROM recurring_rules ORDER BY id", [], row =>
        {
            var id = MySqlRead.Text(row, "id");
            return new RecurringRule(
                id, MySqlRead.Text(row, "concept"), MySqlRead.Integer(row, "amount_cents"), MySqlRead.Text(row, "type"),
                MySqlRead.Text(row, "category_id"), MySqlRead.Text(row, "frequency"), MySqlRead.Date(row, "start_date"),
                MySqlRead.NullableDate(row, "end_date"), (int?)MySqlRead.NullableInteger(row, "installments"), MySqlRead.Text(row, "notes"),
                excluded.TryGetValue(id, out var dates) ? dates : [], MySqlRead.Text(row, "created_at"), MySqlRead.Text(row, "updated_at"));
        });
    }

    public async Task<FinanceData> ReadAll()
    {
        var categories = await ListCategories();
        var movements = await database.Rows($"SELECT {MovementColumns} FROM movements ORDER BY id", [], ToMovement);
        var recurring = await AllRules();
        return new FinanceData(categories, movements, recurring);
    }

    /* Categorías ------------------------------------------------------------ */

    public async Task<IReadOnlyList<Category>> ListCategories() =>
        await database.Rows($"SELECT {CategoryColumns} FROM categories ORDER BY id", [], ToCategory);

    public async Task<Category?> GetCategory(string id) =>
        (await database.Rows($"SELECT {CategoryColumns} FROM categories WHERE id = ?", [id], ToCategory)).FirstOrDefault();

    public async Task<long> CountChildren(string categoryId) =>
        (await database.Rows("SELECT COUNT(*) AS n FROM categories WHERE parent_id = ?", [categoryId], row => MySqlRead.Integer(row, "n")))[0];

    public Task UpsertCategory(Category category) => database.Run(UpsertCategorySql, CategoryValues(category));

    public async Task<long> CountCategoryUsage(IReadOnlyList<string> categoryIds)
    {
        if (categoryIds.Count == 0) return 0;
        var inList = Placeholders(categoryIds.Count);
        long total = 0;
        foreach (var table in new[] { "movements", "recurring_rules" })
            total += (await database.Rows($"SELECT COUNT(*) AS n FROM {table} WHERE category_id IN ({inList})", [.. categoryIds],
                row => MySqlRead.Integer(row, "n")))[0];
        return total;
    }

    public async Task ReassignCategories(IReadOnlyList<string> categoryIds, string replacementId, string now)
    {
        if (categoryIds.Count == 0) return;
        var inList = Placeholders(categoryIds.Count);
        foreach (var table in new[] { "movements", "recurring_rules" })
            await database.Run($"UPDATE {table} SET category_id = ?, updated_at = ? WHERE category_id IN ({inList})",
                [replacementId, now, .. categoryIds]);
    }

    public async Task DeleteCategories(IReadOnlyList<string> categoryIds)
    {
        if (categoryIds.Count == 0) return;
        await database.Run($"DELETE FROM categories WHERE id IN ({Placeholders(categoryIds.Count)})", [.. categoryIds]);
    }

    /* Metadatos ------------------------------------------------------------- */

    public async Task<string?> GetMeta(string key) =>
        (await database.Rows("SELECT value FROM meta WHERE `key` = ?", [key], row => MySqlRead.Text(row, "value"))).FirstOrDefault();

    public Task SetMeta(string key, string value) =>
        database.Run("INSERT INTO meta (`key`, value) VALUES (?, ?) AS new ON DUPLICATE KEY UPDATE value = new.value", [key, value]);
}
