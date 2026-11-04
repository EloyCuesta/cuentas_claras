# e2e/ — Pruebas en el navegador

> Lee antes: /AGENTS.md, `docs/pruebas.md` y el AGENTS.md de la feature que pruebas (sus textos y `data-testid`).

Pruebas de extremo a extremo con Playwright, en Chromium, en escritorio y en móvil (Pixel 7), con la app real: servidor, base MySQL y web construida.

## Qué hay

| Archivo | Qué prueba |
| --- | --- |
| `e2e/app.spec.ts` | Las finanzas, con sesión: primer gasto, validación, editar y borrar, pagar sin duplicar, vencimientos sin duplicar, copias, CSV, plantilla anual y migración del navegador |
| `e2e/despensa.spec.ts` | El invitado y la despensa: no ve finanzas, personas y productos, lista y WhatsApp, + y −, comprar y deshacer, copiar sin portapapeles, entrar y cerrar sesión, sesión caducada |
| `e2e/tickets.spec.ts` | Escanear un ticket con el OCR real, revisarlo y guardarlo, importes dudosos, «Dejar pendiente», lo que toca revisar días después y el repaso de la semana |
| `e2e/auth.ts` | `E2E_CODE`, `signIn` y `resetDatabase` |
| `e2e/prepareDatabase.ts` | Antes de arrancar el servidor de pruebas, crea la base `cuentas_claras_e2e` si falta (con las `CUENTAS_DB_*`) |
| `e2e/dotnet/auth.spec.ts` | Acceso React real contra .NET: código erróneo, cookie, recarga y cierre, en claro y oscuro |

La configuración está en `playwright.config.ts`, en la raíz.

El ensayo .NET usa `playwright.dotnet.config.ts` y la página aislada de `e2e/dotnet/`: monta AuthProvider, LoginDialog y SessionPanel sin FinanceProvider. La suite habitual lo excluye; Express sigue atendiendo las funcionalidades todavía pendientes de migrar.

## Reglas que no se rompen

- Servidor de pruebas propio (puerto 3101, base MySQL `cuentas_claras_e2e`, `CUENTAS_TEST=1` y su propio código) y web propia (puerto 4174). Nunca se reutiliza un servidor abierto: no tocan tus datos (la base `cuentas_claras`) ni tu `npm run dev`. Con `CUENTAS_TEST=1` el servidor no arranca contra otra base.
- Cada prueba de Express empieza con `resetDatabase` (POST /api/test/reset, que exige sesión). Las pruebas van de una en una porque comparten la base de datos.
- El ensayo .NET usa los puertos 3202 y 4175, código inventado, navegador nuevo por prueba y ningún almacenamiento. Su host no expone reset ni otros atajos; `/api/auth/me` comprueba disponibilidad mientras salud espera DATA-01.
- Se busca por rol, nombre y etiqueta (`getByRole`, `getByLabel`), y solo en tres casos por `data-testid`: `restore-input`, `ticket-input` y `ticket-check`.
- Sin atajos de autenticación: se inicia sesión como el formulario.
- Los tickets de prueba están en `fixtures/tickets/`; nunca se usan datos reales.

## Cómo ejecutar

- `npm run test:e2e`: todas. Necesita MySQL en marcha y las `CUENTAS_DB_*` de un usuario con permisos sobre `cuentas_claras_e2e` (README, «Pruebas»). Primero construye la web; tarda unos dos minutos.
- `npx playwright test e2e/tickets.spec.ts --project=escritorio`: un archivo y un proyecto.
- `CUENTAS_E2E_CHANNEL=chrome npm run test:e2e`: con el Chrome instalado, si no se puede descargar Chromium (`npx playwright install chromium`).
- `npm run test:e2e:dotnet`: los cuatro recorridos React/.NET, después de compilar la solución .NET. Acepta también CUENTAS_E2E_CHANNEL=chrome. Los comandos de compilación están en [pruebas](../docs/pruebas.md).

Las trazas de los fallos quedan en la carpeta test-results, fuera de git.

## Trampas

- Los puertos 3101 y 4174 tienen que estar libres.
- Si el servidor de pruebas no arranca (MySQL apagado, usuario o contraseña mal), Playwright enseña su mensaje en español, el mismo que daría `npm run server`.
- Para el ensayo .NET tienen que estar libres 3202 y 4175; tampoco se reutilizan servidores abiertos.
- `e2e/tickets.spec.ts` usa Tesseract de verdad: una lectura tarda unos segundos.
- La zona horaria es Europe/Madrid y el idioma es-ES (`playwright.config.ts`).
- Playwright transforma estos archivos al ejecutarlos; los tipos los comprueba `npm run typecheck` con `tsconfig.e2e.json`, que incluye la librería DOM porque el código de `page.evaluate` se ejecuta en el navegador.

## Si cambias algo aquí

Si una prueba busca un texto nuevo, añádelo a la sección «Textos y accesibilidad» del AGENTS.md de su feature. Si cambian los puertos o el arranque, `playwright.config.ts` y `docs/pruebas.md`.
