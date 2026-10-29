# Plan: Cuentas claras con arquitectura hexagonal y guía para agentes

## Contexto

Se reestructura Cuentas claras en tres partes:

- un backend hexagonal y modular (auth, finance, pantry, tickets y health);
- el dominio puro en `shared/`;
- una web organizada por funcionalidades, con documentación para agentes y dos tests que la vigilan.

Es una **reestructuración, no una reescritura**: la API, la base de datos, los textos y el aspecto no cambian. Todos los tests siguen pasando y no hay menos que al empezar. Se trabaja en la rama `refactor/arquitectura-hexagonal`, con commits pequeños en español y `npm run check` en verde tras cada uno. Al final se abre un PR hacia `main`, que no se fusiona. Este plan se copia a `plan-reestructuracion.md`, en la raíz, y ahí se va marcando lo hecho.

**Ya decidido contigo**
- better-sqlite3 12.11.1, que tienes sin confirmar: va en el **primer commit de la rama**, aparte.
- Migración de los datos del navegador: **se queda en este PR**, movida a `src/features/finance/browserMigration/`. Retirarla irá en un **PR aparte**. Queda en `docs/decisiones.md` como pendiente, con lo que se ganaría: unas 700 líneas menos, `idb` y `fake-indexeddb` fuera y un `FinanceProvider` sin `beforeOpen`; a cambio, bajan 19 tests.
- Migración 001: **solo cambia la línea del import** de `DEFAULT_CATEGORIES`, que pasa a `../../shared/finance/categories.ts`. El SQL y los datos quedan idénticos.

## 0. Línea base (medida el 29/10/2026, antes de mover nada)

Rama `refactor/arquitectura-hexagonal`, con el commit «Fija better-sqlite3 en 12.11.1»; `npm install` ya estaba al día y no tocó el lockfile.

| Comprobación | Resultado |
| --- | --- |
| `npm run typecheck` (`tsc -b`) | 0 errores |
| `npm run lint` (oxlint 1.90) | 0 avisos, 0 errores |
| `npm test` (Vitest 5) | **29 archivos, 359 tests**, todos en verde |
| `npm run test:e2e` | **46 de 46** (23 pruebas × 2 proyectos), en verde |

Tests por archivo en la línea base, para comparar al final: app 10 · auth 17 · database 10 · pantry 12 · repository 20 · tickets 14 · ticketReviewState 7 · annual 3 · backup 8 · csv 4 · dates 13 · filters 4 · money 29 · pantry (dominio) 19 · pantryReview 4 · pantryRhythm 16 · period 4 · recurring 14 · summary 12 · ticketCases 44 · ticketEvidence 21 · ticketFixtures 10 · ticketMatch 4 · ticketParse 19 · ticketSafety 9 · validation 8 · browserDataMigration 5 · IndexedDbFinanceRepository 14 · ticketImages 5.

**e2e y Chromium**: `npx playwright install chromium` falla porque la descarga de `cdn.playwright.dev` caduca a los 30 s. Las e2e se ejecutan con el Chrome instalado en el equipo: `CUENTAS_E2E_CHANNEL=chrome npm run test:e2e`, una opción que ya contemplaba `playwright.config.ts`. No he podido comprobarlas con el Chromium de Playwright.

## Progreso

- [x] 0. Línea base y plan
- [x] 1. Fixtures a `fixtures/tickets/`
- [x] 2. Dominio a `shared/`; `#shared/*` funciona en tsx, Vite, Vitest y `tsc -b`, así que se usa
- [x] 3. `server/common/` (más 6 tests: ruta por defecto, migraciones congeladas y transacciones)
- [x] 4. Módulos: health y auth → pantry → finance → huella golden → tickets → test de arquitectura (366 + 2 tests)
- [ ] 5. Web: api/ui → auth → finance → tickets → pantry → DespensaPage
- [ ] 6. Documentación, README y test de documentación
- [ ] 7. Comprobación final, decisiones a `docs/decisiones.md`, borrar este plan, subir la rama y abrir el PR

## 1. Estructura final

```
.claude/settings.json · .claude/rules/{tests,routers,sqlite,casos-de-uso,estilos}.md
AGENTS.md · CLAUDE.md · README.md (para personas, enlaza a docs/)
docs/        convenciones · arquitectura · api · base-de-datos · pruebas · frontend · glosario · decisiones
fixtures/tickets/   hoy server/fixtures/ (mismos nombres, ocr-real/ incluido)
tests/       architecture.test.ts · docs.test.ts
shared/      AGENTS.md · common/ · finance/ · pantry/ · tickets/ · testing/factories.ts
server/
├── index.ts · app.ts · app.test.ts · AGENTS.md
├── common/  errors.ts · ports.ts · system.ts · imageInfo.ts
│            http/{response,request,testingRoutes}.ts · sqlite/{openDatabase,SqliteUnitOfWork}.ts · testing/{tempDb,testApi}.ts
├── migrations/  001…005 (solo cambia una línea de 001) · index.ts · migrations.test.ts · AGENTS.md
└── modules/{auth,finance,pantry,tickets,health}/  AGENTS.md · CLAUDE.md · index.ts · domain? · application/ · adapters/ · <modulo>.test.ts
src/
├── main.tsx · Root.tsx · App.tsx · GuestApp.tsx · styles.css · test/setup.ts · AGENTS.md
├── api/     client.ts (apiRequest, ApiError, ServerUnavailableError, onUnauthorized, segment) · storageErrors.ts
├── ui/      Dialog, Section, forms, Icon, Amount, EmptyState, ToastProvider, toastContext, BudgetMeter, helpers, useHashRoute
└── features/{auth,finance,pantry,tickets}/  AGENTS.md · CLAUDE.md · index.ts · …
e2e/         AGENTS.md · CLAUDE.md · specs (solo cambian las rutas de las fixtures)
```
Hay un `CLAUDE.md` con `@AGENTS.md` junto a **cada** `AGENTS.md`: 15 pares (raíz, 5 zonas, 5 módulos y 4 features).

## 2. Servidor

**Reglas de dependencia**: la tabla 3.2 se aplica como lista de lo permitido, más estas concreciones:
- el `index.ts` de un módulo puede importar todo su módulo, `common/`, `shared/` y librerías;
- `server/index.ts` y `app.ts` solo importan los `index.ts` de los módulos y `common/`;
- `common/` (salvo `testing/`) no importa módulos;
- `migrations/` solo importa librerías, `shared/` (la 001 siembra las categorías iniciales) y a sí misma;
- un adaptador no importa otro adaptador.

**Puertos comunes** (`common/ports.ts`; las implementaciones reales están en `common/system.ts`):
- `Clock { nowMs(): number; nowISO(): string; today(): ISODate }`. Une el reloj en ms de auth, el `now` ISO de despensa, finanzas y tickets, y el `todayISO()` de respaldo.
- `IdGenerator { newId(): string }`. Por defecto, `newId` de `shared/common/ids.ts` (`crypto.randomUUID` global): da el mismo UUID v4 que `node:crypto`.
- `UnitOfWork { run<T>(work: () => T, options?: { immediate?: boolean }): T }`. Es síncrono: better-sqlite3 lanza un error si `work` devuelve una promesa. Si se anida, crea un savepoint. `SqliteUnitOfWork` hace `db.transaction(work)` o `.immediate()`. Hay una sola instancia, creada en `app.ts` y compartida por todos los módulos.

| Módulo | Casos de uso (un archivo PascalCase cada uno) | Lecturas (`queries.ts`) | Puertos propios → adaptador real | API pública (`index.ts`) |
| --- | --- | --- | --- | --- |
| auth | Login, Logout, CheckSession | — | SessionStore y AttemptStore → memoria; CodeVerifier → sha256 + timingSafeEqual; TokenGenerator → randomBytes. `domain/`: `accessCode.ts` (checkAccessCode, longitudes) y `accessPolicy.ts` (Role, 12 h, 5 fallos, 15 min, ventana) | `createAuthModule({ accessCode, clock })` → `{ router, requireAdmin }`. Lanza si el código no vale. Exporta checkAccessCode y las constantes que usan los tests |
| finance | SaveMovement, DeleteMovement, SaveCategory, DeleteCategory, SaveRecurring, DeleteRecurring, GenerateOccurrences, RestoreBackup, ImportBrowserData, SetMeta (ayudante: `requireCategory.ts`) | loadAll (dentro de `run`: una sola foto de los datos), getMeta | FinanceStore (síncrono) → `SqliteFinanceStore`. Las listas `IN (…)` van siempre con parámetros | `createFinanceModule(deps)` → `{ router, useCases, reset }` |
| pantry | CreatePerson, RenamePerson, DeletePerson, CreateItem, UpdateItem, AdjustItem, DeleteItem, AddEvent, DeleteEvent, SetBudget, SetReviewDate, MarkPurchased, UndoPurchase, ApplyTicketPurchase | listPeople, listItems, getItem, getSettings, eventsSince | PantryRepository → `SqlitePantryRepository` | `createPantryModule(deps)` → `{ router, api: { getItem, createItem, applyTicketPurchase, listItems, eventsSince }, reset }` |
| tickets | ReadTicket (async: OCR), SaveTicket, SetLineItem, DeleteTicket (ayudante: `duplicates.ts`). Todas las escrituras usan `{ immediate: true }`, como hoy | listTickets, getTicket, activity | TicketRepository → SQLite; TicketReader → Tesseract (imágenes como `Uint8Array`); PantryGateway → `pantry.api`; Hasher → sha256 de `node:crypto`. `domain/`: `ticketIdentity.ts` (aliasStoreOf, texto canónico de la huella), `ticketPurchase.ts` (priceFromLines, quantityFromLines) y `purchaseHistory.ts` (agrupa las líneas en compras) | `createTicketsModule({ ...deps, pantry, reader })` → `{ router, reset }`. Exporta `createTesseractReader` y los tipos TicketReader y PantryGateway |
| health | — | — | — (el `SELECT 1` preparado en `index.ts` se pasa al router) | `createHealthModule({ database })` → `{ router }` |

`deps = { db, clock, ids, unitOfWork }`. Los routers (`adapters/http/`) leen y validan la petición, llaman a un caso de uso y responden con `sendData`; los de finanzas montan data → movements → categories → recurring → meta en un router, en el mismo orden. Las restricciones de SQLite se traducen a `AppError('CONFLICT', …)` en el adaptador, con los mismos mensajes.

**`createApp({ database, accessCode, testMode?, clock?, ids?, ticketReader? })`**:
1. Crea auth primero, porque lanza si el código no vale.
2. Después, `SqliteUnitOfWork` y los módulos; `tickets` recibe `pantry.api`.
3. Monta el resto igual que hoy: `x-powered-by` desactivado, `trust proxy` solo para `loopback`, JSON de 30 MB para `/api/despensa/tickets/leer` y de 20 MB para lo demás, `no-store`, health → auth → pantry → tickets → `requireAdmin` → finance → reset de pruebas (solo con `CUENTAS_TEST=1`, que llama a `finance.reset`, `tickets.reset` y `pantry.reset` en un solo `run`) → `notFoundHandler` → `errorHandler`.

`index.ts` sigue igual: comprueba el código antes de abrir la base de datos, y al cerrar se cierra primero el lector OCR y después la base de datos.

**Puntos delicados**
- `DEFAULT_DB_PATH` depende de `import.meta.url`: en `common/sqlite/` pasa a `'../../data/cuentas.db'`. Un test nuevo comprueba que sigue siendo `server/data/cuentas.db`.
- `ReadTicket`: el adaptador HTTP (`readTicketRequest.ts`) decodifica y valida el texto, las imágenes y las franjas, en el mismo orden y con los mismos mensajes. El caso de uso hace el resto: huella de origen, OCR (si falla, `console.error` y VALIDATION), `parseTicket`, «ningún producto», sugerencias, duplicados e `importId`. `hoy` llega como `ISODate | null` y el caso de uso usa `clock.today()` de respaldo.
- `SaveTicket` conserva el orden de comprobaciones de `saveTicket` y sus mensajes, y el `review_status` de cada línea lo decide el caso de uso. Las huellas deben salir **idénticas**, porque ya hay huellas guardadas en tu base de datos. Para comprobarlo, antes de tocar tickets añado un test «golden» con el código actual.
- `reset` de pruebas: hoy `pantry.reset` vacía también las tablas de tickets. Al separar los módulos, tickets vacía `pantry_tickets` y `pantry_aliases`, y pantry el resto, en el mismo orden por las claves foráneas.

## 3. `shared/` (sale de `src/domain/`)

- `common/`: money, dates, ids, `types.ts` (ISODate) y `validation.ts`, que recibe `ValidationResult<T>` de `backup.ts` y `FieldErrors<T>` de `validation.ts`. El `ValidationResult<T, D>` de formularios de finanzas se queda en `finance/validation.ts`.
- `finance/`: categories, recurring, summary, annual, period, filters, suggestions, backup, csv, validation, `meta.ts` (`META_KEYS` y `MetaKey`, hoy en `src/storage/FinanceRepository.ts`) y `types.ts` (Movement, Category, RecurringRule, FinanceData y SaveRecurringOptions).
- `pantry/`: pantry, pantryRhythm, pantryReview, pantryValidation y `types.ts` (Pantry*).
- `tickets/`: ticketParse, ticketMatch, ticketText, ticketValidation, ticketEvidence, ticketArithmetic y `types.ts` (Ocr*, Ticket*, PantryTicket*).
- Dependencias, comprobadas: `tickets → pantry → common` y `finance → common`. Ningún archivo importa paquetes ni `node:*`.
- `tsconfig.shared.json`, nuevo, con la configuración de la web (bundler, `resolveJsonModule`, `lib: ES2023 + DOM`, que `ids.ts` necesita por la Web Crypto, y sin tipos de Node). Se añade a las referencias de `tsconfig.json`. Por su parte, `tsconfig.node.json` pasa a incluir `tests/`, y `vite.config.ts` añade a `test.include` `shared/**/*.test.ts` y `tests/**/*.test.ts`.
- Imports `#shared/*` (el campo `imports` de `package.json`, sin dependencias): pruebo `tsx`, `vite build`, Vitest y `tsc -b`. Si los cuatro funcionan, se usan desde `server/` y `src/`; si alguno falla, se usan rutas relativas. Dentro de `shared/` siempre van relativas.

## 4. Web

- `api/client.ts` (hoy `services/apiClient.ts`) y `api/storageErrors.ts` (hoy `state/storageErrors.ts`).
- `ui/`: los componentes genéricos y `toastContext`. También `BudgetMeter`, porque lo usan finanzas y despensa; importa un tipo de `shared/finance/summary.ts`.
- `features/auth/`: AuthProvider, authContext, LoginDialog, SessionPanel y `api.ts`, nuevo, con `me`, `login` y `logout`. Hoy AuthProvider llama a `apiRequest` directamente; tras el cambio, solo `api/` y los clientes de cada feature hacen peticiones.
- `features/finance/`: `pages/` (las 6 páginas), `components/` (15 componentes), FinanceProvider, financeContext, useForecastMovements, tabSync, FinanceRepository (el contrato async del navegador) y ApiFinanceRepository. Además, `browserMigration/`, con IndexedDbFinanceRepository, browserDataMigration y sus tests.
- `features/tickets/`: TicketScanDialog, TicketReview, TicketLineCheck, ticketReviewState, TicketDetailDialog, ticketImages y `ticketActions.ts`, que define `TicketActions` (readTicket, saveTicket, getTicket, setTicketLine y deleteTicket).
- `features/pantry/`: DespensaPage, `components/` (los diálogos de la despensa, owner, ownerFilter, rhythmText, RhythmStatus y WeeklyReview), `usePantry.ts` y `api.ts` (hoy `pantryApi`). `PantryActions extends TicketActions`: las acciones de tickets **se quedan en usePantry**, porque guardar un ticket recarga productos, compras y tickets. La dependencia es solo pantry → tickets, a través de `tickets/index.ts`, y queda documentada.
- `DespensaPage` (712 líneas) se divide en `components/PantryRow.tsx` (StockStatus, PantryRow y priceText), `ReviewBlock.tsx`, `RecentTickets.tsx`, `SummaryBlock.tsx` y `BudgetBlock.tsx`; la página queda en unas 360 líneas. Ningún texto cambia.
- `index.ts` de cada feature: auth exporta AuthProvider, useAuth, LoginDialog y SessionPanel. finance exporta FinanceProvider, useFinance, ApiFinanceRepository, la migración del navegador, las páginas, MovementDialog y PaymentDialog. pantry exporta DespensaPage, y tickets exporta los dos diálogos y `TicketActions`.
- Opcional, al final: dividir `styles.css` en `src/styles/*.css`, importados en el mismo orden. Para comprobarlo, la concatenación de los archivos nuevos debe dar exactamente el `styles.css` original.

## 5. Tabla completa: archivo actual → archivo nuevo

| Hoy | Pasa a |
| --- | --- |
| `server/index.ts`, `server/app.ts`, `server/app.test.ts` | se quedan (imports nuevos; `createApp` deja de recibir `repository`) |
| `server/errors.ts` | `server/common/errors.ts` |
| `server/http.ts` | `server/common/http/response.ts` (envelope, sendData, errorHandler, notFoundHandler) y `request.ts` (isRecord, readBody, readDate, readOptionalDate, valid, sameId) |
| `server/database.ts` | `server/common/sqlite/openDatabase.ts` (más `SqliteUnitOfWork.ts`, nuevo) |
| `server/database.test.ts` | `server/common/sqlite/openDatabase.test.ts` (crear, WAL, reabrir, versión más nueva) y `server/migrations/migrations.test.ts` (restricciones y v1→última, v3, v4) |
| `server/migrations/*` | se quedan; en 001 solo cambia la línea del import |
| `server/auth.ts` | `modules/auth/`: `domain/{accessCode,accessPolicy}.ts`, `application/{ports,Login,Logout,CheckSession}.ts`, `adapters/http/routes.ts` (rutas, cookie, `readSessionToken`, `clientIp`, `requireAdmin`), `adapters/memory/{InMemorySessionStore,InMemoryAttemptStore}.ts`, `adapters/crypto/{Sha256CodeVerifier,RandomTokenGenerator}.ts` e `index.ts` |
| `server/auth.test.ts` | `modules/auth/auth.test.ts` |
| `server/routes/health.ts` | `modules/health/{routes,index}.ts` |
| `server/repository.ts` | `modules/finance/adapters/sqlite/SqliteFinanceStore.ts` (SQL y filas) y `application/` (ports, queries, requireCategory y los 10 casos de uso) |
| `server/routes/{data,movements,categories,recurring,meta}.ts` | `modules/finance/adapters/http/` (mismos nombres) y `routes.ts`, que los monta en orden |
| `server/repository.test.ts` | `modules/finance/finance.test.ts`: mismas aserciones; un ayudante `openFinance()` envuelve los casos de uso con los nombres de antes (`await repository.saveMovement(…)`) |
| `server/pantryRepository.ts` | `modules/pantry/adapters/sqlite/SqlitePantryRepository.ts` y `application/` (ports, queries y 14 casos de uso) |
| `server/routes/pantry.ts` · `server/pantry.test.ts` | `modules/pantry/adapters/http/routes.ts` · `modules/pantry/pantry.test.ts` |
| `server/ticketRepository.ts` | `modules/tickets/adapters/sqlite/SqliteTicketRepository.ts`, `domain/`, `application/{SaveTicket,SetLineItem,DeleteTicket,duplicates,queries,ports}.ts` |
| `server/routes/tickets.ts` | `modules/tickets/adapters/http/{routes,readTicketRequest}.ts` y `application/ReadTicket.ts` |
| `server/ocr.ts` | `modules/tickets/adapters/tesseract/TesseractTicketReader.ts` (el puerto pasa a `application/ports.ts`) |
| (nuevo) | `modules/tickets/adapters/crypto/Sha256Hasher.ts` |
| `server/imageInfo.ts` | `server/common/imageInfo.ts` (ver §10) |
| `server/tickets.test.ts` | `modules/tickets/tickets.test.ts` |
| `server/routes/testing.ts` | `server/common/http/testingRoutes.ts` (recibe la función de reset; `app.ts` le pasa la de los módulos) |
| `server/test-helpers.ts` · `server/api-test-helpers.ts` | `server/common/testing/tempDb.ts` · `testApi.ts` (`startApi({ clock?: Partial<Clock>, ids? … })`) |
| `server/fixtures/**` | `fixtures/tickets/**` |
| `src/domain/{money,dates,ids}.ts` (+ tests de money y dates) | `shared/common/` |
| `src/domain/types.ts` | se reparte en `shared/{common,finance,pantry,tickets}/types.ts` |
| `src/domain/{categories,recurring,summary,annual,period,filters,suggestions,backup,csv,validation}.ts` (+ sus 8 tests) | `shared/finance/` |
| `src/domain/{pantry,pantryRhythm,pantryReview,pantryValidation}.ts` (+ 3 tests) | `shared/pantry/` |
| `src/domain/{ticketParse,ticketMatch,ticketText,ticketValidation,ticketEvidence,ticketArithmetic}.ts` (+ 6 tests) | `shared/tickets/`. Los 2 `it` que prueban `imageQuality` e `imageLayout` pasan a `src/features/tickets/ticketImages.test.ts` |
| `src/test/factories.ts` · `src/test/setup.ts` | `shared/testing/factories.ts` · se queda |
| `src/services/apiClient.ts` · `src/state/storageErrors.ts` | `src/api/client.ts` · `src/api/storageErrors.ts` |
| `src/components/{Dialog,Section,forms,Icon,Amount,EmptyState,ToastProvider,BudgetMeter}.tsx`, `src/state/toastContext.ts` | `src/ui/` |
| `src/ui/{helpers,useHashRoute}.ts` | se quedan |
| `src/state/{AuthProvider.tsx,authContext.ts}`, `src/components/{LoginDialog,SessionPanel}.tsx` | `src/features/auth/` (más `api.ts`) |
| `src/pages/{Summary,Year,Movements,Recurring,Budgets,Settings}Page.tsx` | `src/features/finance/pages/` |
| `src/components/{BackupPanel,BudgetSummary,CategoryChart,CategoryEditor,CategoryMonthGrid,CategoryTable,DueList,Ledger,MonthlyTrendChart,MovementDialog,MovementList,PaymentDialog,PeriodPicker,PeriodSwitch,RecurringDialog}.tsx` | `src/features/finance/components/` |
| `src/state/{FinanceProvider.tsx,financeContext.ts,useForecastMovements.ts,tabSync.ts}`, `src/storage/FinanceRepository.ts`, `src/services/ApiFinanceRepository.ts` | `src/features/finance/` |
| `src/storage/IndexedDbFinanceRepository{,.test}.ts`, `src/services/browserDataMigration{,.test}.ts` | `src/features/finance/browserMigration/` |
| `src/pages/DespensaPage.tsx` | `src/features/pantry/DespensaPage.tsx` y 5 piezas en `components/` |
| `src/components/pantry/{PantryBudgetDialog,PantryItemDialog,PeopleDialog,RhythmStatus,ShoppingListDialog,WeeklyReview,owner}.tsx`, `{ownerFilter,rhythmText}.ts` | `src/features/pantry/components/` |
| `src/state/usePantry.ts` · `src/services/pantryApi.ts` | `src/features/pantry/usePantry.ts` · `api.ts` |
| `src/components/pantry/{TicketScanDialog,TicketReview,TicketLineCheck,TicketDetailDialog}.tsx`, `ticketReviewState{,.test}.ts`, `src/ui/ticketImages{,.test}.ts` | `src/features/tickets/` |
| `src/{main,Root,App,GuestApp}.tsx`, `src/styles.css`, `index.html`, `public/`, `ejemplo/` | se quedan (imports nuevos) |
| `e2e/*.spec.ts`, `playwright.config.ts` | se quedan; `tickets.spec.ts` lee `fixtures/tickets/…` |
| `tsconfig*.json`, `vite.config.ts`, `package.json` | `tsconfig.shared.json` nuevo; include y referencias, `test.include` y, si funciona, `imports` (`#shared/*`). Scripts sin cambios |

## 6. Documentación

- **`AGENTS.md` de la raíz**, con las secciones 6.2 en orden: qué es, antes de tocar nada, mapa, «Si vas a tocar… lee…» (cada módulo y cada feature, `shared/**`, `server/migrations/**`, `e2e/**`, `*.css`, `docs/**`), reglas que no se rompen (con enlaces), comandos (incluido un solo test: `npx vitest run <ruta>`, `npx playwright test e2e/x.spec.ts --project=escritorio`), «Terminado significa» y mantener la documentación.
- **Zonas** (`server/`, `server/migrations/`, `shared/`, `src/`, `e2e/`). **Módulos y features** con las plantillas 6.4 y 6.5: cada módulo documenta sus rutas (cuerpo → respuesta, errores); cada feature, sus textos y `data-testid`.
- **Comentario de cabecera completo**, donde falte, en los archivos nuevos y en TicketReview, ticketReviewState, WeeklyReview, ShoppingListDialog y TicketScanDialog.
- **`docs/`**, como pide la sección 6.3.
  - Las partes técnicas del README (Comprobaciones, Estructura, Base de datos, API y Decisiones) pasan a `docs/` sin perder nada; el README las enlaza y conserva lo que es para personas (qué hace, instalación, código de acceso, Despensa y límites).
  - `docs/base-de-datos.md` incluye la migración **005**, que hoy falta en el README.
  - `docs/api.md` incluye `{ franjas }` en `tickets/leer`.
  - `docs/pruebas.md` explica de dónde salen los datos de cada fixture (§10).
- **`.claude/rules/`**: cinco recordatorios de 5 a 10 líneas, con `paths:` y enlaces a `docs/`:
  - `tests.md` (`**/*.test.ts`);
  - `routers.md` (`server/modules/*/adapters/http/**`);
  - `sqlite.md` (`…/adapters/sqlite/**`);
  - `casos-de-uso.md` (`server/modules/*/application/**`);
  - `estilos.md` (`src/**/*.css`).
- Los `AGENTS.md` de los módulos se escriben en el paso de cada módulo; los de las features, en el de cada feature; el resto, al final.

## 7. Tests nuevos (solo suben el total)

- **`tests/architecture.test.ts`**:
  - lee los imports (`from`, `import()` e `import '…'`) de cada `.ts` y `.tsx` de `server/`, `shared/` y `src/`;
  - resuelve las rutas relativas y `#shared/`, y aplica §2 y la tabla 3.2;
  - comprueba que `src/` no importa `server/`, que una feature no entra en otra salvo por su `index.ts`, que `ui/` y `api/` no importan features, y que solo `api/` y los clientes usan `apiRequest` o `fetch`;
  - además, no puede haber `Buffer` ni `process.` (quitando antes los comentarios) en `shared/`, `domain/` ni `application/`;
  - quedan fuera los tests, `common/testing/` y `shared/testing/`;
  - el mensaje dice el archivo, el import y la regla;
  - una comprobación de cordura (que hay más de N archivos y que cada módulo tiene `index.ts`) evita que pase sin haber comprobado nada.
- **`tests/docs.test.ts`**:
  - cada zona, módulo y feature tiene su `AGENTS.md` y, al lado, un `CLAUDE.md` que es exactamente `@AGENTS.md`;
  - están todas las secciones de cada plantilla;
  - existe cada ruta citada entre comillas invertidas en los `AGENTS.md`, `docs/` y `.claude/rules/`. Se busca relativa al `.md` y, si no, a la raíz. Se omiten las que llevan espacios, `*`, `<`, `…`, `http`, `node:`, `@` o empiezan por `/`, y se quitan `#ancla` y `:línea`. Lista mínima de rutas que solo existen al ejecutar: `server/data/cuentas.db`;
  - cada caso de uso PascalCase de `application/` aparece en la tabla de su módulo;
  - la tabla «Si vas a tocar… lee…» nombra cada `server/modules/<m>` y cada `src/features/<f>`;
  - ningún `AGENTS.md` pasa de 200 líneas.
- **Guardas**:
  - huella de tickets «golden»: se escribe **con el código actual** antes de mover tickets;
  - `DEFAULT_DB_PATH` sigue apuntando a `server/data/cuentas.db`;
  - (opcional) las migraciones 001–005 no cambian, con un hash del texto normalizado a LF.

## 8. Pasos y commits (`npm run check` en verde después de cada uno)

1. «Fija better-sqlite3 en 12.11.1» → línea base → «Plan de la reestructuración» (con `.claude/settings.json`).
2. «Mueve las fixtures de tickets a fixtures/tickets».
3. «Mueve el dominio puro a shared/ por áreas»: tipos repartidos, validación genérica en `common/`, `META_KEYS`, factories, tsconfig, Vitest, la línea de 001 y los 2 `it` de ticketImages. Después, si la prueba sale bien, «Imports #shared/*».
4. «server/common: errores, HTTP, SQLite, puertos y ayudantes de tests» (sin lógica nueva; `createApp` ya usa `Clock`, `IdGenerator` y `UnitOfWork`).
5. Módulos, de uno en uno, cada uno con sus tests, su `AGENTS.md` y su `CLAUDE.md`:
   - «Módulos health y auth».
   - «Módulo pantry». La versión antigua de tickets recibe `pantry.api`, que expone los mismos métodos.
   - «Módulo finance».
   - «Tickets: la huella no cambia», un test golden contra el código actual.
   - «Módulo tickets», en dos commits: primero se mueve el lector OCR y el SQL; después llegan los casos de uso.
   - «Test de arquitectura (servidor y shared)»: así vigila el resto del trabajo.
6. Web: «api/ y ui/» → «feature auth» → «feature finance» → «feature tickets» → «feature pantry» → «DespensaPage en piezas». Cada feature con su `AGENTS.md`; el test de arquitectura amplía las reglas de la web. Después, `npm run build` y `npm run test:e2e`.
7. «Documentación para agentes» (raíz, zonas, `docs/` y `.claude/rules/`) → «README para personas» → «Test de documentación» → (opcional) «styles.css por secciones».
8. Comprobación final (§11). Lo que merezca quedarse del plan pasa a `docs/decisiones.md`, y `plan-reestructuracion.md` se borra. Después se sube la rama y se abre el PR.
Todos los movimientos se hacen con `git mv`, en commits mecánicos, separados de los que reparten la lógica. Las versiones fijadas se commitean con nombre explícito, sin `git add -A`. Ningún error que encuentre se arregla aquí salvo que bloquee; si bloquea, va en un commit aparte con su test.

## 9. Riesgos y cómo se controlan

- **Cambiar el comportamiento al repartir la lógica.** Mismo orden de comprobaciones y mismos mensajes. Los tests de la API no cambian sus aserciones; el ayudante `openFinance()` mantiene intactas las de finanzas.
- **Atomicidad.** Todo pasa por `UnitOfWork`, que es síncrono y anida los savepoints como hoy. Las escrituras de tickets siguen siendo `.immediate()`. Los tests de deshacer con 409, de guardar sin duplicar y de restauración fallida no cambian.
- **Huellas o ruta de la base de datos distintas.** Los tests golden y de `DEFAULT_DB_PATH` lo detectan.
- **Orden de montaje y 401.** `auth.test.ts` recorre todas las rutas financieras y una ruta que no existe.
- **Ciclos en la web.** Solo existe la dependencia pantry → tickets.
- **Avisos de `react/only-export-components` en los `index.ts`.** Si aparecen, se añade una excepción documentada en `.oxlintrc.json` para `src/features/*/index.ts`.
- **`#shared/*` no compatible con TS 7 o Vite 8.** Se vuelve a rutas relativas.
- **Rutas de Windows en los tests nuevos.** Se normalizan a `/`.
- **e2e:** la descarga de Chromium caduca en este equipo; se usa `CUENTAS_E2E_CHANNEL=chrome`. Los puertos 3101 y 4174 deben estar libres.

## 10. Lo que no encaja con el prompt (y qué propongo)

1. **Migración 001**: importa `src/domain/categories.ts`. Cambia esa única línea, ya acordado.
2. **`imageInfo.ts`**: lo usan dos adaptadores de tickets (HTTP, para validar; Tesseract, para medir). Va a `server/common/imageInfo.ts`, que es técnico y no tiene reglas de negocio, en lugar de `tickets/adapters/http/`, para que ningún adaptador importe otro.
3. **Dos tests del dominio importan código de la web** (`imageQuality` e `imageLayout` de `src/ui/ticketImages.ts`). Esos 2 `it` pasan a `src/features/tickets/ticketImages.test.ts`, con las mismas aserciones y sin cambiar el total.
4. **Datos reales**: `ticket-cases.json`, `ticketCases.test.ts` y el ticket «sintético de Torrelavega» usan líneas que transcribiste de un ticket real tuyo (28/10/26). No cambio los datos en este PR, porque eso podría debilitar los tests del OCR. `docs/pruebas.md` dirá con exactitud qué es inventado y qué está transcrito, en lugar de «todo inventado», y lo apunto en el resumen por si quieres sustituirlos.
5. **`node:crypto` en tickets**: hace falta un puerto `Hasher` (para la huella y el origen), que no está en tu lista. Es lo mínimo para sacarlo de `application/`.
6. **Un solo `Clock`** sustituye a los dos que se inyectan hoy (ms en auth e ISO en despensa); el ayudante de tests acepta sobrescribir solo una parte. **Un solo `IdGenerator`**.
7. **Reset de pruebas**: pasa de dos transacciones a una, con el mismo resultado.
8. **README**: no menciona la migración 005 ni `{ franjas }`; se corrige en `docs/`.
9. **`e2e/` y `playwright.config.ts`**: ningún tsconfig los comprueba hoy. Opcional: añadirlos a `tsconfig.node.json`. Si salen errores, los dejo fuera y te los cuento.
10. **PR**: `gh` no está instalado y el conector de GitHub no ha podido conectar. Subo la rama con `git push -u origin refactor/arquitectura-hexagonal` y te paso el enlace de comparación con la descripción lista para pegar, salvo que antes arregles alguno de los dos.
11. **`.env` de pruebas**: no toco tu `.env`. Para `npm run dev` uso variables de entorno, que tienen prioridad, y una base de datos temporal, para no abrir `server/data/cuentas.db`.

## 11. Verificación final (= «Terminado significa»)

- `npm run check` en verde, con al menos tantos tests como en la línea base (y más, por los nuevos); `npm run build`; `CUENTAS_E2E_CHANNEL=chrome npm run test:e2e` con 46 de 46.
- Servidor: `CUENTAS_CODIGO=… CUENTAS_DB_PATH=<temporal> npm run dev` → `GET /api/health` responde en `:3001` y a través de Vite en `:5173`.
- `git diff main -- server/migrations` muestra solo la línea de 001. `git grep` no encuentra referencias a `src/domain`, `server/routes`, `services/` ni `state/` (salvo en `docs/decisiones.md`, sin comillas invertidas).
- Los tests de arquitectura y de documentación pasan; no hay dependencias nuevas, textos ni `data-testid` cambiados, ni datos reales nuevos.
- Resumen final: qué ha cambiado, qué se ha quedado igual y por qué, errores encontrados y no arreglados, y lo que no he podido comprobar.
- Commits con la línea `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; la descripción del PR termina con la línea de Claude Code.
