# Arquitectura

Cuentas claras es una web (React, en `src/`) que habla por HTTP con un servidor (Express y MySQL, en `server/`). Los dos usan la misma lógica pura (`shared/`). El servidor sigue una arquitectura hexagonal modular, y la web está organizada por funcionalidades. Las reglas de dependencia las vigila `tests/architecture.test.ts`.

El host .NET de ensayo está en `backend/`: su composición y límites por ensamblado y módulo se describen en [arquitectura de migración](migration/ARCHITECTURE.md) y se comprueban con ArchitectureTests. Su alcance actual es acceso y transporte HTTP; no sustituye todavía la aplicación siguiente.

## Vista general

```
navegador ── src/ (features: auth · finance · pantry · tickets) ──┐
                                                                   │ /api (JSON, cookie de sesión)
server/index.ts → server/app.ts (raíz de composición)              ▼
   ├─ modules/health   router y nada más
   ├─ modules/auth     ┐
   ├─ modules/finance  │  adapters/http (routers) ─▶ application (casos de uso) ─▶ domain
   ├─ modules/pantry   │                               │ puertos (application/ports.ts)
   └─ modules/tickets  ┘                               ▼
                           adapters/mysql · tesseract · crypto · memory (implementan los puertos)
server/common/   errores, HTTP, MySQL, puertos comunes (Clock, IdGenerator, UnitOfWork)
shared/          lógica pura: common · finance · pantry · tickets (la usan web y servidor)
database/mysql/  el esquema de MySQL (.sql), que aplica server/common/mysql/ al arrancar
tools/           fuera del servidor: el esquema SQLite de antes y el importador
```

## Capas del servidor

Cada módulo de `server/modules/` tiene:

- **`index.ts`**: su API pública. Crea sus adaptadores, monta sus casos de uso y devuelve `{ router, …, reset }`. Es lo único que se importa desde fuera del módulo.
- **domain/** (solo si hace falta): reglas puras que solo usa el servidor, como la política de acceso (auth) o la huella de un ticket (tickets). Las reglas que también usa la web están en `shared/`.
- **application/**: un archivo por caso de uso (`AdjustItem.ts`), las lecturas juntas (`queries.ts`) y los puertos (`ports.ts`), que son interfaces de lo que el módulo necesita de fuera. Aquí están las comprobaciones, los mensajes de error y las transacciones.
- **adapters/**: la entrada (http/, routers de Express que traducen HTTP ⇄ caso de uso y nada más) y las salidas (mysql/, tesseract/, crypto/, memory/, que implementan los puertos).

### Reglas de dependencia

| Código en… | Puede importar | No puede importar |
| --- | --- | --- |
| `shared/` | solo `shared/` | servidor, web, Express, MySQL, Tesseract, React ni `node:*`, ni usar `Buffer` o `process` |
| `modules/*/domain` | `shared/` y su propio `domain` | todo lo demás |
| `modules/*/application` | su `domain`, su `application`, `shared/`, `server/common/errors.ts` y `server/common/ports.ts` | adaptadores, `server/common/http`, `server/common/mysql`, Express, mysql2, tesseract.js y `node:*` (ni `Buffer` ni `process`) |
| `modules/*/adapters/<tecnología>` | su `application`, su `domain`, su propia carpeta, `shared/`, `server/common/` y librerías | otros módulos y otros adaptadores |
| `modules/*/index.ts` | todo su módulo, `server/common/`, `shared/` y librerías | de otro módulo, más que su `index.ts` |
| `server/common/` | `server/common/`, `shared/` y librerías | módulos y `server/app.ts` |
| todo `server/` | lo de arriba | `tools/` y better-sqlite3: el servidor no depende de SQLite |
| `tools/sqlite/` | librerías (better-sqlite3), `shared/` y su propia carpeta | lo demás, también `server/` |
| `tools/importer/` | su carpeta, `tools/sqlite/`, `server/common/`, `shared/` y librerías | los módulos y `server/app.ts`: carga las tablas tal cual, sin casos de uso |
| `server/app.ts` · `server/index.ts` | el `index.ts` de cada módulo y `server/common/` | el interior de los módulos |
| `src/` | lo de la web y `shared/` | nada de `server/` |

Los tests (`*.test.ts`), `server/common/testing/` y `shared/testing/` quedan fuera de estas reglas. `tests/architecture.test.ts` comprueba además que los puertos que implementa un adaptador MySQL (adapters/mysql) devuelven Promise en todos sus métodos. Las reglas de la web están en `docs/frontend.md`.

## Una petición de principio a fin

`POST /api/despensa/productos/:id/ajustar` con `{ delta: 0.5 }`, el botón + de un producto que se cuenta:

1. `server/app.ts`: `express.json` lee el cuerpo, el router `/api` pone `Cache-Control: no-store` y llega al router de la despensa (público, antes de `requireAdmin`).
2. `server/modules/pantry/adapters/http/routes.ts`: `valid(validateDeltaInput(req.body))` valida el cuerpo con `shared/pantry/pantryValidation.ts`; si no vale, `AppError('VALIDATION')` y 400.
3. `server/modules/pantry/application/AdjustItem.ts`: dentro de `unitOfWork.run` bloquea el producto (`lockItems`, `SELECT … FOR UPDATE`), comprueba que existe (404 si no), calcula la cantidad nueva sobre la del servidor con `stepQuantity` y `checkQuantity` (`shared/pantry/pantry.ts`) y la guarda. Otro + a la vez espera a que este termine y suma sobre su resultado.
4. `PantryRepository.setQuantity` (puerto), que implementa `server/modules/pantry/adapters/mysql/MysqlPantryRepository.ts`: `UPDATE pantry_items SET quantity = ?, version = version + 1 …`, con parámetros y con la conexión de la transacción.
5. De vuelta en el router, `sendData(res, item)` responde `{ ok: true, data: … }`. Cualquier error acaba en `errorHandler` (`server/common/http/response.ts`) como `{ ok: false, error: { code, message } }`.

## Cómo se hablan los módulos

Un módulo no importa el interior de otro. Si tickets necesita la despensa, declara lo que usa en un puerto (`PantryGateway`, en `server/modules/tickets/application/ports.ts`: `lockItems`, `getItem`, `createItem`, `applyTicketPurchase`, `listItems` y `eventsSince`, todos async), y `server/app.ts` le pasa la API pública de pantry (`pantry.api`), que encaja con ese puerto. Así, guardar un ticket bloquea y cambia los productos de la despensa, y crea los nuevos con el caso de uso CreateItem, con sus mismas comprobaciones, dentro de la transacción del ticket.

## Transacciones

- `UnitOfWork.run(work, { lock? })` (`server/common/ports.ts`), implementado por `server/common/mysql/MysqlUnitOfWork.ts`. Cada caso de uso que escribe es una sola transacción: o se guarda todo o nada.
- **Async, con una sola conexión**: `work` devuelve una promesa y la transacción se confirma cuando termina. Toda la operación usa la misma conexión del pool, de principio a fin (`MysqlDatabase` la encuentra con AsyncLocalStorage). Los puertos de persistencia y los casos de uso devuelven Promise.
- **Anidadas**: una llamada a `run` dentro de otra (un caso de uso que llama a otro, o tickets → PantryGateway) se une a la transacción de fuera, con un savepoint propio: si falla y quien la llama lo captura, solo se deshace lo de dentro. Hay una sola instancia de UnitOfWork, creada en `server/app.ts`.
- **Bloqueos explícitos**: better-sqlite3 escribía todo en serie; MySQL no, así que lo que antes daba el motor se pide. Va siempre lo primero, porque con REPEATABLE READ la primera lectura normal fija una instantánea que no verá lo que confirme otra conexión después:
  - `{ lock: 'finance' }`: la fila `finance` de `app_locks` con `SELECT … FOR UPDATE`, en todo lo que escribe finanzas. Generar vencimientos desde dos pestañas a la vez da `[0, 2]`, sin 409.
  - `{ lock: 'tickets' }`: guardar, reasociar y borrar tickets (lo que antes era BEGIN IMMEDIATE). El duplicado y el posible duplicado se comprueban dentro; el OCR, fuera.
  - `lockItems(ids)`: los productos que se van a cambiar (+ y −, editar, borrar, revisiones, comprar, deshacer y los efectos de un ticket), con `SELECT … FOR UPDATE` en orden de id.
  - Un bloqueo se suelta al confirmar o deshacer.
- **Interbloqueo** (1213): InnoDB deshace la transacción entera, y la UnitOfWork repite la operación completa una sola vez.
- Lo que garantiza la base de datos: claves foráneas, CHECK, el índice único de vencimientos y la huella única de los tickets (`docs/base-de-datos.md`). Sus errores (1062, 1451, 1452, 3819 y 1048) son el 409 de siempre.

## Raíz de composición

- `server/index.ts`: lee las variables de entorno y comprueba el código **antes** de conectar con MySQL. Después lee las `CUENTAS_DB_*` (con `CUENTAS_TEST=1`, solo `cuentas_claras_e2e` o `cuentas_test_*`), conecta y aplica las migraciones (`openDatabase`, en `server/common/mysql/MysqlDatabase.ts`), crea el lector OCR, arranca el servidor y, al cerrar (Ctrl+C), termina las peticiones, cierra el lector y luego las conexiones. Si MySQL no responde, rechaza el usuario o la base no existe, no arranca y explica en español qué revisar, sin la contraseña.
- `server/app.ts` (`createApp`): crea auth primero (lanza si el código no vale), luego la UnitOfWork y los módulos, y monta todo en este orden:
  1. `x-powered-by` desactivado y `trust proxy` solo para `loopback`;
  2. JSON de 30 MB para `/api/despensa/tickets/leer` y de 20 MB para lo demás;
  3. `no-store`, y los routers de health, auth, despensa y tickets;
  4. **`requireAdmin`**, y detrás las finanzas;
  5. el reset de pruebas (solo con `CUENTAS_TEST=1`);
  6. `notFoundHandler` y `errorHandler`.
- Lo que los tests pueden sustituir al crear la app: `clock`, `ids` y `ticketReader` (`docs/pruebas.md`).

## Recetas

**Añadir un caso de uso** (por ejemplo, «Vaciar la despensa de una persona»):
1. `server/modules/<módulo>/application/VerboNombre.ts`, una clase con sus puertos en el constructor y un `execute` que hace todo dentro de `unitOfWork.run`. Las comprobaciones lanzan `AppError` con un mensaje en español.
2. Si necesita algo nuevo del almacenamiento, añádelo al puerto (`server/modules/<módulo>/application/ports.ts`), que devuelve Promise, y al adaptador MySQL. Si escribe, decide su bloqueo (`docs/arquitectura.md`, «Transacciones»).
3. Créalo en el `index.ts` del módulo y pásalo al router.
4. Añade una fila a la tabla «Casos de uso y rutas» del AGENTS.md del módulo (`tests/docs.test.ts` lo comprueba) y su test.

**Añadir una ruta**: en `server/modules/<módulo>/adapters/http/routes.ts`. Lee y valida la petición (`server/common/http/request.ts` o un validador de `shared/`), llama a un caso de uso y responde con `sendData`. Sin SQL ni reglas en el router. Si es financiera, va en el módulo finance, que se monta detrás de `requireAdmin`; añádela a `FINANCE_ROUTES` en `server/modules/auth/auth.test.ts`. Documéntala en el AGENTS.md del módulo, en `docs/api.md` y, si la usa la web, en el cliente de su feature (`api.ts`).

**Añadir un adaptador** (otro lector de tickets, por ejemplo): una clase en `adapters/<tecnología>/` que implemente el puerto. El `index.ts` del módulo decide cuál se usa. Un adaptador no importa otro.

**Añadir un módulo**: `server/modules/<nombre>/` con `index.ts` (`create<Nombre>Module(deps)` → `{ router, reset }`), application/ y adapters/. Móntalo en `server/app.ts` en su sitio (antes o después de `requireAdmin`) y escribe su AGENTS.md (plantilla en `/AGENTS.md`) con su CLAUDE.md. Añádelo a la tabla «Si vas a tocar… lee…» de la raíz y a la lista de módulos de `tests/architecture.test.ts`.

## Estructura del repositorio

```
server/
├── index.ts · app.ts              arranque y raíz de composición
├── common/                        errores, HTTP, MySQL, puertos comunes, imageInfo y ayudantes de tests
├── modules/{auth,finance,pantry,tickets,health}/
└── data/                          cuentas.db de antes de MySQL (fuera de git)
database/mysql/                    schema_migrations.sql y migrations/005…
tools/sqlite/                      las migraciones 001…005 de SQLite (las lee el importador)
tools/importer/                    el importador de una copia de cuentas.db a MySQL
shared/{common,finance,pantry,tickets,testing}/
src/
├── main.tsx · Root.tsx · App.tsx · GuestApp.tsx · styles.css
├── api/ · ui/ · features/{auth,finance,pantry,tickets}/ · test/setup.ts
fixtures/tickets/                  tickets de prueba
tests/                             architecture.test.ts y docs.test.ts
e2e/                               pruebas en el navegador (Playwright)
docs/ · ejemplo/ · public/
```
