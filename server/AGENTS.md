# server/ — El servidor

> Lee antes: /AGENTS.md. Después, el AGENTS.md del módulo que vas a tocar y `docs/arquitectura.md`.

Node.js con Express 5 y mysql2, ejecutado con tsx (sin compilar). Es la API REST (`/api`) sobre una base de datos MySQL de este equipo (MySQL Server 8.4, la base `cuentas_claras`).

## Qué hay

| Ruta | Qué es |
| --- | --- |
| `server/index.ts` | Arranque: variables de entorno, comprueba el código antes de conectar con MySQL, prepara la base (migraciones), puerto y cierre ordenado (lector OCR y después las conexiones). |
| `server/app.ts` | Raíz de composición: crea los módulos y los monta en orden (públicos → `requireAdmin` → finanzas). |
| `server/common/` | Lo transversal, sin reglas de negocio: `server/common/errors.ts` (AppError), `server/common/ports.ts` (Clock, IdGenerator, UnitOfWork y LockName), `system.ts` (el reloj y los ids de verdad), `modules.ts`, `imageInfo.ts`, `server/common/http/` (sobre, errores y lectura de peticiones), `server/common/mysql/` (configuración, conexión, migraciones, errores y transacciones) y `server/common/testing/` (ayudantes de los tests). |
| `server/modules/` | Un módulo por área: `auth`, `finance`, `pantry`, `tickets` y `health`, cada uno con su AGENTS.md. |
| `server/data/` | `cuentas.db`, fuera de git: los datos de antes de MySQL, si los había. El servidor ya no lo abre; el importador (`tools/`) lee una copia. No se lee, no se abre en los tests y no se toca. |

El esquema de MySQL está en `database/mysql/` (su propio AGENTS.md): lo aplica `server/common/mysql/migrations.ts` al arrancar.

## Reglas que valen para todo el servidor

- Hexagonal: el router valida y llama a un caso de uso; el caso de uso decide; el adaptador guarda. Lo que se puede importar desde cada capa está en `docs/arquitectura.md`, y lo vigila `tests/architecture.test.ts`.
- Un módulo no importa el interior de otro: `server/app.ts` los conecta a través de su `index.ts` (tickets recibe `pantry.api` como PantryGateway).
- Todo lo que escribe es una transacción (`UnitOfWork.run`), **async**, con una sola conexión de principio a fin; las llamadas anidadas se unen a la de fuera. Los bloqueos van antes que cualquier lectura: la fila `finance` o `tickets` de `app_locks` (opción `lock`) y los productos que cambian (`lockItems`, `SELECT … FOR UPDATE` en orden de id). Detalle en `docs/arquitectura.md`.
- Respuestas siempre con el sobre `{ ok, data }` / `{ ok: false, error: { code, message } }` (`sendData` y `AppError`), con los mensajes en español (`docs/api.md`). Las restricciones de MySQL (1062, 1451, 1452, 3819 y 1048) son el 409 de siempre.
- Consultas SQL siempre con parámetros, también las listas `IN (...)`, y una sentencia por llamada.
- Sin un `CUENTAS_CODIGO` válido, el servidor no arranca ni conecta con MySQL, y `createApp` lanza.
- Importes en céntimos enteros, y fechas `AAAA-MM-DD`; la de hoy la manda el navegador. Fechas e instantes viajan como texto: nunca un `Date` como parámetro.
- El OCR es local y las imágenes no se guardan.

## Variables de entorno

`CUENTAS_CODIGO` (obligatoria), `CUENTAS_DB_HOST` (127.0.0.1), `CUENTAS_DB_PORT` (3306), `CUENTAS_DB_USER` (obligatoria), `CUENTAS_DB_PASSWORD`, `CUENTAS_DB_NAME` (cuentas_claras), `CUENTAS_PORT` (3001), `CUENTAS_HOST` (127.0.0.1) y `CUENTAS_TEST=1`, que solo arranca contra `cuentas_claras_e2e` o una base `cuentas_test_*`. Las explica el README; `CUENTAS_DB_PATH` ya no se usa (el servidor avisa si la encuentra).

## Cómo probar

Las pruebas necesitan un MySQL en marcha y las `CUENTAS_DB_*` de un usuario que pueda crear y borrar las bases `cuentas_test_%` (README, «Pruebas»). Sin él, fallan con un mensaje claro: no se saltan.

- `npx vitest run server`: todo el servidor.
- `npx vitest run server/modules/<módulo>`: un módulo.
- `server/app.test.ts`: la API compuesta (health, finanzas por HTTP y reset de pruebas).
- `server/index.test.ts`: el arranque de verdad, en otro proceso: sin usuario, MySQL caído, usuario rechazado, base inexistente, modo pruebas y ping.
- `server/migrationContracts.test.ts` y `server/common/http/response.test.ts`: contratos reproducibles y errores del host para la migración (formato y comandos en `docs/pruebas.md`).
- `server/common/mysql/`: conexión, migraciones, esquema y transacciones.

Los ayudantes están en `server/common/testing/` (bases `cuentas_test_*`, `startApi` y el proceso del servidor): ver `docs/pruebas.md`. Para arrancarlo a mano sin tocar tus datos, con una base de pruebas creada antes: `CUENTAS_CODIGO=prueba CUENTAS_DB_NAME=cuentas_test_mano CUENTAS_PORT=3201 npm run server`.

## Trampas

- `npm run dev:server` usa `tsx watch`: al cambiar un archivo del servidor se reinicia. Si tienes `npm run dev` abierto, ese servidor usa tus datos reales (la base `cuentas_claras`).
- El cuerpo JSON admite 30 MB en `/api/despensa/tickets/leer` y 20 MB en lo demás (`server/app.ts`).
- Con REPEATABLE READ, la primera lectura normal de una transacción fija lo que ve: un bloqueo tomado después no ve lo que otro confirmó antes. Por eso el bloqueo es lo primero.
- Ante un interbloqueo (1213), la UnitOfWork repite la operación completa una vez; los ids que pidió la primera vez se pierden.

## Si cambias algo aquí

El AGENTS.md del módulo, `docs/api.md` si cambian rutas o mensajes, `docs/arquitectura.md` si cambian las capas o la composición, y `docs/base-de-datos.md` y `database/mysql/AGENTS.md` si cambian las tablas.
