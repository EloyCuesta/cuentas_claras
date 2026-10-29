# server/ — El servidor

> Lee antes: /AGENTS.md. Después, el AGENTS.md del módulo que vas a tocar y `docs/arquitectura.md`.

Node.js con Express 5 y better-sqlite3, ejecutado con tsx (sin compilar). Es la API REST (`/api`) sobre una base de datos SQLite de este equipo.

## Qué hay

| Ruta | Qué es |
| --- | --- |
| `server/index.ts` | Arranque: variables de entorno, comprueba el código antes de abrir la base de datos, puerto y cierre ordenado (lector OCR y después la base de datos). |
| `server/app.ts` | Raíz de composición: crea los módulos y los monta en orden (públicos → `requireAdmin` → finanzas). |
| `server/common/` | Lo transversal, sin reglas de negocio: `server/common/errors.ts` (AppError), `server/common/ports.ts` (Clock, IdGenerator y UnitOfWork), `system.ts` (el reloj y los ids de verdad), `modules.ts`, `imageInfo.ts`, `server/common/http/` (sobre, errores y lectura de peticiones), `server/common/sqlite/` (abrir la base de datos y transacciones) y `server/common/testing/` (ayudantes de los tests). |
| `server/migrations/` | Las migraciones de la base de datos (su propio AGENTS.md). |
| `server/modules/` | Un módulo por área: `auth`, `finance`, `pantry`, `tickets` y `health`, cada uno con su AGENTS.md. |
| `server/data/` | `cuentas.db`, fuera de git: los datos de la persona. No se lee, no se abre en los tests y no se toca. |

## Reglas que valen para todo el servidor

- Hexagonal: el router valida y llama a un caso de uso; el caso de uso decide; el adaptador guarda. Lo que se puede importar desde cada capa está en `docs/arquitectura.md`, y lo vigila `tests/architecture.test.ts`.
- Un módulo no importa el interior de otro: `server/app.ts` los conecta a través de su `index.ts` (tickets recibe `pantry.api` como PantryGateway).
- Todo lo que escribe es una transacción (`UnitOfWork.run`), y es **síncrono**: nada de `async` dentro de una transacción.
- Respuestas siempre con el sobre `{ ok, data }` / `{ ok: false, error: { code, message } }` (`sendData` y `AppError`), con los mensajes en español (`docs/api.md`).
- Consultas SQL siempre con parámetros, también las listas `IN (...)`.
- Sin un `CUENTAS_CODIGO` válido, el servidor no arranca ni abre la base de datos, y `createApp` lanza.
- Importes en céntimos enteros, y fechas `AAAA-MM-DD`; la de hoy la manda el navegador.
- El OCR es local y las imágenes no se guardan.

## Variables de entorno

`CUENTAS_CODIGO` (obligatoria), `CUENTAS_DB_PATH`, `CUENTAS_PORT` (3001), `CUENTAS_HOST` (127.0.0.1) y `CUENTAS_TEST=1`. Las explica el README.

## Cómo probar

- `npx vitest run server`: todo el servidor.
- `npx vitest run server/modules/<módulo>`: un módulo.
- `server/app.test.ts`: la API compuesta (health, finanzas por HTTP y reset de pruebas).

Los ayudantes están en `server/common/testing/` (base de datos temporal y `startApi`): ver `docs/pruebas.md`. Para arrancarlo a mano sin tocar tus datos: `CUENTAS_CODIGO=prueba CUENTAS_DB_PATH=<carpeta temporal>/cuentas.db CUENTAS_PORT=3201 npm run server`.

## Trampas

- `DEFAULT_DB_PATH` se calcula desde `server/common/sqlite/openDatabase.ts` con `import.meta.url`. Si mueves ese archivo, el test de la ruta por defecto te avisará.
- `npm run dev:server` usa `tsx watch`: al cambiar un archivo del servidor se reinicia. Si tienes `npm run dev` abierto, ese servidor usa tus datos reales.
- El cuerpo JSON admite 30 MB en `/api/despensa/tickets/leer` y 20 MB en lo demás (`server/app.ts`).

## Si cambias algo aquí

El AGENTS.md del módulo, `docs/api.md` si cambian rutas o mensajes, `docs/arquitectura.md` si cambian las capas o la composición, y `docs/base-de-datos.md` si cambian las tablas.
