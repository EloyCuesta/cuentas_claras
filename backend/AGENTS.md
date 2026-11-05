# backend/ — Migración a ASP.NET Core

> Lee antes: [guía raíz](../AGENTS.md), [convenciones](../docs/convenciones.md), [estado](../docs/migration/STATUS.md) y [arquitectura de migración](../docs/migration/ARCHITECTURE.md).

## Qué hace

El host .NET que sustituirá a Express. BASE-02 aporta el acceso; DATA-01, la conexión con el MySQL que ya usa Express: las mismas migraciones de `../database/mysql/`, el mismo historial, transacciones y bloqueos. TIC-01 añade las reglas puras de los tickets, sin rutas: en `src/CuentasClaras.Domain/Tickets/` (lectura del OCR, evidencia, emparejamiento, compra, huellas e historial), con lo común en `src/CuentasClaras.Domain/Common/`, y la validación del cuerpo en `src/CuentasClaras.Application/Tickets/TicketRequests.cs`. Todavía no tiene finanzas, despensa ni rutas de tickets: la aplicación de uso diario sigue siendo Express sobre MySQL, y la web no se dirige a este host. El arranque y las pruebas están en [pruebas](../docs/pruebas.md).

## Acceso

Mismo código, cookie, caducidad y bloqueo que [auth actual](../server/modules/auth/AGENTS.md). CUENTAS_CODIGO se valida antes que CUENTAS_DB_* y antes de conectar con MySQL. Las sesiones y los intentos viven en memoria por host. No hay ruta de reset ni modo de pruebas accesible por HTTP.

## API pública

`src/CuentasClaras.Api/Composition/ApiHost.cs` compone a mano adaptadores y casos de uso:

- `ApiHost.Create`: host sin base de datos, para el ensayo aislado del acceso; permite sustituir reloj y comprobación de almacenamiento.
- `ApiHost.CreateConfigured`: el arranque de Program. Valida el código; sin CUENTAS_DB_USER arranca solo con el acceso; con él abre MySQL, aplica las migraciones, siembra una base nueva y conecta la salud. Un fallo de almacenamiento llega como StartupException, con el mensaje en español y sin la contraseña.

## Casos de uso y rutas

| Ruta | Caso de uso | Estado |
| --- | --- | --- |
| POST /api/auth/login | Login | Valida cuerpo, limita intentos y sustituye la sesión previa solo tras acertar |
| GET /api/auth/me | CheckSession | admin o invitado; HEAD conserva cabeceras sin cuerpo |
| POST /api/auth/logout | Logout | Siempre éxito; invalida token y cookie |
| GET /api/health | CheckHealth | Con MySQL, la versión aplicada que dice `schema_migrations` en cada petición; sin almacenamiento responde 500, nunca inventa una versión |
| Rutas financieras y desconocidas | CheckSession | Sin sesión 401; con sesión 404 mientras no se implemente la ruta |

Las rutas conocidas de despensa/tickets se reservan como públicas pero responden 404 hasta sus entregas. La lista actual sigue en [API](../docs/api.md).

## Puertos

Application posee IClock, IIdGenerator, IUnitOfWork (con LockName: finance o tickets), ISessionStore, IAttemptStore, ICodeVerifier, ITokenGenerator e IStorageHealth, sin tipos del driver. Infrastructure implementa reloj UTC, UUID, memoria, SHA-256 con comparación constante, tokens aleatorios y, en `src/CuentasClaras.Infrastructure/Common/MySql/`, la conexión (MySqlDatabase), las migraciones (MySqlMigrations) y la unidad de trabajo (MySqlUnitOfWork). `src/CuentasClaras.Infrastructure/Health/` tiene la salud sobre MySQL y el fallo explícito sin configurar; `src/CuentasClaras.Infrastructure/Finance/` siembra las categorías iniciales de `src/CuentasClaras.Domain/Finance/DefaultCategories.cs`.

## Reglas que no se rompen

- Capas y módulos: [arquitectura](../docs/migration/ARCHITECTURE.md). Solo Composition de Api conoce Infrastructure. Composición manual, sin contenedor de aplicación ni ORM.
- Domain solo biblioteca estándar; Application solo Domain. Common no conoce módulos. Los módulos solo conocen el propio y Common; Tickets puede consumir contratos de Application.Pantry.Contracts cuando se implementen.
- MySqlConnector 2.6.2, con versión exacta y solo en Infrastructure: ni Api ni las capas puras usan sus tipos (ArchitectureTests). Ninguna dependencia nueva más sin preguntar; los locks se actualizan con el restore.
- El esquema es el de `../database/mysql/`, incrustado en el ensamblado: .NET no tiene migraciones propias ni edita las publicadas. La clave de GET_LOCK, los estados del historial, los mensajes y la siembra son los de `../server/common/mysql/migrations.ts`.
- SQL explícito con parámetros «?»: texto, números finitos o null; nunca una fecha de .NET. Cada conexión fija utf8mb4_0900_bin, el modo estricto y REPEATABLE READ. El bloqueo de app_locks va antes que cualquier lectura y las filas de productos se bloquean en orden de id.
- C# con nullable y avisos como errores. Mantén los archivos y comentarios en el estilo existente; nombres de tests y comentarios en español.
- Cada host tiene sus almacenes y un Login compartido. Su sección crítica protege la operación completa de intentos y sesiones concurrentes.
- El lector JSON precede al acceso y al router. Cuenta bytes descomprimidos: 30 MiB para lectura de tickets, 20 MiB en el resto. Todos los errores de aplicación usan sobre JSON español y no-store.
- El proxy solo es fiable desde loopback. No sustituyas esa regla por confiar en todas las cabeceras X-Forwarded-For.
- Nunca leer server/data ni cargar .env automáticamente. La configuración local se pasa por entorno.

## Datos

Sesiones e intentos efímeros; los datos son los de MySQL, con los tipos de [DATA.md](../docs/migration/DATA.md): céntimos en BIGINT (long), milésimas en DECIMAL (decimal), fechas DATE leídas como AAAA-MM-DD con MySqlRead.Date, JSON de tickets como texto exacto. Una base nueva recibe las 27 categorías iniciales en la transacción que completa la migración 5; una existente no se vuelve a sembrar.

## Pruebas

`tests/CuentasClaras.Tests/AuthTests.cs`: política, casos de uso y adaptadores de acceso.
`tests/CuentasClaras.Tests/HttpTests.cs`: Kestrel real sin base de datos, corpus HTTP compartido, límites, errores, proxy y proceso de arranque.
`tests/CuentasClaras.Tests/ArchitectureTests.cs`: referencias de proyectos/ensamblados, paquetes y dependencias de tipos e IL entre capas y módulos, incluido el driver; que Domain.Tickets no usa Domain.Pantry y que las reglas de tickets no leen el reloj ni el azar.
`tests/CuentasClaras.Tests/TicketRulesCorpusTests.cs`: las reglas de tickets dan exactamente el corpus de TypeScript (`../fixtures/migration/rules-tickets.json`, 510 casos) y las reglas de tickets de `../fixtures/migration/rules.json`, en es-ES y en la invariante. El ejecutor y los mapeos a JSON están en `TicketRulesCorpus.cs` y `CorpusJson.cs`.
`tests/CuentasClaras.Tests/MySqlMigrationTests.cs`, `MySqlUnitOfWorkTests.cs`, `MySqlSchemaTests.cs` y `MySqlHostTests.cs`: contra MySQL real (categoría MySql), con bases `cuentas_test_*` de `TestDatabase.cs` que se borran al terminar.
`../e2e/dotnet/auth.spec.ts`: componentes reales React sobre .NET, escritorio/móvil y claro/oscuro, sin base de datos.

Los comandos y el alcance exacto están en [pruebas](../docs/pruebas.md). Los resultados de cada tarea van en [STATUS](../docs/migration/STATUS.md).

## Trampas y decisiones

- CUENTAS_PORT usa 3201 por defecto para convivir con Express; puerto 0 se reserva a ensayos con puerto libre.
- Sin CUENTAS_DB_USER el host arranca solo con el acceso y lo dice en la consola. `playwright.dotnet.config.ts` lo pasa vacío a propósito: Playwright añade su `env` al del proceso, y con CUENTAS_DB_* heredadas el host abriría y migraría la base, por defecto cuentas_claras.
- Las pruebas MySQL necesitan CUENTAS_DB_* en el entorno (el host no lee .env) y fallan con un mensaje claro si faltan: no se saltan. Usa un usuario limitado a `cuentas\_test\_%`.
- El pool de MySqlConnector reinicia la sesión al devolver cada conexión: por eso SESSION_SETUP se ejecuta en cada apertura. Dentro de una transacción las consultas van en serie (una conexión no admite dos a la vez).
- MySqlConnector admite varias sentencias en un mismo texto: «una sentencia por llamada» se cumple por convención, y los valores siempre van como parámetros.
- La salud lee schema_migrations en cada petición, también para comprobar que MySQL responde.
- La página e2e monta solo acceso: no demuestra finanzas ni despensa sobre .NET.
- Los mensajes históricos que mencionan npm run dev o .env se conservan por compatibilidad. El arranque .NET se configura como indica la documentación de pruebas.
- Reglas portadas de TypeScript: usa `src/CuentasClaras.Domain/Common/` y no lo de .NET por defecto. Math.round es JsNumber.Round (Math.Round va al par); String(x) y toFixed, JsNumber; trim y \s, JsText (string.Trim quita U+0085 y deja U+FEFF); mayúsculas y minúsculas, JsCase (ToUpperInvariant no expande «ß» ni pasa «ı» a «I»; sus tablas salen de Node con `../tests/generateJsCaseData.ts`); JSON.stringify, JsJson (System.Text.Json escapa comillas y lo que no es ASCII); las expresiones regulares, JsRegex (\d, \b, \s, «.», «$» y la bandera i). Ordena con StringComparer.Ordinal y OrderBy (estable); recorre en orden de inserción con una lista, no con Dictionary ni HashSet; suma dobles en un bucle; InvariantCulture siempre.
- El cuerpo de las rutas de tickets (TIC-02 y TIC-03) se pasa a TicketRequests como JsonElement, sin cuerpo = Undefined. JsonInput lee los sustitutos sueltos que GetString rechaza. Al responder, ojo: un objeto de JavaScript (Record) pone primero las claves que son índices enteros.
- El Hasher de las huellas (TIC-02) tiene que pasar los textos a UTF-8 con U+FFFD en los sustitutos sueltos, como Node: Encoding.UTF8, no un codificador que lance.

## Si cambias este módulo

Actualiza esta guía, el estado de migración y la API si cambia un contrato; los cambios de arquitectura deben quedar cubiertos por ArchitectureTests. Mantén CLAUDE.md junto a esta guía y pasa las comprobaciones .NET y Node indicadas en la raíz.
