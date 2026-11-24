# Feature finance — Cuentas

> Lee antes: /AGENTS.md y src/AGENTS.md. Depende de: `src/api/`, `src/ui/`, `shared/finance/` y la feature auth (SessionPanel, en Ajustes). Lo usan: `src/Root.tsx` (FinanceProvider y la migración del navegador) y `src/App.tsx` (páginas y diálogos). En el servidor es el módulo finance (`server/modules/finance/`).

## Qué ve la persona
Con el código: Resumen (mes y año), Movimientos, Recurrentes, Presupuestos y Ajustes, más «Añadir movimiento» en el lateral y en el botón flotante. En el móvil, Presupuestos no tiene pestaña: se abre desde su bloque del Resumen. En una columna, el Resumen enseña la cuenta, lo pendiente, el gráfico y los presupuestos, en ese orden, y si hay vencidos, un aviso arriba lleva a ellos (UX-04). Lo real se ve en trazo sólido; lo previsto, «a lápiz» (gris y discontinuo).

## Componentes
| Componente | Archivo | Qué hace | Test e2e (`e2e/app.spec.ts`) |
| --- | --- | --- | --- |
| SummaryPage | `pages/SummaryPage.tsx` | El mes: cuenta, gráfico por categoría, presupuestos, vencimientos y detalle; descarga la plantilla | «empieza vacía…», «registra un gasto…» |
| YearPage | `pages/YearPage.tsx` | El año: evolución mes a mes, categorías × meses y presupuesto anual | «la plantilla anual cuadra con la mensual…» |
| MovementsPage | `pages/MovementsPage.tsx` | Lista con búsqueda y filtros, exportar CSV | «exporta los movimientos a CSV…», «editar o eliminar…» |
| RecurringPage | `pages/RecurringPage.tsx` | Recurrentes y financiaciones | «abrir varias veces la aplicación no duplica vencimientos» |
| BudgetsPage | `pages/BudgetsPage.tsx` | Presupuestos por categoría | — |
| SettingsPage | `pages/SettingsPage.tsx` | Copias (BackupPanel), categorías (CategoryEditor) y sesión | «exportar y restaurar una copia…», «rechaza una copia no válida…», «crea, renombra y elimina categorías…», «eliminar una categoría con movimientos…» |
| MovementDialog, PaymentDialog, RecurringDialog | `components/` | Crear y editar un movimiento, confirmar un pago y editar un recurrente | «valida los campos obligatorios», «una fecha prevista a medio escribir…», «marcar un pago pendiente como pagado…» |
| Resto de `components/` | | Piezas de las páginas: Ledger, CategoryChart, CategoryTable, CategoryMonthGrid, MonthlyTrendChart, BudgetSummary, DueList, MovementList, PeriodPicker y PeriodSwitch | las de su página |

## Estado y datos
- `financeContext.ts` (useFinance) + `FinanceProvider.tsx`. Al abrir, genera los vencimientos hasta el final del mes siguiente (con la fecha de hoy del navegador) y lee todo. Tras cada escritura confirmada (`confirmedWrite.ts`, UX-01), el cambio entra en pantalla y la acción termina: el diálogo se cierra tras una sola petición. Después avisa a las otras pestañas (`tabSync.ts`) y vuelve a leer en segundo plano. Si falla la escritura, el diálogo muestra el error y sigue abierto; si lo que falla es la relectura, se avisa de que la pantalla no está al día, para que nadie repita un alta que sí se guardó. Una relectura que empezó antes de una escritura no la pisa (un contador en FinanceProvider). Restaurar una copia sí espera a releer.
- Lo que entra en pantalla sin releer: el movimiento, la categoría o el recurrente guardados; lo borrado (con los movimientos de una categoría borrada pasados a la que se eligió, y los pendientes de un recurrente borrado); y la fecha de la última copia. Los vencimientos que crea el servidor llegan con la relectura.
- Las altas deciden su id al abrir el diálogo (MovementDialog, RecurringDialog y el formulario de CategoryEditor): reintentar tras un fallo envía el mismo registro y no lo duplica.
- `FinanceRepository.ts` es el contrato asíncrono que conoce la interfaz, y `ApiFinanceRepository.ts`, su implementación: /api/data, /movements, /categories, /recurring, /occurrences/generate, /meta e /import. `api.ts` hace las consultas de resumen de .NET (/api/summary/month y /api/summary/year). Son lo único que hace peticiones.
- `useSummaryView.ts` (useMonthView y useYearView): lo que enseñan Resumen (mes y año) y Presupuestos, con los vencimientos proyectados de los recurrentes (no se guardan). Contra Express lo calcula el navegador con `shared/finance/summaryViews.ts`; con la web compilada para .NET (`CUENTAS_BACKEND=dotnet`), lo pide a GET /api/summary/* (`api.ts`, FIN-04) cada vez que cambian los datos, hoy o el periodo. Los pendientes que se pagan desde el resumen siguen siendo los guardados.
- `browserMigration/`: el paso único de los datos de IndexedDB (versiones antiguas) al servidor, que Root ejecuta antes de abrir. Retirarlo está pendiente, en un PR aparte (`docs/decisiones.md`).

## Textos y accesibilidad
- Los e2e usan, entre otros, estos nombres; no los cambies sin cambiar el test:
  - botones: «Añadir movimiento» (también con la tecla «n», `aria-keyshortcuts`), «Añadir ingreso» (en el lateral y en Movimientos, solo en el escritorio), «Añadir un gasto», «Guardar gasto», «Guardar y añadir otro», «Guardar cambios», «Hoy», «Ayer», «Marcar como pendiente» (con una fecha futura), los de «Más usadas» (el nombre corto de cada categoría), «Marcar como pagado», «Eliminar movimiento», «Nuevo recurrente», «Guardar recurrente», «Descargar copia (JSON)», «Sustituir mis datos», «Exportar movimientos (CSV)» y «Descargar hoja de cálculo»;
  - diálogos: «Nuevo movimiento», «Editar movimiento», «Confirmar pago», «Eliminar movimiento», «Nuevo recurrente» y «Restaurar copia»;
  - títulos: «Empieza apuntando tu primer gasto» y «Todavía no has apuntado ningún movimiento».
  - Resumen en una columna (el móvil): el aviso «N vencidos» («1 vencido») con el botón «Ver los vencidos», que lleva el foco al título «¿Qué pagos tengo pendientes?»; el enlace «Fijar presupuestos» o «Ver todos» del bloque «Presupuestos» abre la sección.
  - categorías (CategoryEditor, en la región «Categorías»): «Añadir categoría», «Añadir subcategoría a X», «Renombrar X» y «Eliminar X» (X es «Principal › Sub» en las subcategorías), los campos «Nueva categoría de gastos», «Nueva subcategoría de X» y «Nuevo nombre para «X»», el botón «Guardar», el diálogo «Eliminar «X»» con «Pasar a» y «Eliminar categoría», y los avisos «Categoría añadida», «Subcategoría añadida», «Categoría renombrada» y «Categoría «X» eliminada».
- Con la web para .NET, mientras llega el resumen: «Calculando el resumen…» (`role="status"`), y si falla: «No se ha podido calcular el resumen: …» (`role="alert"`), en `components/SummaryPending.tsx`.
- Aviso (tono `warning`) de una escritura guardada cuya relectura falló: «Se ha guardado, pero la pantalla no se ha podido actualizar. No hace falta repetirlo: vuelve a cargar la página para verlo.»
- El almacenamiento se describe como «una base de datos MySQL de este equipo» (FinanceProvider, SummaryPage y BackupPanel); SQLite solo aparece en la importación de los datos de antes (`tools/importer/`).
- `data-testid="restore-input"`, el selector de archivo de la copia, en `components/BackupPanel.tsx`.
- Formularios con etiquetas y errores asociados, foco en el primer campo con error (`focusFirstError`) y ventanas `<dialog>` nativas.
- MovementDialog (UX-03): el importe y «Tipo» (los radios «Gasto» e «Ingreso») en la misma fila; el grupo «Más usadas» (`role="group"`, sin la palabra «Categoría» para no confundir `getByLabel('Categoría')`); el estado («Pagado» o «Cobrado» y «Pendiente») y «Notas» dentro de «Más opciones», plegado salvo en un pendiente o con notas (también se abre si hay un error dentro).
- Mientras guarda, «Guardar gasto» (y el resto) y «Marcar como pagado» llevan `aria-busy` y un círculo que gira, sin cambiar su nombre: si falla, se vuelven a pulsar igual.

## Pruebas
- `browserMigration/IndexedDbFinanceRepository.test.ts` y `browserMigration/browserDataMigration.test.ts`, con IndexedDB en memoria (`src/test/setup.ts`).
- `confirmedWrite.test.ts`: escritura fallida frente a guardado con la relectura fallida, y que el cambio entra en pantalla sin esperar a la relectura.
- Los cálculos, en `shared/finance/`.
- En el navegador, `e2e/app.spec.ts`: solo esas, `npx playwright test e2e/app.spec.ts --project=escritorio`.

## Trampas
- Cambiar «Gasto | Ingreso» con el ratón o el dedo devuelve el foco al importe si lo tenía (MovementDialog); con el teclado, el foco se queda en los radios.
- La categoría se propone por el concepto igual o, si no hay ninguno igual, por el más reciente que empieza por lo escrito (3 letras o más): `shared/finance/suggestions.ts`, con sus tests.
- La fecha de hoy es la del navegador: el horizonte de los vencimientos se calcula aquí, no en el servidor.
- Al volver a la pestaña con otro día, FinanceProvider vuelve a generar los vencimientos.
- Un 401 en cualquier petición devuelve a la Despensa (lo gestiona la feature auth): FinanceProvider se desmonta y su estado se pierde.
- Restaurar una copia genera después los vencimientos que falten, como al abrir la app.

## Si cambias esta pantalla
- Textos y roles: `e2e/app.spec.ts`.
- El contrato o las rutas: `ApiFinanceRepository.ts`, `server/modules/finance/` y `docs/api.md`.
- Cálculos: `shared/finance/`, que comparte el servidor.
