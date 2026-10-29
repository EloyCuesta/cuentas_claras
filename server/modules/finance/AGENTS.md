# Módulo finance — Cuentas

> Lee antes: /AGENTS.md y server/AGENTS.md. Depende de: nada (solo `server/common/` y `shared/finance/`). Lo usan: solo `server/app.ts`, que monta su router detrás de `requireAdmin`.

## Qué hace
Ingresos y gastos (movimientos), categorías con presupuesto, pagos recurrentes con sus vencimientos, la copia de seguridad (restaurar), el paso único de los datos del navegador y los metadatos (fecha de la última copia).

## Acceso
Todo con sesión: sin ella, `requireAdmin` (módulo auth) responde 401 antes de llegar aquí.

## API pública (index.ts)
- `createFinanceModule(deps)` → `{ router, useCases, reset }`.
- `useCases`: los casos de uso y `queries`. Solo los usan los tests de este módulo.
- `reset()`: deja las categorías iniciales y borra lo demás, solo para POST /api/test/reset.

## Casos de uso y rutas
| Ruta | Caso de uso (archivo) | Cuerpo → respuesta | Errores |
| --- | --- | --- | --- |
| GET /api/data | `application/queries.ts` (loadAll, en una transacción) | → `{ categories, movements, recurring }` | — |
| PUT /api/data | RestoreBackup | FinanceData → `null` | 400 (validación de la copia, entera) · 409 si algo no encaja |
| POST /api/import | ImportBrowserData | `{ data, lastBackupAt }` → 201 `{ categories, movements, recurring }` | 400 · 409 si ya hay datos |
| PUT /api/movements/:id | SaveMovement | Movement → `null` | 400 (también categoría inexistente o de otro tipo, id distinto) · 409 vencimiento duplicado |
| DELETE /api/movements/:id | DeleteMovement | → `null` | — (si no existe, no hace nada) |
| PUT /api/categories/:id | SaveCategory | Category → `null` | 400 (subcategorías) · 409 cambiar de tipo |
| DELETE /api/categories/:id?replacementId= | DeleteCategory | → `null` | 400 destino no válido · 409 en uso y sin destino |
| PUT /api/recurring/:id | SaveRecurring | `{ rule, horizon, markPaidBefore }` → `{ created }` | 400 · 409 |
| DELETE /api/recurring/:id | DeleteRecurring | → `null` | — |
| POST /api/occurrences/generate | GenerateOccurrences | `{ horizon }` → `{ created }` | 400 |
| GET /api/meta/:key | `application/queries.ts` (getMeta) | → `{ value }` | 404 clave desconocida |
| PUT /api/meta/:key | SetMeta | `{ value }` (texto de 100 como máximo) → `null` | 400 · 404 |

Los routers están en `adapters/http/` y `adapters/http/routes.ts` los monta en ese orden. Un movimiento o recurrente con una categoría que no existe o de otro tipo da 400, desde `application/requireCategory.ts`.

## Puertos
| Puerto | Para qué | Adaptador real | Falso en los tests |
| --- | --- | --- | --- |
| FinanceStore | Guardar y leer categorías, movimientos, recurrentes y metadatos | `adapters/sqlite/SqliteFinanceStore.ts` | SQLite temporal (`openFinance` en `finance.test.ts`) |
| Clock, IdGenerator, UnitOfWork (comunes) | Fechas de los cambios, ids de los vencimientos y transacciones | `server/common/system.ts` y `server/common/sqlite/SqliteUnitOfWork.ts` | `clock: { nowISO: () => NOW }` |

FinanceStore es síncrono; el contrato asíncrono FinanceRepository es de la web (`src/features/finance/FinanceRepository.ts`), y el servidor no lo implementa.

## Reglas que no se rompen
- Importes en céntimos enteros (> 0) y fechas `AAAA-MM-DD`. El `horizon` y `markPaidBefore` los calcula la web con su fecha de hoy.
- Un vencimiento no existe dos veces: índice único `(recurring_id, occurrence_date)` y 409 «Ese vencimiento ya existe, así que no se ha creado otro.».
- Borrar un vencimiento de un recurrente anota su fecha para no volver a crearlo.
- Guardar un recurrente rehace sus pendientes y conserva los pagados. Borrarlo borra los pendientes y deja los pagados (con su `recurringId`).
- Restaurar e importar sustituyen solo las finanzas, todo o nada. La despensa no se toca, y la importación no se hace si ya hay datos del usuario.
- Marcar como pagado es guardar el mismo movimiento, nunca crear otro.
- Listas `IN (...)` (borrar categorías) siempre con parámetros.

## Datos
Tablas `categories`, `movements`, `recurring_rules`, `recurring_excluded_dates` y `meta`, de la migración 001. `movements.recurring_id` no es clave foránea a propósito. Ver `docs/base-de-datos.md`.

## Pruebas
- `finance.test.ts`: los casos de uso contra SQLite temporal, con los mismos nombres que el contrato de la web (`openFinance`).
- La API por HTTP está en `server/app.test.ts`, y el acceso (401), en `server/modules/auth/auth.test.ts`.
- Los cálculos (resumen, recurrentes, copias, CSV) están en `shared/finance/`.

Solo estas: `npx vitest run server/modules/finance`.

## Trampas y decisiones
- GenerateOccurrences lo llama la web al abrirse y al cambiar de día: varias pestañas a la vez no duplican nada.
- `writeAll` (restaurar e importar) usa la inserción sin traducir: un choque ahí sale como el 409 genérico de `errorHandler`, no como «vencimiento duplicado».
- Por qué no hay tablas de cuentas, préstamos ni vivienda: ver `docs/decisiones.md`.

## Si cambias este módulo
- Rutas o mensajes: `docs/api.md`, la web (`src/features/finance/ApiFinanceRepository.ts`) y `e2e/app.spec.ts`.
- Reglas de cálculo o validación: `shared/finance/`, que comparte la web.
- Tablas: una migración nueva (`server/migrations/AGENTS.md`).
