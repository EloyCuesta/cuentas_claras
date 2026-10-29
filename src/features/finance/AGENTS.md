# Feature finance — Cuentas

> Lee antes: /AGENTS.md y src/AGENTS.md. Depende de: `src/api/`, `src/ui/`, `shared/finance/` y la feature auth (SessionPanel, en Ajustes). Lo usan: `src/Root.tsx` (FinanceProvider y la migración del navegador) y `src/App.tsx` (páginas y diálogos). En el servidor es el módulo finance (`server/modules/finance/`).

## Qué ve la persona
Con el código: Resumen (mes y año), Movimientos, Recurrentes, Presupuestos y Ajustes, más «Añadir movimiento» en el lateral y en el botón flotante. Lo real se ve en trazo sólido; lo previsto, «a lápiz» (gris y discontinuo).

## Componentes
| Componente | Archivo | Qué hace | Test e2e (`e2e/app.spec.ts`) |
| --- | --- | --- | --- |
| SummaryPage | `pages/SummaryPage.tsx` | El mes: cuenta, gráfico por categoría, presupuestos, vencimientos y detalle; descarga la plantilla | «empieza vacía…», «registra un gasto…» |
| YearPage | `pages/YearPage.tsx` | El año: evolución mes a mes, categorías × meses y presupuesto anual | «la plantilla anual cuadra con la mensual…» |
| MovementsPage | `pages/MovementsPage.tsx` | Lista con búsqueda y filtros, exportar CSV | «exporta los movimientos a CSV…», «editar o eliminar…» |
| RecurringPage | `pages/RecurringPage.tsx` | Recurrentes y financiaciones | «abrir varias veces la aplicación no duplica vencimientos» |
| BudgetsPage | `pages/BudgetsPage.tsx` | Presupuestos por categoría | — |
| SettingsPage | `pages/SettingsPage.tsx` | Copias (BackupPanel), categorías (CategoryEditor) y sesión | «exportar y restaurar una copia…», «rechaza una copia no válida…» |
| MovementDialog, PaymentDialog, RecurringDialog | `components/` | Crear y editar un movimiento, confirmar un pago y editar un recurrente | «valida los campos obligatorios», «marcar un pago pendiente como pagado…» |
| Resto de `components/` | | Piezas de las páginas: Ledger, CategoryChart, CategoryTable, CategoryMonthGrid, MonthlyTrendChart, BudgetSummary, DueList, MovementList, PeriodPicker y PeriodSwitch | las de su página |

## Estado y datos
- `financeContext.ts` (useFinance) + `FinanceProvider.tsx`. Al abrir, genera los vencimientos hasta el final del mes siguiente (con la fecha de hoy del navegador) y lee todo. Tras cada escritura vuelve a leer y avisa a las otras pestañas (`tabSync.ts`).
- `FinanceRepository.ts` es el contrato asíncrono que conoce la interfaz, y `ApiFinanceRepository.ts`, su implementación. Es lo único que hace peticiones: /api/data, /movements, /categories, /recurring, /occurrences/generate, /meta e /import.
- `useForecastMovements.ts`: los movimientos más los vencimientos proyectados de los recurrentes (no se guardan), para la previsión de meses lejanos.
- `browserMigration/`: el paso único de los datos de IndexedDB (versiones antiguas) al servidor, que Root ejecuta antes de abrir. Retirarlo está pendiente, en un PR aparte (`docs/decisiones.md`).

## Textos y accesibilidad
- Los e2e usan, entre otros, estos nombres; no los cambies sin cambiar el test:
  - botones: «Añadir movimiento», «Añadir un gasto», «Guardar gasto», «Guardar cambios», «Marcar como pagado», «Eliminar movimiento», «Nuevo recurrente», «Guardar recurrente», «Descargar copia (JSON)», «Sustituir mis datos», «Exportar movimientos (CSV)» y «Descargar hoja de cálculo»;
  - diálogos: «Nuevo movimiento», «Editar movimiento», «Confirmar pago», «Eliminar movimiento», «Nuevo recurrente» y «Restaurar copia»;
  - títulos: «Empieza apuntando tu primer gasto» y «Todavía no has apuntado ningún movimiento».
- `data-testid="restore-input"`, el selector de archivo de la copia, en `components/BackupPanel.tsx`.
- Formularios con etiquetas y errores asociados, foco en el primer campo con error (`focusFirstError`) y ventanas `<dialog>` nativas.

## Pruebas
- `browserMigration/IndexedDbFinanceRepository.test.ts` y `browserMigration/browserDataMigration.test.ts`, con IndexedDB en memoria (`src/test/setup.ts`).
- Los cálculos, en `shared/finance/`.
- En el navegador, `e2e/app.spec.ts`: solo esas, `npx playwright test e2e/app.spec.ts --project=escritorio`.

## Trampas
- La fecha de hoy es la del navegador: el horizonte de los vencimientos se calcula aquí, no en el servidor.
- Al volver a la pestaña con otro día, FinanceProvider vuelve a generar los vencimientos.
- Un 401 en cualquier petición devuelve a la Despensa (lo gestiona la feature auth): FinanceProvider se desmonta y su estado se pierde.
- Restaurar una copia genera después los vencimientos que falten, como al abrir la app.

## Si cambias esta pantalla
- Textos y roles: `e2e/app.spec.ts`.
- El contrato o las rutas: `ApiFinanceRepository.ts`, `server/modules/finance/` y `docs/api.md`.
- Cálculos: `shared/finance/`, que comparte el servidor.
