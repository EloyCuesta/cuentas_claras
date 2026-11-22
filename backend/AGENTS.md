# backend/ — Migración a ASP.NET Core

> Lee antes: [guía raíz](../AGENTS.md), [convenciones](../docs/convenciones.md), [estado](../docs/migration/STATUS.md) y [arquitectura de migración](../docs/migration/ARCHITECTURE.md).

## Qué hace

El host .NET que sustituirá a Express. BASE-02 aporta el acceso; DATA-01, la conexión con el MySQL que ya usa Express: las mismas migraciones de `../database/mysql/`, el mismo historial, transacciones y bloqueos. TIC-01 añade las reglas puras de los tickets: en `src/CuentasClaras.Domain/Tickets/` (lectura del OCR, evidencia, emparejamiento, compra, huellas e historial), con lo común en `src/CuentasClaras.Domain/Common/`, y la validación del cuerpo en `src/CuentasClaras.Application/Tickets/TicketRequests.cs`. Las funcionalidades llegan por ID (FIN-01…05, las finanzas; PAN-01 a PAN-03, la despensa entera; TIC-02 a TIC-04, los tickets enteros con el OCR local; desde TIC-04, las 39 rutas de Express; el estado de cada uno, en [STATUS](../docs/migration/STATUS.md)). La aplicación de uso diario sigue siendo Express sobre MySQL; la web React se dirige a este host solo en el ensayo. El arranque y las pruebas están en [pruebas](../docs/pruebas.md).

## Acceso

Mismo código, cookie, caducidad y bloqueo que [auth actual](../server/modules/auth/AGENTS.md). CUENTAS_CODIGO se valida antes que CUENTAS_DB_* y antes de conectar con MySQL. Las sesiones y los intentos viven en memoria por host. No hay ruta de reset ni modo de pruebas accesible por HTTP.

## API pública

`src/CuentasClaras.Api/Composition/ApiHost.cs` compone a mano adaptadores y casos de uso:

- `ApiHost.Create`: host sin base de datos, para el ensayo aislado del acceso; permite sustituir reloj y comprobación de almacenamiento. Sus rutas de datos existen, pero cualquier consulta da 500 (MySqlDatabase.Unconfigured), como la salud.
- `ApiHost.CreateWithDatabase`: sobre una MySqlDatabase ya abierta, con reloj e ids sustituibles: las pruebas de integración y el corpus HTTP (como startApi en Express).
- `ApiHost.CreateConfigured`: el arranque de Program. Valida el código; sin CUENTAS_DB_USER arranca solo con el acceso; con él abre MySQL, aplica las migraciones, siembra una base nueva y conecta la salud. Un fallo de almacenamiento llega como StartupException, con el mensaje en español y sin la contraseña.
- `ApiHost.HostRoutes` y `ApiHost.ModuleRoutes`: el inventario de rutas, para las pruebas.

Cada módulo registra sus rutas en una ApiRouteTable (`src/CuentasClaras.Api/Common/ApiRoutes.cs`) desde `Api/<Módulo>/`, con sus casos de uso ya compuestos; Composition (MapModules) los construye en el orden de `../server/app.ts`.

## Casos de uso y rutas

| Ruta | Caso de uso | Estado |
| --- | --- | --- |
| POST /api/auth/login | Login | Valida cuerpo, limita intentos y sustituye la sesión previa solo tras acertar |
| GET /api/auth/me | CheckSession | admin o invitado; HEAD conserva cabeceras sin cuerpo |
| POST /api/auth/logout | Logout | Siempre éxito; invalida token y cookie |
| GET /api/health | CheckHealth | Con MySQL, la versión aplicada que dice `schema_migrations` en cada petición; sin almacenamiento responde 500, nunca inventa una versión |
| GET /api/data | FinanceQueries.LoadAll | FIN-01. Categorías, movimientos y recurrentes, por id, en una transacción sin bloqueo |
| PUT /api/data | RestoreBackup | FIN-02 (adelantado de FIN-05: los corpus lo usan para preparar). Valida todo y sustituye las finanzas en una transacción; no toca metadatos ni despensa |
| POST /api/import | ImportBrowserData | FIN-05. `{ data, lastBackupAt }` del navegador (IndexedDB) → 201 con los recuentos; 409 si ya hay datos del usuario (hasUserData: la despensa no cuenta); conserva la fecha de copia que hubiera y anota browserImportAt |
| PUT /api/movements/:id | SaveMovement | FIN-02. Actualizar por id (filas encontradas) y, si no existía, insertar; 409 propio si choca con un vencimiento que ya existe |
| DELETE /api/movements/:id | DeleteMovement | FIN-02. Si era un vencimiento de un recurrente que sigue existiendo, su fecha queda excluida; sin el movimiento, nada |
| PUT /api/categories/:id | SaveCategory | FIN-01. Valida el cuerpo (FinanceRequests) antes del id de la URL; un nivel de subcategorías del mismo tipo; 409 si cambia de tipo |
| DELETE /api/categories/:id | DeleteCategory | FIN-01. `?replacementId` de un solo valor no vacío; reasignar y borrar en una transacción con el bloqueo finance |
| PUT /api/recurring/:id | SaveRecurring | FIN-03. `{ rule, horizon, markPaidBefore }`: guarda la regla y sus fechas excluidas, rehace los pendientes (los pagados se quedan) y crea ya pagado lo anterior a markPaidBefore; devuelve `{ created }` |
| DELETE /api/recurring/:id | DeleteRecurring | FIN-03. Borra la regla y sus pendientes; los pagados se conservan con su recurringId |
| POST /api/occurrences/generate | GenerateOccurrences | FIN-03. `{ horizon }` (lo calcula la web): crea lo que falte, sin duplicar aunque generen dos conexiones a la vez (bloqueo finance) |
| GET/PUT /api/meta/:key | FinanceQueries.GetMeta, SetMeta | FIN-01. Solo lastBackupAt y browserImportAt (404); el valor, un texto de hasta 100 |
| GET /api/summary/month, GET /api/summary/year | SummaryQueries (FinanceSummaries) | FIN-04, solo en .NET. MonthView y YearView de `../shared/finance/summaryViews.ts` con la fecha `hoy` del navegador; contrato en [API](../docs/api.md) |
| GET/POST /api/despensa/personas, PUT/DELETE /api/despensa/personas/:id | PantryQueries.ListPeople, CreatePerson, RenamePerson, DeletePerson | PAN-01, públicas. Por nombre con localeCompare('es') (JsCollator); 409 si la persona tiene productos |
| GET/POST /api/despensa/productos, PUT/DELETE /api/despensa/productos/:id | PantryQueries.ListItems, CreateItem, UpdateItem, DeleteItem | PAN-01, públicas. Por frecuencia y nombre; editar exige `expectedVersion` (409 si cambió, con el producto bloqueado) |
| POST /api/despensa/productos/:id/ajustar | AdjustItem | PAN-02. `{ delta }` sobre la cantidad del servidor, con el producto bloqueado; nunca bajo cero |
| POST /api/despensa/comprado, POST /api/despensa/comprado/deshacer | MarkPurchased (con AddEvent), UndoPurchase | PAN-02. Bloquean los productos en orden de id; comprar completa lo que se cuenta y apunta «comprado» en lo que va por compras; deshacer, 409 sin tocar nada si algo cambió |
| POST /api/despensa/productos/:id/revision, DELETE /api/despensa/revisiones/:id | AddEvent, DeleteEvent | PAN-03. `{ kind, date }` → 201; la revisión no cambia el producto |
| GET/PUT /api/despensa/presupuesto, PUT /api/despensa/repaso | PantryActivityQueries.Settings, SetBudget, SetReviewDate | PAN-03. `{ monthlyBudgetCents, lastReviewDate }`; 0 es un presupuesto, null lo quita |
| POST /api/despensa/tickets/leer | ReadTicket (TicketReadRequest, TicketDuplicates) | TIC-02, pública. `{ texto }`, `{ imagenes }` o `{ franjas }` y `hoy` → el borrador (no guarda nada); el OCR, por ITicketReader (el worker Node, abajo) |
| POST /api/despensa/tickets | SaveTicket | TIC-03, pública. TicketSaveInput → 201 `{ ticket, items }`, todo o nada con el bloqueo tickets y los productos que cambian bloqueados antes de leer; 409 si ya estaba guardado o es un posible duplicado sin confirmar |
| GET /api/despensa/tickets, GET /api/despensa/tickets/:id | TicketQueries | TIC-04. Los últimos 100 (resumen) y uno entero (404 «Ese ticket ya no existe.») |
| PUT /api/despensa/tickets/:id/lineas/:lineId, DELETE /api/despensa/tickets/:id | SetLineItem, DeleteTicket | TIC-04, con el bloqueo tickets. Cambiar una línea cambia las iguales y lo aprende; borrar quita sus compras de la actividad y deja productos y cantidades |
| GET /api/despensa/actividad | PantryActivityQueries.Activity | PAN-03. Compras de los tickets (por IPantryPurchaseHistory, que implementa `src/CuentasClaras.Infrastructure/Tickets/MySqlTicketPurchaseHistory.cs`) y revisiones de los últimos 400 días; `hoy` del navegador o, si falta o no vale, la del servidor |
| Rutas desconocidas | CheckSession | Como requireAdmin en Express: sin sesión 401; con sesión 404 |

`tests/CuentasClaras.Tests/HttpContractTests.cs` comprueba que .NET atiende exactamente los 39 pares de Express (más las dos consultas de resumen) y que cada uno tiene un paso 2xx en los contratos.

## Puertos

Application posee IClock (NowMs, NowIso y Today, la fecha de reserva del servidor), IIdGenerator, IUnitOfWork (con LockName: finance o tickets), ISessionStore, IAttemptStore, ICodeVerifier, ITokenGenerator e IStorageHealth, sin tipos del driver, y cada módulo los suyos: IFinanceStore en `src/CuentasClaras.Application/Finance/FinancePorts.cs` e IPantryStore en `src/CuentasClaras.Application/Pantry/PantryPorts.cs`. Lo que Tickets puede usar de la despensa está en `src/CuentasClaras.Application/Pantry/Contracts/PantryContracts.cs` (IPantryCatalog, que implementa PantryCatalog). Infrastructure implementa reloj, UUID, memoria, SHA-256 con comparación constante, tokens aleatorios y, en `src/CuentasClaras.Infrastructure/Common/MySql/`, la conexión (MySqlDatabase), las migraciones (MySqlMigrations) y la unidad de trabajo (MySqlUnitOfWork). `src/CuentasClaras.Infrastructure/Health/` tiene la salud sobre MySQL y el fallo explícito sin configurar; `src/CuentasClaras.Infrastructure/Finance/` siembra las categorías iniciales de `src/CuentasClaras.Domain/Finance/DefaultCategories.cs` y guarda las finanzas con el SQL de Express (MySqlFinanceStore); `src/CuentasClaras.Infrastructure/Pantry/MySqlPantryStore.cs`, la despensa (DECIMAL(10,3) leído y escrito como texto decimal exacto).

## Reglas que no se rompen

- Capas y módulos: [arquitectura](../docs/migration/ARCHITECTURE.md). Solo Composition de Api conoce Infrastructure. Composición manual, sin contenedor de aplicación ni ORM.
- Domain solo biblioteca estándar; Application solo Domain. Common no conoce módulos. Los módulos solo conocen el propio y Common; Tickets puede consumir los contratos de Application.Pantry.Contracts.
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
`tests/CuentasClaras.Tests/TicketRulesCorpusTests.cs`: las reglas de tickets dan exactamente el corpus de TypeScript (`../fixtures/migration/rules-tickets.json`, 520 casos) y las reglas de tickets de `../fixtures/migration/rules.json`, en es-ES y en la invariante. El ejecutor y los mapeos a JSON están en `TicketRulesCorpus.cs` y `CorpusJson.cs`.
`tests/CuentasClaras.Tests/MySqlMigrationTests.cs`, `MySqlUnitOfWorkTests.cs`, `MySqlSchemaTests.cs` y `MySqlHostTests.cs`: contra MySQL real (categoría MySql), con bases `cuentas_test_*` de `TestDatabase.cs` que se borran al terminar.
`tests/CuentasClaras.Tests/FinanceRulesCorpusTests.cs`: la validación de finanzas da exactamente el corpus de TypeScript (`../fixtures/migration/rules-finance.json`), en es-ES y en la invariante; el ejecutor, `FinanceRulesCorpus.cs`. Lo mismo con la despensa: `tests/CuentasClaras.Tests/PantryRulesCorpusTests.cs` y `../fixtures/migration/rules-pantry.json` (más que TicketVocabulary coincide con PantryRules).
`tests/CuentasClaras.Tests/FinanceHttpTests.cs`, `MovementHttpTests.cs` y `RecurringHttpTests.cs` (MySql, con dos conexiones para generar a la vez): las rutas de finanzas por HTTP sobre Kestrel y MySQL (`TestApi.cs`), con los mensajes y las rarezas de Express; la sustitución de categorías y la restauración, deshechas enteras si fallan a mitad.
`tests/CuentasClaras.Tests/PantryHttpTests.cs` (MySql): personas y productos como invitado, con los mensajes de Express; la edición con `expectedVersion` (400, 404 antes que 409, 409 sin escribir) y dos conexiones editando el mismo producto (una guarda, la otra 409); IPantryCatalog dentro de una transacción de tickets.
`tests/CuentasClaras.Tests/PantryPurchaseHttpTests.cs` (MySql): + y − (diez a la vez desde dos conexiones), comprar, deshacer (y un deshacer a la vez que un +), y lo que deja un ticket (IPantryCatalog.ApplyTicketPurchase).
`tests/CuentasClaras.Tests/PantryReviewHttpTests.cs` (MySql): revisiones, presupuesto y repaso, y la actividad con tickets sembrados por SQL (ventana de 400 días, orden, líneas que no cuentan y el `hoy` que no vale).
`tests/CuentasClaras.Tests/TicketReadHttpTests.cs` (MySql): la lectura con un lector falso (el OCR guardado del ticket de ejemplo), el primer paso de `../fixtures/migration/http-tickets.json` exacto, la validación y los límites de imágenes y franjas, y los duplicados por origen, por contenido y posibles. `tests/CuentasClaras.Tests/TicketReadCorpusTests.cs`: el corpus `../fixtures/migration/rules-ticket-read.json` (base64 de Node, cabeceras PNG/JPEG y el cuerpo de la lectura). `OcrWorkerTests` (categoría Ocr, en el mismo archivo que las HTTP): el worker real con las dos imágenes de `../fixtures/tickets/`; necesita Node y node_modules.
`tests/CuentasClaras.Tests/TicketSaveHttpTests.cs` (MySql): guardar como `../server/modules/tickets/tickets.test.ts` (productos nuevos, lo aprendido, precio y cantidad, decisiones, líneas dudosas, huellas golden) y `../server/modules/tickets/ticketAtomicity.test.ts` (un fallo real de MySQL en la segunda línea no deja nada, dos guardados iguales a la vez dan 201 y 409, también sin productos que bloquear, y un ticket y un + a la vez no se pisan), y cambiar una línea y borrar tickets (TIC-04).
`tests/CuentasClaras.Tests/ImportHttpTests.cs` (MySql): la importación del navegador, y que restaurar e importar dejan intactas (CHECKSUM TABLE) las tablas de la despensa y los tickets.
`tests/CuentasClaras.Tests/SummaryHttpTests.cs` (MySql): las consultas de resumen responden exactamente lo que calculó TypeScript (los casos «api-*» del corpus de finanzas), restaurando sus datos.
`tests/CuentasClaras.Tests/HttpContractTests.cs` (MySql): los corpus `http-health`, `http-finance`, `http-pantry` y `http-tickets` sobre .NET, una base por escenario (los seis activos desde TIC-04), y el inventario de rutas.
`../e2e/dotnet/auth.spec.ts`: componentes reales React sobre .NET, escritorio/móvil y claro/oscuro, sin base de datos. La app completa contra .NET (todos los `../e2e/*.spec.ts`): `../e2e/AGENTS.md`.

Los comandos y el alcance exacto están en [pruebas](../docs/pruebas.md). Los resultados de cada tarea van en [STATUS](../docs/migration/STATUS.md).

## Trampas y decisiones

- CUENTAS_PORT usa 3201 por defecto para convivir con Express; puerto 0 se reserva a ensayos con puerto libre.
- Sin CUENTAS_DB_USER el host arranca solo con el acceso y lo dice en la consola. `playwright.dotnet.config.ts` lo pasa vacío a propósito: Playwright añade su `env` al del proceso, y con CUENTAS_DB_* heredadas el host abriría y migraría la base, por defecto cuentas_claras.
- Las pruebas MySQL necesitan CUENTAS_DB_* en el entorno (el host no lee .env) y fallan con un mensaje claro si faltan: no se saltan. Usa un usuario limitado a `cuentas\_test\_%`.
- El pool de MySqlConnector reinicia la sesión al devolver cada conexión: por eso SESSION_SETUP se ejecuta en cada apertura. Dentro de una transacción las consultas van en serie (una conexión no admite dos a la vez).
- MySqlConnector admite varias sentencias en un mismo texto: «una sentencia por llamada» se cumple por convención, y los valores siempre van como parámetros.
- La salud lee schema_migrations en cada petición, también para comprobar que MySQL responde.
- La página e2e de `../e2e/dotnet/` monta solo acceso; la app completa contra .NET va en los proyectos app-* de `../playwright.dotnet.config.ts`.
- Api no puede tocar tipos de Domain (ArchitectureTests): los casos de uso reciben el cuerpo como JsonElement y devuelven vistas de Application (FinanceViews, PantryViews), y los validadores que usan Domain.Common viven en Application (FinanceRequests, PantryRequests, TicketRequests).
- Como Express: un escape «%» mal formado en un parámetro de una ruta que coincide da 500 INTERNAL (decodeURIComponent, `src/CuentasClaras.Api/Common/UriText.cs`), y un parámetro de la query repetido no es un texto. Las restricciones de MySQL dan el 409 genérico por el clasificador que pasa Composition (MySqlErrors.IsConstraintViolation); las que tienen mensaje propio las traduce el adaptador.
- Los double de las respuestas se escriben como JSON.stringify (JsDoubleConverter): 0.8 y no 0.800.
- localeCompare('es') es JsCollator (`src/CuentasClaras.Domain/Common/JsCollator.cs`), con CompareInfo de «es»: necesita la globalización ICU (Windows 10 1903 o posterior); el corpus compara una matriz de nombres con Node. Ordena con OrderBy (estable), nunca con List.Sort.
- Los resúmenes (FIN-04) son consultas de Application (`src/CuentasClaras.Application/Finance/FinanceSummaries.cs`) que devuelven sus vistas: los mapas de JavaScript se recorren en orden de inserción y los empates se rompen igual.
- Los mensajes históricos que mencionan npm run dev o .env se conservan por compatibilidad. El arranque .NET se configura como indica la documentación de pruebas.
- Reglas portadas de TypeScript: usa `src/CuentasClaras.Domain/Common/` y no lo de .NET por defecto. Math.round es JsNumber.Round (Math.Round va al par); String(x) y toFixed, JsNumber; trim y \s, JsText (string.Trim quita U+0085 y deja U+FEFF); mayúsculas y minúsculas, JsCase (ToUpperInvariant no expande «ß» ni pasa «ı» a «I»; sus tablas salen de Node con `../tests/generateJsCaseData.ts`); JSON.stringify, JsJson (System.Text.Json escapa comillas y lo que no es ASCII); las expresiones regulares, JsRegex (\d, \b, \s, «.», «$» y la bandera i). Ordena con StringComparer.Ordinal y OrderBy (estable); recorre en orden de inserción con una lista, no con Dictionary ni HashSet; suma dobles en un bucle; InvariantCulture siempre.
- El cuerpo de las rutas de tickets (TIC-02 y TIC-03) se pasa a TicketRequests como JsonElement, sin cuerpo = Undefined. JsonInput lee los sustitutos sueltos que GetString rechaza. Al responder, ojo: un objeto de JavaScript (Record) pone primero las claves que son índices enteros.
- La evidencia de una línea se guarda como la deja validateTicketSave (sin la posición en la imagen, en su orden) y los ajustes como TicketAdjustmentView; al leerlos se devuelven tal cual (JSON en texto), también los que guardó Express.
- El Hasher de las huellas (TIC-02) tiene que pasar los textos a UTF-8 con U+FFFD en los sustitutos sueltos, como Node: Encoding.UTF8, no un codificador que lance.

## Si cambias este módulo

Actualiza esta guía, el estado de migración y la API si cambia un contrato; los cambios de arquitectura deben quedar cubiertos por ArchitectureTests. Mantén CLAUDE.md junto a esta guía y pasa las comprobaciones .NET y Node indicadas en la raíz.
