# API

Todas las rutas están bajo `/api`. La web solo habla con el servidor a través de `src/api/client.ts` y del cliente de cada feature. El detalle de cada ruta (cuerpo, respuesta y errores) está en el AGENTS.md de su módulo; aquí, lo común y el índice.

## El sobre

Todas las respuestas tienen el mismo formato (`server/common/http/response.ts`):

- Si todo va bien: `{ "ok": true, "data": … }`.
- Si hay un error: `{ "ok": false, "error": { "code": "…", "message": "…" } }`, con el mensaje en español, listo para enseñarlo a la persona.

Todas llevan `Cache-Control: no-store`: ni la sesión ni los datos se quedan en una caché.

## Códigos de error

| Código | Estado HTTP | Cuándo |
| --- | --- | --- |
| `VALIDATION` | 400 | Datos no válidos, cuerpo que no es JSON, o una imagen de ticket que no se puede leer |
| `VALIDATION` | 413 | Cuerpo demasiado grande: más de 30 MB en `/api/despensa/tickets/leer` o de 20 MB en lo demás |
| `UNAUTHORIZED` | 401 | Ruta financiera sin sesión, o código incorrecto |
| `NOT_FOUND` | 404 | Ruta o dato que no existe |
| `CONFLICT` | 409 | Vencimiento duplicado, categoría en uso, importación con datos ya existentes, persona con productos, ticket ya guardado o «Deshacer» tras otro cambio. También cualquier restricción de la base de datos que salte («Los datos no encajan con los que ya están guardados…») |
| `TOO_MANY_ATTEMPTS` | 429 | Demasiados códigos incorrectos desde este dispositivo (con `Retry-After`) |
| `INTERNAL` | 500 | Error inesperado; el detalle sale en la consola del servidor |

Los casos de uso lanzan `AppError(código, mensaje)` (`server/common/errors.ts`) y `errorHandler` lo convierte en la respuesta.

## Acceso

- **Públicas** (cualquiera de casa, sin código): salud, acceso, despensa y tickets.
- **Con sesión**: todo lo financiero. `requireAdmin` (módulo auth) se monta en `server/app.ts` después de las públicas. Sin sesión, cualquier ruta que venga detrás (también una que no exista) responde 401.
- La sesión es una cookie `cc_sesion` (`HttpOnly; SameSite=Strict; Path=/api`, 12 horas) con un token aleatorio. Las sesiones viven en memoria: reiniciar el servidor las borra.
- Tras 5 códigos incorrectos desde la misma IP, 429 durante 15 minutos. La IP es la que da Express con `trust proxy` solo para `loopback` (el proxy de Vite del propio equipo).
- `POST /api/test/reset` solo existe con `CUENTAS_TEST=1` (las pruebas en navegador) y también exige sesión.

## Índice de rutas

| Método y ruta | Qué hace | Módulo |
| --- | --- | --- |
| GET /api/health | Estado y versión del esquema (sin datos ni rutas de archivos) | health |
| POST /api/auth/login | `{ codigo }` → `{ rol: 'admin' }` y la cookie | auth |
| POST /api/auth/logout | Cierra la sesión de este navegador (siempre 200) | auth |
| GET /api/auth/me | `{ rol: 'admin' }` o `{ rol: 'invitado' }` | auth |
| GET, POST /api/despensa/personas | Lista o crea una persona (201) | pantry |
| PUT, DELETE /api/despensa/personas/:id | Renombra o borra (409 si tiene productos) | pantry |
| GET, POST /api/despensa/productos | Lista o crea un producto (201; el servidor pone id, versión y fechas; `tracking` es `cantidad` si no se indica) | pantry |
| PUT, DELETE /api/despensa/productos/:id | Edita o borra un producto | pantry |
| POST /api/despensa/productos/:id/ajustar | `{ delta }`: botones + y − sobre el valor actual | pantry |
| POST /api/despensa/productos/:id/revision | `{ kind, date }`, con `kind` = `queda`, `poco`, `se_acabo` o `comprado` (201) | pantry |
| DELETE /api/despensa/revisiones/:id | Deshace una revisión | pantry |
| GET, PUT /api/despensa/presupuesto | GET da `{ monthlyBudgetCents, lastReviewDate }`; PUT recibe `{ monthlyBudgetCents }` (número o `null`) | pantry |
| PUT /api/despensa/repaso | `{ date }`: apunta el día del repaso de la semana | pantry |
| POST /api/despensa/comprado | `{ ids, date }` → `{ changes, items }` | pantry |
| POST /api/despensa/comprado/deshacer | `{ changes }` → los productos, o 409 si algo cambió después | pantry |
| POST /api/despensa/tickets/leer | `{ imagenes }` (PNG o JPEG, hasta 6 de 8 MB), `{ franjas }` (hasta 24, las que prepara la web) o `{ texto }`, y `{ hoy }` → el ticket leído, lo que se propone y si ya estaba guardado. No guarda nada | tickets |
| GET, POST /api/despensa/tickets | Lista los tickets o guarda uno revisado (201; 409 si ya estaba guardado) | tickets |
| GET, DELETE /api/despensa/tickets/:id | Un ticket con sus líneas, o borrarlo | tickets |
| PUT /api/despensa/tickets/:id/lineas/:lineId | `{ itemId }` (o `null`): cambia el producto de esa línea y de las iguales, y lo aprendido | tickets |
| GET /api/despensa/actividad?hoy= | Compras y revisiones de los últimos 400 días, para el ritmo de compra | tickets |
| GET, PUT /api/data | Todos los datos financieros; PUT los sustituye (restaurar una copia, validada entera antes de tocar nada) | finance |
| PUT, DELETE /api/movements/:id | Crea o actualiza un movimiento; lo elimina (si era un vencimiento, no se vuelve a crear) | finance |
| PUT /api/categories/:id | Crea o actualiza una categoría | finance |
| DELETE /api/categories/:id?replacementId= | Elimina una categoría; sus movimientos pasan a otra | finance |
| PUT /api/recurring/:id | `{ rule, horizon, markPaidBefore }` → `{ created }` | finance |
| DELETE /api/recurring/:id | Elimina un recurrente y sus vencimientos pendientes | finance |
| POST /api/occurrences/generate | Crea los vencimientos que falten hasta `{ horizon }` → `{ created }` | finance |
| GET, PUT /api/meta/:key | Datos auxiliares (`lastBackupAt`) | finance |
| POST /api/import | Importa los datos del navegador (201), o 409 si ya hay datos | finance |
| POST /api/test/reset | Vacía la base de datos de pruebas (solo con `CUENTAS_TEST=1`) | `server/common/http/testingRoutes.ts` |

El detalle está en `server/modules/health/AGENTS.md`, `server/modules/auth/AGENTS.md`, `server/modules/pantry/AGENTS.md`, `server/modules/tickets/AGENTS.md` y `server/modules/finance/AGENTS.md`.

## Variables de entorno

Están en el README, en «Cómo ejecutarla». La web usa `CUENTAS_API_URL` (por defecto `http://127.0.0.1:3001`) para saber adónde envía Vite las peticiones a `/api`.
