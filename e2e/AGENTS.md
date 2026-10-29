# e2e/ — Pruebas en el navegador

> Lee antes: /AGENTS.md, `docs/pruebas.md` y el AGENTS.md de la feature que pruebas (sus textos y `data-testid`).

Pruebas de extremo a extremo con Playwright, en Chromium, en escritorio y en móvil (Pixel 7), con la app real: servidor, base de datos y web construida.

## Qué hay

| Archivo | Qué prueba |
| --- | --- |
| `e2e/app.spec.ts` | Las finanzas, con sesión: primer gasto, validación, editar y borrar, pagar sin duplicar, vencimientos sin duplicar, copias, CSV, plantilla anual y migración del navegador |
| `e2e/despensa.spec.ts` | El invitado y la despensa: no ve finanzas, personas y productos, lista y WhatsApp, + y −, comprar y deshacer, copiar sin portapapeles, entrar y cerrar sesión, sesión caducada |
| `e2e/tickets.spec.ts` | Escanear un ticket con el OCR real, revisarlo y guardarlo, importes dudosos, «Dejar pendiente», lo que toca revisar días después y el repaso de la semana |
| `e2e/auth.ts` | `E2E_CODE`, `signIn` y `resetDatabase` |

La configuración está en `playwright.config.ts`, en la raíz.

## Reglas que no se rompen

- Servidor de pruebas propio (puerto 3101, base de datos en la carpeta temporal del sistema, `CUENTAS_TEST=1` y su propio código) y web propia (puerto 4174). Nunca se reutiliza un servidor abierto: no tocan tus datos ni tu `npm run dev`.
- Cada prueba empieza con `resetDatabase` (POST /api/test/reset, que exige sesión). Las pruebas van de una en una porque comparten la base de datos.
- Se busca por rol, nombre y etiqueta (`getByRole`, `getByLabel`), y solo en tres casos por `data-testid`: `restore-input`, `ticket-input` y `ticket-check`.
- Sin atajos de autenticación: se inicia sesión como el formulario.
- Los tickets de prueba están en `fixtures/tickets/`; nunca se usan datos reales.

## Cómo ejecutar

- `npm run test:e2e`: todas. Primero construye la web; tarda alrededor de un minuto.
- `npx playwright test e2e/tickets.spec.ts --project=escritorio`: un archivo y un proyecto.
- `CUENTAS_E2E_CHANNEL=chrome npm run test:e2e`: con el Chrome instalado, si no se puede descargar Chromium (`npx playwright install chromium`).

Las trazas de los fallos quedan en la carpeta test-results, fuera de git.

## Trampas

- Los puertos 3101 y 4174 tienen que estar libres.
- `e2e/tickets.spec.ts` usa Tesseract de verdad: una lectura tarda unos segundos.
- La zona horaria es Europe/Madrid y el idioma es-ES (`playwright.config.ts`).
- Estos archivos no los comprueba `tsc -b`: los transforma Playwright al ejecutarlos.

## Si cambias algo aquí

Si una prueba busca un texto nuevo, añádelo a la sección «Textos y accesibilidad» del AGENTS.md de su feature. Si cambian los puertos o el arranque, `playwright.config.ts` y `docs/pruebas.md`.
