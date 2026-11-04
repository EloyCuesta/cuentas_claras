---
paths:
  - "**/*.test.ts"
---
# Tests
- Junto al código que prueban, con su mismo nombre; títulos de `describe` e `it` en español.
- Nunca se borran ni se debilitan aserciones, y el número de tests no baja.
- Nunca tocan la base `cuentas_claras` ni `server/data/`: una base MySQL de pruebas (`openTestDatabase`, `startApi`), que borra `dropTestDatabases`, y datos inventados. Sin MySQL fallan con un mensaje claro: no se saltan.
- Reloj, ids y lector OCR falsos con `startApi({ clock, ids, ticketReader })`; sin esperas reales.
- Uno solo: `npx vitest run <ruta>` o `-t "nombre"`; y al final, `npm run check`.
- Detalle: docs/pruebas.md
