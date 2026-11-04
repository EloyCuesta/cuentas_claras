---
paths:
  - "server/modules/*/adapters/mysql/**"
  - "server/common/mysql/**"
---
# Adaptadores MySQL
- Consultas siempre con parámetros (`?`), también las listas `IN (...)`; nunca datos concatenados en el SQL. Parámetros: texto, números o null; nunca un `Date`.
- Todo async, y sin transacciones propias: las abre el caso de uso con `unitOfWork.run` (y su bloqueo), no el adaptador. Dentro de una transacción, `db.rows` y `db.run` ya usan su conexión.
- Una sentencia por llamada: nada de `DELETE …; DELETE …;`, ni `sqlite_master` ni `pragma`.
- `key` va entre comillas invertidas; «IS ?» es `<=>`.
- `INSERT OR IGNORE` es `INSERT … ON DUPLICATE KEY UPDATE` sobre su propia clave, nunca `INSERT IGNORE` (se traga los fallos de clave foránea). `ON DUPLICATE KEY UPDATE` solo en tablas sin otra clave única: en `movements`, actualizar por id y, si no había, insertar.
- Una consulta de varias filas, o de la primera de varias, lleva un ORDER BY completo: MySQL no garantiza el orden de un GROUP BY.
- Solo SQL y conversión de filas (snake_case ⇄ camelCase); las comprobaciones y los mensajes van en application/.
- Los errores de restricción (1062, 1451, 1452, 3819, 1048) llegan como el 409 genérico; si un caso tiene su propio mensaje, se traduce a `AppError('CONFLICT', …)` mirando la clave (`duplicateKeyName`).
- Cada tabla tiene un módulo dueño; las tablas nuevas, con una migración nueva en `database/mysql/migrations/`.
- Detalle: docs/base-de-datos.md, docs/arquitectura.md y database/mysql/AGENTS.md
