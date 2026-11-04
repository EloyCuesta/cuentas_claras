# Estado y tareas de la migración

Última actualización: 4 de noviembre de 2026. Este archivo es el registro de continuidad de los agentes; actualízalo al terminar cada tarea.

## Estado comprobado

| Aspecto | Estado y evidencia |
| --- | --- |
| Referencia actual | Rama feat/mysql, creada desde refactor/arquitectura-hexagonal (`700d750`); documentos recuperados de `9d1df17` |
| Referencia documental histórica | `91832a52b987b8e89f270ee86b4a95b8a4ddad15`, main del 30 de octubre de 2026 |
| Backend ejecutable | Node.js + Express, en `server/`, sobre MySQL desde MYSQL-02 (mysql2, migraciones de `database/mysql/`); el servidor ya no abre SQLite |
| Frontend | React + TypeScript + Vite, en `src/`; reglas compartidas en `shared/` |
| Backend .NET | Host de acceso en `backend/` (BASE-02, implementado): compila con el SDK 10.0.114; sus pruebas no se han podido restaurar en el entorno del agente (registro BASE-02) |
| Persistencia MySQL e importación | MYSQL-01: conexión, transacciones, bloqueos y esquema en `database/mysql/`. MYSQL-02: finanzas, despensa y tickets sobre MySQL con bloqueos, probados contra MySQL 8.4.11. El importador llega en MYSQL-03 |
| Inventario actual | 39 pares método/ruta de aplicación y uno exclusivo de pruebas; 12 tablas de aplicación, `schema_migrations` y `app_locks` en MySQL; el esquema SQLite de antes en `tools/sqlite/` |
| Datos reales del usuario | Fuera del alcance de agentes; no se han leído ni importado ni se afirma equivalencia de filas reales |
| Resultado de esta entrega | MYSQL-02 verificada: la API completa sobre MySQL, contratos de BASE-01 sin tocar y E2E sobre `cuentas_claras_e2e` |
| Pruebas de aplicación de esta entrega | Ver el registro MYSQL-02 |

Este resumen distingue la rama actual de la referencia histórica. Cuando cambie el runtime, actualiza las filas afectadas y enlaza la evidencia; conserva la referencia histórica para entender el origen.

## Estados permitidos

- `pendiente`: no implementado.
- `en_curso`: trabajo iniciado y todavía incompleto.
- `implementado`: existe código, pero queda validación necesaria.
- `verificado`: cumple la aceptación con evidencia de las comprobaciones correspondientes.
- `bloqueado`: falta un requisito concreto; registra cuál, qué se pudo completar y qué permite avanzar.

Una dependencia se considera cerrada cuando está `verificado`. Para elegir el siguiente trabajo, recorre la tabla y selecciona la primera pendiente cuyas dependencias estén verificadas. Las tareas de datos reales bloqueadas no impiden desarrollar reglas o integraciones independientes con datos sintéticos.

## Plan por módulos y funcionalidades

La aceptación detallada está en [MODULES.md](MODULES.md), [ARCHITECTURE.md](ARCHITECTURE.md) y [DATA.md](DATA.md). No cierres una fila porque solo existan carpetas o interfaces.

| ID | Entrega | Dependencias | Estado |
| --- | --- | --- | --- |
| DOC-01 | Contexto para Codex, arquitectura, datos, módulos, tareas y prompts | — | verificado |
| BASE-01 | Caracterización de contratos/fixtures, inventario confirmado y línea base ejecutada con resultados registrados | DOC-01 | verificado |
| BASE-02 | Solución .NET, composición, host/configuración, acceso, envoltorios HTTP y pruebas de arquitectura | BASE-01 | implementado |
| MYSQL-01 | Base: configuración, conexión, UnitOfWork asíncrono, esquema MySQL y ayudantes de prueba | BASE-01 | verificado |
| MYSQL-02 | Finanzas, despensa y tickets sobre MySQL, con bloqueos. La API completa funciona y pasan los contratos de BASE-01 | MYSQL-01 | verificado |
| MYSQL-03 | Importador SQLite→MySQL con informe | MYSQL-02 | pendiente |
| MYSQL-04 | E2E sobre MySQL, documentación, better-sqlite3 fuera del runtime y pasos del corte | MYSQL-02, MYSQL-03 | pendiente |
| DATA-01 | Acceso de .NET al MySQL ya migrado: conexión, transacciones y bloqueos sobre `database/mysql/`, sin esquema propio, con pruebas de tipos/índices/JSON desde C# | BASE-02, MYSQL-04 | pendiente |
| FIN-01 | Lectura de finanzas, categorías, presupuestos de categoría y metadatos; primer recorrido React | DATA-01 | pendiente |
| FIN-02 | Movimientos, pagos, eliminación e IDs estables ante reintentos | FIN-01 | pendiente |
| FIN-03 | Recurrentes, exclusiones, cuotas y generación sin duplicados concurrentes | FIN-02 | pendiente |
| FIN-04 | Consultas de resumen mensual/anual y previsión, con integración React y equivalencia | FIN-03 | pendiente |
| FIN-05 | Copia/restauración financiera y exportaciones conservadas, sin afectar despensa | FIN-03 | pendiente |
| PAN-01 | Personas, catálogo y edición con expectedVersion y conflicto visible en React | DATA-01 | pendiente |
| PAN-02 | Ajustes de cantidad, comprar y deshacer de forma atómica | PAN-01 | pendiente |
| PAN-03 | Revisiones, actividad, ritmo, lista, presupuesto de despensa y repaso semanal | PAN-02 | pendiente |
| TIC-01 | Reglas puras de parsing, evidencia, emparejamiento y plan de guardado equivalentes | BASE-02 | pendiente |
| TIC-02 | Lectura OCR/texto/franjas mediante puerto local e integración de la revisión | TIC-01, PAN-01 | pendiente |
| TIC-03 | Guardado transaccional, deduplicación y efectos de compra sobre Pantry | TIC-02, PAN-02 | pendiente |
| TIC-04 | Historial, detalle, asociación, borrado y efectos sobre actividad/ritmo | TIC-03, PAN-03 | pendiente |
| DATA-02 | Validación del corte de datos real: la persona importa su copia con la herramienta de MYSQL-03, revisa el informe y se registra el resultado | MYSQL-03 | pendiente |
| CUT-01 | E2E completos contra .NET sobre la misma base MySQL, backup/restauración, ensayo final, cambio de backend y retirada de dependencias obsoletas | FIN-04, FIN-05, PAN-03, TIC-04, DATA-02 | pendiente |

La fase MYSQL cambia el motor antes que el backend: Express pasa de SQLite a MySQL con la misma API, y el esquema (`database/mysql/`) y el importador salen de ella. Por eso DATA-01 ya no crea el esquema, DATA-02 queda como la validación con los datos de la instalación y CUT-01 cambia el backend, no el motor. Ese corte de datos lo hace la persona, no un agente: `DATA-02` no se cierra con ensayos sintéticos, y `CUT-01` no se cierra sin él.

## Decisiones y verificaciones pendientes

| Elemento | Estado | Evidencia necesaria |
| --- | --- | --- |
| SDK .NET | `global.json` pide 10.0.102 con `rollForward: latestFeature`: vale 10.0.102 o una banda/parche posterior de 10.0 (comprobado con 10.0.114) | Restore y tests de `backend/` en un equipo con acceso a nuget.org |
| Proveedor .NET para MySQL | Propuesta, sin autorizar: MySqlConnector con SQL explícito sobre `database/mysql/`. Pomelo.EntityFrameworkCore.MySql no tiene versión para EF Core 10 y AGENTS.md prohíbe los ORM | Autorización de la dependencia, versión estable exacta, restore/build y pruebas contra MySQL (DATA-01) |
| MySQL de la instalación | Las pruebas del agente usan MySQL Server 8.4 de Ubuntu 26.04 en Linux (8.4.8 en MYSQL-01; 8.4.11, con el registro binario activo como en una instalación normal, desde MYSQL-02) | `npm run check` y `npm run test:e2e` en Windows con el MySQL Server 8.4 de la persona (allí `lower_case_table_names` vale 1; todos los nombres de tablas y bases son minúsculas) |
| Textos de la web sobre SQLite | Pendiente de decisión de la persona: no se ha tocado la web | `FinanceProvider.tsx`, `BackupPanel.tsx` y `SummaryPage.tsx` dicen que los datos están en «una base de datos SQLite» (y el panel, en `server/data/cuentas.db`). Cambiarlos es un cambio de textos de la interfaz que no se ha pedido |
| Documentación de `backend/` | Desfasada a propósito: esta fase no toca `backend/` | Su AGENTS.md dice que Express/SQLite es la aplicación de uso diario; actualizarlo en DATA-01 |
| Cabecera de caché en errores del host | Diferencia actual registrada; corrección prevista en BASE-02 | Los errores 400/413 del lector JSON actual carecen de `Cache-Control: no-store`; probarla también en los errores de ASP.NET Core |
| OCR definitivo | Pendiente de ensayo | Mismos fixtures, reconocimiento real, arranque y dependencia Node si la hay |
| Copia SQLite real | No disponible | Copia consistente, integridad y versión comprobadas |
| Equivalencia de la importación real | No ejecutada | Informe sin diferencias por tabla/ID y comprobaciones funcionales |
| Recuperación completa de MySQL | No ejecutada | Backup recuperado en otra base y datos comparados |
| Cambio del backend usado a diario | No realizado | Requisitos CUT-01 cumplidos y fecha del corte registrada |

## Verificaciones según el tipo de cambio

Para documentación: enlaces relativos, nombres y IDs consistentes, dependencias sin ciclos, estados honestos y diff limitado a documentación.

Para caracterización/Node/React, usa los scripts existentes pertinentes: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` y `npm run test:e2e`. En `BASE-01` registra la línea base y cualquier limitación del entorno. Los E2E tienen su servidor y base de pruebas; no reutilices los datos de la instalación.

Cuando exista .NET: restore, build y test sobre la ruta de solución real creada. Asegura reglas puras, restricciones de arquitectura, contratos HTTP, integración MySQL y el consumidor React afectado. Documenta los comandos concretos al añadir los proyectos; no afirmes que ya están disponibles.

Casos transversales de cierre:

- Dos conexiones MySQL para generación de ocurrencias, edición/ajustes de producto y guardado duplicado de tickets.
- Fallo intermedio de ticket con rollback de cabecera/líneas, productos, equivalencias y cambios de precio/cantidad.
- Guardado confirmado y posterior recarga fallida sin repetir el alta financiera.
- JSON financiero restaurado sin modificar despensa ni tickets.
- Precisión de céntimos/milésimas, fechas de calendario, nulos, negativos válidos y claves con distintas collations.
- Recorridos de escritorio y móvil, sesión, modo invitado y recuperación completa de MySQL.

## Registro de trabajo

### DOC-01 — 1 de noviembre de 2026

Registro histórico del commit `9d1df17`, referido a su árbol de código. Sus rutas y recuentos no sustituyen la inspección de la rama actual.

- Base: commit `91832a52b987b8e89f270ee86b4a95b8a4ddad15`.
- Archivos: `AGENTS.md`, entrada del README y documentos en `docs/migration/`.
- Comprobación de fuente: árbol completo sin truncar, dependencias del proyecto, composición, acceso, rutas/clientes HTTP, cinco migraciones, validación de producto y plan de guardado de tickets.
- Validación documental: aprobada el 1 de noviembre de 2026 mediante comprobación local con Python de los ocho Markdown, 70 enlaces relativos, 18 IDs de tareas y sus dependencias sin ciclos. Las 38 rutas extraídas de Express aparecen en el inventario. Se verificó el SHA del README original y que su único cambio es la entrada de migración.
- No se han ejecutado pruebas Node, .NET, MySQL ni importaciones; no hay cambio del runtime.
- Siguiente tarea tras validar la documentación: `BASE-01`.

### BASE-01 — 1 de noviembre de 2026 (verificada)

- Base de código: `7eebed2`, rama refactor/arquitectura-hexagonal elegida para conservar el trabajo actual. Documentación de origen: `9d1df17`; se incorporan sus seis documentos, adaptados a módulos, features y fixtures de esta rama.
- Alcance: caracterizar contratos y reglas con datos sintéticos, confirmar inventario y registrar línea base. Express/SQLite, React, los contratos públicos y las cinco migraciones publicadas se conservan; no se añaden dependencias.
- Inventario contrastado: 39 pares método/ruta de aplicación y `POST /api/test/reset` exclusivo de pruebas; cinco migraciones; doce tablas de aplicación más `schema_migrations`. Detalle de rutas en [API](../api.md) y de datos en [DATA.md](DATA.md).
- Diferencias con la referencia inicial: sigue existiendo `POST /api/import` y la migración desde IndexedDB; el guardado de tickets está en SaveTicket y ticketPurchase; las referencias al antiguo savePlan no corresponden a esta rama. Edición con `expectedVersion`, consultas de resumen .NET y persistencia MySQL siguen previstas.
- Línea base: en la planificación, check aprobó 376 pruebas en 33 archivos, build aprobó y 46 E2E aprobaron con Chrome. Al iniciar la implementación se repitió `npm run check`: 376/376, tipos y lint correctos. La ejecución predeterminada previa de Playwright no pudo arrancar por falta de Chromium; se usa la alternativa documentada, Chrome instalado.
- Contratos: [seis fixtures HTTP](../../fixtures/migration), 11 escenarios y 105 peticiones con cuerpos esperados completos, reloj/IDs fijos y comprobación de cuatro cabeceras. [El ejecutor](../../server/migrationContracts.test.ts) verifica que las 40 rutas tienen un recorrido válido. Incluye sesión y bloqueo, reintento/pago con el mismo ID, exclusiones del día 31, importación del navegador, ajustes/comprar/deshacer y deduplicación de tickets. El token de sesión es aleatorio y se normaliza únicamente al compararlo.
- Reglas: [rules.json](../../fixtures/migration/rules.json) contiene 42 casos inventados de 11 operaciones, ejecutados por [migrationRules.test.ts](../../tests/migrationRules.test.ts), sobre céntimos, límites, nulos, milésimas, fechas y redondeo de devoluciones. El formato de ambos corpus se explica en [pruebas](../pruebas.md); las expectativas no se regeneran al ejecutar tests.
- Atomicidad: [ticketAtomicity.test.ts](../../server/modules/tickets/ticketAtomicity.test.ts) provoca un fallo real de SQLite al insertar la segunda línea. La comparación íntegra de las 13 tablas confirma el rollback de cabecera/líneas, productos, equivalencias, precio, cantidad y versión; el reintento posterior guarda una sola vez. También verifica que restaurar finanzas conserva todas las tablas de despensa y tickets.
- Errores y diferencias: [response.test.ts](../../server/common/http/response.test.ts) comprueba JSON mal formado, 20/30 MiB exactos y un byte más, 401/404 según sesión y 500 sin detalles internos. Los errores 400/413 del lector JSON carecen de Cache-Control, confirmado por HTTP y documentado en la API; la garantía completa queda prevista en BASE-02. Al revisar la expectativa de compra se confirmó que cambiar precio y cantidad incrementa dos veces la versión; se corrigió la expectativa, conservando la aplicación. Se corrigieron referencias documentales antiguas y acentos dañados en los nuevos datos de ensayo.
- Documentación: [tests/docs.test.ts](../../tests/docs.test.ts) recorre subdirectorios, comprueba enlaces relativos y valida IDs, estados y dependencias sin ciclos; una tarea verificada exige dependencias verificadas. Se conservan los AGENTS y sus CLAUDE, y se enlazan las nuevas pruebas desde las zonas afectadas.
- Validación final ejecutada: `npm run check` aprobado (443 pruebas, 37 archivos, tipos y oxlint correctos); `npm run build` aprobado; en PowerShell, `$env:CUENTAS_E2E_CHANNEL = 'chrome'; npm run test:e2e` aprobado (46/46, escritorio y móvil, 58,5 s, incluido OCR local). Las pruebas documentales (10/10) y las de arquitectura existentes están incluidas en check. `git diff --check` sin errores de espacios; Git avisa de normalización LF/CRLF.
- Límites: solo SQLite temporal y datos de ensayo; no se lee server/data ni se cambia el backend utilizado a diario. No se añaden dependencias ni se modifican contratos, React, reglas de negocio o migraciones publicadas. No se ha probado .NET/MySQL, concurrencia MySQL, importación real ni recuperación de MySQL; esas validaciones siguen pendientes en sus tareas.
- Siguiente tarea elegible: **BASE-02**. BASE-01 queda verificada por sus contratos, inventario, reglas y comprobaciones actuales; no equivale a una migración del backend.

### BASE-02 — revisión del 3 de noviembre de 2026 (implementado)

- La fila decía «pendiente», pero el host .NET existe: `backend/CuentasClaras.slnx` con cuatro proyectos de ejecución y uno de pruebas. No se ha modificado `backend/`.
- `global.json` pasa de `rollForward: disable` a `latestFeature`, para que una actualización del SDK no rompa `dotnet build`. Comprobado: con `disable` y solo el SDK 10.0.114 instalado, `dotnet --version` no encuentra un SDK compatible; con `latestFeature` usa 10.0.114.
- Entorno del agente: SDK 10.0.114 de Ubuntu 24.04 (paquete dotnet-sdk-10.0) y sin acceso a api.nuget.org.
- `dotnet restore backend/CuentasClaras.slnx --locked-mode`: restaura los cuatro proyectos de ejecución y falla en CuentasClaras.Tests con NU1301 (no carga el índice de nuget.org: el proxy del entorno rechaza la conexión).
- `dotnet build backend/src/CuentasClaras.Api/CuentasClaras.Api.csproj --no-restore`: correcto, 0 avisos y 0 errores (compila Domain, Application, Infrastructure y Api).
- `npm run build:dotnet`, `npm run test:dotnet` y `npm run test:e2e:dotnet`: no ejecutados, porque sin restaurar las pruebas no compila la solución entera.
- Queda en «implementado». Para verificarla, en un equipo con nuget.org: `dotnet restore backend/CuentasClaras.slnx --locked-mode`, `npm run build:dotnet`, `npm run test:dotnet` y `npm run test:e2e:dotnet`.

### MYSQL-01 — 3 de noviembre de 2026 (verificada)

- Base: refactor/arquitectura-hexagonal `700d750`, sin cambios locales en el clon del agente; rama feat/mysql. Entorno: MySQL Server 8.4.8 (build oficial de Ubuntu 26.04, en Linux) con un usuario limitado a `cuentas_claras`, `cuentas_claras_e2e` y `cuentas\_test\_%`; Node 22.23.4; Chrome for Testing 153.
- Línea base antes de editar: en un clon nuevo, `npm run check` dio 442/443 porque `src/AGENTS.md` cita `dist/`, que solo existe después de compilar; tras `npm run build`, 443/443 en 37 archivos. `npm run build` correcto y `CUENTAS_E2E_CHANNEL=chrome npm run test:e2e` 46/46. Corregido: `tests/docs.test.ts` trata `dist/` como ruta que se crea al compilar.
- Dependencia: mysql2 3.24.6, versión exacta (autorizada). better-sqlite3 sigue como dependencia mientras el runtime use SQLite.
- Esquema: `database/mysql/schema_migrations.sql` y `database/mysql/migrations/005-esquema-inicial.sql`, equivalente al final de SQLite 001–005 con las columnas en el mismo orden, más `app_locks` (filas `finance` y `tickets`). Tipos y tamaños en [DATA.md](DATA.md). Hallazgos: la primera versión de los tickets guardó huellas en claro («tienda|fecha|hora|total», hasta unos 215 caracteres), así que `fingerprint` es VARCHAR(255); `name_key` admite 240 porque las mayúsculas pueden triplicar una ligadura; `meta.value` es MEDIUMTEXT porque `POST /api/import` no limita `lastBackupAt`.
- Código: `server/common/mysql/` (configuración `CUENTAS_DB_*` con mensajes en español, pool de mysql2 con sesión fija, errores, migraciones y `MysqlUnitOfWork`) y `server/common/testing/testDatabase.ts` (bases `cuentas_test_<aleatorio>` que se borran al terminar y fallan con un mensaje claro si falta MySQL). `vite.config.ts` pasa a Vitest las `CUENTAS_DB_*` del entorno o de .env, y `.env.example` las documenta sin valores.
- Decisiones: cada conexión fija `utf8mb4_0900_bin`, el modo estricto y REPEATABLE READ (y quita IGNORE_SPACE); las llamadas anidadas usan la misma conexión con un savepoint, como hacía better-sqlite3, así que un fallo capturado dentro solo deshace lo de dentro; un interbloqueo (1213) repite la operación completa una vez; el bloqueo con nombre es la primera sentencia; una migración se anota sin `applied_at` antes de su DDL y GET_LOCK evita que dos procesos migren a la vez; las categorías iniciales solo se siembran en una base nueva; además de 1062, 1451, 1452 y 3819, se traduce 1048 (NOT NULL), que era SQLITE_CONSTRAINT_NOTNULL.
- Comprobado a mano en 8.4.8, además de las pruebas: un CHECK sobre una columna con `ON DELETE CASCADE` se admite y con `ON DELETE SET NULL` no (3823); un DECIMAL con decimales de más se redondea sin error; mysql2 cuenta en `affectedRows` las filas encontradas aunque no cambien; `LIMIT ?` admite un número.
- Pruebas nuevas, todas contra MySQL: `server/common/mysql/config.test.ts` (11), `MysqlDatabase.test.ts` (6: sesión, parámetros, una sentencia por llamada, MySQL caído, usuario rechazado y base inexistente), `migrations.test.ts` (9: base nueva, reapertura, sin sembrar, dos procesos a la vez, versión más nueva, migración a medias, tablas ajenas y huellas de los .sql), `schema.test.ts` (10: InnoDB y colación en todo, columnas de SQLite en orden, restricciones de finanzas, despensa y tickets con sus acciones, NULL únicos, colaciones, precisión de céntimos y milésimas, DATE y textos exactos) y `MysqlUnitOfWork.test.ts` (8, con dos conexiones para el bloqueo y el interbloqueo).
- Validación final: `npm run check` aprobado (487 pruebas en 42 archivos: las 443 de antes y 44 nuevas; tipos y oxlint correctos, también sin `dist/`); `npm run build` aprobado; `CUENTAS_E2E_CHANNEL=chrome npm run test:e2e` aprobado (46/46, 1,8 min). Las E2E y las pruebas de los módulos siguen sobre SQLite: MYSQL-01 no cambia el runtime.
- Siguiente tarea: **MYSQL-02**.

### MYSQL-02 — 4 de noviembre de 2026 (verificada)

- Base: feat/mysql en `eb814a1` (MYSQL-01), sin cambios locales en el clon del agente. Entorno: MySQL Server 8.4.11 (paquete oficial de Ubuntu 26.04 en Linux) con el registro binario activo, como en una instalación normal de 8.4, y un usuario limitado a `cuentas_claras`, `cuentas_claras_e2e` y `cuentas\_test\_%`; Node 22.23.4; Chrome para las E2E.
- Línea base antes de editar: `npm run check` 487/487 en 42 archivos, `npm run build` correcto y `CUENTAS_E2E_CHANNEL=chrome npm run test:e2e` 46/46 (todavía sobre SQLite).
- Alcance: puertos y casos de uso async; adaptadores MySQL de finanzas, despensa y tickets; bloqueos; arranque y `/api/health` sobre MySQL; pruebas y E2E contra MySQL real. Sin cambios de rutas, cuerpos, respuestas, mensajes ni de la web. Sin dependencias nuevas.
- Código: `server/common/ports.ts` (UnitOfWork async y LockName), `server/common/modules.ts`, `server/common/http/response.ts` (restricciones de MySQL → el 409 de siempre), `server/app.ts` (MysqlUnitOfWork), `server/index.ts` (código antes de conectar, `CUENTAS_DB_*`, modo pruebas solo con bases de prueba, mensajes sin contraseña, aviso si queda `CUENTAS_DB_PATH`), el módulo health (ping a MySQL), los adaptadores MySQL de cada módulo (MysqlFinanceStore, MysqlPantryRepository y MysqlTicketRepository) y todos los casos de uso y routers, ahora async. Se borra server/common/sqlite; las migraciones SQLite pasan sin cambios a `tools/sqlite/` (con `openSqlite.ts`), donde las leerá el importador.
- Bloqueos: todas las escrituras de finanzas toman la fila `finance` (también generar vencimientos y guardar recurrentes: el test de dos conexiones sigue dando `[0, 2]`, sin 409). Guardar, reasociar y borrar tickets toman `tickets`; el duplicado y el posible duplicado se comprueban dentro y el OCR queda fuera. Los productos que cambian (+ y −, editar, borrar, revisiones, comprar, deshacer y los efectos de un ticket) se bloquean con `SELECT … FOR UPDATE` en orden de id antes de cualquier lectura (`lockItems`, también en la API pública de pantry para tickets). Se amplió a todas las escrituras de finanzas, editar, borrar y revisar productos para conservar lo que daba SQLite (todo en serie: 404 en vez de un error de clave foránea).
- SQL: `key` entre comillas invertidas; `<=>` en lugar de «IS ?»; `INSERT … ON DUPLICATE KEY UPDATE` sobre su propia clave en lugar de `INSERT OR IGNORE`; en `movements`, actualizar por id y si no había insertar (con `ON DUPLICATE KEY UPDATE` un vencimiento repetido sobrescribía el otro movimiento: lo prueba «un movimiento que pasaría a ser un vencimiento que ya existe…»); una sentencia por llamada en reinicio y restauración; ORDER BY completos donde SQLite dependía del orden de su GROUP BY o de inserción (con el id al final).
- Contratos: `server/migrationContracts.test.ts` pasa sin tocar sus expectativas (11 escenarios con 105 peticiones, y el inventario de las 40 rutas); solo cambian su limpieza y su comentario.
- Pruebas sustituidas: server/common/sqlite/SqliteUnitOfWork.test.ts (4) → `server/common/mysql/MysqlUnitOfWork.test.ts` («guarda todo o nada», anidadas, async, y bloqueo con nombre en lugar de BEGIN IMMEDIATE). server/common/sqlite/openDatabase.test.ts (5) → la conexión por defecto en `config.test.ts`; base nueva, reapertura y versión más nueva en `server/common/mysql/migrations.test.ts`; claves foráneas activas en `schema.test.ts`; y la lista de las doce tablas en `tools/sqlite/migrations.test.ts`. Adaptadas a MySQL: el fallo a mitad de ticket provoca una clave primaria repetida en vez de un trigger (con el registro binario activo, un usuario sin SUPER no puede crearlos: error 1419, comprobado), la huella golden se lee de MySQL y el arranque sin código comprueba que no se abre ninguna conexión.
- Pruebas nuevas, todas contra MySQL: `server/index.test.ts` (6: sin usuario, MySQL caído, usuario rechazado sin enseñar la contraseña, base inexistente, modo pruebas contra `cuentas_claras` sin conectar, y arranque con ping); en finanzas, guardar un recurrente mientras otra conexión genera, el choque por id con el índice único, céntimos hasta `MAX_CENTS` y ids con mayúsculas, tildes y espacios finales; en despensa, diez + a la vez desde dos conexiones y milésimas, céntimos y nombres con tildes; en tickets, dos guardados iguales a la vez (un 201 y un 409, sin efectos dobles) y un ticket con un + a la vez; en arquitectura, que los puertos de los adaptadores MySQL y la UnitOfWork son async (y que el servidor no importa better-sqlite3 ni `tools/`).
- E2E: `playwright.config.ts` usa la base `cuentas_claras_e2e`, que `e2e/prepareDatabase.ts` crea si falta, con `CUENTAS_TEST=1`. Había que cambiarlo aquí: el servidor ya no abre SQLite. MYSQL-04 revisa el resto.
- Documentación: AGENTS.md de la raíz, de `server/`, de cada módulo, de `e2e/` y de `tools/sqlite/`; `docs/arquitectura.md` (transacciones y bloqueos), `docs/base-de-datos.md`, `docs/pruebas.md`, `docs/decisiones.md`, `docs/convenciones.md`, `docs/glosario.md`, DATA.md, MODULES.md y PROMPTS.md; `.claude/rules/` (la regla de «transacción síncrona» se sustituye en `casos-de-uso.md`, y `sqlite.md` pasa a `mysql.md`); el README («Preparar MySQL», variables y «Pruebas»).
- Validación final: `npm run check` aprobado (494 pruebas en 41 archivos: las 487 de antes, menos las 9 de SQLite sustituidas y 16 nuevas; tipos y oxlint correctos); `npm run build` aprobado; `CUENTAS_E2E_CHANNEL=chrome npm run test:e2e` aprobado (46/46 sobre `cuentas_claras_e2e`, 1,8 min); `git diff --check` sin errores. Tras las pruebas no queda ninguna base `cuentas_test_*`.
- Limitaciones: no se ha probado en Windows ni con el MySQL de la persona; no se ha leído `server/data` ni `.env`. Los textos de la web que hablan de SQLite siguen igual (decisiones pendientes).
- Siguiente tarea: **MYSQL-03**.

### Plantilla para la siguiente tarea

Al trabajar en un ID, añade una entrada con fecha, commit base, alcance, archivos modificados, decisiones, contratos afectados y comandos ejecutados con resultados. Si algo no se ejecutó, indica el motivo y el efecto sobre la aceptación. Anota dependencias temporales, datos reales pendientes y el siguiente ID elegible. No rellenes esta plantilla con resultados hipotéticos.
