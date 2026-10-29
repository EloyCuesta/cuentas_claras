# server/migrations/ — Migraciones

> Lee antes: /AGENTS.md, server/AGENTS.md y `docs/base-de-datos.md` (tablas, decisiones y cómo añadir una migración).

Los cambios del esquema de la base de datos, en orden. `index.ts` las lista (`MIGRATIONS`) y `runMigrations` las aplica: cada una una sola vez, en una transacción, anotada en `schema_migrations`. Una base de datos de una versión más nueva no se abre.

## Qué hay

| Archivo | Versión |
| --- | --- |
| `001-esquema-inicial.ts` | 1: finanzas y categorías iniciales |
| `002-despensa.ts` | 2: personas, productos y ajustes de la despensa |
| `003-tickets.ts` | 3: tickets, lo aprendido, revisiones y `tracking` |
| `004-repaso.ts` | 4: día del repaso y «Queda poco» |
| `005-ticket-review.ts` | 5: revisión segura de tickets (ajustes, avisos, estado y evidencia de las líneas, `import_id` y `source_fingerprint`) |
| `index.ts` | La lista, `LATEST_VERSION` y `runMigrations` |
| `migrations.test.ts` | Migraciones de versiones antiguas con datos, restricciones de las tablas y migraciones congeladas |

## Reglas que no se rompen

- **Una migración publicada no se edita.** Un cambio es una migración nueva (`006-…`), y el test guarda la huella de 001 a 005.
- Nunca se borran datos: `ALTER TABLE`, tablas nuevas o copias completas (como hace la 004, porque SQLite no deja cambiar un `CHECK`).
- Una migración solo importa better-sqlite3 (tipos), `shared/` y otras migraciones.
- Se nombran en español: `NNN-qué-hace.ts`, con un `name` en español.
- Cada migración trae un comentario que explica qué cambia y por qué no se pierde nada, y un test que parte de una base de datos anterior con datos.

## Trampas

- La 001 siembra las categorías iniciales desde `shared/finance/categories.ts` (`DEFAULT_CATEGORIES`): cambiarlas cambia lo que tiene una base de datos nueva, no las que ya existen. Su comentario todavía dice «src/domain/types.ts», porque es de antes de `shared/`: no se edita.
- La 005 rehace dos tablas copiando todas sus filas y comprueba las claves foráneas al final.
- `server/common/sqlite/openDatabase.test.ts` comprueba la lista exacta de tablas de una base de datos nueva.

## Cómo probar

`npx vitest run server/migrations server/common/sqlite`.

## Si cambias algo aquí

`docs/base-de-datos.md` (tablas y lista de migraciones), el adaptador SQLite y el AGENTS.md del módulo dueño de la tabla, y, al publicarla, la lista del test de migraciones congeladas.
