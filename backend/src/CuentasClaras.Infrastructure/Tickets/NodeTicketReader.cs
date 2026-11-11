using System.ComponentModel;
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using CuentasClaras.Application.Tickets;
using CuentasClaras.Domain.Tickets;

namespace CuentasClaras.Infrastructure.Tickets;

/// <summary>
/// Dónde está el worker del OCR (server/modules/tickets/adapters/tesseract/ocrWorker.ts) y cómo se lanza: <c>node --import tsx</c>
/// desde la carpeta del package.json, para que encuentre tsx y el modelo de español de node_modules.
/// </summary>
public sealed record OcrWorkerSettings(string Node, string Script, string WorkingDirectory, TimeSpan Timeout)
{
    public const string DefaultScript = "server/modules/tickets/adapters/tesseract/ocrWorker.ts";

    /// <summary>CUENTAS_OCR_WORKER, o el worker del repositorio relativo a la carpeta actual (la raíz, con npm o dotnet run).</summary>
    public static OcrWorkerSettings FromEnvironment(Func<string, string?> read, string? currentDirectory = null)
    {
        var configured = read("CUENTAS_OCR_WORKER");
        var script = Path.GetFullPath(string.IsNullOrWhiteSpace(configured) ? DefaultScript : configured, currentDirectory ?? Environment.CurrentDirectory);
        return new OcrWorkerSettings("node", script, PackageRoot(script) ?? Path.GetDirectoryName(script)!, TimeSpan.FromMinutes(3));
    }

    private static string? PackageRoot(string script)
    {
        for (var directory = Path.GetDirectoryName(script); directory is not null; directory = Path.GetDirectoryName(directory))
            if (File.Exists(Path.Combine(directory, "package.json")) && Directory.Exists(Path.Combine(directory, "node_modules"))) return directory;
        return null;
    }
}

/// <summary>
/// El lector de tickets real en .NET (TIC-02): el mismo OCR que Express (tesseract.js), en un proceso Node aparte que solo
/// reconoce imágenes. Habla con él por stdin/stdout, una línea JSON por petición y por respuesta (el protocolo está en
/// ocrWorker.ts), y le manda las peticiones de una en una. El proceso se arranca la primera vez que hace falta; si muere o no
/// responde a tiempo, se para y la siguiente lectura arranca otro. Se cierra con el host. Si algo falla, explica la causa en
/// la consola y lanza: ReadTicket responde el 400 de siempre. Las imágenes no se guardan en ningún sitio.
/// </summary>
public sealed class NodeTicketReader(OcrWorkerSettings settings, TextWriter? log = null) : ITicketReader, IAsyncDisposable
{
    private readonly SemaphoreSlim gate = new(1, 1);
    private readonly TextWriter log = log ?? Console.Error;
    private Process? process;
    private int nextId;

    public async Task<IReadOnlyList<IReadOnlyList<OcrLine>>> Read(IReadOnlyList<byte[]> images, IReadOnlyList<TicketSegmentInput>? segments,
        CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            var worker = Start();
            var id = ++nextId;
            var request = JsonSerializer.Serialize(new
            {
                id,
                images = images.Select(Convert.ToBase64String),
                segments = segments?.Select(segment => new
                {
                    imageIndex = segment.ImageIndex, segmentIndex = segment.SegmentIndex, offsetY = segment.OffsetY, fullHeight = segment.FullHeight,
                }),
            });
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(settings.Timeout);
            try
            {
                await worker.StandardInput.WriteLineAsync(request.AsMemory(), timeout.Token);
                await worker.StandardInput.FlushAsync(timeout.Token);
                while (true)
                {
                    var line = await worker.StandardOutput.ReadLineAsync(timeout.Token)
                        ?? throw new InvalidOperationException("El proceso del OCR ha terminado sin responder.");
                    using var response = JsonDocument.Parse(line);
                    var root = response.RootElement;
                    // Una respuesta de una petición anterior que se canceló: no es la nuestra.
                    if (!root.TryGetProperty("id", out var answered) || answered.ValueKind != JsonValueKind.Number || answered.GetInt32() != id) continue;
                    if (root.TryGetProperty("error", out var error)) throw new InvalidOperationException($"El OCR no ha podido leer la imagen: {error}");
                    return ReadPages(root.GetProperty("pages"));
                }
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                // No ha respondido a tiempo: se para, para no dejar trabajo a medias en el proceso.
                Stop();
                throw new TimeoutException($"El OCR no ha respondido en {settings.Timeout.TotalSeconds:0} s.");
            }
            catch (Exception error) when (error is IOException or InvalidOperationException && worker.HasExited)
            {
                Stop();
                throw new InvalidOperationException($"El proceso del OCR ha terminado (código {worker.ExitCode}).", error);
            }
        }
        catch (Exception error) when (!(error is OperationCanceledException && cancellationToken.IsCancellationRequested))
        {
            await log.WriteLineAsync($"[api] No se ha podido leer el ticket: {error.Message}");
            throw;
        }
        finally
        {
            gate.Release();
        }
    }

    private Process Start()
    {
        if (process is { HasExited: false }) return process;
        Stop();
        if (!File.Exists(settings.Script))
            throw new FileNotFoundException($"No se encuentra el lector de tickets {settings.Script} (CUENTAS_OCR_WORKER).", settings.Script);
        var info = new ProcessStartInfo(settings.Node)
        {
            WorkingDirectory = settings.WorkingDirectory,
            UseShellExecute = false,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
            StandardInputEncoding = new UTF8Encoding(false),
            StandardOutputEncoding = new UTF8Encoding(false),
            StandardErrorEncoding = new UTF8Encoding(false),
        };
        info.ArgumentList.Add("--import");
        info.ArgumentList.Add("tsx");
        info.ArgumentList.Add(settings.Script);
        Process started;
        try
        {
            started = Process.Start(info) ?? throw new InvalidOperationException("No se ha podido arrancar Node para el OCR.");
        }
        catch (Win32Exception error)
        {
            throw new InvalidOperationException($"No se ha podido arrancar Node para el OCR ({settings.Node}): {error.Message}", error);
        }
        started.ErrorDataReceived += (_, line) =>
        {
            if (line.Data is { } text) log.WriteLine($"[ocr] {text}");
        };
        started.BeginErrorReadLine();
        process = started;
        return started;
    }

    private void Stop()
    {
        var current = process;
        process = null;
        if (current is null) return;
        try
        {
            if (!current.HasExited) current.Kill(entireProcessTree: true);
        }
        catch (InvalidOperationException)
        {
            // Ya había terminado.
        }
        current.Dispose();
    }

    /// <summary>Cierra la entrada del worker, que cierra el lector y termina; si no termina enseguida, se para.</summary>
    public async ValueTask DisposeAsync()
    {
        await gate.WaitAsync();
        try
        {
            if (process is { HasExited: false } current)
            {
                current.StandardInput.Close();
                using var wait = new CancellationTokenSource(TimeSpan.FromSeconds(5));
                try
                {
                    await current.WaitForExitAsync(wait.Token);
                }
                catch (OperationCanceledException)
                {
                    // Lo para Stop.
                }
            }
            Stop();
        }
        finally
        {
            gate.Release();
        }
    }

    /// <summary>Las páginas que devuelve el worker (OcrLine[][] en JSON); también lo usan las pruebas con los OCR guardados.</summary>
    public static IReadOnlyList<IReadOnlyList<OcrLine>> ReadPages(JsonElement pages) =>
        [.. pages.EnumerateArray().Select(page => (IReadOnlyList<OcrLine>)[.. page.EnumerateArray().Select(ReadLine)])];

    private static TicketBox ReadBox(JsonElement box) =>
        new(box.GetProperty("x0").GetDouble(), box.GetProperty("y0").GetDouble(), box.GetProperty("x1").GetDouble(), box.GetProperty("y1").GetDouble());

    private static string? TextOrNull(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private static OcrLine ReadLine(JsonElement line)
    {
        double? confidence = line.TryGetProperty("confidence", out var value) && value.ValueKind == JsonValueKind.Number ? value.GetDouble() : null;
        IReadOnlyList<OcrWord>? words = line.TryGetProperty("words", out var list) && list.ValueKind == JsonValueKind.Array
            ? [.. list.EnumerateArray().Select(word => new OcrWord(TextOrNull(word, "text") ?? "", word.GetProperty("confidence").GetDouble(), ReadBox(word.GetProperty("box"))))]
            : null;
        TicketSource? source = line.TryGetProperty("source", out var from) && from.ValueKind == JsonValueKind.Object
            ? new TicketSource(from.GetProperty("imageIndex").GetInt32(), from.GetProperty("segmentIndex").GetInt32(), ReadBox(from.GetProperty("box")),
                from.GetProperty("width").GetDouble(), from.GetProperty("height").GetDouble())
            : null;
        return new OcrLine(TextOrNull(line, "text") ?? "", TextOrNull(line, "reread"), confidence, words, source);
    }
}
