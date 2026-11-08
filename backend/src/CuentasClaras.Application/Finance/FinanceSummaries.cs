using System.Text.Json.Serialization;
using CuentasClaras.Domain.Common;
using CuentasClaras.Domain.Finance;

namespace CuentasClaras.Application.Finance;

/// <summary>Un mes ({ kind: 'mensual', year, month }) o un año ({ kind: 'anual', year }), como Period de shared/finance/period.ts.</summary>
public sealed record PeriodView(string Kind, int Year, [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] int? Month);

/// <summary>PeriodSummary: lo real (pagado) y lo previsto (pendiente, también lo proyectado) del periodo.</summary>
public sealed record PeriodSummaryView(
    long IncomePaid, long ExpensePaid, long RealDifference, long IncomePending, long ExpensePending, int PendingIncomeCount,
    int PendingExpenseCount, int ProjectedIncomeCount, int ProjectedExpenseCount, long Forecast, int MovementCount);

public sealed record CategoryTotalView(string CategoryId, string Name, long PaidCents, long PendingCents);

public sealed record BudgetLineView(CategoryView Category, long? BudgetCents, long SpentCents, long PendingCents, long? LeftCents);

public sealed record BreakdownGroupView(
    string CategoryId, string Name, long PaidCents, long PendingCents, long? BudgetCents, long? LeftCents, IReadOnlyList<CategoryTotalView> Children);

public sealed record BreakdownSideView(IReadOnlyList<BreakdownGroupView> Groups, long PaidCents, long PendingCents, long? BudgetCents, long? LeftCents);

/// <summary>CategoryBreakdown: { ingreso, gasto }, en ese orden.</summary>
public sealed record CategoryBreakdownView(BreakdownSideView Ingreso, BreakdownSideView Gasto);

public sealed record MonthPointView(int Month, PeriodSummaryView Summary, long CumulativeReal, long CumulativeForecast);

public sealed record MonthCellView(long PaidCents, long PendingCents);

public sealed record MatrixRowView(string CategoryId, string Name, IReadOnlyList<MonthCellView> Cells, MonthCellView Total);

public sealed record CategoryMonthMatrixView(string Type, IReadOnlyList<MatrixRowView> Rows, IReadOnlyList<MonthCellView> Totals, MonthCellView Total);

/// <summary>GET /api/summary/month: MonthView de shared/finance/summaryViews.ts.</summary>
public sealed record MonthSummaryView(
    PeriodView Period, string Horizon, PeriodSummaryView Summary, IReadOnlyList<CategoryTotalView> ExpensesByCategory,
    IReadOnlyList<BudgetLineView> BudgetLines, CategoryBreakdownView Breakdown);

/// <summary>GET /api/summary/year: YearView de shared/finance/summaryViews.ts.</summary>
public sealed record YearSummaryView(
    PeriodView Period, string Horizon, PeriodSummaryView Summary, IReadOnlyList<MonthPointView> Series,
    CategoryMonthMatrixView Income, CategoryMonthMatrixView Expense, IReadOnlyList<BudgetLineView> BudgetLines);

/// <summary>
/// Los cálculos del resumen de un mes o un año (shared/finance/summary.ts, annual.ts y summaryViews.ts), en céntimos
/// enteros: un movimiento realizado cuenta en el periodo de su fecha de pago y uno pendiente en el de su vencimiento; lo
/// proyectado de los recurrentes, que no se guarda, cuenta como pendiente. Mismas reglas, órdenes y empates que
/// TypeScript (lo fija el corpus fixtures/migration/rules-finance.json): ordenación estable, mapas en orden de inserción
/// y localeCompare('es').
/// </summary>
public static class FinanceSummaries
{
    /// <summary>NO_SUBCATEGORY: la fila de lo apuntado directamente en una principal que tiene subcategorías.</summary>
    public const string NoSubcategory = "Sin subcategoría";
    private const string NoCategory = "Sin categoría";

    public static PeriodView MonthPeriod(int year, int month) => new("mensual", year, month);

    public static PeriodView YearPeriod(int year) => new("anual", year, null);

    private static string Pad(int value, int width) => JsNumber.ToString(value).PadLeft(width, '0');

    public static (string Start, string End) PeriodBounds(PeriodView period) => period.Month is { } month
        ? IsoDates.MonthBounds(period.Year, month)
        : (IsoDates.ToIsoDate(period.Year, 1, 1), IsoDates.ToIsoDate(period.Year, 12, 31));

    public static bool IsInPeriod(string value, PeriodView period) => period.Month is { } month
        ? value.StartsWith($"{Pad(period.Year, 4)}-{Pad(month, 2)}-", StringComparison.Ordinal)
        : value.StartsWith($"{Pad(period.Year, 4)}-", StringComparison.Ordinal);

    private static int MonthsInPeriod(PeriodView period) => period.Month is null ? 12 : 1;

    /// <summary>effectiveDate: la fecha de pago si está realizado, la prevista si sigue pendiente.</summary>
    public static string EffectiveDate(Movement movement) => (movement.Status == "realizado" ? movement.PaidDate : movement.DueDate) ?? "";

    private static IEnumerable<Movement> InPeriod(IReadOnlyList<Movement> movements, PeriodView period) =>
        movements.Where(movement => IsInPeriod(EffectiveDate(movement), period));

    /// <summary>forecastMovements: los guardados más lo proyectado de los recurrentes hasta <paramref name="until"/>.</summary>
    public static IReadOnlyList<Movement> ForecastMovements(FinanceData data, string today, string until)
    {
        var projected = RecurringRules.ProjectOccurrences(data.Recurring, data.Movements, RecurringRules.GenerationHorizon(today), until);
        return projected.Count > 0 ? [.. data.Movements, .. projected] : data.Movements;
    }

    public static PeriodSummaryView PeriodSummary(IReadOnlyList<Movement> movements, PeriodView period)
    {
        var ofPeriod = InPeriod(movements, period).ToList();
        List<Movement> Pick(string type, string status) => [.. ofPeriod.Where(movement => movement.Type == type && movement.Status == status)];
        var incomePaid = Pick("ingreso", "realizado").Sum(movement => movement.AmountCents);
        var expensePaid = Pick("gasto", "realizado").Sum(movement => movement.AmountCents);
        var pendingIncome = Pick("ingreso", "pendiente");
        var pendingExpense = Pick("gasto", "pendiente");
        var incomePending = pendingIncome.Sum(movement => movement.AmountCents);
        var expensePending = pendingExpense.Sum(movement => movement.AmountCents);
        var realDifference = incomePaid - expensePaid;
        return new PeriodSummaryView(incomePaid, expensePaid, realDifference, incomePending, expensePending, pendingIncome.Count,
            pendingExpense.Count, pendingIncome.Count(RecurringRules.IsProjected), pendingExpense.Count(RecurringRules.IsProjected),
            realDifference + incomePending - expensePending, ofPeriod.Count);
    }

    /// <summary>indexCategories: con ids repetidos vale el último, como un Map.</summary>
    private static Dictionary<string, Category> Index(IReadOnlyList<Category> categories)
    {
        var map = new Dictionary<string, Category>(StringComparer.Ordinal);
        foreach (var category in categories) map[category.Id] = category;
        return map;
    }

    private static string TopLevelId(string categoryId, Dictionary<string, Category> map) =>
        map.TryGetValue(categoryId, out var category) && category.ParentId is { } parent ? parent : categoryId;

    /// <summary>byOrder de categories.ts: el orden y, a igual orden, el nombre con localeCompare('es').</summary>
    private static int ByOrder(Category a, Category b)
    {
        var order = a.Order.CompareTo(b.Order);
        return order != 0 ? order : JsCollator.Compare(a.Name, b.Name);
    }

    private static readonly Comparer<Category> OrderComparer = Comparer<Category>.Create(ByOrder);

    public static IReadOnlyList<Category> TopLevelCategories(IReadOnlyList<Category> categories, string type) =>
        [.. categories.Where(category => category.Type == type && category.ParentId is null).OrderBy(category => category, OrderComparer)];

    private static IReadOnlyList<Category> ChildrenOf(IReadOnlyList<Category> categories, string parentId) =>
        [.. categories.Where(category => category.ParentId == parentId).OrderBy(category => category, OrderComparer)];

    /// <summary>Un total que se va sumando, en el orden en que aparece (como un Map de JavaScript).</summary>
    private sealed class Running(string categoryId, string name)
    {
        public string CategoryId { get; } = categoryId;
        public string Name { get; } = name;
        public long PaidCents { get; set; }
        public long PendingCents { get; set; }
        public CategoryTotalView View(string? name = null) => new(CategoryId, name ?? Name, PaidCents, PendingCents);
    }

    private sealed class OrderedTotals
    {
        private readonly Dictionary<string, Running> byId = new(StringComparer.Ordinal);
        public List<Running> InOrder { get; } = [];
        public Running? this[string id] => byId.GetValueOrDefault(id);
        public bool Contains(string id) => byId.ContainsKey(id);

        public Running GetOrAdd(string id, Func<Running> create)
        {
            if (byId.TryGetValue(id, out var existing)) return existing;
            var added = create();
            byId[id] = added;
            InOrder.Add(added);
            return added;
        }
    }

    /// <summary>sumByCategory: lo pagado y lo pendiente de cada categoría que devuelve <paramref name="keyOf"/>.</summary>
    private static OrderedTotals SumByCategory(IReadOnlyList<Movement> movements, Dictionary<string, Category> map, PeriodView period,
        string type, Func<string, string> keyOf)
    {
        var totals = new OrderedTotals();
        foreach (var movement in InPeriod(movements, period))
        {
            if (movement.Type != type) continue;
            var id = keyOf(movement.CategoryId);
            var entry = totals.GetOrAdd(id, () => new Running(id, map.TryGetValue(id, out var category) ? category.Name : NoCategory));
            if (movement.Status == "realizado") entry.PaidCents += movement.AmountCents;
            else entry.PendingCents += movement.AmountCents;
        }
        return totals;
    }

    /// <summary>totalsByCategory: por categoría principal, de mayor a menor y, a igual total, por nombre.</summary>
    public static IReadOnlyList<CategoryTotalView> TotalsByCategory(IReadOnlyList<Movement> movements, IReadOnlyList<Category> categories,
        PeriodView period, string type)
    {
        var map = Index(categories);
        var totals = SumByCategory(movements, map, period, type, id => TopLevelId(id, map));
        return [.. totals.InOrder.Select(total => total.View()).OrderBy(total => total, Comparer<CategoryTotalView>.Create((a, b) =>
        {
            var size = (b.PaidCents + b.PendingCents).CompareTo(a.PaidCents + a.PendingCents);
            return size != 0 ? size : JsCollator.Compare(a.Name, b.Name);
        }))];
    }

    public static IReadOnlyList<CategoryTotalView> ExpensesByCategory(IReadOnlyList<Movement> movements, IReadOnlyList<Category> categories, PeriodView period) =>
        TotalsByCategory(movements, categories, period, "gasto");

    /// <summary>budgetLines: el consumo del presupuesto (el mensual por los meses del periodo) de cada principal de gasto.</summary>
    public static IReadOnlyList<BudgetLineView> BudgetLines(IReadOnlyList<Movement> movements, IReadOnlyList<Category> categories, PeriodView period)
    {
        var totals = new Dictionary<string, CategoryTotalView>(StringComparer.Ordinal);
        foreach (var total in ExpensesByCategory(movements, categories, period)) totals[total.CategoryId] = total;
        var months = MonthsInPeriod(period);
        return [.. TopLevelCategories(categories, "gasto").Select(category =>
        {
            var total = totals.GetValueOrDefault(category.Id);
            var spent = total?.PaidCents ?? 0;
            long? budget = category.BudgetCents is { } cents ? cents * months : null;
            return new BudgetLineView(CategoryView.From(category), budget, spent, total?.PendingCents ?? 0, budget - spent);
        })];
    }

    /// <summary>
    /// categoryBreakdown: todas las principales de cada tipo, en su orden, con las subcategorías que tienen importes; lo
    /// apuntado directamente en una principal con subcategorías va en «Sin subcategoría», y lo de categorías que ya no
    /// existen, al final.
    /// </summary>
    public static CategoryBreakdownView CategoryBreakdown(IReadOnlyList<Movement> movements, IReadOnlyList<Category> categories, PeriodView period)
    {
        var map = Index(categories);
        var months = MonthsInPeriod(period);

        BreakdownSideView Side(string type)
        {
            var byCategory = SumByCategory(movements, map, period, type, id => id);
            var byParent = SumByCategory(movements, map, period, type, id => TopLevelId(id, map));
            var groups = new List<BreakdownGroupView>();
            foreach (var parent in TopLevelCategories(categories, type))
            {
                var total = byParent[parent.Id];
                var children = ChildrenOf(categories, parent.Id).Select(child => byCategory[child.Id]).Where(line => line is not null)
                    .Select(line => line!.View()).ToList();
                if (children.Count > 0 && byCategory[parent.Id] is { } direct) children.Add(direct.View(NoSubcategory));
                long? budget = parent.BudgetCents is { } cents ? cents * months : null;
                var paid = total?.PaidCents ?? 0;
                var pending = total?.PendingCents ?? 0;
                groups.Add(new BreakdownGroupView(parent.Id, parent.Name, paid, pending, budget, budget - paid - pending, children));
            }
            foreach (var orphan in byParent.InOrder.Where(total => !map.ContainsKey(total.CategoryId)))
                groups.Add(new BreakdownGroupView(orphan.CategoryId, orphan.Name, orphan.PaidCents, orphan.PendingCents, null, null, []));
            var budgeted = groups.Where(group => group.BudgetCents is not null).ToList();
            return new BreakdownSideView(groups, groups.Sum(group => group.PaidCents), groups.Sum(group => group.PendingCents),
                budgeted.Count > 0 ? budgeted.Sum(group => group.BudgetCents!.Value) : null,
                budgeted.Count > 0 ? budgeted.Sum(group => group.LeftCents!.Value) : null);
        }

        return new CategoryBreakdownView(Side("ingreso"), Side("gasto"));
    }

    /// <summary>monthlySeries: el año mes a mes, con la diferencia real y el resultado previsto acumulados.</summary>
    public static IReadOnlyList<MonthPointView> MonthlySeries(IReadOnlyList<Movement> movements, int year)
    {
        long real = 0;
        long forecast = 0;
        var series = new List<MonthPointView>();
        for (var month = 1; month <= 12; month++)
        {
            var summary = PeriodSummary(movements, MonthPeriod(year, month));
            real += summary.RealDifference;
            forecast += summary.Forecast;
            series.Add(new MonthPointView(month, summary, real, forecast));
        }
        return series;
    }

    private static MonthCellView SumCells(IEnumerable<MonthCellView> cells)
    {
        long paid = 0;
        long pending = 0;
        foreach (var cell in cells)
        {
            paid += cell.PaidCents;
            pending += cell.PendingCents;
        }
        return new MonthCellView(paid, pending);
    }

    /// <summary>categoryMonthMatrix: una fila por principal (todas, en su orden) y por categoría que ya no existe, y una columna por mes.</summary>
    public static CategoryMonthMatrixView CategoryMonthMatrix(IReadOnlyList<Movement> movements, IReadOnlyList<Category> categories, int year, string type)
    {
        var map = Index(categories);
        var byMonth = Enumerable.Range(1, 12).Select(month =>
        {
            var totals = new Dictionary<string, CategoryTotalView>(StringComparer.Ordinal);
            var order = new List<string>();
            foreach (var total in TotalsByCategory(movements, categories, MonthPeriod(year, month), type))
            {
                if (!totals.ContainsKey(total.CategoryId)) order.Add(total.CategoryId);
                totals[total.CategoryId] = total;
            }
            return (Totals: totals, Order: order);
        }).ToList();
        var ids = TopLevelCategories(categories, type).Select(category => category.Id).ToList();
        foreach (var (_, order) in byMonth)
            foreach (var id in order)
                if (!map.ContainsKey(id) && !ids.Contains(id, StringComparer.Ordinal)) ids.Add(id);

        var rows = ids.Select(id =>
        {
            var cells = byMonth.Select(month => month.Totals.GetValueOrDefault(id) is { } total
                ? new MonthCellView(total.PaidCents, total.PendingCents) : new MonthCellView(0, 0)).ToList();
            return new MatrixRowView(id, map.TryGetValue(id, out var category) ? category.Name : NoCategory, cells, SumCells(cells));
        }).ToList();
        var totalsByMonth = Enumerable.Range(0, 12).Select(index => SumCells(rows.Select(row => row.Cells[index]))).ToList();
        return new CategoryMonthMatrixView(type, rows, totalsByMonth, SumCells(totalsByMonth));
    }

    /// <summary>monthView: lo que enseña la plantilla mensual.</summary>
    public static MonthSummaryView MonthView(FinanceData data, string today, int year, int month)
    {
        var period = MonthPeriod(year, month);
        var movements = ForecastMovements(data, today, PeriodBounds(period).End);
        return new MonthSummaryView(period, RecurringRules.GenerationHorizon(today), PeriodSummary(movements, period),
            ExpensesByCategory(movements, data.Categories, period), BudgetLines(movements, data.Categories, period),
            CategoryBreakdown(movements, data.Categories, period));
    }

    /// <summary>yearView: lo que enseña la plantilla anual.</summary>
    public static YearSummaryView YearView(FinanceData data, string today, int year)
    {
        var period = YearPeriod(year);
        var movements = ForecastMovements(data, today, PeriodBounds(period).End);
        return new YearSummaryView(period, RecurringRules.GenerationHorizon(today), PeriodSummary(movements, period),
            MonthlySeries(movements, year), CategoryMonthMatrix(movements, data.Categories, year, "ingreso"),
            CategoryMonthMatrix(movements, data.Categories, year, "gasto"), BudgetLines(movements, data.Categories, period));
    }
}
