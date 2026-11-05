using System.Reflection;
using System.Xml.Linq;
using CuentasClaras.Api.Composition;
using CuentasClaras.Application.Auth;
using CuentasClaras.Domain.Auth;
using CuentasClaras.Infrastructure.Auth;

namespace CuentasClaras.Tests;

/// <summary>Impide invertir capas o mezclar módulos, incluso mediante nombres cualificados o genéricos.</summary>
public sealed class ArchitectureTests
{
    private static readonly Assembly[] Assemblies = [
        typeof(AccessCode).Assembly, typeof(Login).Assembly,
        typeof(InMemorySessionStore).Assembly, typeof(ApiHost).Assembly,
    ];
    private static readonly Dictionary<string, string[]> References = new()
    {
        ["Domain"] = [],
        ["Application"] = ["Domain"],
        ["Infrastructure"] = ["Application", "Domain"],
        ["Api"] = ["Application", "Infrastructure"],
    };

    [Fact]
    public void Los_cuatro_proyectos_reales_solo_referencian_las_capas_permitidas()
    {
        var source = Path.Combine(RepositoryRoot(), "backend", "src");
        var projects = Directory.GetFiles(source, "*.csproj", SearchOption.AllDirectories);
        Assert.Equal(References.Count, projects.Length);
        foreach (var project in projects)
        {
            var layer = Path.GetFileNameWithoutExtension(project).Replace("CuentasClaras.", "");
            Assert.True(References.TryGetValue(layer, out var allowed), $"Capa no declarada: {project}");
            var xml = XDocument.Load(project);
            var actual = xml.Descendants("ProjectReference")
                .Select(item => Path.GetFileNameWithoutExtension(item.Attribute("Include")!.Value)
                    .Replace("CuentasClaras.", "")).Order().ToArray();
            Assert.Equal(allowed!.Order(), actual);
            if (layer is "Domain" or "Application")
                Assert.Empty(xml.Descendants("FrameworkReference"));
            // El único paquete de ejecución es el proveedor MySQL autorizado en DATA-01, con versión exacta y solo en Infrastructure.
            var packages = xml.Descendants("PackageReference")
                .Select(item => $"{item.Attribute("Include")!.Value} {item.Attribute("Version")?.Value}").ToArray();
            Assert.Equal(layer == "Infrastructure" ? ["MySqlConnector [2.6.2]"] : [], packages);
        }
    }

    [Fact]
    public void Solo_Infrastructure_referencia_el_ensamblado_del_driver_MySQL()
    {
        var users = Assemblies.Where(assembly => assembly.GetReferencedAssemblies().Any(reference => reference.Name == "MySqlConnector"))
            .Select(assembly => assembly.GetName().Name);
        Assert.Equal(["CuentasClaras.Infrastructure"], users);
    }

    [Fact]
    public void Los_ensamblados_no_introducen_referencias_transitivas_a_capas_prohibidas()
    {
        Assert.Equal(4, Assemblies.Distinct().Count());
        foreach (var assembly in Assemblies)
        {
            var layer = assembly.GetName().Name!.Replace("CuentasClaras.", "");
            Assert.NotEmpty(assembly.GetTypes());
            foreach (var reference in assembly.GetReferencedAssemblies())
            {
                var name = reference.Name!;
                if (name.StartsWith("CuentasClaras.", StringComparison.Ordinal))
                    Assert.Contains(name.Replace("CuentasClaras.", ""), References[layer]);
                else if (layer is "Domain" or "Application")
                    Assert.True(name == "System" || name.StartsWith("System.", StringComparison.Ordinal),
                        $"{layer} depende de {name}; solo admite biblioteca estándar y sus capas permitidas.");
            }
        }
    }

    [Fact]
    public void Firmas_y_cuerpos_respetan_capas_modulos_y_composicion()
    {
        var violations = new List<string>();
        var inspected = 0;
        var internalDependencies = 0;
        foreach (var type in Assemblies.SelectMany(assembly => assembly.GetTypes()))
        {
            inspected++;
            foreach (var target in CompiledDependencies.Of(type))
            {
                if (target.Namespace?.StartsWith("CuentasClaras.", StringComparison.Ordinal) == true)
                    internalDependencies++;
                if (Violation(type.FullName ?? "", target.FullName ?? "") is { } reason)
                    violations.Add($"{type.FullName} → {target.FullName}: {reason}");
            }
        }
        // Impide aprobar por haber inspeccionado el proyecto de pruebas o un ensamblado vacío.
        Assert.True(inspected >= 25, $"Solo se inspeccionaron {inspected} tipos.");
        Assert.True(internalDependencies >= 20, $"Solo se encontraron {internalDependencies} dependencias internas.");
        Assert.True(violations.Count == 0, string.Join(Environment.NewLine, violations));
    }

    [Theory]
    [InlineData("CuentasClaras.Domain.Pantry.Item", "CuentasClaras.Application.Pantry.Save", false)]
    [InlineData("CuentasClaras.Application.Finance.Save", "CuentasClaras.Infrastructure.Finance.Store", false)]
    [InlineData("CuentasClaras.Api.Finance.Routes", "CuentasClaras.Infrastructure.Finance.Store", false)]
    [InlineData("CuentasClaras.Api.Composition.Host", "CuentasClaras.Infrastructure.Finance.Store", true)]
    [InlineData("CuentasClaras.Api.Composition.Host+<Run>d__0", "CuentasClaras.Infrastructure.Finance.Store", true)]
    [InlineData("CuentasClaras.Application.Pantry.Save", "CuentasClaras.Domain.Tickets.Ticket", false)]
    [InlineData("CuentasClaras.Application.Tickets.Save", "CuentasClaras.Application.Pantry.Contracts.IGateway", true)]
    [InlineData("CuentasClaras.Application.Tickets.Save", "CuentasClaras.Application.Pantry.Save", false)]
    [InlineData("CuentasClaras.Application.Finance.Save", "CuentasClaras.Application.Pantry.Contracts.IGateway", false)]
    [InlineData("CuentasClaras.Application.Common.Service", "CuentasClaras.Domain.Auth.Attempts", false)]
    [InlineData("CuentasClaras.Application.Auth.Login", "CuentasClaras.Domain.Auth.Attempts", true)]
    [InlineData("CuentasClaras.Application.Pantry.Save", "CuentasClaras.Application.Common.IClock", true)]
    [InlineData("CuentasClaras.Domain.Auth.Code", "System.IO.File", false)]
    [InlineData("CuentasClaras.Application.Auth.Login", "System.Net.Http.HttpClient", false)]
    [InlineData("CuentasClaras.Application.Pantry.Query", "System.Linq.IQueryable`1", false)]
    [InlineData("CuentasClaras.Application.Pantry.Query", "Microsoft.EntityFrameworkCore.DbContext", false)]
    [InlineData("CuentasClaras.Application.Auth.Login", "Microsoft.AspNetCore.Http.HttpContext", false)]
    [InlineData("CuentasClaras.Domain.Auth.Policy", "System.Math", true)]
    [InlineData("CuentasClaras.Application.Finance.Save", "MySqlConnector.MySqlConnection", false)]
    [InlineData("CuentasClaras.Domain.Finance.Category", "MySqlConnector.MySqlDataReader", false)]
    [InlineData("CuentasClaras.Api.Composition.ApiHost", "MySqlConnector.MySqlConnection", false)]
    [InlineData("CuentasClaras.Api.Finance.Routes", "MySqlConnector.MySqlException", false)]
    [InlineData("CuentasClaras.Infrastructure.Finance.Store", "MySqlConnector.MySqlConnection", true)]
    [InlineData("CuentasClaras.Infrastructure.Common.MySql.MySqlMigrations", "CuentasClaras.Infrastructure.Finance.DefaultCategorySeed", false)]
    [InlineData("CuentasClaras.Infrastructure.Finance.DefaultCategorySeed", "CuentasClaras.Infrastructure.Common.MySql.MySqlCommands", true)]
    [InlineData("CuentasClaras.Domain.Tickets.TicketMatcher", "CuentasClaras.Domain.Pantry.PantryItem", false)]
    [InlineData("CuentasClaras.Domain.Tickets.TicketText", "CuentasClaras.Domain.Common.JsCase", true)]
    [InlineData("CuentasClaras.Application.Tickets.TicketRequests", "CuentasClaras.Domain.Tickets.TicketText", true)]
    [InlineData("CuentasClaras.Application.Tickets.TicketRequests", "CuentasClaras.Domain.Pantry.PantryItem", false)]
    [InlineData("CuentasClaras.Api.Tickets.Routes", "CuentasClaras.Domain.Tickets.TicketText", false)]
    public void La_politica_detecta_infracciones_aunque_el_modulo_aun_no_este_portado(
        string source, string target, bool allowed) => Assert.Equal(allowed, Violation(source, target) is null);

    [Fact]
    public void Las_reglas_de_tickets_no_leen_el_reloj_ni_el_azar()
    {
        // La fecha de hoy y los ids llegan como parámetro (TIC-01): nada de DateTime.Now, Random ni Guid.NewGuid.
        string[] forbidden = ["System.DateTime", "System.DateTimeOffset", "System.TimeProvider", "System.Random", "System.Guid"];
        var rules = typeof(CuentasClaras.Domain.Tickets.TicketParser).Assembly.GetTypes()
            .Concat(typeof(CuentasClaras.Application.Tickets.TicketRequests).Assembly.GetTypes())
            .Where(type => type.Namespace is "CuentasClaras.Domain.Tickets" or "CuentasClaras.Domain.Common" or "CuentasClaras.Application.Tickets")
            .ToArray();
        Assert.True(rules.Length >= 20, $"Solo se inspeccionaron {rules.Length} tipos.");
        var uses = rules.SelectMany(type => CompiledDependencies.Of(type)
            .Where(target => forbidden.Contains(target.FullName))
            .Select(target => $"{type.FullName} → {target.FullName}")).ToArray();
        Assert.True(uses.Length == 0, string.Join(Environment.NewLine, uses));
    }

    [Fact]
    public void El_lector_encuentra_dependencias_que_no_aparecen_en_las_firmas_publicas()
    {
        var dependencies = CompiledDependencies.Of(typeof(DependencyProbe));
        Assert.Contains(typeof(InMemorySessionStore), dependencies);
        Assert.Contains(typeof(AccessCode), dependencies);
        Assert.Contains(typeof(Login), dependencies);
    }

    private static string? Violation(string source, string target)
    {
        var origin = source.Split('.');
        if (origin.Length < 3 || origin[0] != "CuentasClaras") return null;
        var layer = origin[1];
        if (target.StartsWith("MySqlConnector.", StringComparison.Ordinal) && layer != "Infrastructure")
            return "solo Infrastructure usa el driver MySQL";
        if (layer is "Domain" or "Application")
        {
            if (target.StartsWith("System.IO.", StringComparison.Ordinal) ||
                target.StartsWith("System.Net.", StringComparison.Ordinal) ||
                target.StartsWith("System.Data.", StringComparison.Ordinal) ||
                target.StartsWith("System.Linq.IQueryable", StringComparison.Ordinal) ||
                target.StartsWith("Microsoft.EntityFrameworkCore.", StringComparison.Ordinal) ||
                target.StartsWith("Microsoft.AspNetCore.", StringComparison.Ordinal))
                return "la capa pura no conoce transporte ni persistencia";
        }
        var dependency = target.Split('.');
        if (dependency.Length < 3 || dependency[0] != "CuentasClaras") return null;
        var targetLayer = dependency[1];
        if (layer != targetLayer && (!References.TryGetValue(layer, out var allowed) || !allowed.Contains(targetLayer)))
            return "referencia a una capa prohibida";
        if (layer == "Api")
            return targetLayer == "Infrastructure" && origin[2] != "Composition"
                ? "solo Composition construye adaptadores de Infrastructure" : null;
        var module = origin[2];
        var targetModule = dependency[2];
        if (module == targetModule || targetModule == "Common") return null;
        if (module == "Tickets" && targetLayer == "Application" && targetModule == "Pantry" &&
            dependency.Length >= 5 && dependency[3] == "Contracts") return null;
        return "un módulo solo conoce el suyo y Common; Tickets puede usar los contratos públicos de Pantry";
    }

    private static string RepositoryRoot()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
            if (File.Exists(Path.Combine(directory.FullName, "backend", "CuentasClaras.slnx"))) return directory.FullName;
        throw new InvalidOperationException("No se encuentra la solución del repositorio para comprobar sus referencias.");
    }

    // No se ejecuta: el lector debe encontrar llamadas, typeof y genéricos incluso en un método privado.
    private sealed class DependencyProbe
    {
        private static object Probe()
        {
            var store = new InMemorySessionStore();
            store.Delete(AccessCode.Validate("ensayo"));
            return new Dictionary<string, Login[]>();
        }
    }
}
