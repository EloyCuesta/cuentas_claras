---
paths:
  - "server/modules/*/adapters/sqlite/**"
---
# Adaptadores SQLite
- Consultas siempre con parámetros (`?`, `@nombre`), también las listas `IN (...)`; nunca datos concatenados en el SQL.
- Todo síncrono: nada de `async` dentro de una transacción. Las transacciones las abre el caso de uso con UnitOfWork, no el adaptador.
- Solo SQL y conversión de filas (snake_case ⇄ camelCase); las comprobaciones y los mensajes van en application/.
- Los errores de restricción se traducen a `AppError('CONFLICT', …)` con un mensaje en español.
- Cada tabla tiene un módulo dueño; las tablas nuevas, con una migración nueva.
- Detalle: docs/base-de-datos.md y docs/arquitectura.md
