# Pruebas

```bash
npm run check                    # tipos (tsc -b), oxlint y Vitest: lo que tiene que estar en verde siempre
npm test                         # solo Vitest
npx vitest run server/modules/pantry          # una carpeta o un archivo
npx vitest run shared/tickets -t "Lidl"       # solo los tests cuyo nombre encaja
npx playwright install chromium               # la primera vez, para las e2e
npm run test:e2e                              # en el navegador, en escritorio y en móvil
npx playwright test e2e/tickets.spec.ts --project=escritorio
CUENTAS_E2E_CHANNEL=chrome npm run test:e2e   # con el Chrome instalado, si no se puede descargar Chromium
```

## Niveles

| Nivel | Dónde | Qué prueba |
| --- | --- | --- |
| Dominio | `shared/**/*.test.ts` | La lógica pura: dinero, fechas, recurrentes, resumen, copias, CSV, despensa, ritmo, repaso y lectura de tickets. Sin base de datos ni red. |
| Servidor, casos de uso | `server/modules/finance/finance.test.ts`, `server/common/sqlite/*.test.ts` y `server/migrations/migrations.test.ts` | Los casos de uso y las migraciones contra una base de datos SQLite temporal. |
| Servidor, API por HTTP | `server/app.test.ts` y `server/modules/*/<módulo>.test.ts` | El servidor de verdad en un puerto libre (`startApi`), con una base de datos temporal y la cookie como un navegador. |
| Web | `src/features/**/*.test.ts` | El estado de la revisión de tickets, la preparación de imágenes y la migración del navegador (con IndexedDB en memoria). |
| Arquitectura y documentación | `tests/architecture.test.ts` y `tests/docs.test.ts` | Las reglas de dependencia y que la documentación para agentes esté completa y al día. |
| Navegador | `e2e/*.spec.ts` (Playwright) | La app entera, en escritorio y en móvil (`docs/frontend.md`). |

Un test va junto al código que prueba, con el mismo nombre y `.test.ts`. Los tests quedan fuera de las reglas de arquitectura y pueden importar lo que necesiten.

## Los falsos y los ayudantes

- **Base de datos temporal**: `tempDbPath()` y `removeTempDbs()` (`server/common/testing/tempDb.ts`), una carpeta nueva en el directorio temporal del sistema para cada base de datos. Nunca `server/data/`.
- **API en un puerto libre**: `startApi(opciones)` y `stopApis()` (`server/common/testing/testApi.ts`). Inicia sesión con `TEST_CODE` salvo `login: false`; `call(método, ruta, cuerpo, { cookie: null })` llama como invitado.
- **Reloj**: `startApi({ clock: { nowMs } })` sustituye solo lo que haga falta. El resto es el reloj de verdad (`server/common/system.ts`). Así se prueba que una sesión caduca a las 12 horas sin esperar: `auth.test.ts` adelanta el reloj. `{ nowISO }` fija las fechas de lo que crea el servidor.
- **Ids**: `startApi({ ids })` con un IdGenerator propio.
- **Lector de tickets**: `startApi({ ticketReader })`. Sin él, un lector que falla si se usa (no arranca Tesseract). `fakeReader()` en `server/modules/tickets/tickets.test.ts` devuelve lo que leyó el OCR de verdad de una imagen de prueba. Las dos primeras pruebas de ese archivo usan Tesseract de verdad y tardan unos segundos.
- **Casos de uso sueltos**: `openFinance()` en `server/modules/finance/finance.test.ts` crea el módulo con su base de datos y da sus casos de uso con los nombres del contrato de la web.
- **Datos**: `movement()`, `rule()` y `NOW` en `shared/testing/factories.ts`.

## Guardas que no deben cambiar

- Las huellas de los tickets (`server/modules/tickets/tickets.test.ts`, «las huellas no cambian…»): si cambian, los tickets ya guardados dejarían de reconocerse como duplicados.
- Las migraciones publicadas (`server/migrations/migrations.test.ts`), que no se editan.
- La ruta por defecto de la base de datos (`server/common/sqlite/openDatabase.test.ts`).

## Las pruebas en el navegador

`playwright.config.ts` arranca **su propio** servidor de API (puerto 3101), con una base de datos en la carpeta temporal del sistema y su propio código de acceso, y **su propia** web (puerto 4174), construida con `npm run build`. Nunca reutiliza un servidor abierto, así que no toca los datos reales ni el `npm run dev` que tengas abierto (3001 y 5173). Antes de cada prueba vacía la base de datos con `POST /api/test/reset`, que solo existe en ese modo y también exige sesión. Las pruebas inician sesión como el formulario, sin ningún atajo (`e2e/auth.ts`).

## Datos de prueba

Nunca se usan los datos de `server/data/`. Los tickets de prueba están en `fixtures/tickets/`:

- `ticket-lidl-ejemplo.png`, con su lectura y lo que debe salir: un ticket **inventado**.
- `ticket-torrelavega-sintetico.png`: una imagen **sintética**, dibujada imitando un ticket de Lidl con las líneas que el dueño de la app transcribió de un ticket suyo real (Torrelavega, 28/10/26). No es su captura.
- `ticket-cases.json` y los casos de `shared/tickets/ticketCases.test.ts`: incluyen esa **transcripción parcial** de un ticket real, aportada a propósito para probar el lector, y casos escritos a mano.
- `fixtures/tickets/ocr-real/`: lo que leyó Tesseract de verdad de esas imágenes sintéticas (en varias resoluciones y como «foto»).

Cada fixture lleva un campo `provenance` que dice de dónde sale. Si añades una, que sea inventada o sintética, y dilo en ese campo.

## Qué se comprueba

| Comprobación | Base de datos (`npm test`) | API HTTP (`npm test`) | Navegador (`npm run test:e2e`) |
| --- | --- | --- | --- |
| Los movimientos se conservan después de recargar | Se cierra la base de datos y se vuelve a abrir | Se reinicia el servidor con el mismo archivo | Se apunta un gasto y se recarga la página |
| Editar o eliminar un movimiento actualiza los totales | Totales del mes tras editar y eliminar | Crear, consultar, modificar y eliminar un gasto | Edición y borrado desde la interfaz |
| Marcar un pago pendiente como pagado no duplica el gasto | Sigue habiendo un solo registro | — | El total pasa de «pendiente» a «pagado» y hay un solo movimiento |
| Abrir varias veces la aplicación no duplica vencimientos | Generación repetida, con dos conexiones a la vez y tras cerrar | Generar dos veces crea 0 la segunda | Tres recargas y dos pestañas nuevas a la vez |
| Exportar y restaurar una copia conserva los datos | Copia → restauración en otra base de datos → datos idénticos | Una copia incoherente se rechaza sin tocar nada | Se descarga la copia, se restaura en una instalación vacía y se compara |

Además:
- **Validación**: la de campos y peticiones (mensajes en español y códigos 400 y 409), que no se puede inyectar SQL, y las restricciones de la base de datos.
- **Migraciones**: se aplican una sola vez, no borran nada, no se abre una base de datos más nueva y las publicadas no cambian. Las transacciones: todo o nada, anidadas y nunca async.
- **Finanzas**: la importación de los datos del navegador (una sola vez, sin mezclar y conservando la copia), la regla del día 31, las cuotas que quedan, el formato del CSV, la proyección de recurrentes y las plantillas mensual y anual.
- **Código de acceso**: arranque sin código, rutas protegidas (401), cookie y caducidad de la sesión, cierre de sesión, sesiones que no sobreviven a un reinicio, y el bloqueo por intentos, por dispositivo y sin poder eludirlo con cabeceras inventadas.
- **Despensa**: personas, productos, presupuesto, unidades, cálculos sin restos decimales, el texto exacto de la lista, comprar y deshacer (también con cambios de otro dispositivo) y que las copias e importaciones financieras no la tocan.
- **Tickets**:
  - el OCR de verdad con las imágenes de prueba;
  - la interpretación de las líneas (cantidades, pesos, descuentos, devoluciones, cifras y letras del IVA mal leídas) y la comprobación con el total;
  - varias capturas seguidas, otras tiendas, lo aprendido y los nombres parecidos;
  - guardar sin duplicar, cambiar una línea, borrar, las huellas, y la validación de las imágenes y las franjas.
- **Ritmo de compra y repaso**:
  - lo que dura cada producto (mediana, escalado por cantidad, compras del mismo día);
  - «Queda», «Queda poco», «Se acabó» y «Lo he comprado», los avisos, la lista y la estimación mensual;
  - cuándo toca el repaso (también la primera vez) y qué se repasa y en qué orden.
- **En el navegador**:
  - el invitado solo ve la despensa y no pide datos financieros ni ejecuta la migración del navegador;
  - persona, producto, lista y enlace de WhatsApp; + y −, comprar y deshacer; copiar sin portapapeles;
  - entrar con el código, cerrar sesión y sesión caducada;
  - escanear un ticket, revisarlo, guardarlo y no poder guardarlo dos veces;
  - días después, «Para revisar», «Queda», «Se acabó», la lista y deshacer una compra;
  - el repaso de la semana.
