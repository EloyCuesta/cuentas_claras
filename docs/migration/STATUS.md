# Estado y tareas de la migración

Última actualización: 25 de noviembre de 2026 (DATA-02 cerrada sin importación, porque la copia SQLite solo tenía pruebas; CUT-01 en curso, al final del registro). Este archivo es el registro de continuidad de los agentes; actualízalo al terminar cada tarea.

## Estado comprobado

| Aspecto | Estado y evidencia |
| --- | --- |
| Referencia actual | main, desde el 4 de noviembre de 2026: la fusión `f538929` une la historia anterior de main (`9d1df17`, un solo commit con la estructura de antes) con feat/mysql (`f593067`: refactor/arquitectura-hexagonal, `700d750`, más la fase MYSQL). Esas ramas y las de funcionalidad que ya contenían se han borrado; sus commits siguen en main. refactor/arquitectura-modular se conserva aparte, sin fusionar |
| Referencia documental histórica | `91832a52b987b8e89f270ee86b4a95b8a4ddad15`, main del 30 de octubre de 2026 |
| Backend ejecutable | Node.js + Express, en `server/`, sobre MySQL desde MYSQL-02 (mysql2, migraciones de `database/mysql/`); el servidor ya no abre SQLite |
| Frontend | React + TypeScript + Vite, en `src/`; reglas compartidas en `shared/` |
| Backend .NET | Host en `backend/`: acceso (BASE-02, verificado) y conexión con el mismo MySQL (DATA-01, verificado): MySqlConnector 2.6.2, las migraciones de `database/mysql/` incrustadas, unidad de trabajo con bloqueos y `/api/health` real. Probado en Windows con MySQL 8.0.36 y aceptado en MySQL 8.4.13 (instancia de ensayo aislada). Reglas puras de tickets portadas (TIC-01, verificado): `backend/src/CuentasClaras.Domain/Tickets/`, `backend/src/CuentasClaras.Domain/Common/` y la validación en `backend/src/CuentasClaras.Application/Tickets/`, con el corpus `fixtures/migration/rules-tickets.json` reproducido entero en es-ES y en la invariante. Finanzas completas (FIN-01 a FIN-05, verificadas) la despensa (PAN-01 a PAN-03, verificados) y la lectura y el guardado de tickets con el OCR local (TIC-02 y TIC-03, verificados), con la app React real contra .NET en los E2E (registros por ID) |
| Persistencia MySQL e importación | Fase MYSQL terminada. MYSQL-01: conexión, transacciones, bloqueos y esquema en `database/mysql/`. MYSQL-02: finanzas, despensa y tickets sobre MySQL con bloqueos. MYSQL-03: importador SQLite→MySQL con informe (`tools/importer/`). MYSQL-04: better-sqlite3 solo de desarrollo, E2E sobre MySQL y pasos del corte. Probados contra MySQL 8.4.11 |
| Inventario actual | 39 pares método/ruta de aplicación y uno exclusivo de pruebas; 12 tablas de aplicación, `schema_migrations` y `app_locks` en MySQL; el esquema SQLite de antes en `tools/sqlite/` |
| Datos reales del usuario | Fuera del alcance de agentes; no se han leído ni importado ni se afirma equivalencia de filas reales. El 25 de noviembre la persona confirmó que la copia SQLite de antes solo tenía pruebas: no hay datos que importar (DATA-02) |
| Resultado de esta entrega | En main desde el 16 de noviembre (fusión en avance rápido de la rama dotnet-modulos, que se ha borrado): TIC-01 y DATA-01 verificados en MySQL 8.4.13, y FIN-01…05, PAN-01…03 y TIC-02…04 verificados en .NET, con las 39 rutas de Express y la app React entera contra .NET en los E2E. Ensayo técnico del corte hecho con datos sintéticos. El 23 de noviembre entró en main la lectura de tickets de Lidl Plus (fusión `c622210`); FIX-01 y FIX-02 de [terminar-el-proyecto.md](../terminar-el-proyecto.md) la arreglan en la rama local terminar-proyecto. DATA-02 se cerró el 25 de noviembre sin importación (no había datos reales) y queda CUT-01, de la persona (registros «Ensayo técnico del corte», «Verificación final» y «DATA-02 — cerrada sin importación») |
| Pruebas de aplicación de esta entrega | El 23 de noviembre (FIX-02), en Windows con MySQL 8.4.13 aislado en el 3307 y el usuario limitado cuentas_pruebas: .NET 2286/2286 (con el OCR real), `npm run check` (Vitest 1629/1629 en 58 archivos), `npm run test:e2e:dotnet` 80 y 4 omitidas, y `npm run test:e2e` 74 y 4 omitidas, con Chrome 158 instalado. Las 4 omitidas son las capturas de `e2e/capturas-tickets.spec.ts`, que necesitan CUENTAS_CAPTURAS_DIR |

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
| BASE-02 | Solución .NET, composición, host/configuración, acceso, envoltorios HTTP y pruebas de arquitectura | BASE-01 | verificado |
| MYSQL-01 | Base: configuración, conexión, UnitOfWork asíncrono, esquema MySQL y ayudantes de prueba | BASE-01 | verificado |
| MYSQL-02 | Finanzas, despensa y tickets sobre MySQL, con bloqueos. La API completa funciona y pasan los contratos de BASE-01 | MYSQL-01 | verificado |
| MYSQL-03 | Importador SQLite→MySQL con informe | MYSQL-02 | verificado |
| MYSQL-04 | E2E sobre MySQL, documentación, better-sqlite3 fuera del runtime y pasos del corte | MYSQL-02, MYSQL-03 | verificado |
| DATA-01 | Acceso de .NET al MySQL ya migrado: conexión, transacciones y bloqueos sobre `database/mysql/`, sin esquema propio, con pruebas de tipos/índices/JSON desde C# | BASE-02, MYSQL-04 | verificado |
| FIN-01 | Lectura de finanzas, categorías, presupuestos de categoría y metadatos; primer recorrido React | DATA-01 | verificado |
| FIN-02 | Movimientos, pagos, eliminación e IDs estables ante reintentos | FIN-01 | verificado |
| FIN-03 | Recurrentes, exclusiones, cuotas y generación sin duplicados concurrentes | FIN-02 | verificado |
| FIN-04 | Consultas de resumen mensual/anual y previsión, con integración React y equivalencia | FIN-03 | verificado |
| FIN-05 | Copia/restauración financiera y exportaciones conservadas, sin afectar despensa | FIN-03 | verificado |
| PAN-01 | Personas, catálogo y edición con expectedVersion y conflicto visible en React | DATA-01 | verificado |
| PAN-02 | Ajustes de cantidad, comprar y deshacer de forma atómica | PAN-01 | verificado |
| PAN-03 | Revisiones, actividad, ritmo, lista, presupuesto de despensa y repaso semanal | PAN-02 | verificado |
| TIC-01 | Reglas puras de parsing, evidencia, emparejamiento y plan de guardado equivalentes | BASE-02 | verificado |
| TIC-02 | Lectura OCR/texto/franjas mediante puerto local e integración de la revisión | TIC-01, PAN-01 | verificado |
| TIC-03 | Guardado transaccional, deduplicación y efectos de compra sobre Pantry | TIC-02, PAN-02 | verificado |
| TIC-04 | Historial, detalle, asociación, borrado y efectos sobre actividad/ritmo | TIC-03, PAN-03 | verificado |
| DATA-02 | Validación del corte de datos real: la persona importa su copia con la herramienta de MYSQL-03 y los pasos del README de MYSQL-04, revisa el informe y se registra el resultado. Cerrada sin importación: la copia SQLite solo tenía pruebas (registro del 25 de noviembre) | MYSQL-04 | verificado |
| CUT-01 | E2E completos contra .NET sobre la misma base MySQL, backup/restauración, ensayo final, cambio de backend y retirada de dependencias obsoletas | FIN-04, FIN-05, PAN-03, TIC-04, DATA-02 | en_curso |

La fase MYSQL cambia el motor antes que el backend: Express pasa de SQLite a MySQL con la misma API, y el esquema (`database/mysql/`) y el importador salen de ella. Por eso DATA-01 ya no crea el esquema, DATA-02 queda como la validación con los datos de la instalación y CUT-01 cambia el backend, no el motor. Ese corte de datos lo hace la persona, no un agente: `DATA-02` no se cierra con ensayos sintéticos, y `CUT-01` no se cierra sin él. Se cerró el 25 de noviembre de 2026 por decisión de la persona, sin importación: la copia SQLite solo tenía pruebas, así que la instalación empieza vacía en MySQL.

## Decisiones y verificaciones pendientes

| Elemento | Estado | Evidencia necesaria |
| --- | --- | --- |
| SDK .NET | `global.json` pide 10.0.102 con `rollForward: latestFeature`: vale 10.0.102 o una banda/parche posterior de 10.0 (comprobado con 10.0.114 en Linux y con 10.0.102 en Windows) | Hecho en BASE-02, el 4 de noviembre en Windows con acceso a nuget.org: restore con `--locked-mode`, compilación y 68/68 pruebas |
| Proveedor .NET para MySQL | Autorizado por la persona en DATA-01: MySqlConnector 2.6.2 (MIT), versión exacta y solo en Infrastructure, con SQL explícito sobre `database/mysql/`; arrastra Microsoft.Extensions.Logging.Abstractions y DependencyInjection.Abstractions 8.0.2. Pomelo.EntityFrameworkCore.MySql no tiene versión para EF Core 10 y AGENTS.md prohíbe los ORM | Restore con `--locked-mode`, compilación y pruebas contra MySQL hechas en 8.0.36 y, el 8 de noviembre, en 8.4.13 (aceptación de DATA-01) |
| MySQL de la instalación | La de la persona es MySQL Server 8.0.36 en Windows (servicio MySQL80, puerto 3306, `lower_case_table_names` 1), no la 8.4 del README. BASE-02 y DATA-01 se probaron ahí, en bases `cuentas_test_*`, con el usuario limitado cuentas_pruebas (sin acceso a cuentas_claras). Desde el 8 de noviembre las pruebas del agente usan una instancia de ensayo MySQL 8.4.13 aislada (ZIP oficial con firma y MD5 comprobados, sin servicio, puerto 3307, solo 127.0.0.1, registro binario activo, `lower_case_table_names` 1), fuera del repositorio; MySQL80 no se ha tocado. Las pruebas del agente en Linux usaron 8.4 (8.4.8 en MYSQL-01; 8.4.11 desde MYSQL-02) | Repetir las suites con la 8.0.36 de la persona y su usuario de pruebas, porque su instalación diaria es esa (lo hace la persona; el agente no tiene su contraseña) |
| Pruebas Node en Windows | Resuelto en la verificación de DATA-01: el importador cierra el duplicado antes de borrar su carpeta, y `runServer` pide el cierre por IPC en Windows. Vitest 503/503 con MySQL 8.0.36 | — |
| Textos de la web sobre SQLite | Resuelto en FIN-01, a petición de la persona: `FinanceProvider.tsx`, `BackupPanel.tsx` y `SummaryPage.tsx` dicen ahora «una base de datos MySQL de este equipo» (el panel ya no cita `server/data/cuentas.db`), y los comentarios de `src/Root.tsx`, `ApiFinanceRepository.ts` y `browserDataMigration.ts`, igual. SQLite sigue en la importación de los datos de antes | — |
| Chromium de Playwright | `npx playwright install chromium` sigue sin poder completarse en el equipo de la persona: la descarga de cdn.playwright.dev caduca a los 30 s, tres veces (en DATA-01 y otra vez en su verificación), y el 8 de noviembre falló otra vez («Download failure, code=1» al bajar Chrome for Testing 153.0.8010.12). Los E2E se ejecutan con Chrome instalado (156 hasta el 6 de noviembre, 157.0.8103.38 desde el 8 y 157.0.8103.51 el 16; `CUENTAS_E2E_CHANNEL=chrome`) | Repetir la instalación con acceso a cdn.playwright.dev y los E2E sin el canal |
| Cabecera de caché en errores del host | En el host .NET, comprobada en BASE-02: los 400 de JSON mal formado y los 413 llevan `Cache-Control: no-store` (pruebas HTTP, 68/68). Express conserva la diferencia. Desde CUT-PREP, la API y ARCHITECTURE.md lo dicen así, sin pendiente de BASE-02 | Desaparece cuando el uso diario pase a .NET (CUT-01); hasta entonces Express sigue sin la cabecera en esos errores |
| Comprobaciones con MySQL de TIC-01 | Hechas el 8 de noviembre en Windows con MySQL 8.4.13 (registro «TIC-01 y DATA-01 — verificación en MySQL 8.4»): TIC-01 verificado | — |
| Hallazgos de TIC-01 en TypeScript | Resueltos el 6 de noviembre, en TypeScript y en C# | Registro «TIC-01 — hallazgos corregidos»: en validateTicketSave una lista ya no vale donde va un texto, y «1,15-» sin multiplicación queda dudosa |
| OCR definitivo | Resuelto en TIC-02 y TIC-04: el de Express (tesseract.js) en un proceso Node aparte (ocrWorker.ts); el reconocimiento real con los fixtures en xUnit, Vitest y `e2e/tickets.spec.ts` contra .NET. Depende de Node y node_modules (README, «Ensayo con el backend .NET») | — |
| Copia SQLite real | No hay: el 25 de noviembre la persona confirmó que la copia de antes solo tenía pruebas | — |
| Equivalencia de la importación real | No aplica: no hay datos reales que importar (DATA-02, cerrada sin importación) | — |
| Recuperación completa de MySQL | Con mysqldump, comprobada en Linux con datos sintéticos (registro MYSQL-03) y en Windows con MySQL 8.4.13 (registro «Ensayo técnico del corte»: las 14 tablas iguales y los dos backends sobre la copia); Data Export de Workbench sin probar | Una copia de la instalación recuperada en otra base y comparada (`CHECKSUM TABLE` de las 14 tablas) |
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
- Repetido el 4 de noviembre, al cerrar MYSQL-04 (`backend/` sin cambios): el restore da el mismo resultado (los cuatro proyectos de ejecución sí; CuentasClaras.Tests, NU1301, porque la política del proxy rechaza api.nuget.org con 403, y no se ha intentado rodearla); `dotnet build backend/src/CuentasClaras.Api/CuentasClaras.Api.csproj --no-restore` correcto, 0 avisos y 0 errores; y `CUENTAS_E2E_CHANNEL=chrome npm run test:e2e:dotnet`, que solo necesita la API compilada, aprobado: 4/4 (acceso, error, recarga y cierre, en claro y oscuro, escritorio y móvil). `npm run build:dotnet` y `npm run test:dotnet` siguen sin poder ejecutarse.

### BASE-02 — 4 de noviembre de 2026 (verificada)

- Base: main en `18eeb272d9b28f2bcdd3a7f06643098380f5eff3`, igual que origin/main y sin cambios locales; trabajo en la rama base-02-acceso. Entorno: Windows 10 Pro (10.0.19045), SDK .NET 10.0.102 (el de `global.json`) con acceso a nuget.org, Node 24.13.0, npm 11.0.0, Playwright 1.63.0 y Chrome 156 instalado (`CUENTAS_E2E_CHANNEL=chrome`; no se descargó Chromium).
- Antes de editar: `dotnet restore backend/CuentasClaras.slnx --locked-mode` restaura los cinco proyectos, también CuentasClaras.Tests (el NU1301 de antes era del proxy del entorno del agente); `npm run build:dotnet` correcto, 0 avisos y 0 errores; la prueba dirigida (`--filter "FullyQualifiedName~Cuerpo_sin_codigo_valido_no_cuenta_como_intento"`) da 3/4: con `[]` espera «Escribe el código de acceso.» y recibe 400 VALIDATION «Falta el cuerpo de la petición en JSON.».
- Contrato contrastado en los dos hosts. .NET: `ReadCode`, en `backend/src/CuentasClaras.Api/Composition/ApiRouter.cs`, exige un objeto antes de mirar `codigo`. Express: `readBody`, en `server/common/http/request.ts`, probado a mano con `createApp` y una base falsa que lanza ante cualquier acceso (no se usó ninguna vez): `[]` da 400 VALIDATION «Falta el cuerpo de la petición en JSON.»; `{}`, `{"codigo":42}` y `{"codigo":""}` dan «Escribe el código de acceso.»; todas con `no-store`, y tras seis peticiones inválidas de cada tipo el código correcto da 200. La que discrepaba era la expectativa de la prueba; la aplicación no cambia.
- Cambio en `backend/tests/CuentasClaras.Tests/HttpTests.cs`: el mensaje esperado pasa a ser un parámetro de cada caso (`[]` con el de cuerpo ausente; los otros tres, con el del código). Se conservan el 400, el sobre VALIDATION, `no-store`, el tipo de contenido y el login válido después de las seis peticiones.
- Hallazgo en Windows: con esa corrección, la suite dio 65/68, porque `Proceso_real_rechaza_codigo_invalido_antes_de_escuchar` (tres casos) buscaba «código» en la salida de error del proceso. En Windows esa salida usa la página de códigos de la consola (aquí 850: la «ó» llega como el byte 0xA2, comprobado) y la prueba la lee como UTF-8. El programa es correcto para quien lo ve en su consola, así que se cambia la prueba: busca `CUENTAS_CODIGO`, que está en los tres mensajes. En Linux, todo en UTF-8, no se veía.
- Validación final: `npm run build:dotnet` correcto (0 avisos y 0 errores); `npm run test:dotnet` aprobado, 68/68 (las mismas 68 de antes, 1 s); `$env:CUENTAS_E2E_CHANNEL = 'chrome'; npm run test:e2e:dotnet` aprobado, 4/4 (acceso, error, recarga y cierre; escritorio y móvil, claro y oscuro; 11 s); `git diff --check` sin errores.
- Regresiones Node: `npm ci` correcto (el node_modules anterior no tenía mysql2). Sin credenciales de MySQL (ni en el entorno ni en el .env, que no se ha leído), Vitest daba 363/503, con las 140 restantes en «falta CUENTAS_DB_USER», y `npm run test:e2e` no arrancaba. Después, con el servicio MySQL80 de la persona (MySQL Server 8.0.36 con `lower_case_table_names` 1, no la 8.4 que pide el README) y su usuario root, pasado solo por el entorno: en `npm run check`, tipos y oxlint correctos y Vitest 500/503; `$env:CUENTAS_E2E_CHANNEL = 'chrome'; npm run test:e2e` aprobado, 48/48 (1,1 min). No queda ninguna base `cuentas_test_*`; `cuentas_claras_e2e` se conserva, como siempre. La base `cuentas_claras`, que creó la persona, sigue vacía: solo se cambió su colación por defecto a `utf8mb4_0900_bin`, la del README (sus tablas la declaran igualmente).
- Los tres fallos de Vitest no vienen de este cambio, que no toca código Node, sino de Windows o del entorno. `tools/importer/cli.test.ts` comprueba que la salida no contiene la contraseña, y la usada aquí es un texto que el informe siempre contiene: falso positivo, que con un usuario de pruebas con otra contraseña no debería darse (sin comprobar). `server/index.test.ts` espera que el servidor salga con 0 tras SIGTERM, pero en Windows `kill('SIGTERM')` termina el proceso sin pasar por su cierre y `status` es null. `tools/importer/importSqlite.test.ts` da EPERM al rechazar un archivo que no es SQLite: `readSourceCopy`, en `tools/importer/source.ts`, no cierra la base abierta antes de borrar su carpeta temporal, y Windows no borra un archivo abierto (la carpeta que quedó, con el texto sintético de la prueba, se borró a mano). Este último afecta a DATA-02 en Windows: con una copia que no sea SQLite, la persona vería EPERM en lugar de «no es una base de datos SQLite». No se corrigen aquí, porque quedan fuera de BASE-02.
- Queda en «verificado»: cumple la aceptación de BASE-02 (restore, compilación, suite .NET completa y los cuatro E2E de acceso, con el mensaje de `[]` y el login tras seis entradas inválidas comprobados). El host .NET sigue sin MySQL y sin rutas de negocio.
- Siguiente tarea: **DATA-01**, la primera pendiente con sus dependencias verificadas, que antes necesita la autorización del proveedor MySQL de .NET (decisiones pendientes). Sin esa dependencia se puede avanzar **TIC-01**. DATA-02 sigue siendo de la persona; antes conviene corregir el cierre de la copia en el importador (decisiones pendientes, «Pruebas Node en Windows»).

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

### MYSQL-03 — 4 de noviembre de 2026 (verificada)

- Base: feat/mysql en `645d33e` (MYSQL-02). Mismo entorno: MySQL Server 8.4.11 con el registro binario activo y un usuario limitado; Node 22.23.4.
- Alcance: el importador de una copia de `cuentas.db` a una base MySQL vacía, con informe y código de salida, y los pasos del corte en el README. Sin cambios en el servidor, la API ni la web, y sin dependencias nuevas (better-sqlite3 ya estaba; pasa a devDependencies en MYSQL-04).
- Archivos: `tools/importer/` (`cli.ts`, `importSqlite.ts`, `source.ts`, `columns.ts`, `compare.ts`, `tables.ts`, `report.ts`, `syntheticCopy.ts`, sus pruebas, AGENTS.md y CLAUDE.md); el script `importar:sqlite` en `package.json`; `informe-importacion-*.json` en `.gitignore`; la regla del importador en `tests/architecture.test.ts` y su zona en `tests/docs.test.ts`.
- Comando: `npm run importar:sqlite -- <copia de cuentas.db> [--informe <archivo.json>]`, con las `CUENTAS_DB_*` del entorno o de `.env` y sin `CUENTAS_CODIGO`. Salida: 0 válido, 1 con diferencias, 2 rechazado o fallido (nada importado) y 3 si no se pudo escribir el informe.
- Comprobaciones antes de escribir: la copia existe, no tiene un `-wal` con cambios al lado, es SQLite, pasa `integrity_check`, su historial es 1–5, sus tablas y columnas son las del esquema creado con 001–005 y pasa `foreign_key_check`. El destino responde, aplica `database/mysql/` sin sembrar categorías y tiene las mismas columnas. Cada valor cabe tal cual en su columna de MySQL (longitud en caracteres, bytes de MEDIUMTEXT, rangos de enteros, decimales de DECIMAL, fechas que existen y nulos).
- Carga: una transacción con los bloqueos `finance` y `tickets` que exige las doce tablas vacías, inserta en orden de claves foráneas (categorías principales primero) por lotes de 100 filas, vuelve a leer y compara; si algo no coincide o falla, la deshace entera. Tras confirmar, lo compara otra vez con otra conexión.
- Decisiones: la copia se lee como archivo para su SHA-256 y SQLite abre un duplicado temporal en solo lectura, porque abrir en solo lectura una base WAL crea `-wal` y `-shm` a su lado (comprobado) y better-sqlite3 no admite URI con `immutable=1` (comprobado). Los enteros se leen con `safeIntegers` para no perder precisión en silencio. Los DECIMAL se comparan en milésimas, porque un REAL de SQLite puede traer ruido (0,1 + 0,2). Un error de MySQL se informa con su número, su código y la tabla, sin su texto, que puede llevar un valor.
- Informe: archivo, bytes, SHA-256, versión, integridad y referencias de la copia; destino sin la contraseña y versión de MySQL; por tabla, filas, huella SHA-256 del JSON normalizado, nulos por columna, claves y diferencias (claves que faltan, que sobran o columnas distintas, sin valores); sumas de la copia y de MySQL; y los problemas, si se rechazó. Ni la consola ni el informe llevan conceptos, nombres o notas.
- Pruebas nuevas, contra MySQL: `tools/importer/importSqlite.test.ts` (6: importación completa de una copia sintética con las doce tablas, y lo que ve después la API, incluida la huella antigua que sigue detectando el ticket repetido; base con categorías sembradas rechazada sin tocarla; copias de la versión 4, que no son SQLite o con `-wal` pendiente, rechazadas sin crear tablas; cuatro valores que MySQL no guardaría tal cual, con su sitio y sin el valor; fallo a mitad que deja la base vacía y se puede repetir; y diferencias a mitad, deshechas, con tabla, clave y columna) y `tools/importer/cli.test.ts` (2: el comando de verdad con el informe junto a la copia y sin textos de la copia, la segunda vez rechazado con 2, y uso y configuración incorrectos).
- Copias de MySQL, a mano con la copia sintética importada: `mysqldump --single-transaction --no-tablespaces --result-file=…` con el usuario limitado (sin `--no-tablespaces` pide el permiso PROCESS: comprobado) y recuperación en otra base con `mysql … --execute="source …"`; `CHECKSUM TABLE` de las 14 tablas iguales. Comprobado también el comando del README que pasa un `-wal` pendiente a `cuentas.db` (`wal_checkpoint(TRUNCATE)`; sin él, cerrar sin leer no lo pasa).
- Documentación: README («Pasar los datos de SQLite a MySQL» con los pasos del corte, y «Copias de MySQL»), DATA.md (importador implementado y corte por fases), AGENTS.md de la raíz y de `tools/importer/`, `docs/arquitectura.md` y `docs/pruebas.md`.
- Validación final: `npm run check` aprobado (502 pruebas en 43 archivos: las 494 de antes y 8 nuevas; tipos y oxlint correctos); `npm run build` aprobado; `CUENTAS_E2E_CHANNEL=chrome npm run test:e2e` aprobado (46/46, 1,8 min); `git diff --check` sin errores.
- Limitaciones: solo copias sintéticas; la copia real de la persona no se ha leído ni importado (DATA-02). Data Export de Workbench sin probar en este entorno.
- Siguiente tarea: **MYSQL-04**.

### MYSQL-04 — 4 de noviembre de 2026 (verificada)

- Base: feat/mysql en `5c47fb0` (MYSQL-03). Mismo entorno: MySQL Server 8.4.11 con el registro binario activo y el usuario limitado de las pruebas; Node 22.23.4; Playwright 1.63.0 con Chrome (`CUENTAS_E2E_CHANNEL=chrome`).
- Alcance: better-sqlite3 fuera del runtime, una prueba E2E de concurrencia sobre MySQL, la documentación y los pasos del corte. Sin cambios en la API, en el código de la web ni en `backend/`, y sin dependencias nuevas.
- better-sqlite3 pasa de `dependencies` a `devDependencies`, con la misma versión exacta (`npm install --save-dev --save-exact better-sqlite3@12.11.1`): en `package-lock.json` solo cambia que él y sus dependencias de instalación son de desarrollo; ningún paquete nuevo. `npm ls better-sqlite3 --omit=dev` sale vacío.
- Comprobación nueva en `tests/architecture.test.ts`: nada fuera de `tools/` importa better-sqlite3 (tampoco los tests, sus ayudantes, `e2e/`, `tests/` ni la configuración), y `package.json` lo tiene en `devDependencies` y mysql2 en `dependencies`. Comprobado que falla con un test del servidor que lo importa y con el `package.json` de antes, y que pasa después.
- El servidor sin SQLite, a mano: con un gancho de carga (`module.registerHooks`) que rechaza better-sqlite3 y cualquier archivo de `tools/` (comprobado antes con `require('better-sqlite3')` y con imports de `tools/sqlite/` y `tools/importer/`, los tres rechazados), `server/index.ts` arranca contra una base `cuentas_test_*`, responde a salud, acceso, finanzas (guardar un movimiento y `GET /api/data`), despensa (crear y ajustar un producto) y tickets (leer un texto, la lista y la actividad), se cierra con 0 y no intenta cargar nada bloqueado. La base se borró después.
- E2E sobre MySQL: la suite usa `cuentas_claras_e2e` desde MYSQL-02 (preparada por `e2e/prepareDatabase.ts`, con `CUENTAS_TEST=1`). Prueba nueva en `e2e/despensa.spec.ts`, «dos móviles pulsan + a la vez y el servidor suma los dos»: dos contextos del navegador ven 1 kg y pulsan + a la vez; el servidor responde 1,5 y 2, y los dos ven 2 kg al recargar. Comprobado que detecta una suma perdida: quitando a propósito el bloqueo de `AdjustItem` y añadiendo una espera, falla con [1,5, 1,5]; después se restauró el archivo, sin cambios respecto al commit.
- Pasos del corte en el README («Pasar los datos de SQLite a MySQL»): parar la app de antes, copiar `cuentas.db`, preparar MySQL sin arrancar la app (para que la base siga vacía), `npm install`, importar, revisar el informe, arrancar y hacer la copia de MySQL; cómo volver atrás y cuándo deja de hacer falta `server/data/cuentas.db`. «Preparar MySQL» avisa de no arrancar la app si hay datos de SQLite. DATA.md, igual.
- Documentación: `AGENTS.md` (dependencias), `docs/arquitectura.md`, `docs/decisiones.md`, `docs/pruebas.md`, `e2e/AGENTS.md`, `src/features/pantry/AGENTS.md`, `tools/sqlite/AGENTS.md` y `tools/importer/AGENTS.md`; en `docs/migration/`, README.md, ARCHITECTURE.md (`backend/` ya existe y la persistencia propuesta es SQL explícito, sin EF) y DATA.md. DATA-02 depende ahora de MYSQL-04, que trae los pasos del corte.
- BASE-02 repetida con el estado final: ver su registro (restore, compilación de la API y E2E React/.NET).
- Validación final: `npm run check` aprobado (503 pruebas en 43 archivos: las 502 de antes y 1 nueva; tipos y oxlint sin avisos); `npm run build` aprobado; `CUENTAS_E2E_CHANNEL=chrome npm run test:e2e` aprobado (48/48: las 46 de antes y la nueva en escritorio y móvil, 1,8 min); `git diff --check` sin errores. No quedan bases `cuentas_test_*`.
- Limitaciones: todo en Linux y con datos de ensayo. Falta repetir `npm run check` y `npm run test:e2e` en Windows con el MySQL Server 8.4 de la persona, y probar Data Export de Workbench. El corte con los datos reales es DATA-02.
- Siguiente tarea: **DATA-02**, que hace la persona (la primera pendiente con sus dependencias verificadas). Para los agentes, DATA-01 y TIC-01 esperan a que BASE-02 se verifique en un equipo con acceso a nuget.org.

### DATA-01 — 4 de noviembre de 2026 (implementado)

- Base: rama data-01-mysql sobre base-02-acceso `4b2ac97` (BASE-02 verificada). main sigue en `18eeb272d9b28f2bcdd3a7f06643098380f5eff3`. Entorno: Windows 10 Pro, SDK .NET 10.0.102, Node 24.13.0 y Chrome 156. MySQL: el de la persona, MySQL Server 8.0.36 (servicio MySQL80, `lower_case_table_names` 1), con el usuario cuentas_pruebas@localhost, que se creó con root para este ensayo con permisos solo sobre `cuentas\_test\_%` y `cuentas\_claras\_e2e` (comprobado: MySQL le niega cuentas_claras con 1142). Su contraseña es aleatoria y no está en el repositorio. No había MySQL 8.4.
- Proveedor: MySqlConnector 2.6.2, la última estable en nuget.org (MIT; la 3.0.0 está en beta), autorizado por la persona con su alcance. Va como `[2.6.2]` en CuentasClaras.Infrastructure. Los locks añaden el paquete y, como transitivas, Microsoft.Extensions.Logging.Abstractions y DependencyInjection.Abstractions 8.0.2: solo interfaces, sin contenedor.
- Código:
  - Application: IUnitOfWork y LockName en `backend/src/CuentasClaras.Application/Common/Ports.cs`; IStorageHealth y CheckHealth pasan a async.
  - Domain: las 27 categorías iniciales, generadas como en `shared/finance/categories.ts` (`backend/src/CuentasClaras.Domain/Finance/DefaultCategories.cs`).
  - Infrastructure, en `backend/src/CuentasClaras.Infrastructure/Common/MySql/`: MySqlSettings (CUENTAS_DB_* con las reglas y mensajes de config.ts; sin usuario no hay base), MySqlDatabase (pool, SESSION_SETUP en cada apertura, parámetros comprobados y MySqlRead), MySqlMigrations (los .sql incrustados, GET_LOCK con la clave de Express, y sus estados y mensajes), MySqlUnitOfWork (una conexión, savepoints, app_locks primero y un reintento ante 1213) y MySqlErrors. Además, MySqlStorageHealth (la versión aplicada, leída en cada petición) y DefaultCategorySeed.
  - Api: ApiHost.CreateConfigured (código, después CUENTAS_DB_*, después MySQL), StartupException, Program y la salud async en ApiRouter.
  - `playwright.dotnet.config.ts`: CUENTAS_DB_USER vacío.
- Decisiones: sin CUENTAS_DB_USER el host arranca solo con el acceso, y con él un fallo de MySQL impide arrancar. La siembra la aporta el módulo Finance a través de Composition, porque Common no conoce módulos. Las filas de productos se bloquean en el adaptador de la despensa (PAN-02); aquí se prueba el patrón con dos conexiones. MySqlConnector admite varias sentencias por texto: «una por llamada» queda por convención. Detalle en `docs/decisiones.md` y `backend/AGENTS.md`.
- Contratos: rutas, cuerpos, mensajes y el sobre de salud sin cambios. Las migraciones publicadas tampoco cambian: .NET comprueba las mismas huellas que Express. Express, la web y cuentas_claras no se tocaron.
- Pruebas nuevas: 43, de ellas 28 contra MySQL (categoría MySql), en `backend/tests/CuentasClaras.Tests/` (MySqlMigrationTests, MySqlUnitOfWorkTests, MySqlSchemaTests, MySqlHostTests y su ayudante TestDatabase), más los casos del driver en ArchitectureTests. Cada una crea su base `cuentas_test_*` y la borra.
  - Dos inicializaciones sobre una copia sintética de las 12 tablas conservan el historial, las filas y el CHECKSUM TABLE de las 14.
  - La unidad de trabajo, con dos conexiones: todo o nada, anidadas, bloqueo con nombre, bloqueo primero, interbloqueo y filas en orden de id.
  - Los tipos leídos desde C#: céntimos hasta MAX_CENTS y negativos, milésimas, DATE sin desplazamiento, nulos, claves con mayúsculas, tildes y espacios, índices únicos y JSON como texto exacto.
  - La salud con la versión real y los errores sin la contraseña.
- Mutaciones, con el código restaurado después: sin el reintento ante interbloqueo, sin el bloqueo de app_locks, sin fijar la sesión, sin deshacer el savepoint, sin GET_LOCK o confirmando aunque falle, falla al menos una prueba (de una a dos). Sin credenciales, las 28 de MySQL fallan con un mensaje claro.
- Ensayo manual con el programa real (`dotnet` sobre la API compilada, CUENTAS_DB_NAME=cuentas_test_data01):
  - `/api/health` 200 `{"ok":true,"data":{"status":"ok","schemaVersion":5}}` con `no-store`, y en la consola la base sin la contraseña.
  - Express (openDatabase) la abre después con el mismo historial (mismos started_at y applied_at) y 27 categorías, y un segundo arranque .NET tampoco cambia nada.
  - Una base que migró Express la abre .NET sin tocarla.
  - Sin CUENTAS_DB_USER, acceso 200 y salud 500.
  - Las bases se borraron.
- Protección de los E2E de acceso: con CUENTAS_DB_* en el entorno apuntando a una base vacía, `npm run test:e2e:dotnet` pasa y la deja con 0 tablas. Quitando a propósito CUENTAS_DB_USER vacío de la configuración, el host la migró (14 tablas): por eso se fija. La configuración se restauró.
- Validación final, en Windows con MySQL 8.0.36 y el usuario limitado:
  - `npm ci` correcto.
  - `dotnet restore backend/CuentasClaras.slnx --locked-mode` correcto (cinco proyectos).
  - `npm run build:dotnet`: 0 avisos y 0 errores.
  - `npm run test:dotnet`: 111/111 (las 68 de antes y 43 nuevas, 9 s).
  - `npm run test:dotnet -- --filter "Categoria=MySql"`: 28/28 (6 s).
  - `npx playwright install chromium`: bloqueado, la descarga caduca.
  - `$env:CUENTAS_E2E_CHANNEL = 'chrome'; npm run test:e2e:dotnet`: 4/4 (11,4 s).
  - `npm run check`: tipos y oxlint correctos; Vitest 501/503, con los dos fallos de Windows ya registrados.
  - `$env:CUENTAS_E2E_CHANNEL = 'chrome'; npm run test:e2e`: 48/48 (1,4 min).
  - `git diff --check` sin errores. No queda ninguna base `cuentas_test_*`.
- Pruebas de integración, en PowerShell: con CUENTAS_DB_HOST, CUENTAS_DB_PORT, CUENTAS_DB_USER y CUENTAS_DB_PASSWORD del usuario de pruebas en el entorno, `npm run build:dotnet` y después `npm run test:dotnet -- --filter "Categoria=MySql"` (28 pruebas).
- Queda en «implementado»: la aceptación se comprueba en MySQL 8.4, que no hay en este equipo. En 8.0.36, anotado aparte, pasa todo lo de DATA-01. Para verificarla: una instancia 8.4 aislada con un usuario limitado (README, «Pruebas»), y en ella los comandos de la validación final y el ensayo manual con cuentas_test_data01.
- Bloqueos abiertos: MySQL 8.4 para la aceptación; la descarga de Chromium; los dos fallos Node de Windows (decisiones pendientes, «Pruebas Node en Windows»).
- Siguiente tarea: verificar DATA-01 en MySQL 8.4; FIN-01 y PAN-01 dependen de ello. TIC-01, que solo depende de BASE-02, ya es elegible.

### DATA-01 — verificación en Windows, 4 de noviembre de 2026 (sigue implementado)

- Base: main en `7a7bc83d57de1f6c10e5cdc4d7ea6c64c5aed812`, igual que origin/main y sin cambios locales. Sistema: Windows 10 Pro (10.0.19045), SDK .NET 10.0.102, Node 24.13.0, MySqlConnector 2.6.2. MySQL: el de la persona, MySQL Server 8.0.36 (servicio MySQL80), con `SELECT VERSION(), @@port, CURRENT_USER()` = 8.0.36, 3306, cuentas_pruebas@localhost; ese usuario solo tiene permisos sobre `cuentas\_test\_%` y `cuentas\_claras\_e2e`. Navegador: Chrome 156.0.8078.80 instalado.
- MySQL 8.4: no está en el equipo. Se propuso descargar el ZIP oficial 8.4.13 y arrancarlo aislado en 3307, y la persona decidió usar su 8.0.36. Por eso DATA-01 queda en «implementado»: todo lo de abajo es evidencia en 8.0.36.
- Importador en Windows: reproducido el EPERM al rechazar una copia que no es SQLite (y la carpeta temporal que quedaba). better-sqlite3 abre cualquier archivo y falla en el primer `pragma`; el `catch` lanzaba ImportRefused sin cerrar el handle, y Windows no borra un archivo abierto. `tools/importer/source.ts` lo cierra en esa ruta. Se conservan el mensaje, el resultado «rechazado» con código 2 y la apertura en solo lectura. `importSqlite.test.ts` comprueba ahora el código de salida y que la carpeta temporal queda vacía en los dos rechazos que la crean: pasa con el arreglo y, sin él, falla con EPERM.
- Cierre del servidor en las pruebas: medido con una sonda que arranca `server/index.ts` como runServer. En Windows, `child.kill('SIGTERM')` y `child.kill('SIGINT')` devuelven true, pero el proceso acaba con código null y signalCode SIGTERM o SIGINT: el sistema lo termina sin que corra su cierre. El servidor no tenía el problema, que estaba en el mecanismo del test. `server/common/testing/serverProcess.ts` sigue enviando SIGTERM en el resto de sistemas; en Windows precarga `server/common/testing/signalOverIpc.ts` y pide SIGINT por IPC, y así corre el mismo manejador que con Ctrl+C. La prueba sigue exigiendo el arranque, `/api/health` y la salida con 0. Quitando a propósito `process.on('SIGINT', shutdown)` del servidor, falla a los 20 s por cierre forzado (código null); el archivo se restauró sin cambios.
- Comandos, desde la raíz, con CUENTAS_DB_* del usuario limitado en el entorno:
  - `npm ci` correcto.
  - `dotnet restore backend/CuentasClaras.slnx --locked-mode` correcto (cinco proyectos).
  - `npm run build:dotnet`: 0 avisos y 0 errores.
  - `npm run test:dotnet`: 111/111 (7 s).
  - `npm run test:dotnet -- --filter "Categoria=MySql"`: 28/28 (6 s).
  - `npx vitest run tools/importer server/index.test.ts`: 14/14.
  - `npm run check`: tipos y oxlint correctos; Vitest 503/503 en 43 archivos (antes, 501/503 en Windows). No quedan carpetas `cuentas-claras-importar-*` en la carpeta temporal.
  - `npx playwright install chromium`: falla otra vez, la descarga caduca a los 30 s tres veces. No es un resultado de las suites.
  - `$env:CUENTAS_E2E_CHANNEL = 'chrome'; npm run test:e2e:dotnet`: 4/4 (12,3 s).
  - `$env:CUENTAS_E2E_CHANNEL = 'chrome'; npm run test:e2e`: 48/48 (1,3 min).
  - `git diff --check` sin errores.
- Ensayo con el programa real en `cuentas_test_data01`, creada vacía antes de arrancar:
  - Primer arranque: `/api/health` 200 `{"ok":true,"data":{"status":"ok","schemaVersion":5}}` con `no-store`, y la consola indica la base sin la contraseña.
  - Se añadieron filas sintéticas (un movimiento de MAX_CENTS con fecha 2024-02-29, un producto con milésimas y un metadato), y un segundo arranque conserva el historial, el recuento y el CHECKSUM TABLE de las 14 tablas.
  - Express (openDatabase) la abre después sin cambiar nada.
  - Una base que inicializó Express (`cuentas_test_data01_express`) la abre .NET con salud 200 y sin cambios.
  - Las dos bases se borraron.
- Rollback, bloqueos con dos conexiones y tipos del esquema desde C#: siguen cubiertos por las 28 pruebas MySql, que pasan.
- Para cerrar DATA-01: repetir en Windows con MySQL Server 8.4, en una instancia aislada (por ejemplo, otro puerto) o la instalación que indica el README, con un usuario limitado a `cuentas\_test\_%` y `cuentas\_claras\_e2e`. Los pasos son los comandos de arriba y el ensayo con cuentas_test_data01 (`docs/pruebas.md`, «Ensayo .NET»), registrando `SELECT VERSION()` y el puerto. Una ejecución en Linux con 8.4 contaría como evidencia aparte; la aceptación es en Windows.
- Siguiente tarea: la aceptación de DATA-01 en 8.4, de la que dependen FIN-01 y PAN-01. TIC-01 es elegible ya como encargo independiente. DATA-02 la hace la persona, y el EPERM que la afectaba está resuelto.

### TIC-01 — 5 de noviembre de 2026 (implementado)

- Base: main en `8abec56` (DATA-01, verificación en Windows), igual que origin/main y sin cambios locales; rama tic-01-reglas. Entorno: Windows 10 Pro, SDK .NET 10.0.102, Node 24.13.0 (ICU 77.1, Unicode 16.0). No había CUENTAS_DB_* en el entorno; no se leyó `.env` ni `server/data`.
- Alcance: las reglas puras de los tickets en C#, sin endpoint, sin OCR y sin MySQL: `shared/tickets/` (ticketText, ticketArithmetic, ticketEvidence, ticketParse, ticketMatch y ticketValidation), `server/modules/tickets/domain/` (ticketPurchase, ticketIdentity y purchaseHistory) y, de `shared/common/`, las fechas, formatEuros y ValidationResult. Las rutas de tickets de .NET siguen en 404. No cambia ningún archivo de TypeScript de Express, shared ni la web.
- Commits, uno por bloque y con sus pruebas en verde: `fecbba5` (corpus), `44bc88e` (Common y el corpus en xUnit), `b1322b6` (ticketText), `f78193c` (ticketArithmetic y tipos), `30f39cb` (ticketEvidence), `da516e9` (ticketParse), `6e65311` (ticketMatch), `5b79f54` (ticketValidation), `0cc9bd2` (domain) y el de la documentación.
- Corpus: `fixtures/migration/rules-tickets.json`, formato `cuentas-claras-ticket-rules-v1` (`docs/pruebas.md`), 510 casos de 38 operaciones con la salida completa de TypeScript. Entradas: `ticket-lidl-ejemplo.ocr.json`, los cuatro de `fixtures/tickets/ocr-real/`, los cinco de `ticket-cases.json`, los casos de los seis tests de `shared/tickets/`, un catálogo y unas equivalencias de ensayo, 129 cuerpos de guardado y 11 de cambio de línea (válidos e inválidos, y como texto para Infinity, -0, claves repetidas y sustitutos sueltos), las tres huellas golden de `server/modules/tickets/tickets.test.ts` y un caso por trampa (mitades de Math.round, roundRatio no seguro, \d, \b, \s, «.», «$», la bandera i con el signo Kelvin, letras fuera del plano básico, mayúsculas que expanden, sigma final, «ı» e «İ», .sort() ordinal, orden de Map y Set, double.Parse, formatEuros, toFixed, JSON.stringify y doble frente a decimal). Lo generó `tests/generateTicketRules.ts`, se revisaron a mano las trampas, los mensajes de validación y las huellas, y el generador comprueba las tres golden. `tests/migrationTicketRules.test.ts` lo comprueba sin regenerarlo.
- C#: `backend/src/CuentasClaras.Domain/Common/` (JsNumber, JsText, JsCase con `JsCaseData.cs` generado por `tests/generateJsCaseData.ts`, JsJson, JsRegex, IsoDates, Money y ValidationResult), `backend/src/CuentasClaras.Domain/Tickets/` (TicketText, TicketArithmetic, TicketEvidenceRules, TicketParser, TicketMatcher, TicketPurchaseRules, TicketIdentity, PurchaseHistory, los tipos y TicketVocabulary) y `backend/src/CuentasClaras.Application/Tickets/TicketRequests.cs` con `backend/src/CuentasClaras.Application/Common/JsonInput.cs`. Sin dependencias nuevas (System.Text.Json y System.Numerics son del runtime).
- Decisiones (`docs/decisiones.md`): lo que Tickets usa de la despensa va en tipos propios (TicketVocabulary, CatalogItem y TicketPurchase), sin cambiar la regla de ArchitectureTests; la validación va en Application porque usa Domain.Tickets y Api no puede; la semántica de JavaScript va en Domain/Common, y las mayúsculas, en tablas de Node.
- Pruebas nuevas: `backend/tests/CuentasClaras.Tests/TicketRulesCorpusTests.cs` (1042: los 510 casos en es-ES y en la invariante, las 10 reglas de tickets de `rules.json` en las dos, y dos comprobaciones del corpus) y, en ArchitectureTests, cinco casos de módulos de tickets y que las reglas no usan DateTime, Random ni Guid. El JSON, `rules.json` y `ticket-lidl-ejemplo.png` se vinculan en el `.csproj` de pruebas, como `http-auth.json`. Vitest: `tests/migrationTicketRules.test.ts` (512).
- Mutaciones, restauradas desde git después (git status limpio): ToUpperInvariant en nameKey (4 casos por cultura, entre ellos «ı» y «ß»), Math.Round de .NET (14 casos), .sort() con InvariantCulture (huella-orden), \d de .NET (3), JSON de System.Text.Json en la huella (huella-escapes), double.Parse con la cultura del equipo (12 tickets con pesos, solo en es-ES) y string.Trim de .NET (2). La regla del reloj detecta un DateTime.Now puesto a propósito; dio un falso positivo con System.Environment (los iteradores lo usan), que se quitó de la lista.
- Hallazgos en TypeScript, sin corregir: (1) validateTicketSave compara con `[...].includes(String(x))`: una lista como `["read"]` pasa como selectedBy (y como kind, verdict, origin o tipo de ajuste) y se guarda como lista. C# acepta los mismos cuerpos y guarda el texto; esos casos no están en el corpus. Decidir en TIC-03 si se rechazan. (2) El comentario de AMOUNT_TOKEN dice que «1,15-» está deformado y no confirma nada, pero selectLine solo avisa si lo pegado tiene una cifra: «AGUA 1,15-» sin multiplicación se acepta sin marcar (caso trampa-iva-simbolos). C# lo reproduce.
- Trampas anotadas para TIC-02 y TIC-03 (`backend/AGENTS.md`): GetString de System.Text.Json rechaza los sustitutos sueltos que JSON.parse admite (JsonInput los lee); un Record de JavaScript pone primero las claves que son índices enteros; el Hasher tiene que usar UTF-8 con U+FFFD, como Node; la normalización de .NET en Windows puede ir por detrás de Unicode 16 en escrituras nuevas (no afecta a nameKey, que solo deja A-Z y 0-9).
- Comandos ejecutados, en Windows:
  - `dotnet restore backend/CuentasClaras.slnx --locked-mode`: correcto.
  - `npm run build:dotnet`: 0 errores.
  - `npm run test:dotnet -- --filter "Categoria!=MySql"` (dotnet test con ese filtro): 1131/1131 (las 83 de antes y 1048 nuevas).
  - `npx tsc -b` y `npx oxlint`: correctos.
  - `npx vitest run shared tests`: 814/814 (incluye `tests/migrationTicketRules.test.ts`, `tests/docs.test.ts` y `tests/architecture.test.ts`).
- Sin ejecutar: `npm run check` completo, las 28 pruebas MySql de `npm run test:dotnet`, `npm run test:e2e` y `npm run test:e2e:dotnet`. Hace falta el usuario limitado en las CUENTAS_DB_*, que no estaban en el entorno, y la persona pidió cerrar la entrega. Esta entrega no toca el código de Express, MySQL ni la web, pero eso no sustituye la ejecución. Por eso TIC-01 queda en «implementado»; con esas cuatro en verde, pasa a «verificado».
- Siguiente: completar esas comprobaciones de TIC-01. TIC-02 depende de TIC-01 y de PAN-01, que espera a DATA-01 en MySQL 8.4. DATA-02 lo hace la persona.

### TIC-01 — hallazgos corregidos, 6 de noviembre de 2026 (sigue implementado)

- Base: main en `09f611f` (TIC-01), igual que origin/main; rama fix/tic-01-hallazgos. Lo pidió la persona: corregir los dos hallazgos de TIC-01 y fusionarlo en main.
- Entorno: Linux (Ubuntu 24.04) en la nube, Node 22.23.4 (ICU 78.3), SDK .NET 10.0.114 de Ubuntu sin acceso a nuget.org (el proxy lo rechaza con 403), MySQL Server 8.0.46 con el registro binario activo y un usuario limitado a `cuentas\_test\_%` y `cuentas\_claras\_e2e`, y el Chromium 1243 de Playwright 1.63.0. No se leyó `.env` ni `server/data`.
- (1) validateTicketSave: el origen del importe, el tipo y el veredicto de la discrepancia, el origen de una opción y el tipo de ajuste se comparaban con `String(x)`, así que una lista como `["read"]` pasaba y se guardaba como lista. Ahora tienen que ser un texto: oneOf en `shared/tickets/ticketValidation.ts` y OneOf en `backend/src/CuentasClaras.Application/Tickets/TicketRequests.cs`, con los mensajes de siempre. JsonInput.JsString se queda sin uso y se quita. Contrato: esos cuerpos dan ahora 400 VALIDATION en lugar de guardarse; la web nunca los envía.
- (2) parseTicket: un «-» pegado detrás del importe («1,15-», «0,40-€») no confirma nada, como ya decía el comentario de AMOUNT_TOKEN. Sin una multiplicación que lo compruebe, la línea queda dudosa con «Una lectura del importe tiene un «-» pegado detrás («1,15-»): confirma el importe», aunque la otra lectura coincida; si la multiplicación cuadra, la confirma ella, igual que con las cifras de más. Mismo cambio en `backend/src/CuentasClaras.Domain/Tickets/TicketParser.cs`, y el README lo cuenta en la lectura de tickets.
- Corpus: 517 casos (510 y 7 nuevos: trampa-menos-pegado y seis cuerpos con una lista donde va un texto). De los de antes solo cambia trampa-iva-simbolos: la línea «AGUA 1,15-» queda dudosa y el ticket pasa de 4 a 5 líneas pendientes. Hallazgo al regenerar: la entrada de bonito-cada-caracter sale de las tablas Unicode del Node que ejecuta el generador, y con Node 22 (Unicode 17) cambiaba sin que cambie ninguna regla; se conservó como estaba (generado con Node 24) y queda anotado en `docs/pruebas.md`. `tests/migrationTicketRules.test.ts` y TicketRulesCorpusTests esperan 517 casos.
- Pruebas nuevas: `shared/tickets/ticketValidation.test.ts` (7: un cuerpo válido y una lista en cada uno de los cinco campos, una de ellas anidada) y una en `shared/tickets/ticketSafety.test.ts` (el «-» pegado, también con la relectura de acuerdo). Con el TypeScript de antes fallan las siete que comprueban los hallazgos; con el arreglo, pasan.
- C# sin xUnit: Domain y Application compilan con la configuración del repositorio (`dotnet restore` con `--locked-mode` y `dotnet build backend/src/CuentasClaras.Application/CuentasClaras.Application.csproj`: 0 avisos y 0 errores). Un programa de consola fuera del repositorio compila `backend/tests/CuentasClaras.Tests/TicketRulesCorpus.cs` y `backend/tests/CuentasClaras.Tests/CorpusJson.cs` y hace lo mismo que TicketRulesCorpusTests (sus comprobaciones del corpus, las huellas golden y cada caso en es-ES y en la invariante): 1054/1054. Con el C# de antes da 16 fallos, los 8 casos que cambian en las dos culturas.
- Comandos ejecutados, en Linux:
  - `npx tsx tests/generateTicketRules.ts`: cambiados bonito-cada-caracter y trampa-iva-simbolos, y 7 nuevos; después `--escribir`, reponiendo bonito-cada-caracter.
  - `npm run check`: tipos y oxlint correctos; Vitest 1030/1030 en 45 archivos (las 1015 de antes en 44, y 15 nuevas: 7 casos del corpus, 7 de validación y 1 de seguridad).
  - `npx playwright test`, que es `npm run test:e2e` sin canal: 48/48 (1,2 min, escritorio y móvil) sobre `cuentas_claras_e2e`.
  - El corpus en C#: 1054/1054.
  - `git diff --check` sin errores. No queda ninguna base `cuentas_test_*`.
- Sin ejecutar: `npm run build:dotnet`, `npm run test:dotnet` (xUnit y las 28 de MySQL) y `npm run test:e2e:dotnet`, porque necesitan los paquetes de nuget.org. Con `--filter "Categoria!=MySql"` deberían salir 1145 (las 1131 de TIC-01 y 14 casos más del corpus).
- Sigue en «implementado». Para «verificado», en Windows con el usuario limitado: `npm run build:dotnet`, `npm run test:dotnet` y `npm run test:e2e:dotnet`, y conviene repetir allí `npm run check` y `npm run test:e2e`.
- Siguiente: esas comprobaciones de TIC-01, y después la aceptación de DATA-01 en MySQL 8.4, de la que dependen FIN-01 y PAN-01. DATA-02 lo hace la persona.

### TIC-01 y DATA-01 — verificación en MySQL 8.4, 8 de noviembre de 2026 (verificados)

- Base: main en `86e74ff463a3693333f8ab0f78f3e4fd7b3f6685`, igual que origin/main y sin cambios locales; trabajo en la rama dotnet-modulos (sin fusionar ni subir: lo revisa la persona). Sistema: Windows 10 Pro (10.0.19045), SDK .NET 10.0.102, Node 24.13.0, npm 11.0.0, MySqlConnector 2.6.2.
- MySQL 8.4, con la autorización de la persona: el ZIP oficial `mysql-8.4.13-winx64.zip` (la 8.4 publicada en cdn.mysql.com; 8.4.14 no existe todavía), 281 154 912 bytes, MD5 `7b94489d5524dea9b27097068bea25a8` igual que el `.md5` publicado y firma GPG buena de «MySQL Release Engineering» (huella BCA4 3417 C3B4 85DD 128E C6D4 B7B3 B788 A8D3 785C). Sin instalador ni servicio de Windows, en una carpeta fuera del repositorio, con su propio my.ini: puerto 3307, `bind-address` 127.0.0.1, sin X Protocol, registro binario activo (como una 8.4 normal) y `lower_case_table_names` 1 (como la 8.0.36 de la persona). Se inicializó vacía, root con contraseña aleatoria y el usuario cuentas_pruebas (@localhost y @127.0.0.1) con permisos solo sobre `cuentas\_test\_%` y `cuentas\_claras\_e2e`; sus contraseñas están fuera del repositorio y no salen en las trazas. Comprobado: `SELECT VERSION(), @@port, CURRENT_USER()` = 8.4.13, 3307, cuentas_pruebas@127.0.0.1; `@@log_bin` 1; crear o usar `cuentas_claras` da 1044. El servicio MySQL80 (8.0.36) no se ha tocado.
- Chromium: `npx playwright install chromium` falla otra vez («Download failure, code=1» con Chrome for Testing 153.0.8010.12). Los E2E van con Chrome 157.0.8103.38 instalado (`CUENTAS_E2E_CHANNEL=chrome`).
- Comandos, desde la raíz, con las cuatro CUENTAS_DB_* del usuario limitado en el entorno (puerto 3307):
  - `npm ci` correcto; `dotnet restore backend/CuentasClaras.slnx --locked-mode` correcto (cinco proyectos).
  - `npm run build:dotnet`: 0 avisos y 0 errores.
  - `npm run test:dotnet`: 1173/1173 (5 s). Por separado: el corpus de tickets (`--filter "FullyQualifiedName~TicketRulesCorpus"`) 1056/1056, `--filter "Categoria=MySql"` 28/28 y `--filter "Categoria!=MySql"` 1145/1145, las que preveía el registro «TIC-01 — hallazgos corregidos».
  - `npm run test:e2e:dotnet`: 4/4 (10,9 s).
  - `npm run check`: tipos y oxlint correctos; Vitest 1030/1030 en 45 archivos (incluido `tests/migrationTicketRules.test.ts` con los 517 casos).
  - `npm run test:e2e`: 48/48 (1,0 min).
- Ensayo de DATA-01 con el programa real (`docs/pruebas.md`, «Ensayo .NET»), en `cuentas_test_data01`, creada vacía:
  - Primer arranque .NET: `/api/health` 200 `{"ok":true,"data":{"status":"ok","schemaVersion":5}}` con `no-store`; la consola dice `cuentas_pruebas@127.0.0.1:3307/cuentas_test_data01 (esquema 5)` y no contiene la contraseña.
  - Con filas sintéticas (un movimiento de MAX_CENTS pagado el 2024-02-29, un producto de 1,234 kg con objetivo 2,5 y un metadato), un segundo arranque .NET conserva el historial (versión 5 con sus started_at y applied_at), los recuentos (27 categorías, 1 movimiento, 1 producto, 1 metadato) y el `CHECKSUM TABLE` de las 14 tablas.
  - Express abre después la misma base (salud 200) sin cambiar nada.
  - Una base que inicializó Express (`cuentas_test_data01_express`, 27 categorías, historial 5) la abre .NET con salud 200 y sin cambios.
  - Las dos bases se borraron; no queda ninguna `cuentas_test_*`.
- Resultado: TIC-01 y DATA-01 cumplen su aceptación y pasan a «verificado». La evidencia anterior en 8.0.36 sigue en sus registros.
- Siguiente: FIN-01 (DATA-01 verificado), en la rama dotnet-modulos. PAN-01 también es elegible y va después, en el orden de la tabla; TIC-02 espera a PAN-01.

### FIN-01 — 9 de noviembre de 2026 (verificado)

- Base: dotnet-modulos en `3223f9b` (TIC-01 y DATA-01 verificados). Mismo entorno: Windows 10 Pro, SDK .NET 10.0.102, Node 24.13.0, MySQL 8.4.13 de ensayo en el 3307 con cuentas_pruebas, Chrome 157.0.8103.38 (`CUENTAS_E2E_CHANNEL=chrome`).
- Alcance: `GET /api/data`, `PUT /api/categories/:id`, `DELETE /api/categories/:id` (con `?replacementId`) y `GET/PUT /api/meta/:key` en .NET, con sesión; la base común de las rutas de negocio; los textos de SQLite de la web; y la app React real contra .NET en Playwright. Sin cambios en Express ni en los contratos.
- Base común (la usan los ID siguientes):
  - Api: tabla de rutas por módulo (`backend/src/CuentasClaras.Api/Common/ApiRoutes.cs`), con las reglas de Express (barra final, mayúsculas, HEAD, 401 antes que nada en las finanzas); parámetros con decodeURIComponent estricto y query como querystring de Node (`backend/src/CuentasClaras.Api/Common/UriText.cs`); `ApiResponse.Data` con estado; el 409 genérico de las restricciones de MySQL por un clasificador que pasa Composition (MySqlErrors.IsConstraintViolation), sin que Api conozca el driver; los double como JSON.stringify (JsDoubleConverter, en Application.Common).
  - Application.Common: IClock con NowIso (como toISOString) y Today (fecha local de reserva); `Run` sin resultado para la unidad de trabajo.
  - Infrastructure: MySqlDatabase.Unconfigured (el host sin base registra las rutas de datos y responde 500 si se usan, como la salud) y MySqlErrors.DuplicateKeyName.
  - Composition: `ApiHost.CreateWithDatabase` (reloj e ids sustituibles, para las pruebas) e inventario de rutas (`ApiHost.HostRoutes` y `ModuleRoutes`).
- Finanzas: Domain.Finance (Movement, RecurringRule, FinanceData, CategoryRules.WithDescendants, MetaKeys); Application.Finance (FinanceRequests con toda la validación de `shared/finance/backup.ts`, IFinanceStore, FinanceQueries, SaveCategory, DeleteCategory, SetMeta y las vistas de respuesta); Infrastructure.Finance.MySqlFinanceStore (el SQL de Express para lo que usa FIN-01); `backend/src/CuentasClaras.Api/Finance/FinanceRoutes.cs`.
- Web: los textos de SQLite pasan a «una base de datos MySQL de este equipo» en FinanceProvider, SummaryPage y BackupPanel (que ya no cita `server/data/cuentas.db`), y los comentarios de Root, ApiFinanceRepository y browserDataMigration. Decisión pendiente cerrada (encargo de la persona).
- Pruebas nuevas:
  - Corpus `fixtures/migration/rules-finance.json` (146 casos de 5 operaciones, datos inventados), generado con `tests/generateFinanceRules.ts` y `tests/financeRules.ts`: TypeScript `tests/migrationFinanceRules.test.ts` (147) y C# `FinanceRulesCorpusTests` (293: los 146 en es-ES y en la invariante, y la comprobación del corpus). Pasaron a la primera.
  - `FinanceHttpTests` (12, MySql, con `TestApi.cs`): datos iniciales y solo finanzas, orden fraccionario y presupuestos (0 y MAX_CENTS) con el JSON exacto, ids con mayúsculas/tildes/espacios en orden binario, un nivel de subcategorías del mismo tipo y sin cambio de tipo, validación antes del id, sustitución de movimientos y recurrentes con updated_at del reloj, destinos no válidos y replacementId vacío o repetido, borrar sin uso, un fallo a mitad de la sustitución deshecho entero (almacén que falla al borrar), categorías iniciales que no reaparecen, metadatos y el 500 de un escape mal formado.
  - `HttpContractTests` (7, MySql): los corpus HTTP de salud, finanzas, despensa y tickets sobre .NET, una base por escenario; activo: salud. Los de finanzas necesitan rutas de FIN-02, FIN-03 y FIN-05 (S1 y S2 empiezan restaurando con `PUT /api/data`) y la prueba lo comprueba.
  - E2E: `playwright.dotnet.config.ts` con la app completa (Kestrel con MySQL en 3203 sobre `cuentas_test_e2e_dotnet` y la web compilada en dist-dotnet en 4176), `e2e/test.ts`, `e2e/dotnet/database.ts` (reinicio por SQL, comprobando la base) y e2e/dotnet/pending.ts (retirado en TIC-04) (generate y los cinco GET de la despensa, con la respuesta de una base vacía). Dos pruebas nuevas en `e2e/app.spec.ts` (crear, renombrar y eliminar categorías; eliminar una con movimientos pasándolos a otra) y la llamada directa a `/api/test/reset` de «exportar y restaurar» pasa por `resetDatabase`. Contra .NET (@dotnet): «empieza vacía…», «valida los campos obligatorios», «crea, renombra y elimina categorías…», «con el código se ve todo…» y «si la sesión deja de valer…».
- Comandos, en Windows con el usuario limitado (3307):
  - `npm run build:dotnet`: 0 avisos y 0 errores.
  - `npm run test:dotnet`: 1485/1485 (las 1173 de antes y 312 nuevas); `--filter "Categoria=MySql"`: 47/47.
  - `npm run check`: tipos y oxlint correctos; Vitest 1177/1177 en 46 archivos (las 1030 de antes y 147 del corpus).
  - `npm run test:e2e:dotnet`: 14/14 (acceso 4; app 5 × escritorio y móvil), 27,9 s. Al terminar no queda `cuentas_test_e2e_dotnet`.
  - `npm run test:e2e`: 52/52 (las 48 de antes y las 2 nuevas en escritorio y móvil), 1,3 min.
- Limitaciones: la generación de vencimientos y la despensa se responden en el navegador en los E2E .NET hasta FIN-03, PAN-01, PAN-03 y TIC-04 (e2e/dotnet/pending.ts (retirado en TIC-04)). Express no cambia.
- Siguiente: FIN-02.

### FIN-02 — 9 de noviembre de 2026 (verificado)

- Base: dotnet-modulos en `a242c7c` (FIN-01). Mismo entorno (MySQL 8.4.13 de ensayo, Chrome 157).
- .NET: `PUT /api/movements/:id` (SaveMovement: categoría que existe y del mismo tipo, con los mensajes de requireCategory; actualizar por id con las filas encontradas y, si no existía, insertar; el choque con `movements_occurrence` es el 409 «Ese vencimiento ya existe…»), `DELETE /api/movements/:id` (DeleteMovement: la fecha de un vencimiento queda excluida si su recurrente existe) y `PUT /api/data` (RestoreBackup, adelantado de FIN-05 porque los escenarios S1 y S2 del corpus lo usan de preparación; valida todo y escribe en una transacción, primero las categorías principales). IFinanceStore y MySqlFinanceStore con el SQL de Express para ello.
- React (vale también con Express): cada alta decide su id al abrir el diálogo (MovementDialog, RecurringDialog y el formulario de CategoryEditor), y FinanceProvider separa «no se guardó» de «guardado, pero la relectura falló» con `src/features/finance/confirmedWrite.ts`: en el segundo caso la acción no falla y un aviso nuevo, de tono `warning` (tokens `--warning-*` en claro y oscuro), dice «Se ha guardado, pero la pantalla no se ha podido actualizar. No hace falta repetirlo: vuelve a cargar la página para verlo.»
- Pruebas nuevas:
  - `MovementHttpTests` (8, MySql): crear, reintentar y pagar con el mismo id (uno solo); categoría inexistente o de otro tipo, id distinto y cuerpo no válido; un movimiento que pasaría a ser un vencimiento que ya existe da 409 y no pisa ninguno; borrar un vencimiento lo excluye solo si su recurrente existe (y repetir el borrado no falla); céntimos de 1 a MAX_CENTS; restaurar sustituye las finanzas (también con las subcategorías antes que su principal) sin tocar los metadatos; restaurar valida antes de tocar nada; una restauración que falla a mitad (clave foránea) no cambia nada.
  - `HttpContractTests`: activo también S1 de `http-finance.json` («categorías, pago con ID estable, sustitución y metadatos», 18 pasos sin cambiar expectativas).
  - `src/features/finance/confirmedWrite.test.ts` (3).
  - E2E nuevos en `e2e/app.spec.ts`, en los dos backends: la relectura de después de guardar falla (`page.route`), el diálogo se cierra con el aviso y queda un solo movimiento; y la respuesta del guardado se pierde después de llegar al servidor (`route.fetch()` y abortar), el diálogo muestra el error y reintentar no duplica. Pasan a @dotnet además «registra un gasto…», «editar o eliminar…», «marcar un pago pendiente…», «eliminar una categoría con movimientos…», «rechaza una copia no válida…» y «exporta los movimientos a CSV…».
- Comandos, en Windows con el usuario limitado (3307):
  - `npm run build:dotnet`: 0 avisos y 0 errores.
  - `npm run test:dotnet`: 1493/1493; `--filter "Categoria=MySql"`: 55/55.
  - `npm run check`: tipos y oxlint correctos; Vitest 1180/1180 en 47 archivos.
  - `npm run test:e2e:dotnet`: 30/30 (acceso 4; app 13 × escritorio y móvil), 47,2 s.
  - `npm run test:e2e`: 56/56 (1,2 min).
  - `git diff --check` sin errores.
- Siguiente: FIN-03.

### FIN-03 — 9 de noviembre de 2026 (verificado)

- Base: dotnet-modulos en `e7b3efd` (FIN-02). Mismo entorno.
- .NET: `PUT /api/recurring/:id` (SaveRecurring: `{ rule, horizon, markPaidBefore }` validados en el orden de Express, la categoría del mismo tipo, la regla y sus fechas excluidas, los pendientes rehechos y los pagados conservados, lo anterior a markPaidBefore creado ya pagado en su fecha; devuelve `{ created }`), `DELETE /api/recurring/:id` (la regla y sus pendientes; los pagados se quedan con su recurringId) y `POST /api/occurrences/generate` (GenerateOccurrences: por regla en orden de id y por fecha). Todo con el bloqueo finance. Reglas en `backend/src/CuentasClaras.Domain/Finance/RecurringRules.cs` (scheduleDates, planOccurrences, projectOccurrences para FIN-04, generationHorizon) y en IsoDates (shiftMonth, addMonthsClamped, monthBounds y endOfNextMonth), sin DateTime.
- Pruebas nuevas:
  - `RecurringHttpTests` (9, MySql): abrir varias veces y con dos conexiones no duplica (`[0, 0]`); dos conexiones que generan a la vez la primera vez dan `[0, 2]`; guardar un recurrente y generar a la vez desde dos conexiones no duplica ni da 409; pagar o borrar un vencimiento no lo regenera (y queda excluido); editar rehace los pendientes y conserva los pagados; un préstamo empezado con las cuotas pasadas pagadas y los ids en orden de fecha; borrar el recurrente conserva lo pagado con su vínculo; el día 31 en un año bisiesto (31/01, 29/02, 31/03, 30/04) con las cuotas numeradas; y los mensajes de cuerpo, regla, id y fechas.
  - Mutación, restaurada después: sin el bloqueo finance en GenerateOccurrences, las dos pruebas de dos conexiones fallan con el 409 del índice único.
  - `HttpContractTests`: activo también S2 («recurrentes del día 31, exclusiones, pagos y generación repetida», 10 pasos con los ids del escenario).
  - Corpus `rules-finance.json`: 31 casos más (177 en total) de addMonthsClamped, generationHorizon, scheduleDates y planOccurrences; los 146 de antes no cambian. C# 355/355 y TypeScript 178/178.
  - E2E: fuera el stub de generate (e2e/dotnet/pending.ts (retirado en TIC-04)), y pasan a @dotnet «abrir varias veces la aplicación no duplica vencimientos», «exportar y restaurar una copia conserva los datos» y «la plantilla anual cuadra con la mensual…».
- Comandos, en Windows con el usuario limitado (3307):
  - `npm run build:dotnet`: 0 avisos y 0 errores.
  - `npm run test:dotnet`: 1564/1564; `--filter "Categoria=MySql"`: 64/64.
  - `npm run check`: tipos y oxlint correctos; Vitest 1211/1211 en 47 archivos.
  - `npm run test:e2e:dotnet`: 36/36 (acceso 4; app 16 × escritorio y móvil), 44,9 s.
  - `npm run test:e2e` no se repite: FIN-03 no cambia la web ni Express (su última ejecución, 56/56, es la de FIN-02).
  - `git diff --check` sin errores.
- Siguiente: FIN-04 (y después FIN-05; los dos dependen de FIN-03).

### FIN-04 — 9 de noviembre de 2026 (verificado)

- Base: dotnet-modulos en `17d5530` (FIN-03). Mismo entorno.
- Contrato nuevo, solo en .NET y documentado en `docs/api.md` («Consultas de resumen»): `GET /api/summary/month?year&month&hoy` → MonthView `{ period, horizon, summary, expensesByCategory, budgetLines, breakdown }` y `GET /api/summary/year?year&hoy` → YearView `{ period, horizon, summary, series, income, expense, budgetLines }`, con sesión, parámetros comprobados en orden (año, mes, hoy; repetidos no valen) y sin guardar nada. Lo realizado cuenta por su fecha de pago, lo pendiente por su vencimiento y lo proyectado después del horizonte (`endOfNextMonth(hoy)`) como pendiente, sin persistir.
- TypeScript: `shared/finance/summaryViews.ts` (forecastMovements, monthView y yearView) compone lo que ya calculaban las páginas, con sus pruebas (`shared/finance/summaryViews.test.ts`, 3: la previsión, el mes igual a las funciones sueltas y la columna del año igual a su mes).
- C#: `backend/src/CuentasClaras.Application/Finance/FinanceSummaries.cs` (periodSummary, totalsByCategory, budgetLines, categoryBreakdown, monthlySeries, categoryMonthMatrix y las vistas, con mapas en orden de inserción, ordenación estable y los mismos empates), SummaryQueries y las dos rutas; `backend/src/CuentasClaras.Domain/Common/JsCollator.cs` para localeCompare('es') (y la sensibilidad base de PAN-01).
- React: la bandera de compilación `__CUENTAS_BACKEND__` (`define` en `vite.config.ts` con `CUENTAS_BACKEND=dotnet`, declarada en `src/env.d.ts`); `src/features/finance/api.ts` (cliente de las consultas) y `src/features/finance/useSummaryView.ts` (useMonthView y useYearView: en el navegador con summaryViews contra Express; contra .NET, la consulta, pedida otra vez cuando cambian los datos, hoy o el periodo, sin que una respuesta tardía pise a la última). SummaryPage, YearPage y BudgetsPage los usan (presupuestos, con la categoría tal como está en los datos para el editor); `useForecastMovements.ts` desaparece. Textos nuevos solo con la web para .NET: «Calculando el resumen…» y «No se ha podido calcular el resumen: …» (`src/features/finance/components/SummaryPending.tsx`).
- Pruebas nuevas:
  - Corpus `rules-finance.json`: 20 casos más (197): monthView (9), yearView (5), forecastMovements (2), los tres «api-*» con datos que se pueden restaurar y una matriz de localeCompare('es') de 38 nombres (ñ, tildes, mayúsculas, signos, cifras, vacíos). C# 395/395 con la serialización de la API (camelCase y JsDoubleConverter), en es-ES y en la invariante; pasó a la primera, también la matriz: el ICU de Windows y el de Node 24 ordenan igual esos nombres.
  - `SummaryHttpTests` (4, MySql): restaurados los datos de los casos «api-*», GET /api/summary/* responde exactamente lo que calculó TypeScript y consultar no cambia los datos; acceso y mensajes de los parámetros.
  - E2E: `e2e/dotnet/app/resumen.spec.ts` (solo .NET): el mes, el año y los presupuestos piden `/api/summary/*` con la fecha del navegador y enseñan las cifras de la copia de ejemplo; «la plantilla anual cuadra con la mensual…» (@dotnet) comprueba ahora las cifras calculadas por .NET; el control del invitado (`FINANCE_REQUEST`) incluye `/api/summary`.
- Comandos, en Windows con el usuario limitado (3307):
  - `npm run build:dotnet`: 0 avisos y 0 errores.
  - `npm run test:dotnet`: 1608/1608; `--filter "Categoria=MySql"`: 68/68.
  - `npm run check`: tipos y oxlint correctos, sin avisos; Vitest 1234/1234 en 48 archivos.
  - `npm run test:e2e:dotnet`: 38/38 (acceso 4; app 17 × escritorio y móvil), 57,9 s.
  - `npm run test:e2e`: 56/56 (1,2 min): las páginas reorganizadas calculan lo mismo contra Express.
  - `git diff --check` sin errores.
- Siguiente: FIN-05.

### FIN-05 — 9 de noviembre de 2026 (verificado)

- Base: dotnet-modulos en `2a2efac` (FIN-04). Mismo entorno.
- .NET: `POST /api/import` (ImportBrowserData: `{ data, lastBackupAt }` validados como en Express, 201 con `{ categories, movements, recurring }`, 409 «La base de datos ya tiene datos…» si hay datos del usuario, la fecha de copia que ya hubiera se conserva y browserImportAt se anota con el reloj). La regla hasUserData, en `backend/src/CuentasClaras.Domain/Finance/BackupRules.cs` (la misma clave JSON de cada categoría que backup.ts, con JsJson). `PUT /api/data` (restaurar) ya estaba desde FIN-02. El JSON v1 y el CSV se generan y se leen en el navegador, igual contra los dos backends.
- Pruebas nuevas:
  - Corpus `rules-finance.json`: 10 casos de hasUserData (207 en total; C# 415/415 y TypeScript 208/208).
  - `ImportHttpTests` (4, MySql): importa sin datos del usuario aunque haya despensa (y anota las fechas); no importa si ya hay un movimiento o una categoría cambiada; conserva la fecha de copia y valida el cuerpo; y restaurar e importar dejan iguales, con `CHECKSUM TABLE`, las siete tablas de la despensa y los tickets sembradas por SQL (y `GET /api/data` solo tiene finanzas). La restauración deshecha entera si falla a mitad ya la probaba MovementHttpTests.
  - E2E: `e2e/app.spec.ts` entero contra .NET (15 pruebas @dotnet): copias JSON (exportar, restaurar en otro navegador y rechazar una no válida), CSV, plantilla anual y la migración de los datos del navegador.
- El escenario S3 de `http-finance.json` sigue pendiente en HttpContractTests: usa las rutas de personas y productos (PAN-01).
- Comandos, en Windows con el usuario limitado (3307):
  - `npm run build:dotnet`: 0 avisos y 0 errores.
  - `npm run test:dotnet`: 1632/1632; `--filter "Categoria=MySql"`: 72/72.
  - `npm run check`: tipos y oxlint correctos; Vitest 1244/1244 en 48 archivos.
  - `npm run test:e2e:dotnet`: 40/40 (acceso 4; app 18 × escritorio y móvil), 52,3 s.
  - `npm run test:e2e` no se repite: FIN-05 no cambia la web ni Express (la última, 56/56, es la de FIN-04).
  - `git diff --check` sin errores.
- Con esto las finanzas están completas en .NET (FIN-01 a FIN-05). Siguiente: PAN-01.

### PAN-01 — 11 de noviembre de 2026 (verificado)

- Base: dotnet-modulos en `e091a3a` (FIN-05). Mismo entorno: Windows 10 Pro, SDK .NET 10.0.102, Node 24.13.0, MySQL 8.4.13 de ensayo en el 3307 con cuentas_pruebas, Chrome 157.0.8103.38 (`CUENTAS_E2E_CHANNEL=chrome`).
- Cambio de contrato (decisión 1 del plan, en `docs/decisiones.md`): `PUT /api/despensa/productos/:id` exige `expectedVersion`, un entero seguro desde 1 validado con el resto del cuerpo antes de buscar el producto («El campo «expectedVersion» debe ser la versión del producto (un número entero mayor que 0).»). UpdateItem bloquea el producto y comprueba 404, después 409 sin escribir («Este producto ha cambiado desde que lo abriste (quizá desde otro dispositivo), así que no se ha guardado. Vuelve a cargarlo para ver cómo está ahora.») y después el dueño.
  - Express: `shared/pantry/types.ts` (PantryItemUpdate), `shared/pantry/pantryValidation.ts` (validateItemUpdate), `server/modules/pantry/application/UpdateItem.ts` y su ruta.
  - Contrato: `fixtures/migration/http-pantry.json` lleva `expectedVersion` en el PUT y dos pasos nuevos (409 con la versión vieja y 400 sin ella); Express lo reproduce entero.
  - React: PantryItemDialog guarda la versión con que se abrió; ante el 409 conserva lo escrito y ofrece «Volver a cargar el producto», que trae el producto como está ahora con su versión («Este es el producto tal como está ahora. Repite tus cambios y guarda.»). La lógica, en `src/features/pantry/components/itemEdit.ts`; usePantry separa createItem, updateItem y reloadItem.
- .NET: las 8 rutas de personas y productos, públicas.
  - Domain: `backend/src/CuentasClaras.Domain/Pantry/` (tipos y PantryRules: unidades, frecuencias, checkQuantity en milésimas y el orden de sortPeople y sortItems con JsCollator).
  - Application: PantryRequests (la validación de pantryValidation.ts con sus mensajes y su orden), IPantryStore, PantryQueries, los casos de uso y `backend/src/CuentasClaras.Application/Pantry/Contracts/PantryContracts.cs` (IPantryCatalog, PantryItemView y NewPantryItem, lo que usarán los tickets; lo implementa PantryCatalog).
  - Infrastructure: MySqlPantryStore, con el SQL de Express; DECIMAL(10,3) se lee y se escribe como texto decimal exacto.
  - Api: `backend/src/CuentasClaras.Api/Pantry/PantryRoutes.cs`; esas rutas salen de las pendientes de ApiRouter.
- Pruebas nuevas:
  - Corpus `fixtures/migration/rules-pantry.json` (102 casos: validación de personas, productos y edición, checkQuantity, sortPeople y sortItems), generado con `tests/generatePantryRules.ts`: TypeScript 103/103 y C# 205/205 (es-ES e invariante), más TicketVocabularyTests (el vocabulario de tickets coincide con PantryRules).
  - `pantry.test.ts` (Express): la edición con versión (400, 404 antes que 409, 409 sin escribir) y dos conexiones editando a la vez (una 200 y otra 409, cinco veces).
  - `PantryHttpTests` (8, MySql): lo mismo en .NET, más personas, validación con los mensajes de Express, milésimas, céntimos, el orden «es» de productos y personas, e IPantryCatalog dentro de una transacción de tickets (se une a ella y se deshace con ella).
  - `itemEdit.test.ts` (5): la versión que se envía, qué error es un conflicto y lo que queda al volver a cargar.
  - HttpContractTests: el escenario S3 de `http-finance.json` (importación y restauración aislada, que usa personas y productos) pasa a estar activo y en verde. El de `http-pantry.json` sigue pendiente (ajustar, comprar, revisiones…: PAN-02 y PAN-03).
  - E2E en los dos backends: «dos móviles editan el mismo producto…» (nuevo, con `newPhone` de `e2e/test.ts` para que el segundo contexto también tenga las rutas pendientes contra .NET), y «el invitado solo ve la despensa…» y «crea una persona y un producto…» pasan a @dotnet. Se quitan de e2e/dotnet/pending.ts (retirado en TIC-04) las personas y los productos.
- Comandos, en Windows con el usuario limitado (3307):
  - `npm run build:dotnet`: 0 avisos y 0 errores.
  - `npm run test:dotnet`: 1846/1846; `--filter "Categoria=MySql"`: 80/80.
  - `npm run check`: tipos y oxlint correctos; Vitest 1354/1354 en 50 archivos.
  - `npm run test:e2e:dotnet`: 46/46 (acceso 4; app 21 × escritorio y móvil).
  - `npm run test:e2e`: 58/58.
  - `git diff --check` sin errores.
- Siguiente: PAN-02 (ajustar, comprar y deshacer). TIC-02 también es elegible (TIC-01 y PAN-01 verificados); va después, en el orden de la tabla.

### PAN-02 — 11 de noviembre de 2026 (verificado)

- Base: dotnet-modulos en `9647e10` (PAN-01). Mismo entorno.
- .NET, sin cambios de contrato ni en Express:
  - Rutas `POST /api/despensa/productos/:id/ajustar`, `POST /api/despensa/comprado` y `POST /api/despensa/comprado/deshacer`.
  - Casos de uso en `backend/src/CuentasClaras.Application/Pantry/PurchaseUseCases.cs`: AdjustItem, AddEvent (lo usa comprar; su ruta es de PAN-03), MarkPurchased, UndoPurchase y ApplyTicketPurchase. Todos bloquean sus productos antes de leer (FOR UPDATE, en orden de id).
  - Domain: PantryEvent, los cambios de una compra (QuantityChange y EventChange) y stepQuantity. PantryRequests: validateDeltaInput, validatePurchaseInput y validateUndoInput.
  - MySqlPantryStore: getItems, setQuantity, setPrice, fillToTarget (una sola escritura) y las revisiones (insertar, leer y borrar).
  - IPantryCatalog añade ApplyTicketPurchase (el precio nuevo y lo comprado de un ticket) para TIC-03.
- Pruebas nuevas:
  - Corpus `rules-pantry.json`: 53 casos (delta, compra, deshacer y stepQuantity; 155 en total, los anteriores sin cambios). TypeScript 156/156 y C# 312/312 (con TicketVocabularyTests).
  - `PantryPurchaseHttpTests` (8, MySql): + y − con los mensajes de Express, diez + desde dos conexiones (3…12, versión 11), comprar (orden de los cambios, la compra apuntada con la fecha del navegador o la del servidor, nada se reduce), listas no válidas sin escribir, deshacer (cantidades, compras apuntadas, persistencia en otro host, dos veces = 409), 409 sin revertir nada a medias, un deshacer y un + a la vez desde dos conexiones (cinco rondas: o deshacer y después +, o + y deshacer 409; nunca se pierde un cambio) y ApplyTicketPurchase.
  - Mutación: sin el bloqueo de AdjustItem fallan las dos pruebas de concurrencia; sin el de UndoPurchase, la del deshacer a la vez falla 3 de 3. Se restauraron.
  - E2E: «los botones + y −, marcar como comprado y deshacer», «dos móviles pulsan + a la vez…» y las dos del portapapeles de la lista pasan a @dotnet.
  - El escenario de `http-pantry.json` sigue pendiente: le faltan revisiones, actividad, presupuesto y repaso (PAN-03).
- Comandos, en Windows con el usuario limitado (3307):
  - `npm run build:dotnet`: 0 avisos y 0 errores.
  - `npm run test:dotnet`: 1960/1960; `--filter "Categoria=MySql"`: 88/88.
  - `npm run check`: tipos y oxlint correctos; Vitest 1407/1407 en 50 archivos.
  - `npm run test:e2e:dotnet`: 54/54 (acceso 4; app 25 × escritorio y móvil).
  - `npm run test:e2e` no se repite: PAN-02 no cambia la web ni Express, solo etiqueta pruebas (la última, 58/58, es la de PAN-01).
- Siguiente: PAN-03 (revisiones, presupuesto, repaso y actividad).

### PAN-03 — 11 de noviembre de 2026 (verificado)

- Base: dotnet-modulos en `821f039` (PAN-02). Mismo entorno.
- .NET, sin cambios de contrato ni en Express:
  - Rutas `POST /api/despensa/productos/:id/revision`, `DELETE /api/despensa/revisiones/:id`, `GET/PUT /api/despensa/presupuesto`, `PUT /api/despensa/repaso` y `GET /api/despensa/actividad`. Las rutas pendientes de ApiRouter son ya solo las de tickets.
  - `backend/src/CuentasClaras.Application/Pantry/ReviewUseCases.cs`: DeleteEvent, SetBudget, SetReviewDate y PantryActivityQueries (ajustes y actividad); AddEvent valida el cuerpo antes de buscar el producto. PantryRequests: validateEventInput, validateBudgetInput y validateReviewInput.
  - La actividad (decisión 3 del plan, en `docs/decisiones.md`): consulta de la despensa; las compras llegan por IPantryPurchaseHistory (`Application.Pantry.Contracts`), que implementa `backend/src/CuentasClaras.Infrastructure/Tickets/MySqlTicketPurchaseHistory.cs` con el SQL de purchaseLinesSince y PurchaseHistory (TIC-01). `hoy` que falta, no es una fecha o se repite: la fecha del servidor, como Express.
  - IsoDates.AddDays (la ventana de 400 días) y PantrySettings.
- Pruebas nuevas:
  - Corpus `rules-pantry.json`: 31 casos (revisiones, presupuesto, repaso y addDays; 186 en total, los anteriores sin cambios). TypeScript 187/187 y C# 373/373.
  - `PantryReviewHttpTests` (3, MySql): revisiones con los mensajes de Express (validación antes del 404, deshacer, borrado en cascada con el producto), presupuesto (0 frente a null, una sola fila) y repaso, y la actividad con tickets sembrados por SQL (ventana de 400 días con su borde, orden por fecha, posición y guardado, líneas sumadas, kilos, importe desconocido, y sin devoluciones, «para una ocasión», pendientes ni líneas sin producto).
  - HttpContractTests: el escenario de `http-pantry.json` («catálogo público, ajustes relativos, compras, deshacer y revisión», con los pasos de PAN-01) se activa y pasa entero en .NET. Quedan pendientes solo los de tickets.
  - E2E: se quitan de e2e/dotnet/pending.ts (retirado en TIC-04) el presupuesto y la actividad (queda la lista de tickets, de TIC-04); las pruebas de la despensa los piden ya al host .NET. Las de revisiones y repaso de `e2e/tickets.spec.ts` guardan tickets: van con TIC-04.
- Comandos, en Windows con el usuario limitado (3307):
  - `npm run build:dotnet`: 0 avisos y 0 errores.
  - `npm run test:dotnet`: 2025/2025; `--filter "Categoria=MySql"`: 91/91.
  - `npm run check`: tipos y oxlint correctos; Vitest 1438/1438 en 50 archivos.
  - `npm run test:e2e:dotnet`: 54/54.
  - `npm run test:e2e` no se repite: PAN-03 no cambia la web ni Express (la última, 58/58, es la de PAN-01).
- Con esto la despensa está completa en .NET. Siguiente: TIC-02 (lectura OCR y borrador revisable).

### TIC-02 — 11 de noviembre de 2026 (verificado)

- Base: dotnet-modulos en `b33bb90` (PAN-03). Mismo entorno.
- .NET, sin cambios de contrato ni en Express:
  - Ruta `POST /api/despensa/tickets/leer` (pública), con su límite de 30 MB de antes. ReadTicket (`backend/src/CuentasClaras.Application/Tickets/ReadTicket.cs`): texto o imágenes, la huella del origen, TicketParser, lo aprendido de la tienda, las sugerencias (con IPantryCatalog) y los duplicados (TicketDuplicates: misma lectura u origen, misma huella, mismo contenido con una huella antigua, y el posible duplicado). No guarda nada ni toma bloqueos.
  - TicketReadRequest: la validación y los límites de readTicketRequest con sus mensajes y su orden (texto, franjas o imágenes; 6 imágenes o 24 franjas; 8 MB, 20 MB y 40 Mpx), NodeBase64 (el decodificador de Node) e ImageInfo (cabecera PNG/JPEG).
  - Vistas JSON del borrador con el orden y los campos de Express (`backend/src/CuentasClaras.Application/Tickets/TicketViews.cs`); lo que TypeScript deja undefined no se escribe.
  - Infrastructure: MySqlTicketStore (lo aprendido, los resúmenes, los candidatos y el ticket entero, con el SQL de Express), Sha256Hasher (UTF-8 con U+FFFD) y NodeTicketReader.
  - El OCR (decisión 4 del plan, en `docs/decisiones.md`): `server/modules/tickets/adapters/tesseract/ocrWorker.ts`, una entrada fina sobre el TesseractTicketReader de Express, lanzada con `node --import tsx` desde la raíz; NDJSON por stdin/stdout, una petición cada vez, 3 minutos como máximo, reinicio si muere y cierre con el host. `CUENTAS_OCR_WORKER` cambia la ruta.
- Pruebas nuevas:
  - Corpus `fixtures/migration/rules-ticket-read.json` (90 casos: el base64 de Node con sus rarezas, cabeceras PNG/JPEG y el cuerpo de la lectura): TypeScript 91/91 y C# 181/181.
  - `TicketReadHttpTests` (6, MySql): el primer paso de `http-tickets.json` con la respuesta exacta de Express; el ticket de ejemplo con su OCR guardado (sugerencias, comprobación, huella de la imagen, sin guardar nada); validación con los mensajes de Express; límites de 8 MB, 20 MB y píxeles, JPEG y data URL; franjas (como Express, pueden solaparse si el desplazamiento crece); y duplicados.
  - `OcrWorkerTests` (4, categoría Ocr): el worker real lee los dos tickets inventados como el OCR real de `tickets.test.ts`, una imagen ilegible falla sin tumbar el proceso, y sin el worker la causa sale en la consola.
  - `server/modules/tickets/adapters/tesseract/ocrWorker.test.ts` (Vitest): el worker responde lo mismo que el lector de Express (con una franja), explica los errores y termina al cerrar stdin.
  - `HttpTests`: en el límite de 30 MB, `/api/despensa/tickets/leer` responde ya 400 (la ruta existe) en lugar de 404.
  - E2E: sin cambios. Leer un ticket en la web también lo guarda: `e2e/tickets.spec.ts` pasa a .NET con TIC-03 y TIC-04.
- Comandos, en Windows con el usuario limitado (3307):
  - `npm run build:dotnet`: 0 avisos y 0 errores.
  - `npm run test:dotnet`: 2216/2216 (con el OCR real); `--filter "Categoria=MySql"`: 97/97.
  - `npm run check`: tipos y oxlint correctos; Vitest 1530/1530 en 52 archivos.
  - `npm run test:e2e:dotnet` y `npm run test:e2e` no se repiten: TIC-02 no cambia la web ni Express (las últimas, 54/54 y 58/58).
- Siguiente: TIC-03 (guardado atómico, deduplicación y efectos en la despensa).

### TIC-03 — 12 de noviembre de 2026 (verificado)

- Base: dotnet-modulos en `13a51f6` (TIC-02). Mismo entorno.
- .NET, sin cambios de contrato ni en Express:
  - Ruta `POST /api/despensa/tickets` (pública): SaveTicket (`backend/src/CuentasClaras.Application/Tickets/SaveTicket.cs`) en una transacción con el bloqueo tickets, que bloquea antes de leer nada los productos que ya existían (IPantryCatalog.LockItems, en orden de id); después, los duplicados (409 «Este ticket ya está guardado (…)» o el posible duplicado sin `distinctPurchase`), un producto nuevo por nombre y persona (IPantryCatalog.CreateItem, por compras), lo aprendido de la tienda, el precio y lo comprado de los que ya existían (IPantryCatalog.ApplyTicketPurchase), la cabecera con su huella y las líneas, también las dudosas (pendientes, sin producto). Responde 201 con el ticket entero y los productos.
  - Con las reglas de TIC-01 (canApplyLine, newItemUnit, priceFromLines, quantityFromLines, lineReviewStatus y la huella) y validateTicketSave en C#.
  - MySqlTicketStore guarda lo aprendido, la cabecera y las líneas con el SQL de Express; la evidencia, como la deja validateTicketSave, y los ajustes y avisos, como JSON.
  - Las sugerencias del borrador (TIC-02) salen ahora en el orden de un objeto de JavaScript: primero las claves que son índices enteros (TicketDraftView.JsObjectKeyOrder, comprobado con Node).
- Pruebas nuevas:
  - `TicketSaveHttpTests` (10, MySql): los guardados de `tickets.test.ts` (productos nuevos, lo aprendido y la siguiente lectura emparejada, precio y cantidad en los que se cuentan, decisiones que no encajan sin guardar nada, el importe mal leído pendiente con su evidencia, el 92,90 € forzado que sigue pendiente y las huellas golden) y los de `ticketAtomicity.test.ts` (un fallo real de MySQL en la segunda línea deja las 14 tablas iguales y admite un único reintento; dos guardados iguales a la vez dan 201 y 409; un ticket y un + a la vez no se pisan), más dos guardados iguales sin productos que ya existan.
  - Mutación: sin bloquear los productos, «un ticket y un + a la vez» falla 3 de 3; sin el bloqueo tickets, los dos guardados sin productos fallan 3 de 3 (con un producto compartido, su bloqueo ya los ponía en serie). Se restauraron.
  - `TicketDraftOrderTests`: el orden de las claves, igual que Node 24.
  - E2E: sin cambios. `e2e/tickets.spec.ts` necesita también la lista y el detalle de tickets: pasa a .NET con TIC-04.
- Comandos, en Windows con el usuario limitado (3307):
  - `npm run build:dotnet`: 0 avisos y 0 errores.
  - `npm run test:dotnet`: 2227/2227; `--filter "Categoria=MySql"`: 107/107.
  - `npm run check`, `npm run test:e2e:dotnet` y `npm run test:e2e` no se repiten: TIC-03 no cambia TypeScript, la web ni Express.
- Siguiente: TIC-04 (historial, detalle, asociación, borrado y el inventario de rutas).

### TIC-04 — 16 de noviembre de 2026 (verificado)

- Base: dotnet-modulos en `0121041` (TIC-03). Mismo entorno; Chrome 157.0.8103.51.
- .NET, sin cambios de contrato ni en Express:
  - Rutas `GET /api/despensa/tickets`, `GET /api/despensa/tickets/:id`, `PUT /api/despensa/tickets/:id/lineas/:lineId` y `DELETE /api/despensa/tickets/:id` (`backend/src/CuentasClaras.Application/Tickets/TicketUseCases.cs`: TicketQueries, SetLineItem y DeleteTicket, los dos últimos con el bloqueo tickets; SetLineItem bloquea antes el producto nuevo). Con el SQL de Express en MySqlTicketStore.
  - Con esto .NET tiene las 39 rutas: ApiRouter ya no reserva rutas pendientes, y lo desconocido sin sesión da 401, como requireAdmin en Express.
  - El worker del OCR se busca subiendo de carpeta desde la actual y desde la del ensamblado (`dotnet run --project` arranca el host en la carpeta del proyecto); `CUENTAS_OCR_WORKER` sigue mandando.
- Pruebas nuevas:
  - HttpContractTests: el escenario de `http-tickets.json` (lectura, guardado, duplicado, historial, asociación, borrado y actividad) pasa entero, sin tocar sus expectativas: los seis escenarios activos. Y el inventario: .NET atiende exactamente los 39 pares de Express (más las dos consultas de resumen, solo de .NET) y cada uno tiene un paso 2xx en los contratos.
  - TicketSaveHttpTests: cambiar una línea (y sus iguales) y lo aprendido, sus 400 y 404, y borrar un ticket: fuera sus compras de la actividad, los productos y sus cantidades se quedan.
  - OcrWorkerTests: el worker se encuentra desde la raíz y desde la carpeta del proyecto.
  - E2E: fuera e2e/dotnet/pending.ts (retirado en TIC-04), las respuestas simuladas, las etiquetas @dotnet y el filtro: los proyectos app-* ejecutan todas las pruebas de la app contra .NET, `e2e/tickets.spec.ts` incluido, con el OCR real.
- Comandos: los de la verificación final, abajo.
- Con esto están todos los ID de código. Siguiente: DATA-02 y CUT-01, que hace la persona.

### Ensayo técnico del corte — 16 de noviembre de 2026 (con datos sintéticos)

- No es DATA-02 ni CUT-01. En Windows, con MySQL 8.4.13 de ensayo y el usuario limitado, bases `cuentas_test_corte` y `cuentas_test_corte_copia` (borradas al terminar). Un script fuera del repositorio, ejecutado con `node --import tsx` desde la raíz.
- Pasos y resultados:
  1. Copia SQLite sintética (`tools/importer/syntheticCopy.ts`) importada con el importador (`tools/importer/cli.ts`): «válido», 60 filas de 12 tablas, todas iguales fila a fila.
  2. Express sirvió la base; se paró y .NET sirvió la misma: respuestas idénticas en 11 rutas (salud, `/api/data`, metadatos, personas, productos, presupuesto, actividad, la lista de tickets y los tres tickets). Servirla no la cambió (`CHECKSUM TABLE`).
  3. `mysqldump --single-transaction --no-tablespaces --set-gtid-purged=OFF --result-file` y recuperación en otra base con `source`: `CHECKSUM TABLE` igual en las 14 tablas.
  4. .NET sobre la base recuperada, las mismas respuestas; y la vuelta a Express sobre ella, también.
- Los pasos para la persona (parar escrituras, copiar y comprobar la copia, cambiar el destino de la web y volver a Express) están en [DATA.md](DATA.md), «Ensayo, corte y recuperación», y el arranque en dos terminales, en el README («Ensayo con el backend .NET»).

### Verificación final — 16 de noviembre de 2026

- Rama dotnet-modulos, en Windows 10 Pro con SDK .NET 10.0.102, Node 24.13.0, MySQL 8.4.13 de ensayo (3307, usuario limitado cuentas_pruebas) y Chrome 157.0.8103.51 (`CUENTAS_E2E_CHANNEL=chrome`: el Chromium de Playwright sigue sin poder descargarse).
- Comandos, desde la raíz:
  - `npm ci`: correcto (208 paquetes).
  - `dotnet restore backend/CuentasClaras.slnx --locked-mode`: correcto.
  - `npm run build:dotnet`: 0 avisos y 0 errores.
  - `npm run test:dotnet`: 2230/2230; `npm run test:dotnet -- --filter "Categoria=MySql"`: 109/109.
  - `npm run check`: tipos y oxlint correctos; Vitest 1530/1530 en 52 archivos.
  - `npm run build`: correcto.
  - `npm run test:e2e:dotnet`: 64/64 (acceso 4; la app entera, 30 × escritorio y móvil).
  - `npm run test:e2e`: 58/58.
  - `git diff --check`: sin errores.
- La primera pasada paró en `npm run check`: STATUS citaba e2e/dotnet/pending.ts (retirado en TIC-04) entre comillas invertidas; corregido, se repitió desde `npm run check` hasta el final.
- Después, a petición de la persona, dotnet-modulos se fusionó en main en avance rápido (`482f600`, sin commit de fusión) y se borraron las ramas locales ya contenidas en main (dotnet-modulos y tic-01-reglas). En el remoto solo existe main.
- Pendiente para la persona: DATA-02 (importar su copia real y revisar el informe), CUT-01 (el cambio de la instalación diaria, con los pasos de DATA.md), repetir las suites en su MySQL 8.0.36 con su usuario de pruebas, e instalar el Chromium de Playwright cuando la descarga funcione.

### Tickets de Lidl Plus: reglas portadas de la lectura, 19 de noviembre de 2026 (no es un ID de la migración)

- Base: main en `fba6550`; rama tickets-lidl-plus, fusionada en main el 23 de noviembre (`c622210`, más abajo) y borrada. Es una mejora de la lectura de tickets que pidió la persona: Express sigue siendo el backend de uso diario y .NET tiene que dar lo mismo. La razón y las medidas están en `docs/decisiones.md`, «De la lectura de tickets de Lidl Plus».
- Alcance portado a C#: cambian reglas de `shared/tickets/ticketParse.ts` y se portan a `backend/src/CuentasClaras.Domain/Tickets/TicketParser.cs`.
  - «2,75X» deja de ser un importe, y una multiplicación ilegible marca la línea.
  - Un importe sin coma nunca es fiable, y se descarta si sus cifras están en el nombre.
  - Una línea de peso ilegible se une al producto de encima, marcada.
  - Los productos sin «EUR» no se pierden tras la cabecera de Lidl.
  - La PROMO sangrada pasa a ser un descuento sugerido.
  - La unión de capturas por texto es tolerante y avisa.
  - Hay `nonProducts` y el concepto de un ajuste va sin importe.
  - La votación usa la nueva `OcrLine.rereads`.

  Lo que se programa a mano por puntos de código (\p{L} con la bandera u): la cabecera de Lidl con el código postal y las mayúsculas de un producto.
- Tipos: `OcrLine.Rereads` (TicketTypes.cs, NodeTicketReader.ReadLine y el corpus) y `ParsedTicket.NonProducts` (ParsedTicket.cs; ParsedTicketView no lo escribe si es null, como undefined en Express). El paso «PAN ENSAYO» de `fixtures/migration/http-tickets.json` no cambia.
- Corpus: de 517 a 532 casos.
  - 15 nuevos (`lidl-plus-*`), con las entradas de los tests nuevos de `shared/tickets/ticketSafety.test.ts`.
  - Cambian 16, revisados uno a uno: 13 solo por el concepto del ajuste sin importe; seguridad-solape-ambiguo-ticket gana el aviso de solape; y trampa-punto-fin-de-linea y trampa-kelvin, cuyas líneas de peso ilegibles dejan de ser productos y marcan el producto de encima.
  - Generado con Node 24.13 (bonito-cada-caracter no cambia). `tests/migrationTicketRules.test.ts` y TicketRulesCorpusTests esperan 532.
- Comandos, en Windows con el MySQL 8.4.13 de ensayo:
  - `npm run check`: Vitest 1586/1586 en 57 archivos.
  - .NET: 2260/2260, con el corpus 1086/1086 en es-ES y en la invariante.

  Un host .NET arrancado aparte con `dotnet run` bloqueaba la carpeta de compilación de la API (backend/src/CuentasClaras.Api/bin). No se tocó: se compiló y probó con `--artifacts-path` en una carpeta fuera de git.
- Sin ejecutar todavía en esta entrada: `npm run test:e2e:dotnet` (al terminar la interfaz). Se ejecutó después, con la fusión `c622210`: 68 pasan y 4 se omiten (abajo).
- Los recuentos de esta entrada (532 casos, Vitest 1586, .NET 2260, corpus 1086) son los de la rama antes de fusionarla. Con la fusión pasaron a 535, 1594, 2266 y 1092; con FIX-01, a 538, 1606, 2272 y 1098; con FIX-02, a 545, 1629, 2286 y 1112.

### Segunda relectura y el ticket de Lidl Plus con cupones, 22 de noviembre de 2026 (`48093ae`, no es un ID de la migración)

- Base: main de GitHub antes de la fusión. El ejemplo es una captura de Lidl Plus del 21/11/26; la captura no se guarda y los datos de pago y de la tienda se sustituyen por otros inventados (`fixtures/tickets/ticket-lidl-plus-cupones.json` y su imagen sintética, y el OCR real de la captura en `fixtures/tickets/ocr-real/lidl-plus-captura-422px.json`).
- Lector: si la relectura de cifras no trae nada con forma de importe, se repite una vez con un margen más ajustado (TAIL_RETRY_PAD, `docs/decisiones.md`). Medido con OCR real en 7 imágenes: arregla las 4 relecturas sin importe y no cambia ninguna otra.
- Corpus: 520 casos (3 nuevos). Regla portada a C#: no hace falta, el lector es el worker Node de .NET.
- Resultados del mensaje del commit, con MySQL 8.0: `npm run check` 1538, `npm run test:e2e` 58, `dotnet test` 2236 y e2e contra .NET 64.

### Revisión de tickets pensada para el móvil, 22 de noviembre de 2026 (fase 4, `cbedcd6`, no es un ID de la migración)

- Base: la rama tickets-lidl-plus tras la fase 3. Solo cambia la web (la revisión: resumen, tarjetas, productos plegados y «Guardar ticket» siempre a la vista); ni .NET ni el corpus.
- Resultados del mensaje del commit, con MySQL 8.4: `npm run check` 1586 y `e2e/tickets.spec.ts` en escritorio y móvil, 14. Las suites enteras y las de .NET se pasaron con la fusión.

### Fusión de la lectura de tickets en main, 23 de noviembre de 2026 (`c622210`, no es un ID de la migración)

- Une las fases 0-4 (de `5695bfb` a `cbedcd6`) con `48093ae`. La segunda relectura con margen ajustado se queda solo cuando no hay banda de importes clara, que es donde se midió; sobre la banda arreglaba «INSTANT NOODLES» de la imagen sintética de los cupones y estropeaba otras dos.
- Corpus: 535 casos (532 de la rama y 3 de main; cambian los 2 de los cupones por la regla de la PROMO sangrada).
- El test del OCR real de los cupones pasó a pedir que lo distinto quede marcado; FIX-02 lo ajustó a «y como mucho una línea» (más abajo).
- Resultados del mensaje del commit, con MySQL 8.4: `npm run check` 1594, `npm run test:e2e` 62 y 4 omitidas, `dotnet test` 2266 y e2e contra .NET 68 y 4 omitidas.

### FIX-01 de terminar-el-proyecto: reglas y corpus de tickets, 23 de noviembre de 2026 (no es un ID de la migración)

- Base: `d0b383a` (main `c622210` más `docs/terminar-el-proyecto.md`), en la rama local terminar-proyecto, sin commit. El uso diario sigue en Express; .NET tiene que dar lo mismo. La entrada completa, con el resto de FIX-01, está en el registro de [terminar-el-proyecto.md](../terminar-el-proyecto.md).
- Regla portada a C#: qué cifra sin coma se descarta por estar en el nombre (`shared/tickets/ticketParse.ts` → `backend/src/CuentasClaras.Domain/Tickets/TicketParser.cs`, WorkLine.NameLoose).
  - Solo se descarta si es igual a un número del nombre o empieza por uno de dos cifras o más.
  - La descartada impide votar, y si dice otra cifra que el importe elegido, añade «Las lecturas del importe no coinciden».
- Corpus: de 535 a 538 casos (`lidl-plus-sin-coma-nombre-corto`, `-voto` e `-igual`). No cambia ninguno de los anteriores: el diff solo añade. Generado con Node 24.13.0. `tests/migrationTicketRules.test.ts` y TicketRulesCorpusTests esperan 538.
- El OCR de .NET usa el worker Node (`server/modules/tickets/adapters/tesseract/ocrWorker.ts`), así que también le llegan los límites nuevos del PNG de la tercera lectura.
- Comandos, en Windows con el MySQL 8.4.13 de ensayo:
  - `npm run build:dotnet`: 0 avisos y 0 errores;
  - `npm run test:dotnet`: 2272/2272;
  - `npm run test:e2e:dotnet`: 74 pasan y 4 se omiten;
  - `npm run check`: Vitest 1606/1606;
  - `npm run test:e2e`: 68 pasan y 4 se omiten.

### FIX-02 de terminar-el-proyecto: reglas y corpus de tickets, 23 de noviembre de 2026 (no es un ID de la migración)

- Base: `10f3d8f` (FIX-01), en la rama local terminar-proyecto. El uso diario sigue en Express; .NET tiene que dar lo mismo. La entrada completa está en el registro de [terminar-el-proyecto.md](../terminar-el-proyecto.md).
- Reglas portadas a C# (`backend/src/CuentasClaras.Domain/Tickets/TicketParser.cs`):
  - la votación exige la lectura del texto;
  - MarkSuspects: con el desglose de IVA (o el total) sin cuadrar, se marcan las líneas que una sola cifra confundida explicaría;
  - looksLikeProduct solo en Lidl;
  - «5 KG PATATAS» (ProductNamedByWeight y UnitWord);
  - la fecha no es la barra de estado (AppChrome);
  - la cabecera de Lidl acaba también en «… S.A.U.».
- Corpus: de 538 a 545 casos (`fix02-*`). Cambian también, como se esperaba, `seguridad-no-cuadra`, `analisis-no-cambia-cifra`, `casos-12-diferencia` (la línea que una cifra confundida explicaría, marcada) y `lidl-plus-votacion` (sin la lectura del texto no se vota). Generado con Node 24.13.0. `tests/migrationTicketRules.test.ts` y TicketRulesCorpusTests esperan 545.
- El OCR de .NET usa el worker Node: también le llega `decodePngRows` (solo las filas de la banda, fuera del hilo principal).
- Comandos, en Windows con el MySQL 8.4.13 de ensayo: `npm run build:dotnet` (0 avisos y 0 errores), `npm run test:dotnet` (2286/2286), `npm run test:e2e:dotnet` (80 pasan y 4 se omiten), `npm run check` (Vitest 1629/1629) y `npm run test:e2e` (74 pasan y 4 se omiten).

### CUT-PREP — 24 de noviembre de 2026 (CUT-01 en curso)

- No cierra CUT-01: prepara el corte sin cambiar el uso diario (tarea CUT-PREP de `docs/terminar-el-proyecto.md`, con su registro completo). Base `d0b383a` (main en `c622210` más el plan), rama ccr-e3b98276-3xjznb, en la nube. Las tareas FIX-01 a DOC-02 del plan están en una rama local de la persona, sin subir.
- **Scripts de .NET aparte**: `dev:dotnet` (la API en 3201 y Vite), `dev:dotnet:api` y `dev:dotnet:web` (el móvil), `server:dotnet` (Release), `build:web:dotnet` y `preview:dotnet`. `npm run dev`, `server` y `preview` siguen con Express, y `tests/architecture.test.ts` lo vigila.
- **El .env**: el host lo lee solo con `--env-file-if-exists=.env`, como Node en los scripts de Express (`backend/src/CuentasClaras.Api/Composition/EnvFile.cs`), con el formato de Node y el entorno por delante. Las pruebas y las e2e no lo piden. Con `dotnet run`, el host arranca en la raíz del repositorio (RunWorkingDirectory); antes arrancaba en la carpeta del proyecto.
- **La web**: `vite.config.ts` elige el backend con `--mode dotnet` (proxy a 3201 y `__CUENTAS_BACKEND__`).
- **Restos**:
  - tsx pasa a dependencies;
  - la codificación de `playwright.dotnet.config.ts`;
  - MissingRoutes fuera de `backend/tests/CuentasClaras.Tests/HttpContractTests.cs` (el inventario exige ahora que cada paso de los corpus de módulos vaya a una ruta que existe);
  - Cache-Control, al día en la API y en ARCHITECTURE.md;
  - la carpeta bin de la API, sin comillas invertidas.
- **Contratos**: ninguno cambia. Express no cambia de comportamiento.
- **Comandos**, en Linux con .NET SDK 10.0.115, Node 22.23.5 y MySQL 8.0.46:
  - restore con `--locked-mode`: correcto;
  - `npm run check`: Vitest 1596/1596 en 57 archivos;
  - `npm run build` y `npm run build:dotnet`: correctos;
  - `npm run test:dotnet`: 2274/2274;
  - `npm run test:e2e`: 62 y 4 omitidas;
  - `npm run test:e2e:dotnet`: 68 y 4 omitidas.
- **A mano**: `dev:dotnet` y los tres de producción, con un `.env` de ensayo sobre `cuentas_test_cutprep`.
- **Sin comprobar**: Windows, Node 24 y el MySQL 8.0.36 de la persona.
- **Siguiente**: DATA-02 y los pasos de la persona (PERSONA en el plan); después, CUT-FINAL con su confirmación.

### Fusión de terminar-proyecto con main, 25 de noviembre de 2026 (no es un ID de la migración)

- Une la rama local terminar-proyecto (FIX-01, FIX-02, DOC-02 y UX-00 a UX-07, con su registro en [terminar-el-proyecto.md](../terminar-el-proyecto.md)) con main (`efa7b4b`, la CUT-PREP de la entrada anterior).
- Se hicieron dos CUT-PREP en paralelo: la de main, en la nube, y otra en terminar-proyecto (`7ba9c1b`), con el `.env` buscado por el host y `CUENTAS_ENV_FILE=ninguno` en las pruebas. Se queda la de main y se retira la otra (su DotEnv, sus 4 tests y `start:dotnet`):
  - es más prudente: el host solo lee `.env` si el script lo pide, así que ninguna prueba puede abrir la base de la instalación;
  - tiene más pruebas (EnvFileTests y dos de arquitectura);
  - ya estaba en GitHub.
- Del lado de terminar-proyecto se conserva `worker: { format: 'es' }` en `vite.config.ts` (FIX-02, el Web Worker de las capturas), que la de main no tenía.
- El apartado del README pasa a llamarse «Probar el backend .NET», que es como lo cita `docs/pruebas.md`, y suma los pasos del corte para la persona.
- Lo que la CUT-PREP de main dejó sin comprobar (Windows y Node 24): comprobados en Windows con Node 24.13.0. `npm run dev:dotnet` arranca con concurrently y cmd.exe; la API se abre en la raíz del repositorio («Content root path: D:\PROYECTOS\cuentas_claras», por RunWorkingDirectory) y `--env-file-if-exists` encuentra un archivo de ensayo con ruta relativa, del que toma el código y la base `cuentas_test_cutprep` (creada y borrada para ello). Por el proxy de Vite responden la salud, el acceso y GET /api/summary/month, y `__CUENTAS_BACKEND__` vale `dotnet`. Los 26 valores del archivo de `EnvFileTests.Lee_el_formato_de_Node` coinciden con `node --env-file` de Node 24.13.0. Sigue sin comprobar su MySQL 8.0.36.
- Comandos, en Windows con el MySQL 8.4.13 de ensayo: `npm run build:dotnet` (0 avisos y 0 errores), `npm run test:dotnet` (2294/2294: los 2286 de FIX-02 y los 8 de EnvFileTests), `npm run check` (Vitest 1640/1640: los 1638 de UX-07 y los 2 de arquitectura de la CUT-PREP de main), `npm run test:e2e` (90 pasan y 6 se omiten) y `npm run test:e2e:dotnet` (96 pasan y 6 se omiten).

### DATA-02 — cerrada sin importación, 25 de noviembre de 2026

- Base: main `a1e32ae`. Solo documentación: no cambia código, contratos ni migraciones.
- Decisión de la persona: la copia SQLite de la versión de antes solo tenía pruebas, así que no hay datos reales que pasar a MySQL. DATA-02 se cierra sin importación, como prevé PERSONA en [terminar-el-proyecto.md](../terminar-el-proyecto.md) («Si no hay copia SQLite que importar…»).
- Qué significa: la instalación empieza vacía en MySQL. La primera vez, `npm run dev` crea las tablas y las categorías iniciales en `cuentas_claras` (README, «Preparar MySQL»). El importador (`tools/importer/`) y el apartado «Pasar los datos de SQLite a MySQL» del README se quedan para quien venga de la versión con SQLite.
- Lo que no se ha hecho: el agente no ha leído `server/data/`, la base `cuentas_claras` ni `.env`, y el importador no se ha ejecutado con datos reales. No se afirma ninguna equivalencia de filas reales: no hay filas que comparar.
- Comandos: `npm run check` (Vitest 1640/1640 en 59 archivos, con `tests/docs.test.ts`), en Windows con el MySQL 8.4.13 de ensayo.
- Sigue pendiente (PERSONA): una copia de `cuentas_claras` comprobada con `CHECKSUM TABLE`, probar .NET con `dev:dotnet` sobre ella, repetir las suites en su MySQL 8.0.36 y las capturas reales. CUT-01 sigue `en_curso`.
- Siguiente: el resto de PERSONA; después, CUT-FINAL con su confirmación.

### Plantilla para la siguiente tarea

Al trabajar en un ID, añade una entrada con fecha, commit base, alcance, archivos modificados, decisiones, contratos afectados y comandos ejecutados con resultados. Si algo no se ejecutó, indica el motivo y el efecto sobre la aceptación. Anota dependencias temporales, datos reales pendientes y el siguiente ID elegible. No rellenes esta plantilla con resultados hipotéticos.
