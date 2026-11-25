using System.Diagnostics;
using CuentasClaras.Api.Composition;

namespace CuentasClaras.Tests;

/// <summary>
/// El .env que piden los scripts de npm (CUT-PREP). Los valores esperados son los que da el --env-file de Node 22 con el
/// mismo archivo, salvo las dos diferencias a propósito de EnvFile. Nunca abre una base de datos.
/// </summary>
public sealed class EnvFileTests
{
    [Fact]
    public void Lee_el_formato_de_Node()
    {
        const string content =
            "# comentario\n" +
            "\n" +
            "  CUENTAS_A=uno\n" +
            "CUENTAS_B = dos  \n" +
            "CUENTAS_C=tres # comentario\n" +
            "CUENTAS_D=\"cuatro # no es comentario\"\n" +
            "CUENTAS_E='cinco\\nseis'\n" +
            "CUENTAS_F=\"siete\\nocho\"\n" +
            "export CUENTAS_G=nueve\n" +
            "CUENTAS_H=\n" +
            "CUENTAS_I=primero\n" +
            "CUENTAS_I=segundo\n" +
            "SIN_IGUAL\n" +
            "=sin_clave\n" +
            "CUENTAS_J=a=b\n" +
            "CUENTAS_K=\"multi\nlinea\"\n" +
            "CUENTAS_L=`tilde`\n" +
            "CUENTAS_M=\"  con espacios  \"\n" +
            "CUENTAS_N=\tcon tab\t\n" +
            "CUENTAS_P=después\n" +
            "CUENTAS_Q=ñandú áé\r\n" +
            "  # sangrado\n" +
            "\tCUENTAS_S=\"s\"  # comentario\n" +
            "CUENTAS_T= \"t\"\n" +
            "export  CUENTAS_U=u\n" +
            "CUENTAS V=v\n" +
            "CUENTAS_W=\"x\"resto\n" +
            "CUENTAS_X=#solo\n" +
            "CUENTAS_Y=\"uno\ndos\" extra\n" +
            "CUENTAS_Z=\"a\\\\nb\"\n" +
            // Una comilla sin cerrar llega hasta la siguiente comilla igual, aunque esté en otra línea: aquí no hay más.
            "CUENTAS_O=\"sin cerrar\n" +
            "CUENTAS_R=final";

        var expected = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["CUENTAS_A"] = "uno",
            ["CUENTAS_B"] = "dos",
            ["CUENTAS_C"] = "tres",
            ["CUENTAS_D"] = "cuatro # no es comentario",
            ["CUENTAS_E"] = "cinco\\nseis",
            ["CUENTAS_F"] = "siete\nocho",
            ["CUENTAS_G"] = "nueve",
            ["CUENTAS_H"] = "",
            ["CUENTAS_I"] = "segundo",
            ["CUENTAS_J"] = "a=b",
            ["CUENTAS_K"] = "multi\nlinea",
            ["CUENTAS_L"] = "tilde",
            ["CUENTAS_M"] = "  con espacios  ",
            ["CUENTAS_N"] = "con tab",
            ["CUENTAS_O"] = "\"sin cerrar",
            ["CUENTAS_P"] = "después",
            ["CUENTAS_Q"] = "ñandú áé",
            ["CUENTAS_S"] = "s",
            ["CUENTAS_T"] = "t",
            ["CUENTAS_U"] = "u",
            ["CUENTAS V"] = "v",
            ["CUENTAS_W"] = "x",
            ["CUENTAS_X"] = "",
            ["CUENTAS_Y"] = "uno\ndos",
            ["CUENTAS_Z"] = "a\\\nb",
            ["CUENTAS_R"] = "final",
        };
        var parsed = EnvFile.Parse(content);
        Assert.Equal(expected.OrderBy(pair => pair.Key, StringComparer.Ordinal), parsed.OrderBy(pair => pair.Key, StringComparer.Ordinal));
    }

    [Fact]
    public void Diferencias_con_Node_un_BOM_se_ignora_y_una_clave_seguida_de_espacios_queda_vacia()
    {
        // Node deja el BOM pegado a la primera clave (CUENTAS_CODIGO no se encontraría) y toma «CUENTAS_B=1» como valor de A.
        var parsed = EnvFile.Parse("﻿CUENTAS_CODIGO=codigo-largo\nCUENTAS_A=   \nCUENTAS_B=1\n");
        Assert.Equal("codigo-largo", parsed["CUENTAS_CODIGO"]);
        Assert.Equal("", parsed["CUENTAS_A"]);
        Assert.Equal("1", parsed["CUENTAS_B"]);
        Assert.Equal(3, parsed.Count);
    }

    [Fact]
    public void El_entorno_manda_sobre_el_archivo_aunque_este_vacio()
    {
        var environment = new Dictionary<string, string>(StringComparer.Ordinal) { ["CUENTAS_YA"] = "del entorno", ["CUENTAS_VACIA"] = "" };
        var file = EnvFile.Parse("CUENTAS_YA=del archivo\nCUENTAS_VACIA=del archivo\nCUENTAS_SOLO=del archivo\n");
        var read = EnvFile.Reader(name => environment.TryGetValue(name, out var value) ? value : null, file);
        Assert.Equal("del entorno", read("CUENTAS_YA"));
        Assert.Equal("", read("CUENTAS_VACIA"));
        Assert.Equal("del archivo", read("CUENTAS_SOLO"));
        Assert.Null(read("CUENTAS_NINGUNA"));
    }

    [Fact]
    public void La_opcion_sale_de_los_argumentos_y_sin_archivo_no_hay_variables()
    {
        var (path, rest) = EnvFile.TakeOption(["--urls=http://127.0.0.1:1", "--env-file-if-exists=.env", "otro"]);
        Assert.Equal(".env", path);
        Assert.Equal(["--urls=http://127.0.0.1:1", "otro"], rest);

        var (none, all) = EnvFile.TakeOption(["--env-file=.env"]);
        Assert.Null(none);
        Assert.Equal(["--env-file=.env"], all);

        Assert.Empty(EnvFile.LoadIfExists(Path.Combine(Path.GetTempPath(), $"cuentas-no-existe-{Guid.NewGuid():N}.env")));
        Assert.Empty(EnvFile.LoadIfExists(""));
        Assert.Empty(EnvFile.LoadIfExists(Path.GetTempPath()));
    }

    [Theory]
    // Del archivo: un código corto y un puerto que no vale se rechazan antes de escuchar (y antes de MySQL).
    [InlineData("CUENTAS_CODIGO=abc\n", null, true, "al menos 4")]
    [InlineData("CUENTAS_CODIGO=codigo-largo\nCUENTAS_PORT=99999\n", null, true, "CUENTAS_PORT")]
    // El entorno manda: solo espacios en el entorno, aunque el archivo tenga otro código.
    [InlineData("CUENTAS_CODIGO=abc\n", "     ", true, "solo espacios")]
    // Sin la opción, el archivo no se lee: falta el código.
    [InlineData("CUENTAS_CODIGO=codigo-largo\n", null, false, "Falta el c")]
    public async Task Proceso_real_lee_el_archivo_solo_si_se_le_pide(string content, string? environmentCode, bool withOption, string error)
    {
        var file = Path.Combine(Path.GetTempPath(), $"cuentas-env-{Guid.NewGuid():N}.env");
        await File.WriteAllTextAsync(file, content, TestContext.Current.CancellationToken);
        try
        {
            var start = new ProcessStartInfo("dotnet")
            {
                UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardError = true, RedirectStandardOutput = true,
            };
            start.ArgumentList.Add(typeof(CuentasClaras.Api.Program).Assembly.Location);
            if (withOption) start.ArgumentList.Add($"--env-file-if-exists={file}");
            foreach (var name in new[] { "CUENTAS_CODIGO", "CUENTAS_PORT", "CUENTAS_HOST", "CUENTAS_DB_USER", "CUENTAS_DB_NAME" })
                start.Environment.Remove(name);
            if (environmentCode is not null) start.Environment["CUENTAS_CODIGO"] = environmentCode;
            start.Environment["CUENTAS_HOST"] = "127.0.0.1";
            if (!content.Contains("CUENTAS_PORT", StringComparison.Ordinal)) start.Environment["CUENTAS_PORT"] = "0";
            using var process = Process.Start(start)!;
            var output = process.StandardOutput.ReadToEndAsync(TestContext.Current.CancellationToken);
            var errors = process.StandardError.ReadToEndAsync(TestContext.Current.CancellationToken);
            try
            {
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(TestContext.Current.CancellationToken);
                timeout.CancelAfter(TimeSpan.FromSeconds(15));
                await process.WaitForExitAsync(timeout.Token);
                Assert.Equal(1, process.ExitCode);
                // Un texto ASCII: en Windows el error sale en la página de códigos de la consola.
                Assert.Contains(error, await errors);
                Assert.DoesNotContain("Now listening", await output);
            }
            finally
            {
                if (!process.HasExited) process.Kill(entireProcessTree: true);
            }
        }
        finally
        {
            File.Delete(file);
        }
    }
}
