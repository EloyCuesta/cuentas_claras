---
paths:
  - "server/modules/*/application/**"
  - "server/modules/*/domain/**"
---
# Casos de uso y dominio del servidor
- Un caso de uso por archivo, clase PascalCase (verbo + nombre) con `execute`; las lecturas, juntas en `queries.ts`.
- Campos declarados y asignados en el constructor: nada de `constructor(private readonly …)`.
- Solo importa su domain/, su application/, `shared/`, `server/common/errors.ts` y `server/common/ports.ts`. Nada de Express, better-sqlite3, tesseract.js, `node:*`, `Buffer` ni `process`.
- Lo que escribe va dentro de `unitOfWork.run(...)`, síncrono. Solo el OCR es async.
- Mismo orden de comprobaciones y mismos mensajes que comprueban los tests.
- Un caso de uso nuevo va en la tabla del AGENTS.md del módulo.
- Detalle: docs/arquitectura.md
