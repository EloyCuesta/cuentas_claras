# Módulo health — Estado del servidor

> Lee antes: /AGENTS.md y server/AGENTS.md. Depende de: nada (solo `server/common/`). Lo usan: `server/app.ts`, Playwright (espera a que responda antes de las pruebas e2e) y quien comprueba a mano que el servidor funciona.

## Qué hace
Responde si el servidor está en marcha y MySQL contesta a un ping, con la versión del esquema. Es el único módulo sin casos de uso: un router y nada más.

## Acceso
Público y sin datos: no dice a qué servidor ni a qué base de MySQL se conecta, ni nada de lo guardado.

## API pública (index.ts)
- `createHealthModule({ database })` → `{ router }`.

## Casos de uso y rutas
| Ruta | Caso de uso (archivo) | Cuerpo → respuesta | Errores |
| --- | --- | --- | --- |
| GET /api/health | ninguno: `adapters/http/routes.ts` hace ping a MySQL (`SELECT 1`) | nada → `{ status: 'ok', schemaVersion }` | 500 si MySQL no responde |

## Puertos
Ninguno. `index.ts` le pasa al router `ping` (`MysqlDatabase.ping`, en `server/common/mysql/MysqlDatabase.ts`) y la versión del esquema.

## Reglas que no se rompen
- Nunca devuelve servidores, nombres de bases ni datos.
- `schemaVersion` es la última migración aplicada de MySQL (`LATEST_VERSION` en `server/common/mysql/migrations.ts`): 5, como la última de SQLite.

## Datos
Solo lee: `SELECT 1`, sin tocar ninguna tabla.

## Pruebas
«GET /api/health responde con el estado, sin revelar datos», en `server/app.test.ts`, y el arranque de verdad con ping a MySQL, en `server/index.test.ts`. Las e2e lo usan para saber cuándo ha arrancado el servidor de pruebas (`playwright.config.ts`).

## Trampas y decisiones
- Si cambias la forma de la respuesta, Playwright solo mira que responda 200, pero `server/app.test.ts` compara el cuerpo entero.

## Si cambias este módulo
- `docs/api.md` y el README (Cómo ejecutarla, que dice cómo comprobar que el servidor funciona).
