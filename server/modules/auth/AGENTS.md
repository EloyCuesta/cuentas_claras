# Módulo auth — Código de acceso

> Lee antes: /AGENTS.md y server/AGENTS.md. Depende de: nada (solo `server/common/`). Lo usan: `server/app.ts` (su router y `requireAdmin`) y `server/index.ts` (`checkAccessCode`, antes de abrir la base de datos).

## Qué hace
Las cuentas solo se ven con un código que pone el dueño en `CUENTAS_CODIGO`. Quien lo escribe abre una sesión de 12 horas en ese navegador; sin el código, solo se usa la Despensa. Tras 5 códigos incorrectos desde un mismo dispositivo, los intentos se bloquean 15 minutos.

## Acceso
Sus rutas son públicas: hay que poder entrar sin sesión. Lo que protege las finanzas es `requireAdmin`, que `server/app.ts` monta después de health, auth, despensa y tickets y antes de todo lo financiero.

## API pública (index.ts)
- `createAuthModule({ accessCode, clock })` → `{ router, requireAdmin }`. Lanza si el código no vale: nunca hay una aplicación con el acceso abierto.
- `checkAccessCode(value)`: lo usa `server/index.ts` para no arrancar sin código.
- `SESSION_MS`, `ATTEMPT_WINDOW_MS`, `LOCK_MS`, `MAX_FAILED_ATTEMPTS` y `MIN_CODE_LENGTH`, para los tests.

## Casos de uso y rutas
| Ruta | Caso de uso (archivo) | Cuerpo → respuesta | Errores |
| --- | --- | --- | --- |
| POST /api/auth/login | Login (`application/Login.ts`); después, Logout de la sesión anterior | `{ codigo }` → `{ rol: 'admin' }` y la cookie `cc_sesion` | 400 «Escribe el código de acceso.» (no cuenta como intento) · 401 «El código no es correcto.» · 429 con `Retry-After` |
| POST /api/auth/logout | Logout (`application/Logout.ts`) | nada → `null`, y borra la cookie | ninguno: siempre 200 |
| GET /api/auth/me | CheckSession (`application/CheckSession.ts`) | nada → `{ rol: 'admin' }` o `{ rol: 'invitado' }` | — |
| todas las financieras | CheckSession, desde `requireAdmin` | — | 401 «Hace falta el código de acceso para ver esta sección.» |

## Puertos
| Puerto | Para qué | Adaptador real | Falso en los tests |
| --- | --- | --- | --- |
| SessionStore | Sesiones abiertas: token → caducidad | `adapters/memory/InMemorySessionStore.ts` | el real (una instancia por aplicación) |
| AttemptStore | Fallos de cada IP | `adapters/memory/InMemoryAttemptStore.ts` | el real |
| CodeVerifier | Comparar con el código en tiempo constante | `adapters/crypto/Sha256CodeVerifier.ts` | — |
| TokenGenerator | Tokens de 64 caracteres hexadecimales | `adapters/crypto/RandomTokenGenerator.ts` | — |
| Clock (común) | Caducidad de sesiones y bloqueos | `server/common/system.ts` | `startApi({ clock: { nowMs } })` |

Las reglas puras están en `domain/accessCode.ts` (qué código vale) y `domain/accessPolicy.ts` (12 h, 5 fallos, 15 min).

## Reglas que no se rompen
- Sin un `CUENTAS_CODIGO` válido (al menos 4 caracteres, no solo espacios, como mucho 200) el servidor no arranca ni abre la base de datos, y `createApp` lanza.
- Cookie `cc_sesion` con `HttpOnly; SameSite=Strict; Path=/api` y `Max-Age` de 12 h, sin `Secure`: la app va por HTTP en la red de casa.
- Las sesiones viven en memoria: reiniciar el servidor obliga a escribir otra vez el código.
- 5 fallos desde la misma IP → 429 durante 15 minutos, aunque el código sea correcto. Sin bloqueo, los fallos se olvidan a los 15 minutos del primero, y un acierto pone la cuenta a cero.
- La IP es `req.ip` con `trust proxy` solo para `loopback`: una cabecera `X-Forwarded-For` inventada no elude el bloqueo.
- El código nunca se guarda ni se devuelve: solo su hash SHA-256, en memoria.

## Datos
Ninguna tabla: sesiones e intentos viven en memoria.

## Pruebas
`auth.test.ts`, por HTTP con `startApi`: qué código vale, arranque sin código (lanza `server/index.ts` de verdad), las 13 rutas financieras sin sesión, la cookie, la caducidad, cerrar sesión, el reinicio y el límite de intentos con un reloj controlado (sin esperar minutos). Solo estas: `npx vitest run server/modules/auth`.

## Trampas y decisiones
- Login mira el bloqueo antes que el código: con el bloqueo activo, el código correcto también da 429.
- El router valida el cuerpo antes de llamar a Login, así que un cuerpo mal formado no cuenta como intento.
- CheckSession borra la sesión caducada al consultarla; Login purga las caducadas cuando abre una nueva.
- Un solo código para toda la casa, sin usuarios: ver `docs/decisiones.md`.

## Si cambias este módulo
- Rutas o mensajes: `docs/api.md` y la web (`src/features/auth/`).
- Duración de la sesión o del bloqueo: el README (Código de acceso) y estos tests.
- Una ruta financiera nueva (en otro módulo) va detrás de `requireAdmin` y se añade a `FINANCE_ROUTES` en `auth.test.ts`.
