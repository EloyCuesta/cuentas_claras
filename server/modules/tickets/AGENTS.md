# Módulo tickets — Tickets de la compra

> Lee antes: /AGENTS.md, server/AGENTS.md y el AGENTS.md del módulo pantry, del que depende. Depende de: pantry, a través de su PantryGateway (`server/app.ts` le pasa `pantry.api`). Lo usan: solo `server/app.ts`.

## Qué hace
Lee un ticket (captura, foto o texto pegado) con OCR en este equipo, propone qué producto es cada línea y si ya estaba guardado, y lo guarda una vez revisado. Además aprende lo que es cada nombre en cada tienda y da el historial de compras para el ritmo de la despensa.

## Acceso
Público, como la despensa: lo usa cualquiera de casa. No guarda imágenes ni toca las finanzas.

## API pública (index.ts)
- `createTicketsModule({ ...deps, pantry, reader })` → `{ router, reset }`.
- `createTesseractReader()`: el lector real. Lo crea `server/index.ts` para poder cerrarlo al apagar.
- Los tipos TicketReader y PantryGateway, para los tests y para `server/app.ts`.

## Casos de uso y rutas
Todas bajo /api/despensa.

| Ruta | Caso de uso (archivo) | Cuerpo → respuesta | Errores |
| --- | --- | --- | --- |
| POST /tickets/leer | ReadTicket (`application/ReadTicket.ts`); la petición la valida `adapters/http/readTicketRequest.ts` | `{ imagenes }`, `{ franjas }` o `{ texto }`, y `{ hoy }` → TicketDraft (no guarda nada) | 400: sin imágenes, demasiadas, no PNG/JPEG, demasiado grandes, franjas desordenadas, texto vacío, OCR fallido o «ningún producto» |
| POST /tickets | SaveTicket | TicketSaveInput → 201 `{ ticket, items }` | 400 (decisiones, productos que no existen) · 409 ya guardado o posible duplicado sin confirmar |
| GET /tickets | `application/queries.ts` (listTickets) | → los últimos 100 (resumen) | — |
| GET /tickets/:id | `application/queries.ts` (getTicket) | → el ticket con sus líneas | 404 |
| PUT /tickets/:id/lineas/:lineId | SetLineItem | `{ itemId }` o `{ itemId: null }` → el ticket | 400 producto que no existe · 404 |
| DELETE /tickets/:id | DeleteTicket | → `null` | 404 |
| GET /actividad?hoy= | `application/queries.ts` (activity) | → `{ purchases, events }` de los últimos 400 días | — |

Qué es un duplicado está en `application/duplicates.ts`, y la identidad de un ticket, en `domain/ticketIdentity.ts`.

## Puertos
| Puerto | Para qué | Adaptador real | Falso en los tests |
| --- | --- | --- | --- |
| TicketRepository | Tickets, líneas y lo aprendido | `adapters/sqlite/SqliteTicketRepository.ts` | SQLite temporal (`startApi`) |
| TicketReader | OCR de las imágenes | `adapters/tesseract/TesseractTicketReader.ts` | `fakeReader()` en `tickets.test.ts`; sin imágenes, el `unusedReader` de `startApi` |
| PantryGateway | Productos y revisiones de la despensa | la API pública del módulo pantry | el módulo pantry de verdad |
| Hasher | SHA-256 de las huellas | `adapters/crypto/Sha256Hasher.ts` | el real |
| Clock, IdGenerator, UnitOfWork (comunes) | Fechas, ids e `importId`, transacciones inmediatas | `server/common/` | el real |

## Reglas que no se rompen
- Guardar es todo o nada, en una transacción inmediata: crea los productos nuevos, lo aprendido y las líneas, y actualiza los productos. Lo hace con PantryGateway, en transacciones anidadas.
- Un ticket no se guarda dos veces (409). Lo impiden la misma lectura (`importId`), el mismo origen (huella del texto o de las imágenes), la misma huella de contenido o, en los antiguos, el mismo contenido. Las huellas no pueden cambiar: hay un test golden.
- Solo las líneas fiables (`canApplyLine`) crean productos, cambian precios y cantidades, enseñan lo aprendido y cuentan para el ritmo. Las dudosas se guardan pendientes, con lo que leyó el OCR.
- Un producto nuevo por nombre y persona, aunque venga en varias líneas.
- El total del ticket nunca decide un importe (lo hace `shared/tickets/`).
- El OCR es local: tesseract.js con el modelo de español de node_modules, y nada sale a Internet. Las imágenes no se guardan.
- Límites del cuerpo: 30 MB para `/tickets/leer` (`server/app.ts`). Cada imagen hasta 8 MB, 20 MB en total, 6 imágenes o 24 franjas.

## Datos
- `pantry_tickets`: la huella es única. También guarda `import_id` y `source_fingerprint`, sin imágenes.
- `pantry_ticket_lines`: se borran con su ticket, y quedan sin producto si se borra el producto.
- `pantry_aliases`: lo aprendido, por tienda y nombre normalizado; se borra con su producto.

Vienen de las migraciones 003 y 005: ver `docs/base-de-datos.md`.

## Pruebas
`tickets.test.ts`:
- el OCR real con dos tickets inventados (`fixtures/tickets/`);
- la API con un lector falso: leer, guardar, duplicados, decisiones, pendientes, cambiar una línea, borrar y actividad;
- las huellas golden.

La lectura de las líneas se prueba en `shared/tickets/`. Solo estas: `npx vitest run server/modules/tickets`; sin OCR real, añade `-t "API de tickets"`.

## Trampas y decisiones
- Qué líneas cuentan para el ritmo (con producto, verificadas y no «para una ocasión») se filtra en el SQL de `purchaseLinesSince`, para no leer todas las líneas. Las devoluciones y la agrupación por ticket y producto están en `domain/purchaseHistory.ts`.
- `findDuplicate` devuelve el ticket entero (con líneas) cuando lo encuentra comparando contenido, y solo el resumen en los demás casos. Así era antes y la web lo acepta.
- `imageInfo` está en `server/common/imageInfo.ts` porque lo usan dos adaptadores: HTTP para validar y Tesseract para medir.
- Por qué el OCR es local y por compras en lugar de inventario: ver `docs/decisiones.md`.

## Si cambias este módulo
- Rutas o mensajes: `docs/api.md`, la web (`src/features/tickets/` y el `api.ts` de `src/features/pantry/`) y `e2e/tickets.spec.ts`.
- Lo que usa de la despensa: PantryGateway y la API pública de pantry, a la vez.
- La huella: no la cambies; si no queda más remedio, hace falta una migración que recalcule las guardadas.
