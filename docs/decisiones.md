# Decisiones

Por qué Cuentas claras es como es. Cada entrada dice qué se decidió, por qué y qué consecuencias tiene. Las nuevas van al final.

## De la app

**Céntimos enteros.** 12,34 € se guarda como `1234`. Nunca se suman decimales, así que no hay errores de redondeo. El campo de importe acepta `12,5`, `12.50` o `1.234,56`.

**Fechas sin hora.** Se guardan como `"2026-10-28"`, para que el cambio de zona horaria no mueva un gasto de día. La fecha de «hoy» la pone el navegador, no el servidor; el servidor solo usa la suya de respaldo.

**Real y previsto.** Un movimiento pagado cuenta en el mes de su fecha de pago, y uno pendiente, en el mes de su fecha prevista. El resultado previsto es lo cobrado más lo pendiente de cobrar, menos lo pagado y lo pendiente de pagar en ese mes. Lo real se muestra en trazo sólido y lo previsto «a lápiz» (gris y discontinuo), siempre con su etiqueta.

**Recurrentes.** Al abrir la app se crean los vencimientos que falten hasta el final del mes siguiente, como pendientes. Cada vencimiento se identifica por recurrente + fecha programada con un índice único, así que no puede existir dos veces aunque se abran varias pestañas a la vez. Si se borra un vencimiento, se anota para no volver a crearlo. Si cae en un día 31 y el mes no lo tiene, se usa el último día del mes.

**Plantillas mensual y anual.** *Resumen* tiene dos vistas, Mes y Año, que comparten los cálculos: reciben un periodo (`shared/finance/period.ts`) en lugar de un año y un mes, así que una columna del año coincide siempre con ese mes. El mes añade un detalle por categoría y subcategoría. El año añade la evolución mes a mes, una tabla de categorías × meses y el presupuesto anual (el mensual × 12). Las dos se descargan como hoja de cálculo con el formato del CSV.

**Proyección de recurrentes.** Para los meses posteriores al horizonte, los vencimientos se calculan al vuelo y cuentan en la previsión como pendientes, marcados como «proyectados». No se guardan: no aparecen en Movimientos ni se pueden pagar hasta que la app los crea. Respetan las cuotas, la fecha de fin y los vencimientos eliminados.

**Marcar como pagado** modifica el mismo movimiento (estado y fecha de pago), no crea otro. Se puede ajustar el importe final, por ejemplo en una factura de luz.

**Categorías** con un nivel de subcategorías (Vivienda › Luz). El gráfico y los presupuestos usan la categoría principal. La de ingresos se llama «Otros ingresos» para no confundirla con «Otros».

**Copias.** Restaurar valida todo el archivo (tipos, importes, fechas, ids repetidos y referencias) y pide confirmación antes de sustituir nada. El servidor lo vuelve a validar con las mismas reglas. El CSV usa `;`, coma decimal, fechas dd/mm/aaaa y gastos en negativo, para que Excel o LibreOffice lo abran bien.

**Sin tablas de cuentas, vivienda, préstamos ni seguros.** La app no lleva saldos, Vivienda o Coche son categorías y una financiación es un recurrente con cuotas: así no se duplica información.

**Un código para toda la casa, no usuarios.** Basta para que nadie vea las cuentas por la red de casa, sin altas ni contraseñas. Las sesiones viven en memoria (reiniciar el servidor obliga a escribir el código), y la cookie es HttpOnly y sin `Secure`, porque la app va por HTTP en casa. Por eso no debe exponerse a Internet.

**Tickets con OCR local.** Los tickets se leen con tesseract.js y el modelo de español de `@tesseract.js-data/spa`, los dos en `node_modules`: no hace falta Internet ni una cuenta en ningún servicio, y las compras no salen de casa. Cada captura se lee dos veces: una para el texto y otra, solo con cifras, para la columna de importes. El total del ticket sirve de comprobación, nunca para decidir un importe: lo que no se puede asegurar se marca para revisar en lugar de inventarlo. El lector se abre la primera vez que se usa y se cierra tras 5 minutos sin uso. Las imágenes no se guardan.

**Por compras, no por inventario.** Contar lo que hay en casa es pesado y se desactualiza; con los tickets la app ya sabe qué se compró y cuándo. Por eso los productos nuevos se siguen por compras, y contar queda como opción.

**Accesibilidad.** Formularios con etiquetas y errores asociados, foco en el primer campo con error, ventanas modales nativas (`<dialog>`), navegación con teclado y contraste AA en modo claro y oscuro, revisado con axe sin incidencias.

## De la reestructuración (octubre de 2026)

**Arquitectura hexagonal modular en el servidor.** Cada área es un módulo (auth, finance, pantry, tickets y health), con casos de uso separados de HTTP y de SQL, y puertos para cada dependencia externa. `server/app.ts` los compone a mano: sin contenedores de inyección ni ORM. Así se puede cambiar o probar una pieza sin tocar las demás, y un agente sabe dónde va cada cosa. Lo vigila `tests/architecture.test.ts`. Detalle en `docs/arquitectura.md`.

**El dominio compartido en `shared/`.** La lógica pura que usan la web y el servidor dejó src/domain/ y se reparte por áreas (`common`, `finance`, `pantry` y `tickets`, con `tickets → pantry → common` y `finance → common`). No importa paquetes ni Node, y `tsconfig.shared.json` lo comprueba sin tipos de Node ni de Vite. Se importa con `#shared/…` (campo `imports` de `package.json`), que funciona igual en tsx, Vite, Vitest y `tsc -b`, sin dependencias nuevas.

**Puertos síncronos y una sola UnitOfWork.** better-sqlite3 es síncrono y sus transacciones no admiten trabajo async (lanza un error si se intenta), así que los puertos de persistencia y `UnitOfWork.run` son síncronos. Solo el OCR es async. Hay una única UnitOfWork, creada en `server/app.ts` y compartida: cuando tickets crea un producto con el caso de uso de la despensa, la transacción se anida (savepoint) y todo sigue siendo atómico.

**Un reloj y unos ids comunes.** Antes, auth recibía un reloj en milisegundos y la despensa un `now` en ISO. Ahora hay un `Clock` (`nowMs`, `nowISO` y `today`) y un `IdGenerator` en `server/common/ports.ts`. Los ids de la despensa y los tickets salen del mismo `crypto.randomUUID` que los de finanzas (UUID v4 igual que antes).

**Hasher para las huellas de los tickets.** `node:crypto` no puede estar en application/, así que el SHA-256 de las huellas va detrás de un puerto (`Hasher`). El texto del que sale cada huella está en `server/modules/tickets/domain/ticketIdentity.ts`, y un test golden asegura que las huellas ya guardadas siguen coincidiendo.

**Lo que se quedó en el SQL.** Qué líneas cuentan para el ritmo de compra (con producto, verificadas y no «para una ocasión») se filtra en la consulta, para no leer todas las líneas. La agrupación y las devoluciones están en el dominio.

**`imageInfo` en `server/common/`.** Leer el tamaño de una imagen PNG o JPEG lo usan dos adaptadores de tickets (el router, para validar, y Tesseract, para medir). En `server/common/imageInfo.ts` ningún adaptador importa otro.

**Migraciones congeladas.** Las migraciones publicadas no se editan, y un test guarda su huella. Al pasar el dominio a `shared/` solo cambió la línea del import de `DEFAULT_CATEGORIES` en la 001, porque la ruta antigua dejaba de existir; el SQL y los datos son los mismos.

**La web por funcionalidades.** `src/features/{auth,finance,pantry,tickets}` con su `index.ts`, más `src/ui/` (genérico) y `src/api/` (el cliente). Solo los clientes hacen peticiones. Las acciones de los tickets siguen en `usePantry`, porque guardar un ticket recarga toda la despensa; la feature tickets define `TicketActions` y la dependencia va solo de pantry a tickets. Detalle en `docs/frontend.md`.

**Documentación para agentes.** Un `AGENTS.md` en la raíz, en cada zona, en cada módulo y en cada feature, con un `CLAUDE.md` al lado que solo contiene `@AGENTS.md`, y reglas cortas en `.claude/rules/`. Lo comprueba `tests/docs.test.ts`. `.claude/settings.json` impide que un agente lea `server/data/` y `.env`.

**better-sqlite3 12.11.1.** La 13 no trae binarios para Windows con Node 24 y `npm install` falla al compilarla; la 12.11.1 instala los suyos precompilados.

**Pruebas e2e con el Chrome instalado.** En el equipo de desarrollo la descarga de Chromium de Playwright caduca; `CUENTAS_E2E_CHANNEL=chrome` usa el Chrome del sistema (una opción que ya tenía `playwright.config.ts`).

**Los tipos de las e2e también se comprueban.** `e2e/` y `playwright.config.ts` no estaban en ningún tsconfig. Ahora `tsconfig.e2e.json` los incluye en `tsc -b`, con la librería DOM porque el código de `page.evaluate` se ejecuta en el navegador.

**Cómo se hizo.** Se hizo en pasos pequeños y con `npm run check` en verde en cada commit. Primero se midió la línea base: 359 tests de Vitest y 46 pruebas e2e. Los movimientos se hicieron con `git mv` y en commits separados de los que reparten la lógica. Antes de tocar los tickets se escribió un test golden de las huellas con el código de entonces. Al terminar hay 376 tests, porque se añadieron 17 (arquitectura, documentación y guardas) y no se quitó ninguno, y siguen pasando las 46 pruebas e2e.

## Pendiente

**Retirar la migración de los datos del navegador** (IndexedDB → SQLite), en un PR aparte, cuando se confirme que ningún navegador (el móvil, por ejemplo) tiene datos antiguos sin pasar. Se ganaría:
- unas 700 líneas menos: `src/features/finance/browserMigration/` y sus tests;
- dos dependencias menos, `idb` y `fake-indexeddb`;
- un FinanceProvider sin `beforeOpen` y un README más corto.

El coste: bajarían 19 tests (los de esas dos piezas). La ruta POST /api/import del servidor podría quedarse.

**Tickets reales en las pruebas.** `fixtures/tickets/ticket-cases.json` y el ticket sintético de Torrelavega usan líneas transcritas de un ticket real del dueño de la app (`docs/pruebas.md`). Si se prefieren datos inventados, habría que sustituirlos sin debilitar las pruebas del lector.
