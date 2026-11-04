---
paths:
  - "server/modules/*/application/**"
  - "server/modules/*/domain/**"
---
# Casos de uso y dominio del servidor
- Un caso de uso por archivo, clase PascalCase (verbo + nombre) con `execute`; las lecturas, juntas en `queries.ts`.
- Campos declarados y asignados en el constructor: nada de `constructor(private readonly …)`.
- Solo importa su domain/, su application/, `shared/`, `server/common/errors.ts` y `server/common/ports.ts`. Nada de Express, mysql2, tesseract.js, `node:*`, `Buffer` ni `process`.
- Lo que escribe va dentro de `unitOfWork.run(async () => …)`: async, con `await` en cada llamada a un puerto y una sola conexión. Las anidadas se unen a la de fuera.
- El bloqueo va antes que cualquier lectura: `{ lock: 'finance' }` en lo que escribe finanzas, `{ lock: 'tickets' }` en guardar, reasociar y borrar tickets, y `lockItems(ids)` (FOR UPDATE, en orden de id) antes de leer los productos que se van a cambiar. El OCR, fuera de la transacción.
- Mismo orden de comprobaciones y mismos mensajes que comprueban los tests.
- Un caso de uso nuevo va en la tabla del AGENTS.md del módulo.
- Detalle: docs/arquitectura.md
