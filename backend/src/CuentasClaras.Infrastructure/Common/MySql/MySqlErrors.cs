using MySqlConnector;

namespace CuentasClaras.Infrastructure.Common.MySql;

/// <summary>No se puede preparar la base de datos: el mensaje, en español y sin la contraseña, se puede enseñar tal cual.</summary>
public sealed class DatabaseSetupException(string message, Exception? inner = null) : Exception(message, inner);

/// <summary>Los errores de MySQL que la aplicación entiende, como server/common/mysql/errors.ts.</summary>
public static class MySqlErrors
{
    /// <summary>Equivalen a SQLITE_CONSTRAINT y se responderán con 409: clave repetida, referencias, CHECK y NOT NULL.</summary>
    public static readonly IReadOnlySet<int> ConstraintNumbers = new HashSet<int> { 1062, 1451, 1452, 3819, 1048 };

    public static bool IsConstraintViolation(Exception error) =>
        error is MySqlException mysql && ConstraintNumbers.Contains(mysql.Number);

    /// <summary>ER_LOCK_DEADLOCK: InnoDB ya ha deshecho la transacción entera, que se puede repetir.</summary>
    public static bool IsDeadlock(Exception error) => error is MySqlException { Number: 1213 };

    /// <summary>
    /// Por qué no se puede usar la base y qué revisar. Nunca incluye la contraseña (MySqlConnector tampoco la pone
    /// en sus mensajes). El host .NET no lee .env: la configuración llega por el entorno.
    /// </summary>
    public static string Explain(Exception error, MySqlSettings settings)
    {
        if (error is DatabaseSetupException setup) return setup.Message;
        var where = $"{settings.Host}:{settings.Port}";
        if (error is MySqlException mysql)
        {
            switch (mysql.ErrorCode)
            {
                case MySqlErrorCode.UnableToConnectToHost:
                    return $"MySQL no responde en {where}. Comprueba que MySQL Server está instalado y en marcha " +
                        "(en Windows, su servicio en Servicios o «Server Status» en MySQL Workbench) y que CUENTAS_DB_HOST y CUENTAS_DB_PORT son correctos.";
                case MySqlErrorCode.AccessDenied:
                    return $"MySQL ha rechazado el usuario «{settings.User}» en {where}: revisa CUENTAS_DB_USER y CUENTAS_DB_PASSWORD " +
                        "(el usuario y la contraseña que creaste en MySQL Workbench).";
                case MySqlErrorCode.UnknownDatabase:
                    return $"La base de datos «{settings.Database}» no existe en MySQL ({where}). Créala en MySQL Workbench (README, «Preparar MySQL») o revisa CUENTAS_DB_NAME.";
                case MySqlErrorCode.DatabaseAccessDenied:
                    return $"El usuario «{settings.User}» no tiene permiso sobre la base de datos «{settings.Database}»: dale permisos en MySQL Workbench (README, «Preparar MySQL»).";
            }
        }
        return $"No se puede usar la base de datos MySQL {settings.Describe()}: {error.Message}";
    }
}
