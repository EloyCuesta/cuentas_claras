namespace CuentasClaras.Domain.Finance;

/// <summary>Una categoría tal como se guarda: <see cref="ParentId"/> nulo en las principales.</summary>
public sealed record Category(string Id, string Name, string Type, string? ParentId, double Order, long? BudgetCents);

/// <summary>
/// Las categorías con las que empieza una base nueva, generadas como en shared/finance/categories.ts:
/// mismos slugs, prefijo «g-»/«i-» y orden por posición; las principales antes que sus subcategorías.
/// </summary>
public static class DefaultCategories
{
    private static readonly (string Slug, string Name, (string Slug, string Name)[] Children)[] Expenses =
    [
        ("vivienda", "Vivienda", [("alquiler", "Alquiler o hipoteca"), ("luz", "Luz"), ("agua", "Agua"), ("gas", "Gas"), ("internet", "Internet")]),
        ("coche", "Coche", [("combustible", "Combustible"), ("mantenimiento", "Mantenimiento"), ("aparcamiento", "Aparcamiento"), ("impuestos", "Impuestos")]),
        ("alimentacion", "Alimentación", [("supermercado", "Supermercado"), ("comidas-fuera", "Comidas fuera")]),
        ("seguros", "Seguros", [("coche", "Coche"), ("hogar", "Hogar"), ("salud", "Salud"), ("otros", "Otros")]),
        ("prestamos", "Préstamos y letras", []),
        ("suscripciones", "Suscripciones", []),
        ("salud", "Salud", []),
        ("ocio", "Ocio", []),
        ("otros", "Otros", []),
    ];

    private static readonly (string Slug, string Name, (string Slug, string Name)[] Children)[] Incomes =
    [
        ("nomina", "Nómina", []),
        ("extra", "Ingresos extra", []),
        ("otros", "Otros ingresos", []),
    ];

    public static IReadOnlyList<Category> All { get; } = [.. Expand("gasto", Expenses), .. Expand("ingreso", Incomes)];

    private static IEnumerable<Category> Expand(string type, (string Slug, string Name, (string Slug, string Name)[] Children)[] seed)
    {
        var prefix = type == "gasto" ? "g" : "i";
        for (var parentIndex = 0; parentIndex < seed.Length; parentIndex++)
        {
            var parent = seed[parentIndex];
            var parentId = $"{prefix}-{parent.Slug}";
            yield return new Category(parentId, parent.Name, type, null, parentIndex, null);
            for (var childIndex = 0; childIndex < parent.Children.Length; childIndex++)
            {
                var child = parent.Children[childIndex];
                yield return new Category($"{parentId}-{child.Slug}", child.Name, type, parentId, childIndex, null);
            }
        }
    }
}
