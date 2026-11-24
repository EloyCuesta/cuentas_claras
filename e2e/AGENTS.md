# e2e/ — Pruebas en el navegador

> Lee antes: /AGENTS.md, `docs/pruebas.md` y el AGENTS.md de la feature que pruebas (sus textos y `data-testid`).

Pruebas de extremo a extremo con Playwright, en Chromium, en escritorio y en móvil (Pixel 7), con la app real: servidor, base MySQL y web construida.

## Qué hay

| Archivo | Qué prueba |
| --- | --- |
| `e2e/app.spec.ts` | Las finanzas, con sesión: primer gasto, un gasto en tres toques (la tecla «n», el tipo sin perder el foco, Intro, «Más usadas», «Hoy» y «Ayer», la fecha futura y «Guardar y añadir otro»), el móvil (cinco pestañas enteras también en 360 px, «N vencidos» lleva a lo pendiente, los avisos abajo encima de «Añadir» y Presupuestos desde el Resumen), «Deshacer» tras marcar un pago, validación, una fecha prevista a medio escribir, guardado con la relectura fallida y reintento tras perder la respuesta (sin duplicar), categorías (crear, renombrar, borrar y pasar sus movimientos a otra), editar y borrar, pagar sin duplicar, vencimientos sin duplicar, copias, CSV, plantilla anual y migración del navegador |
| `e2e/despensa.spec.ts` | El invitado y la despensa: no ve finanzas, personas y productos, lista y WhatsApp, el buscador (sin tildes, + desde el resultado, sin resultados), los bloques vacíos que no salen y la persona que se recuerda al recargar, borrar una persona y quitar el presupuesto con confirmación, + y −, + tres veces seguidas (al momento, y un + que falla se deshace), comprar y deshacer, volver a la Despensa sin «Cargando…», dos móviles con + a la vez (otro contexto del navegador; el servidor suma los dos), dos móviles editando el mismo producto (el segundo recibe el conflicto, conserva lo escrito y lo vuelve a cargar), copiar sin portapapeles, entrar y cerrar sesión, sesión caducada |
| `e2e/tickets.spec.ts` | Escanear un ticket con el OCR real, revisarlo y guardarlo, el aviso antes de leer de las capturas que no se pueden unir, una foto de 24 MP girada con el límite de lienzo de Safari emulado, importes dudosos, una línea emparejada por parecido (y el foco al resolverla), «Dejar pendiente», una fecha a medio escribir y los errores de la cabecera en la revisión, lo que toca revisar días después y el repaso de la semana |
| `e2e/capturas-tickets.spec.ts` | No es una prueba: capturas de la lectura de un ticket (elegir, leyendo, la revisión pantalla a pantalla y la primera línea dudosa), en claro y oscuro, para comparar antes y después. Se salta (2 por proyecto) sin CUENTAS_CAPTURAS_DIR, la carpeta fuera de git donde se guardan |
| `e2e/medidas-interfaz.spec.ts` | No es una prueba: las medidas de la interfaz (capturas de cada pantalla y diálogo en claro y oscuro, toques de cada tarea, peticiones y tiempos, JS y CSS al abrir, objetivos de menos de 44 px y, en el móvil, la barra inferior), para la línea base y el cierre de [terminar-el-proyecto.md](../docs/terminar-el-proyecto.md). Se salta (1 por proyecto) sin CUENTAS_MEDIDAS_DIR (por ejemplo, .medidas-interfaz, fuera de git) |
| `e2e/auth.ts` | `E2E_CODE`, `signIn` y `resetDatabase` (contra Express, POST /api/test/reset; contra .NET, SQL directo) |
| `e2e/test.ts` | El `test` de las pruebas de la app (el mismo contra los dos backends), `againstDotnet()` y `newPhone(browser)`, que abre otro móvil (otro contexto) en español y con la hora de Madrid |
| `e2e/prepareDatabase.ts` | Antes de arrancar el servidor de pruebas, crea la base `cuentas_claras_e2e` si falta (con las `CUENTAS_DB_*`) |
| `e2e/dotnet/auth.spec.ts` | Acceso React real contra .NET: código erróneo, cookie, recarga y cierre, en claro y oscuro |
| `e2e/dotnet/database.ts` | La base de la app contra .NET (`cuentas_test_e2e_dotnet`): crearla, vaciarla como el reinicio de Express y borrarla |

La configuración está en `playwright.config.ts`, en la raíz.

El ensayo .NET usa `playwright.dotnet.config.ts`, en dos partes. Los proyectos acceso-* usan la página aislada de `e2e/dotnet/` (AuthProvider, LoginDialog y SessionPanel sin FinanceProvider) contra el host sin base de datos. Los proyectos app-* ejecutan todos los `e2e/*.spec.ts` (desde TIC-04, sin filtro ni respuestas simuladas) contra la app real compilada con CUENTAS_BACKEND=dotnet y el host .NET con MySQL y el OCR real, más las pruebas solo de .NET de `e2e/dotnet/app/`. La suite habitual excluye `e2e/dotnet/`.

## Reglas que no se rompen

- Servidor de pruebas propio (puerto 3101, base MySQL `cuentas_claras_e2e`, `CUENTAS_TEST=1` y su propio código) y web propia (puerto 4174). Nunca se reutiliza un servidor abierto: no tocan tus datos (la base `cuentas_claras`) ni tu `npm run dev`. Con `CUENTAS_TEST=1` el servidor no arranca contra otra base.
- Cada prueba de Express empieza con `resetDatabase` (POST /api/test/reset, que exige sesión). Las pruebas van de una en una porque comparten la base de datos.
- El acceso contra .NET usa los puertos 3202 y 4175, código inventado, navegador nuevo por prueba y ningún almacenamiento; `/api/auth/me` comprueba que su host está listo.
- La app contra .NET usa los puertos 3203 y 4176, `E2E_CODE` y la base `cuentas_test_e2e_dotnet`, que se crea al arrancar y se borra al terminar. Su host no expone reset ni otros atajos: `resetDatabase` vacía esa base con SQL directo (comprueba antes `SELECT DATABASE()`), nunca por la API. La web se construye en la carpeta dist-dotnet, aparte de `dist/`.
- Se busca por rol, nombre y etiqueta (`getByRole`, `getByLabel`), y solo en tres casos por `data-testid`: `restore-input`, `ticket-input` y `ticket-check`.
- Sin atajos de autenticación: se inicia sesión como el formulario.
- Los tickets de prueba están en `fixtures/tickets/`; nunca se usan datos reales.

## Cómo ejecutar

- `npm run test:e2e`: todas. Necesita MySQL en marcha y las `CUENTAS_DB_*` de un usuario con permisos sobre `cuentas_claras_e2e` (README, «Pruebas»). Primero construye la web; tarda unos dos minutos.
- `npx playwright test e2e/tickets.spec.ts --project=escritorio`: un archivo y un proyecto.
- `CUENTAS_E2E_CHANNEL=chrome npm run test:e2e`: con el Chrome instalado, si no se puede descargar Chromium (`npx playwright install chromium`).
- `npm run test:e2e:dotnet`: el acceso y la app completa contra .NET, después de compilar la solución .NET (`npm run build:dotnet`). Necesita MySQL y las `CUENTAS_DB_*` de un usuario con permisos sobre `cuentas\_test\_%`, del entorno o de .env. Acepta también CUENTAS_E2E_CHANNEL=chrome. Solo una parte: `npx playwright test --config playwright.dotnet.config.ts --project=app-escritorio`. Los comandos de compilación están en [pruebas](../docs/pruebas.md).

Las trazas de los fallos quedan en la carpeta test-results, fuera de git.

## Trampas

- Los puertos 3101 y 4174 tienen que estar libres.
- Si el servidor de pruebas no arranca (MySQL apagado, usuario o contraseña mal), Playwright enseña su mensaje en español, el mismo que daría `npm run server`.
- Para el ensayo .NET tienen que estar libres 3202, 3203, 4175 y 4176; tampoco se reutilizan servidores abiertos.
- Las pruebas de la app importan `test` y `expect` de `e2e/test.ts`, no de @playwright/test: así funcionan contra los dos backends. Un segundo contexto del navegador se abre con `newPhone(browser)`, con el idioma y la zona horaria de las demás pruebas.
- `e2e/tickets.spec.ts` usa Tesseract de verdad: una lectura tarda unos segundos.
- La zona horaria es Europe/Madrid y el idioma es-ES (`playwright.config.ts`).
- En Chromium, una captura entera (`fullPage`) de una página larga deja de emular el dedo en el móvil: `(pointer: coarse)` pasa a fino y los objetivos vuelven a sus tamaños de escritorio. `e2e/medidas-interfaz.spec.ts` lo vuelve a activar tras cada captura con `Emulation.setTouchEmulationEnabled`.
- Playwright transforma estos archivos al ejecutarlos; los tipos los comprueba `npm run typecheck` con `tsconfig.e2e.json`, que incluye la librería DOM porque el código de `page.evaluate` se ejecuta en el navegador.

## Si cambias algo aquí

Si una prueba busca un texto nuevo, añádelo a la sección «Textos y accesibilidad» del AGENTS.md de su feature. Si cambian los puertos o el arranque, `playwright.config.ts` y `docs/pruebas.md`.
