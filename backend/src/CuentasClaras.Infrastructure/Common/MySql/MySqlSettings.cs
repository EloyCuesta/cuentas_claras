using System.Globalization;
using System.Text.RegularExpressions;

namespace CuentasClaras.Infrastructure.Common.MySql;

/// <summary>
/// Conexión a MySQL leída de CUENTAS_DB_*, con las reglas de server/common/mysql/config.ts.
/// La contraseña nunca se muestra: <see cref="Describe"/> y <see cref="ToString"/> la omiten.
/// </summary>
public sealed partial record MySqlSettings(string Host, int Port, string User, string Password, string Database)
{
    public const string DefaultHost = "127.0.0.1";
    public const int DefaultPort = 3306;
    public const string DefaultDatabase = "cuentas_claras";

    /// <summary>Null sin CUENTAS_DB_USER: el host arranca solo con el acceso. Lanza si un valor no es válido.</summary>
    public static MySqlSettings? FromEnvironment(Func<string, string?> read)
    {
        string? Text(string name) => read(name)?.Trim() is { Length: > 0 } value ? value : null;

        var user = Text("CUENTAS_DB_USER");
        if (user is null) return null;
        var host = Text("CUENTAS_DB_HOST") ?? DefaultHost;
        var portText = Text("CUENTAS_DB_PORT");
        var port = DefaultPort;
        if (portText is not null && (!int.TryParse(portText, NumberStyles.None, CultureInfo.InvariantCulture, out port)
            || port is < 1 or > 65535))
            throw new ArgumentException($"CUENTAS_DB_PORT debe ser un número de puerto entre 1 y 65535 (por defecto {DefaultPort}).");
        var database = Text("CUENTAS_DB_NAME") ?? DefaultDatabase;
        if (!DatabaseName().IsMatch(database))
            throw new ArgumentException("CUENTAS_DB_NAME solo puede tener letras sin tildes, números y guiones bajos (hasta 64).");
        // La contraseña no se recorta: puede empezar o terminar con espacios.
        return new MySqlSettings(host, port, user, read("CUENTAS_DB_PASSWORD") ?? "", database);
    }

    /// <summary>«usuario@equipo:puerto/base», sin la contraseña.</summary>
    public string Describe() => $"{User}@{Host}:{Port}/{Database}";

    public override string ToString() => Describe();

    // \z y no $: en .NET, $ también acepta un salto de línea final.
    [GeneratedRegex(@"^[A-Za-z0-9_]{1,64}\z")]
    private static partial Regex DatabaseName();
}
