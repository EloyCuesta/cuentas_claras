# database/mysql/ — Esquema de MySQL

> Lee antes: /AGENTS.md, `docs/base-de-datos.md` y `docs/migration/DATA.md`. Lo aplica `server/common/mysql/migrations.ts` (al arrancar el servidor y en el importador) y lo reutilizará el backend .NET.

Las migraciones de MySQL en archivos .sql, con su propio historial. Son el esquema de la aplicación: el servidor Node no tiene otro, y .NET aplicará estos mismos archivos y la misma tabla `schema_migrations`.

## Qué hay

| Archivo | Qué es |
| --- | --- |
| `schema_migrations.sql` | El historial: `CREATE TABLE IF NOT EXISTS`, antes de aplicar nada. `applied_at` NULL = migración a medias |
| `migrations/005-esquema-inicial.sql` | Versión 5: el esquema final de SQLite tras sus migraciones 001–005, más `app_locks` |

Empieza en la versión 5 para que `/api/health` siga diciendo 5. Las migraciones de SQLite (001–005) no se editan: describen la base que lee el importador.

## Reglas que no se rompen

- **Una migración publicada no se edita**: los cambios van en una nueva (`006-…`). `server/common/mysql/migrations.test.ts` guarda la huella de cada archivo.
- Se llaman `NNN-que-hace.sql` (minúsculas y guiones; NNN es la versión) y se aplican en orden, una sola vez.
- Formato que entienden Node y .NET: comentarios solo en líneas propias que empiezan por `--`; cada sentencia termina con `;` al final de una línea; sin `DELIMITER` ni sentencias compuestas (`BEGIN … END`).
- Tablas InnoDB, utf8mb4 y `utf8mb4_0900_bin`, con las columnas en el orden del esquema de SQLite. Los VARCHAR se dimensionan con los validadores de `shared/` (la cabecera de la 005 explica cada uno).
- Nunca se borran datos: `ALTER TABLE`, tablas nuevas o copias completas.
- El DDL de MySQL se confirma solo: la migración se anota sin `applied_at` antes de empezar y se completa al final. Si se queda a medias, la aplicación lo explica y no continúa.
- Las categorías iniciales no están aquí: el servidor las siembra solo en una base nueva, nunca al importar, desde `shared/finance/categories.ts`.
- `app_locks` no son datos de la persona: sus filas (`finance`, `tickets`) las crea la migración y el importador no las copia.

## Trampas

- MySQL no admite un CHECK sobre una columna con `ON DELETE SET NULL` (`pantry_ticket_lines.item_id`); con `ON DELETE CASCADE` sí (`pantry_aliases`).
- `key` es palabra reservada: va entre comillas invertidas también en las consultas.
- Un `MEDIUMTEXT` no admite `DEFAULT '[]'` literal: se escribe `DEFAULT ('[]')`.
- Un DECIMAL con decimales de más se redondea sin error: los validadores (y el importador) lo impiden antes.

## Cómo añadir una migración

1. `migrations/006-<que-hace>.sql`, con un comentario que explique qué cambia y por qué no se pierde nada.
2. Una prueba en `server/common/mysql/migrations.test.ts` que parta de una base de la versión anterior con datos, y las restricciones nuevas en `server/common/mysql/schema.test.ts`.
3. El adaptador mysql del módulo dueño, `docs/base-de-datos.md` y el AGENTS.md del módulo.
4. Su huella en el test de migraciones publicadas.

## Cómo probar

`npx vitest run server/common/mysql` (necesita MySQL: README, «Pruebas»).
