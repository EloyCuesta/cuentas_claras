# Pruebas

Las pruebas del servidor usan **MySQL de verdad**: un MySQL Server en marcha y las `CUENTAS_DB_*` (del entorno o de `.env`) de un usuario que pueda crear y borrar las bases `cuentas_test_%` y usar `cuentas_claras_e2e` (README, «Pruebas»). Sin MySQL fallan con un mensaje claro; no se saltan ni se sustituyen por SQLite o por falsos.

```bash
npm run check                    # tipos (tsc -b), oxlint y Vitest: lo que tiene que estar en verde siempre
npm test                         # solo Vitest
npx vitest run server/modules/pantry          # una carpeta o un archivo
npx vitest run shared/tickets -t "Lidl"       # solo los tests cuyo nombre encaja
npx playwright install chromium               # la primera vez, para las e2e
npm run test:e2e                              # en el navegador, en escritorio y en móvil
npx playwright test e2e/tickets.spec.ts --project=escritorio
CUENTAS_E2E_CHANNEL=chrome npm run test:e2e   # con el Chrome instalado, si no se puede descargar Chromium
```

## Niveles

| Nivel | Dónde | Qué prueba |
| --- | --- | --- |
| Dominio | `shared/**/*.test.ts` | La lógica pura: dinero, fechas, recurrentes, resumen, copias, CSV, despensa, ritmo, repaso y lectura de tickets. Sin base de datos ni red. |
| Servidor, MySQL | `server/common/mysql/*.test.ts` | Configuración, conexión, migraciones, esquema (tipos, restricciones, colaciones, precisión) y transacciones con dos conexiones. |
| Servidor, casos de uso | `server/modules/finance/finance.test.ts` | Los casos de uso contra una base MySQL de pruebas, también con dos conexiones a la vez. |
| Servidor, API por HTTP | `server/app.test.ts` y `server/modules/*/<módulo>.test.ts` | El servidor de verdad en un puerto libre (`startApi`), con una base MySQL de pruebas y la cookie como un navegador. |
| Servidor, arranque | `server/index.test.ts` y el arranque de `server/modules/auth/auth.test.ts` | `server/index.ts` en otro proceso: sin código no conecta, y sin MySQL o con la base o el usuario mal no arranca y lo explica. |
| Esquema de antes | `tools/sqlite/migrations.test.ts` | Las migraciones 001–005 de SQLite y sus restricciones, contra archivos temporales: la base que lee el importador. |
| Importador | `tools/importer/importSqlite.test.ts` y `tools/importer/cli.test.ts` | Copias sintéticas de cuentas.db pasadas a MySQL: carga completa comprobada, lo que ve después la API, rechazos, fallo y diferencias a mitad (se deshace todo) y el comando con sus códigos de salida, sin enseñar datos. |
| Web | `src/features/**/*.test.ts` | El estado de la revisión de tickets, la preparación de imágenes y la migración del navegador (con IndexedDB en memoria). |
| Arquitectura y documentación | `tests/architecture.test.ts` y `tests/docs.test.ts` | Las reglas de dependencia y que la documentación para agentes esté completa y al día. |
| Navegador | `e2e/*.spec.ts` (Playwright) | La app entera, en escritorio y en móvil (`docs/frontend.md`). |

Un test va junto al código que prueba, con el mismo nombre y `.test.ts`. Los tests quedan fuera de las reglas de arquitectura y pueden importar lo que necesiten.

## Los falsos y los ayudantes

- **Base MySQL de pruebas**: `createTestDatabase()`, `openTestDatabase()` y `connectTestDatabase(nombre)` (`server/common/testing/testDatabase.ts`) crean una base `cuentas_test_<aleatorio>` con las `CUENTAS_DB_*` (nunca `CUENTAS_DB_NAME`) y la abren; `dropTestDatabases()`, en `afterEach`, cierra las conexiones y la borra. Nunca `cuentas_claras` ni `server/data/`.
- **API en un puerto libre**: `startApi(opciones)` y `stopApis()` (`server/common/testing/testApi.ts`), con una base de pruebas nueva o, con `{ database: api.database }`, la de otro servidor (reiniciar, o dos servidores a la vez para las pruebas de dos conexiones). Inicia sesión con `TEST_CODE` salvo `login: false`; `call(método, ruta, cuerpo, { cookie: null })` llama como invitado.
- **El servidor en otro proceso**: `runServer(env)`, `countingListener()` y `closedPort()` (`server/common/testing/serverProcess.ts`), para probar el arranque sin el `.env` de nadie.
- **SQLite temporal** (solo el esquema de antes y el importador): `tempDbPath()` y `removeTempDbs()` (`server/common/testing/tempDb.ts`), una carpeta nueva en el directorio temporal del sistema.
- **Reloj**: `startApi({ clock: { nowMs } })` sustituye solo lo que haga falta. El resto es el reloj de verdad (`server/common/system.ts`). Así se prueba que una sesión caduca a las 12 horas sin esperar: `auth.test.ts` adelanta el reloj. `{ nowISO }` fija las fechas de lo que crea el servidor.
- **Ids**: `startApi({ ids })` con un IdGenerator propio.
- **Lector de tickets**: `startApi({ ticketReader })`. Sin él, un lector que falla si se usa (no arranca Tesseract). `fakeReader()` en `server/modules/tickets/tickets.test.ts` devuelve lo que leyó el OCR de verdad de una imagen de prueba. Las dos primeras pruebas de ese archivo usan Tesseract de verdad y tardan unos segundos.
- **Casos de uso sueltos**: `openFinance()` en `server/modules/finance/finance.test.ts` crea el módulo con su propio pool sobre una base de pruebas y da sus casos de uso con los nombres del contrato de la web. Dos `openFinance` sobre la misma base son dos conexiones, como dos procesos.
- **Datos**: `movement()`, `rule()` y `NOW` en `shared/testing/factories.ts`.

## Guardas que no deben cambiar

- Las huellas de los tickets (`server/modules/tickets/tickets.test.ts`, «las huellas no cambian…»): si cambian, los tickets ya guardados dejarían de reconocerse como duplicados.
- Las migraciones publicadas de MySQL (`server/common/mysql/migrations.test.ts`) y de SQLite (`tools/sqlite/migrations.test.ts`), que no se editan.
- La conexión por defecto (127.0.0.1:3306, base `cuentas_claras`, en `server/common/mysql/config.test.ts`).

## Las pruebas en el navegador

`playwright.config.ts` arranca **su propio** servidor de API (puerto 3101), con su propia base MySQL (`cuentas_claras_e2e`, que `e2e/prepareDatabase.ts` crea si falta) y su propio código de acceso, y **su propia** web (puerto 4174), construida con `npm run build`. Nunca reutiliza un servidor abierto, así que no toca los datos reales ni el `npm run dev` que tengas abierto (3001 y 5173). Con `CUENTAS_TEST=1` el servidor se niega a arrancar contra otra base. Antes de cada prueba vacía la base de datos con `POST /api/test/reset`, que solo existe en ese modo y también exige sesión. Las pruebas inician sesión como el formulario, sin ningún atajo (`e2e/auth.ts`).

## Datos de prueba

Nunca se usan los datos de `server/data/`. Los tickets de prueba están en `fixtures/tickets/`:

- `ticket-lidl-ejemplo.png`, con su lectura y lo que debe salir: un ticket **inventado**.
- `ticket-torrelavega-sintetico.png`: una imagen **sintética**, dibujada imitando un ticket de Lidl con las líneas que el dueño de la app transcribió de un ticket suyo real (Torrelavega, 28/10/26). No es su captura.
- `ticket-cases.json` y los casos de `shared/tickets/ticketCases.test.ts`: incluyen esa **transcripción parcial** de un ticket real, aportada a propósito para probar el lector, y casos escritos a mano.
- `fixtures/tickets/ocr-real/`: lo que leyó Tesseract de verdad de esas imágenes sintéticas (en varias resoluciones y como «foto»).

Cada fixture lleva un campo `provenance` que dice de dónde sale. Si añades una, que sea inventada o sintética, y dilo en ese campo.

Las copias de `cuentas.db` con las que se prueba el importador no son archivos: las crea `tools/importer/syntheticCopy.ts` en la carpeta temporal, con las migraciones 001–005 y datos inventados.

## Caracterización para la migración

Los contratos de BASE-01 están en `fixtures/migration/`: JSON con datos inventados, preparación y peticiones/respuestas completas, separados por módulo y con su procedencia. `server/migrationContracts.test.ts` los ejecuta sobre la API Express real y una base MySQL de pruebas nueva por escenario, con reloj e IDs controlados. Se grabaron con SQLite: que pasen igual sobre MySQL, sin tocar sus expectativas, es la prueba de que cambiar de motor no cambió la API. Las expectativas se revisan y se guardan en el repositorio; ejecutar las pruebas no las regenera. Así podrán reutilizarse desde C# al sustituir el backend. Los tokens de sesión siguen siendo aleatorios: se comprueban sus atributos y funcionamiento, no un valor fijo.

Los seis archivos http-* usan `format: cuentas-claras-http-v1`, `provenance` y `scenarios`. Cada escenario empieza en una base recién migrada, con `setup` (`accessCode`, `now`, `today`, `login`, `testMode`, `ids`) y una secuencia de `steps`. Cada paso tiene nombre, `request` (método, ruta completa con /api, cuerpo opcional y `guest`) y `expected` (estado, cuerpo completo y cabeceras). `advanceMs` adelanta el reloj antes de la petición; `today` sigue siendo la fecha de calendario explícita del escenario. Los IDs se consumen en orden y se comprueba que no sobren ni falten. `login` abre una sesión inicial; después, las cookies recibidas se usan en los siguientes pasos salvo `guest`. Solo se normaliza el token como `<token>` al comparar Set-Cookie, conservando y utilizando su valor real para enviar peticiones. Las cuatro cabeceras comparadas son Cache-Control, Content-Type, Set-Cookie y Retry-After; Date y otras cabeceras del transporte no forman parte del corpus.

`fixtures/migration/rules.json` contiene entradas y salidas de reglas puras, ejecutadas por `tests/migrationRules.test.ts`. Su formato es `cuentas-claras-rules-v1`, con `provenance` y `cases`: cada caso tiene `id`, `description`, `operation`, `input` y `expected`. El ejecutor selecciona la regla indicada y compara el resultado completo, sin completar entradas ni recalcular expectativas. Cubre céntimos y límites, precio desconocido o cero, milésimas, fechas de calendario y redondeo de tickets, incluidas devoluciones y líneas pendientes.

`server/common/http/response.test.ts` caracteriza los errores HTTP, incluidos JSON mal formado, los límites de tamaño y fallos internos. Estas pruebas describen lo observado; las discrepancias y garantías aún pendientes se registran en [STATUS.md](migration/STATUS.md). La concurrencia y los tipos de MySQL se prueban aparte, con dos conexiones (`server/common/mysql/`, los módulos y `ticketAtomicity.test.ts`).

`server/modules/tickets/ticketAtomicity.test.ts` fuerza un error real de MySQL en la segunda línea de un ticket (su id ya está ocupado: clave primaria repetida), después de crear productos y equivalencias y cambiar precios/cantidades. Compara las filas completas de todas las tablas con su estado anterior, vuelve a guardar con éxito al retirar el fallo y rechaza un duplicado sin repetir efectos. No usa triggers: con el registro binario activo, como en una instalación normal de MySQL 8.4, un usuario sin SUPER no puede crearlos (error 1419). Con dos conexiones, prueba también dos guardados iguales a la vez (un 201 y un 409, sin efectos dobles) y un ticket y un + a la vez sobre el mismo producto. Y que una restauración financiera conserva todas las tablas de despensa y tickets.

```bash
npx vitest run server/migrationContracts.test.ts server/common/http/response.test.ts
npx vitest run server/modules/tickets/ticketAtomicity.test.ts
npx vitest run tests/migrationRules.test.ts
npx vitest run tests/docs.test.ts
```

La comprobación documental recorre también las subcarpetas de `docs/`, verifica rutas citadas y enlaces relativos (también los del README) y valida los IDs, estados y dependencias sin ciclos de la tabla de migración. Las rutas de proyectos todavía previstos se escriben como texto, sin presentarlas como archivos existentes. Los resultados reales de cada entrega y las comprobaciones pendientes se mantienen en [el registro de migración](migration/STATUS.md).

## Qué se comprueba

### Ensayo .NET (BASE-02 y DATA-01)

La solución `backend/CuentasClaras.slnx` pide el SDK 10.0.102 en `global.json` (versión publicada en [las notas oficiales de .NET](https://github.com/dotnet/core/blob/main/release-notes/10.0/10.0.2/10.0.2.md)), sin previews y con `rollForward: latestFeature`: vale esa versión o una banda o parche posterior de 10.0, así que actualizar el SDK no rompe `dotnet build`. No afirma que sea el último parche disponible. El único paquete de ejecución es MySqlConnector 2.6.2, en Infrastructure (DATA-01). Las referencias NuGet de pruebas ya estaban en el trabajo retomado: xunit.v3 3.2.2, xunit.runner.visualstudio 3.1.5, Microsoft.NET.Test.Sdk 18.0.1 y Microsoft.AspNetCore.Mvc.Testing 10.0.2. Todas con versiones exactas y locks.

Las pruebas de la categoría MySql usan MySQL real con las CUENTAS_DB_* del entorno: el host .NET no lee .env. Con un usuario limitado a `cuentas\_test\_%` (README, «Pruebas»), en PowerShell:

```powershell
dotnet restore backend/CuentasClaras.slnx --locked-mode
npm run build:dotnet
$env:CUENTAS_DB_HOST = '127.0.0.1'
$env:CUENTAS_DB_PORT = '3306'
$env:CUENTAS_DB_USER = 'cuentas_pruebas'
$env:CUENTAS_DB_PASSWORD = Read-Host 'Contraseña del usuario de pruebas'
npm run test:dotnet
npm run test:dotnet -- --filter "Categoria=MySql"
Remove-Item env:CUENTAS_DB_USER, env:CUENTAS_DB_PASSWORD
$env:CUENTAS_E2E_CHANNEL = 'chrome'
npm run test:e2e:dotnet
```

Sin MySQL, las de la categoría MySql fallan con un mensaje claro (no se saltan); `--filter "Categoria!=MySql"` ejecuta las demás. Las pruebas HTTP arrancan Kestrel en puertos libres, sin base de datos, y prueban los 22 pasos de los tres escenarios de `fixtures/migration/http-auth.json`, sin modificar sus expectativas. También cubren arranque rechazado en proceso real, caducidad/reinicio/renovación de sesión, limitación por IP, proxy fiable, protección de rutas, límites de 20/30 MiB (incluido gzip), JSON erróneo y fallos sin detalles internos. AuthTests cubre las reglas Unicode y los límites temporales con reloj falso, y concurrencia de intentos. ArchitectureTests comprueba proyectos, paquetes, ensamblados y dependencias compiladas (firmas e IL), incluidos módulos, composición y el driver; sus casos negativos verifican que detecta infracciones.

Las de MySQL crean bases `cuentas_test_*` con `backend/tests/CuentasClaras.Tests/TestDatabase.cs` y las borran. Reproducen las de `server/common/mysql/`:
- Migraciones: base nueva con su historial y las categorías del contrato `http-testing.json`, dos inicializaciones sobre una copia sintética (filas, historial y CHECKSUM TABLE iguales), sin sembrar, dos arranques a la vez, la clave de GET_LOCK de Express, versión más nueva, migración a medias y tablas ajenas. Las huellas de los .sql incrustados son las del test de Express.
- Unidad de trabajo, con dos conexiones cuando hace falta: todo o nada, confirmación al final, anidadas con savepoint, bloqueo con nombre, bloqueo primero, fila de bloqueo ausente, interbloqueo reintentado una vez y filas de productos bloqueadas en orden de id.
- Tipos desde C#: la sesión de cada conexión, parámetros (nunca una fecha de .NET), céntimos hasta MAX_CENTS y negativos, milésimas, DATE sin desplazamiento, nulos, claves con mayúsculas/tildes/espacios, índices únicos, restricciones y JSON como texto exacto.
- Host configurado: la salud responde la versión leída de MySQL en cada petición, el código se valida antes de conectar, y un usuario rechazado o una base inexistente se explican sin la contraseña.

`playwright.dotnet.config.ts` usa API en 3202 y Vite en 4175, sin reutilizar procesos, y pasa CUENTAS_DB_USER vacío para que el host no abra ninguna base. La página de `e2e/dotnet/` monta AuthProvider, LoginDialog y SessionPanel existentes y llama a .NET mediante el proxy del mismo origen. Cuatro recorridos combinan escritorio/móvil y claro/oscuro. No prueban todavía el resto de la aplicación contra .NET; los E2E habituales siguen ejecutándose contra Express y `cuentas_claras_e2e`.

Para arrancar la API de ensayo después de compilar, en una terminal propia y contra una base de pruebas que exista (el host no la crea):

```powershell
$env:CUENTAS_CODIGO = 'codigo-local-de-ensayo'
$env:CUENTAS_HOST = '127.0.0.1'
$env:CUENTAS_PORT = '3201'
$env:CUENTAS_DB_USER = 'cuentas_pruebas'
$env:CUENTAS_DB_PASSWORD = Read-Host 'Contraseña del usuario de pruebas'
$env:CUENTAS_DB_NAME = 'cuentas_test_data01'
dotnet run --no-build --project backend/src/CuentasClaras.Api/CuentasClaras.Api.csproj
```

No lee .env automáticamente. Al arrancar aplica las migraciones de `database/mysql/` (y siembra una base nueva) y escribe en la consola la base, sin la contraseña. `/api/health` devuelve 200 con la versión aplicada; sin CUENTAS_DB_USER arranca solo con el acceso y salud devuelve 500. Las rutas pendientes no devuelven datos simulados. Express sigue siendo el servidor de uso diario. Antes de sustituirlo, sigue las dependencias y validaciones de [STATUS](migration/STATUS.md).

### Cobertura de la aplicación actual

| Comprobación | Base de datos (`npm test`) | API HTTP (`npm test`) | Navegador (`npm run test:e2e`) |
| --- | --- | --- | --- |
| Los movimientos se conservan después de recargar | Se cierran las conexiones y se vuelve a abrir | Se reinicia el servidor con la misma base | Se apunta un gasto y se recarga la página |
| Editar o eliminar un movimiento actualiza los totales | Totales del mes tras editar y eliminar | Crear, consultar, modificar y eliminar un gasto | Edición y borrado desde la interfaz |
| Marcar un pago pendiente como pagado no duplica el gasto | Sigue habiendo un solo registro | — | El total pasa de «pendiente» a «pagado» y hay un solo movimiento |
| Abrir varias veces la aplicación no duplica vencimientos | Generación repetida, con dos conexiones a la vez y tras cerrar | Generar dos veces crea 0 la segunda | Tres recargas y dos pestañas nuevas a la vez |
| Exportar y restaurar una copia conserva los datos | Copia → restauración en otra base de datos → datos idénticos | Una copia incoherente se rechaza sin tocar nada | Se descarga la copia, se restaura en una instalación vacía y se compara |

Además:
- **Validación**: la de campos y peticiones (mensajes en español y códigos 400 y 409), que no se puede inyectar SQL, y las restricciones de la base de datos.
- **Migraciones**: se aplican una sola vez (también con dos procesos a la vez), no borran nada, no se abre una base de datos más nueva, una a medias se explica y las publicadas no cambian. Las transacciones: todo o nada, async con una sola conexión, anidadas, bloqueos con nombre y por producto, y un reintento ante un interbloqueo.
- **Concurrencia**, con dos conexiones: vencimientos generados a la vez (`[0, 2]`, sin 409), guardar un recurrente mientras se genera, diez + sobre el mismo producto, un ticket duplicado en paralelo y un ticket con un + a la vez. En el navegador, dos móviles que pulsan + a la vez sobre el mismo producto.
- **Tipos de MySQL**: céntimos hasta el máximo, milésimas, fechas DATE, JSON como texto exacto, colaciones (mayúsculas, tildes y espacios finales) y nombres de 40 caracteres con tildes.
- **Finanzas**: la importación de los datos del navegador (una sola vez, sin mezclar y conservando la copia), la regla del día 31, las cuotas que quedan, el formato del CSV, la proyección de recurrentes y las plantillas mensual y anual.
- **Código de acceso**: arranque sin código, rutas protegidas (401), cookie y caducidad de la sesión, cierre de sesión, sesiones que no sobreviven a un reinicio, y el bloqueo por intentos, por dispositivo y sin poder eludirlo con cabeceras inventadas.
- **Despensa**: personas, productos, presupuesto, unidades, cálculos sin restos decimales, el texto exacto de la lista, comprar y deshacer (también con cambios de otro dispositivo) y que las copias e importaciones financieras no la tocan.
- **Tickets**:
  - el OCR de verdad con las imágenes de prueba;
  - la interpretación de las líneas (cantidades, pesos, descuentos, devoluciones, cifras y letras del IVA mal leídas) y la comprobación con el total;
  - varias capturas seguidas, otras tiendas, lo aprendido y los nombres parecidos;
  - guardar sin duplicar, cambiar una línea, borrar, las huellas, y la validación de las imágenes y las franjas.
- **Ritmo de compra y repaso**:
  - lo que dura cada producto (mediana, escalado por cantidad, compras del mismo día);
  - «Queda», «Queda poco», «Se acabó» y «Lo he comprado», los avisos, la lista y la estimación mensual;
  - cuándo toca el repaso (también la primera vez) y qué se repasa y en qué orden.
- **En el navegador**:
  - el invitado solo ve la despensa y no pide datos financieros ni ejecuta la migración del navegador;
  - persona, producto, lista y enlace de WhatsApp; + y −, comprar y deshacer; dos móviles que pulsan + a la vez y ven la suma de los dos; copiar sin portapapeles;
  - entrar con el código, cerrar sesión y sesión caducada;
  - escanear un ticket, revisarlo, guardarlo y no poder guardarlo dos veces;
  - días después, «Para revisar», «Queda», «Se acabó», la lista y deshacer una compra;
  - el repaso de la semana.
