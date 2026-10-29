# Módulo health — Estado del servidor

> Lee antes: /AGENTS.md y server/AGENTS.md. Depende de: nada (solo `server/common/`). Lo usan: `server/app.ts`, Playwright (espera a que responda antes de las pruebas e2e) y quien comprueba a mano que el servidor funciona.

## Qué hace
Responde si el servidor está en marcha y la base de datos se puede consultar, con la versión del esquema. Es el único módulo sin casos de uso: un router y nada más.

## Acceso
Público y sin datos: no dice dónde está el archivo de la base de datos ni nada de lo guardado.

## API pública (index.ts)
- `createHealthModule({ database })` → `{ router }`.

## Casos de uso y rutas
| Ruta | Caso de uso (archivo) | Cuerpo → respuesta | Errores |
| --- | --- | --- | --- |
| GET /api/health | ninguno: `adapters/http/routes.ts` ejecuta `SELECT 1` | nada → `{ status: 'ok', schemaVersion }` | 500 si la base de datos no responde |

## Puertos
Ninguno. `index.ts` prepara el `SELECT 1` una vez y se lo pasa al router como `ping`.

## Reglas que no se rompen
- Nunca devuelve rutas de archivos ni datos.
- `schemaVersion` es la última migración aplicada (`LATEST_VERSION` en `server/migrations/index.ts`).

## Datos
Solo lee: `SELECT 1`, sin tocar ninguna tabla.

## Pruebas
«GET /api/health responde con el estado, sin revelar datos», en `server/app.test.ts`. Las e2e lo usan para saber cuándo ha arrancado el servidor de pruebas (`playwright.config.ts`).

## Trampas y decisiones
- Si cambias la forma de la respuesta, Playwright solo mira que responda 200, pero `server/app.test.ts` compara el cuerpo entero.

## Si cambias este módulo
- `docs/api.md` y el README (Cómo ejecutarla, que dice cómo comprobar que el servidor funciona).
