using System.Collections.Concurrent;
using CuentasClaras.Application.Auth;
using CuentasClaras.Application.Common;
using CuentasClaras.Domain.Auth;
using CuentasClaras.Infrastructure.Auth;
using CuentasClaras.Infrastructure.Common;

namespace CuentasClaras.Tests;

/// <summary>Contratos de acceso con reloj controlado y almacenes reales, sin red ni datos de la instalación.</summary>
public sealed class AuthTests
{
    private const string Code = "codigo-de-ensayo";
    private const string Ip = "192.168.1.20";

    [Theory(DisplayName = "La configuración rechaza códigos ausentes, cortos o compuestos solo por espacios")]
    [InlineData(null, "Falta el código de acceso.")]
    [InlineData("", "Falta el código de acceso.")]
    [InlineData("abc", "debe tener al menos 4 caracteres.")]
    [InlineData("     ", "no puede ser solo espacios.")]
    [InlineData("\t\r\n\uFEFF", "no puede ser solo espacios.")]
    [InlineData("😀😀😀", "debe tener al menos 4 caracteres.")]
    public void InvalidConfiguration(string? code, string message)
    {
        Assert.Contains(message, Assert.Throws<ArgumentException>(() => AccessCode.Validate(code)).Message);
        Assert.Throws<ArgumentException>(() => new Sha256CodeVerifier(code));
    }

    [Theory(DisplayName = "La configuración conserva el código y las reglas Unicode de JavaScript")]
    [InlineData("1234")]
    [InlineData(" a b ")]
    [InlineData("😀😀😀😀")]
    [InlineData("\u0085\u0085\u0085\u0085")]
    [InlineData("abc\uD800")]
    public void ValidConfigurationPreservesCode(string code)
    {
        Assert.Equal(code, AccessCode.Validate(code));
        Assert.True(new Sha256CodeVerifier(code).Matches(code));
    }

    [Fact(DisplayName = "El máximo del código se mide en 200 unidades UTF-16, como el servidor actual")]
    public void MaximumCodeLength()
    {
        var ascii = new string('a', 200);
        var unicode = string.Concat(Enumerable.Repeat("😀", 100));
        Assert.Equal(ascii, AccessCode.Validate(ascii));
        Assert.Equal(unicode, AccessCode.Validate(unicode));
        foreach (var code in new[] { ascii + "a", unicode + "a" })
            Assert.Equal("El código de acceso (CUENTAS_CODIGO) puede tener como máximo 200 caracteres.",
                Assert.Throws<ArgumentException>(() => AccessCode.Validate(code)).Message);
    }

    [Fact(DisplayName = "El verificador distingue espacios, mayúsculas y Unicode sin normalizar el secreto")]
    public void VerifierPreservesExactCode()
    {
        var verifier = new Sha256CodeVerifier(" café ");
        Assert.True(verifier.Matches(" café "));
        Assert.False(verifier.Matches("café"));
        Assert.False(verifier.Matches(" CAFÉ "));
        Assert.False(verifier.Matches(" cafe\u0301 "));
        Assert.False(verifier.Matches(""));
        Assert.True(new Sha256CodeVerifier("abc\uD800").Matches("abc\uFFFD"));
    }

    [Fact(DisplayName = "La sesión dura exactamente 12 horas y las consultas no la prolongan")]
    public void SessionHasAbsoluteExpiration()
    {
        var auth = new AuthFixture();
        var token = auth.Login.Execute(Code, Ip);
        Assert.Equal(auth.Clock.NowMs() + 43_200_000, auth.Sessions.Get(token));
        auth.Clock.Advance(43_200_000 - 1);
        Assert.True(auth.Check.Execute(token));
        auth.Clock.Advance(1);
        Assert.False(auth.Check.Execute(token));
        Assert.Null(auth.Sessions.Get(token));
        Assert.False(auth.Check.Execute(token));
    }

    [Fact(DisplayName = "No hay sesión para tokens ausentes, inventados o de otra instancia del servidor")]
    public void UnknownAndRestartedSessionsAreGuests()
    {
        var first = new AuthFixture();
        var token = first.Login.Execute(Code, Ip);
        Assert.True(first.Check.Execute(token));
        Assert.False(first.Check.Execute(null));
        Assert.False(first.Check.Execute(""));
        Assert.False(first.Check.Execute("inventado"));
        Assert.False(new AuthFixture().Check.Execute(token));
    }

    [Fact(DisplayName = "Cerrar sesión es repetible y solo invalida el token indicado")]
    public void LogoutIsIdempotentAndScoped()
    {
        var auth = new AuthFixture();
        var first = auth.Login.Execute(Code, Ip);
        var second = auth.Login.Execute(Code, Ip);
        var logout = new Logout(auth.Sessions);
        logout.Execute(first);
        logout.Execute(first);
        logout.Execute(null);
        logout.Execute("");
        Assert.False(auth.Check.Execute(first));
        Assert.True(auth.Check.Execute(second));
    }

    [Fact(DisplayName = "Solo un acceso correcto sustituye la sesión anterior y purga las caducadas")]
    public void SuccessfulLoginReplacesPreviousSession()
    {
        var auth = new AuthFixture();
        var previous = auth.Login.Execute(Code, Ip);
        auth.Sessions.Set("caducada", auth.Clock.NowMs());
        Assert.Throws<AppError>(() => auth.Login.Execute("incorrecto", Ip, previous));
        Assert.True(auth.Check.Execute(previous));
        var current = auth.Login.Execute(Code, Ip, previous);
        Assert.NotEqual(previous, current);
        Assert.False(auth.Check.Execute(previous));
        Assert.True(auth.Check.Execute(current));
        Assert.Null(auth.Sessions.Get("caducada"));
    }

    [Fact(DisplayName = "Cinco fallos dan 401 y el siguiente intento se bloquea aunque acierte el código")]
    public void FiveFailuresLockAllFurtherAttempts()
    {
        var auth = new AuthFixture();
        for (var index = 0; index < 5; index++)
        {
            var error = Assert.Throws<AppError>(() => auth.Login.Execute("incorrecto", Ip));
            Assert.Equal("UNAUTHORIZED", error.Code);
            Assert.Equal("El código no es correcto.", error.Message);
            Assert.Null(error.RetryAfterSeconds);
        }
        foreach (var code in new[] { Code, "incorrecto" })
        {
            var error = Assert.Throws<AppError>(() => auth.Login.Execute(code, Ip));
            Assert.Equal("TOO_MANY_ATTEMPTS", error.Code);
            Assert.Equal("Demasiados intentos con un código incorrecto. Vuelve a intentarlo dentro de 15 min.",
                error.Message);
            Assert.Equal(900, error.RetryAfterSeconds);
        }
    }

    [Fact(DisplayName = "El bloqueo termina a los 15 minutos del quinto fallo y redondea Retry-After hacia arriba")]
    public void LockExpiresAtExactBoundary()
    {
        var auth = new AuthFixture();
        for (var index = 0; index < 4; index++) Fail(auth);
        auth.Clock.Advance(60_000);
        Fail(auth);
        // La ventana del primer fallo puede terminar antes que el bloqueo del quinto.
        auth.Clock.Advance(840_000);
        var minute = Assert.Throws<AppError>(() => auth.Login.Execute(Code, Ip));
        Assert.Equal(60, minute.RetryAfterSeconds);
        Assert.EndsWith("dentro de 1 min.", minute.Message);
        auth.Clock.Advance(59_999);
        Assert.Equal(1, Assert.Throws<AppError>(() => auth.Login.Execute(Code, Ip)).RetryAfterSeconds);
        auth.Clock.Advance(1);
        Assert.True(auth.Check.Execute(auth.Login.Execute(Code, Ip)));
        Assert.Null(auth.Attempts.Get(Ip));
    }

    [Fact(DisplayName = "Los fallos sin bloqueo se olvidan a los 15 minutos del primero")]
    public void AttemptWindowExpiresAtExactBoundary()
    {
        var auth = new AuthFixture();
        Fail(auth);
        auth.Clock.Advance(899_999);
        Fail(auth);
        Assert.Equal(2, auth.Attempts.Get(Ip)?.Failures);
        auth.Clock.Advance(1);
        for (var index = 0; index < 4; index++) Fail(auth);
        Assert.Equal(4, auth.Attempts.Get(Ip)?.Failures);
        Assert.True(auth.Check.Execute(auth.Login.Execute(Code, Ip)));
    }

    [Fact(DisplayName = "Un acceso correcto reinicia los fallos y el bloqueo de una IP no afecta a otra")]
    public void AttemptsAreResetOnSuccessAndIsolatedByIp()
    {
        var auth = new AuthFixture();
        for (var index = 0; index < 4; index++) Fail(auth);
        auth.Login.Execute(Code, Ip);
        Assert.Null(auth.Attempts.Get(Ip));
        for (var index = 0; index < 5; index++) Fail(auth);
        Assert.Equal("TOO_MANY_ATTEMPTS", Assert.Throws<AppError>(() => auth.Login.Execute(Code, Ip)).Code);
        Assert.True(auth.Check.Execute(auth.Login.Execute(Code, "192.168.1.21")));
        Assert.Equal("TOO_MANY_ATTEMPTS", Assert.Throws<AppError>(() => auth.Login.Execute(Code, Ip)).Code);
    }

    [Fact(DisplayName = "Los intentos concurrentes no pierden fallos ni admiten más de cinco códigos incorrectos")]
    public async Task ConcurrentFailuresAreAtomic()
    {
        var auth = new AuthFixture();
        var outcomes = new ConcurrentBag<string>();
        var start = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var tasks = Enumerable.Range(0, 32).Select(_ => Task.Run(async () =>
        {
            await start.Task;
            var error = Assert.Throws<AppError>(() => auth.Login.Execute("incorrecto", Ip));
            outcomes.Add(error.Code);
        })).ToArray();
        start.SetResult();
        await Task.WhenAll(tasks);
        Assert.Equal(5, outcomes.Count(code => code == "UNAUTHORIZED"));
        Assert.Equal(27, outcomes.Count(code => code == "TOO_MANY_ATTEMPTS"));
        Assert.Equal(5, auth.Attempts.Get(Ip)?.Failures);
    }

    [Fact(DisplayName = "Los almacenes conservan claves distintas y purgan solo sesiones ya caducadas")]
    public void StoresUseExactKeysAndExpiration()
    {
        var sessions = new InMemorySessionStore();
        sessions.Set("token", 100);
        sessions.Set("TOKEN", 101);
        sessions.Set("anterior", 99);
        sessions.DeleteExpired(100);
        Assert.Null(sessions.Get("token"));
        Assert.Null(sessions.Get("anterior"));
        Assert.Equal(101, sessions.Get("TOKEN"));
        sessions.Delete("ausente");

        var attempts = new InMemoryAttemptStore();
        attempts.Set("IP", new Attempts(1, 100, null));
        Assert.Null(attempts.Get("ip"));
        Assert.Null(new InMemoryAttemptStore().Get("IP"));
        attempts.Delete("IP");
        attempts.Delete("IP");
        Assert.Null(attempts.Get("IP"));
    }

    [Fact(DisplayName = "Los adaptadores crean tokens hexadecimales y UUID distintos con reloj Unix")]
    public void RuntimeAdaptersUseExpectedFormats()
    {
        var tokens = new RandomTokenGenerator();
        var ids = new UuidGenerator();
        var generatedTokens = Enumerable.Range(0, 100).Select(_ => tokens.NewToken()).ToArray();
        var generatedIds = Enumerable.Range(0, 100).Select(_ => ids.NewId()).ToArray();
        Assert.Equal(100, generatedTokens.Distinct().Count());
        Assert.Equal(100, generatedIds.Distinct().Count());
        Assert.All(generatedTokens, token => Assert.Matches("^[0-9a-f]{64}$", token));
        Assert.All(generatedIds, id =>
            Assert.Matches("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", id));
        var before = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var now = new SystemClock().NowMs();
        Assert.InRange(now, before, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
    }

    private static void Fail(AuthFixture auth) =>
        Assert.Equal("UNAUTHORIZED", Assert.Throws<AppError>(() => auth.Login.Execute("incorrecto", Ip)).Code);

    /// <summary>Instancia independiente como la de cada host; solo se sustituye la fuente de tiempo.</summary>
    private sealed class AuthFixture
    {
        public ControlledClock Clock { get; } = new();
        public InMemorySessionStore Sessions { get; } = new();
        public InMemoryAttemptStore Attempts { get; } = new();
        public Login Login { get; }
        public CheckSession Check { get; }

        public AuthFixture()
        {
            Login = new Login(new Sha256CodeVerifier(Code), new RandomTokenGenerator(), Sessions, Attempts, Clock);
            Check = new CheckSession(Sessions, Clock);
        }
    }

    private sealed class ControlledClock : IClock
    {
        private long now = 1_793_606_400_000;
        public long NowMs() => Interlocked.Read(ref now);
        public void Advance(long milliseconds) => Interlocked.Add(ref now, milliseconds);
    }
}
