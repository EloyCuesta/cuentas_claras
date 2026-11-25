using CuentasClaras.Api.Composition;

namespace CuentasClaras.Tests;

/// <summary>El .env de la raíz en el host .NET (CUT-PREP), como --env-file-if-exists=.env en Express. Solo carpetas temporales.</summary>
public sealed class DotEnvTests
{
    [Fact]
    public void Lee_claves_con_comentarios_export_y_comillas()
    {
        var values = DotEnv.Parse("""
            # Comentario
            CUENTAS_CODIGO=abcd1234

            export CUENTAS_DB_HOST = 127.0.0.1
            CUENTAS_DB_PASSWORD="con # almohadilla"
            CUENTAS_DB_NAME='cuentas_claras'
            CUENTAS_DB_PORT=3306 # el de siempre
            VACIA=
            SIN_IGUAL
            =sin clave
            CUENTAS_CODIGO=la-ultima-manda
            """);
        Assert.Equal("la-ultima-manda", values["CUENTAS_CODIGO"]);
        Assert.Equal("127.0.0.1", values["CUENTAS_DB_HOST"]);
        Assert.Equal("con # almohadilla", values["CUENTAS_DB_PASSWORD"]);
        Assert.Equal("cuentas_claras", values["CUENTAS_DB_NAME"]);
        Assert.Equal("3306", values["CUENTAS_DB_PORT"]);
        Assert.Equal("", values["VACIA"]);
        Assert.False(values.ContainsKey("SIN_IGUAL"));
        Assert.Equal(6, values.Count);
    }

    [Fact]
    public void El_entorno_manda_sobre_el_archivo_de_la_raiz_aunque_se_arranque_mas_abajo()
    {
        using var root = new TemporaryFolder();
        File.WriteAllText(Path.Combine(root.Path, "package.json"), "{}");
        File.WriteAllText(Path.Combine(root.Path, ".env"), "CUENTAS_CODIGO=del-archivo\nCUENTAS_DB_USER=usuario\n");
        var project = Directory.CreateDirectory(Path.Combine(root.Path, "backend", "src", "Api")).FullName;
        var environment = new Dictionary<string, string> { ["CUENTAS_CODIGO"] = "del-entorno" };

        var read = DotEnv.Reader(name => environment.GetValueOrDefault(name), project);

        Assert.Equal("del-entorno", read("CUENTAS_CODIGO"));
        Assert.Equal("usuario", read("CUENTAS_DB_USER"));
        Assert.Null(read("CUENTAS_DB_NAME"));
    }

    [Fact]
    public void Ninguno_no_lee_ningun_archivo_y_sin_env_queda_el_entorno()
    {
        using var root = new TemporaryFolder();
        File.WriteAllText(Path.Combine(root.Path, "package.json"), "{}");
        File.WriteAllText(Path.Combine(root.Path, ".env"), "CUENTAS_DB_USER=usuario\n");
        var environment = new Dictionary<string, string> { [DotEnv.FileVariable] = DotEnv.None };

        Assert.Null(DotEnv.Reader(name => environment.GetValueOrDefault(name), root.Path)("CUENTAS_DB_USER"));

        File.Delete(Path.Combine(root.Path, ".env"));
        Assert.Null(DotEnv.Reader(_ => null, root.Path)("CUENTAS_DB_USER"));
    }

    [Fact]
    public void CUENTAS_ENV_FILE_elige_otro_archivo()
    {
        using var root = new TemporaryFolder();
        var other = Path.Combine(root.Path, "otro.env");
        File.WriteAllText(other, "CUENTAS_PORT=3299\n");
        var environment = new Dictionary<string, string> { [DotEnv.FileVariable] = other };

        Assert.Equal("3299", DotEnv.Reader(name => environment.GetValueOrDefault(name), root.Path)("CUENTAS_PORT"));
    }

    private sealed class TemporaryFolder : IDisposable
    {
        public string Path { get; } = Directory.CreateDirectory(System.IO.Path.Combine(System.IO.Path.GetTempPath(), $"cuentas-dotenv-{Guid.NewGuid():N}")).FullName;

        public void Dispose() => Directory.Delete(Path, recursive: true);
    }
}
