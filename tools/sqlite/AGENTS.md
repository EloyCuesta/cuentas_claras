# tools/sqlite/ — El esquema SQLite de antes

> Lee antes: /AGENTS.md y `docs/migration/DATA.md`. El esquema de la aplicación es el de MySQL (`database/mysql/AGENTS.md`); esto describe la base que se usaba antes y que lee el importador.

Las migraciones 001 a 005 de SQLite, tal como se publicaron, con su lista y su aplicador. El servidor ya no las usa: hasta la fase MYSQL creaban `server/data/cuentas.db`. Ahora sirven para comprobar que una copia de `cuentas.db` está en la versión 5 y para crear copias sintéticas en las pruebas del importador.

## Qué hay

| Archivo | Versión |
| --- | --- |
| `001-esquema-inicial.ts` | 1: finanzas y categorías iniciales |
| `002-despensa.ts` | 2: personas, productos y ajustes de la despensa |
| `003-tickets.ts` | 3: tickets, lo aprendido, revisiones y `tracking` |
| `004-repaso.ts` | 4: día del repaso y «Queda poco» |
| `005-ticket-review.ts` | 5: revisión segura de tickets (ajustes, avisos, estado y evidencia de las líneas, `import_id` y `source_fingerprint`) |
| `index.ts` | La lista, `LATEST_VERSION` (5) y `runMigrations` |
| `openSqlite.ts` | `createSqlite` (crear una base de ensayo con las cinco migraciones) y `openSqliteReadOnly` (abrir una copia sin poder escribir en ella) |
| `migrations.test.ts` | Migraciones de versiones antiguas con datos, las doce tablas, restricciones y migraciones congeladas |

## Reglas que no se rompen

- **Las migraciones publicadas no se editan** ni se añaden otras: el test guarda la huella de 001 a 005. Un cambio del esquema es una migración de MySQL (`database/mysql/`).
- Solo importan better-sqlite3, `shared/` y otras migraciones. Nada de `server/`: el servidor no depende de SQLite.
- Nunca abren `server/data/`: las pruebas usan bases en la carpeta temporal del sistema (`server/common/testing/tempDb.ts`), y el importador, la copia que se le indica, en solo lectura.

## Trampas

- La 001 siembra las categorías iniciales desde `shared/finance/categories.ts` (`DEFAULT_CATEGORIES`). Su comentario todavía dice «src/domain/types.ts», porque es de antes de `shared/`: no se edita. Su import relativo (`../../shared/…`) vale aquí igual que en server/migrations, donde estaba antes: la misma profundidad.
- La 005 rehace dos tablas copiando todas sus filas y comprueba las claves foráneas al final.
- better-sqlite3 solo es una dependencia de desarrollo cuando acabe la fase MYSQL (MYSQL-04): el importador se ejecuta desde el repositorio, no desde la aplicación instalada.

## Cómo probar

`npx vitest run tools/sqlite`.

## Si cambias algo aquí

Nada de migraciones nuevas. Si cambia cómo se abre una copia, el importador y `docs/migration/DATA.md`.
