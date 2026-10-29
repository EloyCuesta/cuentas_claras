# Módulo pantry — Despensa

> Lee antes: /AGENTS.md y server/AGENTS.md. Depende de: nada (solo `server/common/` y `shared/pantry/`). Lo usan: tickets, a través de su PantryGateway (`server/app.ts` le pasa `pantry.api`).

## Qué hace
Lo que se compra en casa, separado por persona: las personas, los productos (por compras o contando), las revisiones («Queda», «Queda poco», «Se acabó», «Lo he comprado»), el presupuesto, el día del repaso de la semana y «Marcar todo como comprado» con su «Deshacer».

## Acceso
Público a propósito: lo usa cualquiera de casa, sepa o no el código. Nunca devuelve datos financieros, y las copias y la importación financieras no lo tocan.

## API pública (index.ts)
- `createPantryModule(deps)` → `{ router, api, reset }`.
- `api` (tipo PantryApi): `getItem`, `createItem`, `applyTicketPurchase`, `listItems` y `eventsSince`. Es lo único que usa tickets.
- `reset()`: vacía la despensa, solo para POST /api/test/reset.

## Casos de uso y rutas
Todas bajo /api/despensa. Los ids que no existen dan 404 sin cambiar nada.

| Ruta | Caso de uso (archivo) | Cuerpo → respuesta | Errores |
| --- | --- | --- | --- |
| GET /personas | `application/queries.ts` (listPeople) | → personas, por nombre | — |
| POST /personas | CreatePerson | `{ name }` → 201 y la persona | 400 |
| PUT /personas/:id | RenamePerson | `{ name }` → la persona | 400 · 404 |
| DELETE /personas/:id | DeletePerson | → `null` | 404 · 409 ««Eloy» tiene un producto…» |
| GET /productos | `application/queries.ts` (listItems) | → productos, por frecuencia y nombre | — |
| POST /productos | CreateItem | PantryItemInput → 201 y el producto (id, versión 1 y fechas del servidor) | 400, también si el dueño no existe |
| PUT /productos/:id | UpdateItem | PantryItemInput → el producto (versión + 1) | 400 · 404 |
| POST /productos/:id/ajustar | AdjustItem | `{ delta }` → el producto | 400 (delta 0, decimales en unidades enteras) · 404 |
| POST /productos/:id/revision | AddEvent | `{ kind, date }` → 201 y la revisión | 400 · 404 |
| DELETE /revisiones/:id | DeleteEvent | → `null` | 404 |
| DELETE /productos/:id | DeleteItem | → `null` | 404 |
| GET /presupuesto | `application/queries.ts` (getSettings) | → `{ monthlyBudgetCents, lastReviewDate }` | — |
| PUT /presupuesto | SetBudget | `{ monthlyBudgetCents }` (número o `null`) → ajustes | 400 |
| PUT /repaso | SetReviewDate | `{ date }` → ajustes | 400 |
| POST /comprado | MarkPurchased (con AddEvent) | `{ ids, date }` → `{ changes, items }` | 400 · 404 (no cambia nada) |
| POST /comprado/deshacer | UndoPurchase | `{ changes }` → productos | 400 · 409 si algo cambió después |
| (desde tickets) | ApplyTicketPurchase | precio y cantidad que deja un ticket | 404 |

## Puertos
| Puerto | Para qué | Adaptador real | Falso en los tests |
| --- | --- | --- | --- |
| PantryRepository | Guardar y leer personas, productos, revisiones y ajustes | `adapters/sqlite/SqlitePantryRepository.ts` | SQLite temporal (`startApi`) |
| Clock, IdGenerator, UnitOfWork (comunes) | Fechas, ids y transacciones | `server/common/system.ts` y `server/common/sqlite/SqliteUnitOfWork.ts` | `startApi({ clock: { nowISO } })` |

Las comprobaciones que comparten varios casos de uso (la persona, el producto o el dueño existen) están en `application/require.ts`.

## Reglas que no se rompen
- Los botones + y − suman o restan sobre el valor actual del servidor y nunca bajan de cero. Solo `g`, `kg`, `ml` y `l` admiten decimales (hasta 3).
- Cada escritura en un producto sube su `version`. «Deshacer» la compara y responde 409 si algo cambió; entonces no toca nada.
- Comprar nunca reduce lo que hay: los que ya tienen su objetivo (o más) se quedan igual.
- Una persona con productos no se borra (409), y la base de datos lo impide también (ON DELETE RESTRICT).
- Los ids y las fechas los pone el servidor. La fecha de hoy la manda el navegador (`date`); el servidor solo usa la suya si `comprado` llega sin ella.
- Precios en céntimos enteros: `null` es desconocido y 0 es gratis.
- Cada operación que escribe es una sola transacción (UnitOfWork), anidada dentro de la de tickets cuando la llama tickets.

## Datos
- `pantry_people`, la persona de cada apartado.
- `pantry_items`: `owner_id` es NULL para Compartido; `tracking` vale `compras` o `cantidad`; `version` sube en cada escritura.
- `pantry_events`, las revisiones, que se borran con su producto.
- `pantry_settings`, una sola fila, con `monthly_budget_cents` y `last_review_date`.

Vienen de las migraciones 002, 003 y 004: ver `docs/base-de-datos.md`.

## Pruebas
- `pantry.test.ts`: la API por HTTP como invitado (personas, productos, validación, + y −, presupuesto, comprar y deshacer, y que no se mezcla con las finanzas).
- Las revisiones, «Queda poco» y el repaso se prueban con los tickets: `server/modules/tickets/tickets.test.ts`.
- Las reglas puras (cantidades, ritmo y repaso) están en `shared/pantry/`.

Solo estas: `npx vitest run server/modules/pantry`.

## Trampas y decisiones
- MarkPurchased apunta las compras con AddEvent, en una transacción anidada.
- `reset` solo vacía las tablas de la despensa: los tickets y lo aprendido los vacía antes el módulo tickets, en la misma transacción (`server/app.ts`).
- Un producto creado por la API sin `tracking` se sigue contando (`cantidad`); los que crean los tickets van por compras: ver `docs/decisiones.md`.

## Si cambias este módulo
- Rutas o mensajes: `docs/api.md`, la web (`src/features/pantry/`) y `e2e/despensa.spec.ts`.
- La API pública: el PantryGateway de tickets.
- Reglas de cantidades, ritmo o lista: `shared/pantry/` y sus tests (las comparte la web).
