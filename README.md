# Cuentas claras

Aplicación web para apuntar ingresos, gastos y próximos pagos, y responder de un vistazo:

- ¿Cuánto dinero he ingresado y gastado este mes?
- ¿En qué se me va el dinero?
- ¿Qué pagos tengo pendientes?
- ¿Cuánto me quedará después de pagar los gastos previstos?
- ¿Cómo va el año, mes a mes y por categoría?

Hecha con React y TypeScript. Los datos se guardan en IndexedDB, dentro del navegador, sin servidor ni registro.

## Cómo ejecutarla

Necesitas Node.js 22.12 o superior.

```bash
npm install
npm run dev          # abre http://localhost:5173
```

Versión de producción:

```bash
npm run build        # genera la carpeta dist/
npm run preview      # la sirve en http://localhost:4173
```

`dist/` son archivos estáticos: se puede subir a cualquier hosting (GitHub Pages, Netlify…). Usa rutas relativas y navegación con `#`, así que también funciona dentro de una subcarpeta.

**Probarla en el móvil** (misma red wifi): `npm run dev -- --host` y abre en el móvil la dirección «Network» que aparece en la consola. Ten en cuenta que cada dirección tiene su propio almacenamiento: los datos de `localhost` no se ven desde la IP.

**Datos de ejemplo**: la app empieza vacía. Si quieres verla con datos, ve a *Ajustes › Restaurar una copia…* y elige `ejemplo/copia-de-ejemplo.json` (un mes de octubre de 2026 con nómina, alquiler, un préstamo a 48 cuotas, recibos y presupuestos). En *Resumen › Año* se ve el año completo, con noviembre y diciembre previstos a partir de los recurrentes.

## Comprobaciones

```bash
npm test                        # pruebas unitarias y de almacenamiento (Vitest)
npm run typecheck               # TypeScript estricto
npm run lint                    # oxlint

npx playwright install chromium # solo la primera vez
npm run test:e2e                # pruebas en un navegador real, en escritorio y en móvil
```

Las comprobaciones pedidas están automatizadas a dos niveles:

| Comprobación | Almacenamiento (`npm test`) | Navegador (`npm run test:e2e`) |
| --- | --- | --- |
| Los movimientos se conservan después de recargar | Se cierra la base de datos y se vuelve a abrir | Se apunta un gasto y se recarga la página |
| Editar o eliminar un movimiento actualiza los totales | Totales del mes tras editar y eliminar | Edición y borrado desde la interfaz |
| Marcar un pago pendiente como pagado no duplica el gasto | Sigue habiendo un solo registro | El total pasa de «pendiente» a «pagado» y hay un solo movimiento |
| Abrir varias veces la aplicación no duplica vencimientos | Generación repetida, simultánea (dos pestañas) y tras cerrar | Tres recargas y dos pestañas nuevas a la vez |
| Exportar y restaurar una copia conserva los datos | Copia → restauración en otra base de datos → datos idénticos | Se descarga la copia, se restaura en otro navegador vacío y se compara |

Además se prueban la validación de campos, la regla del día 31, las cuotas que quedan, el rechazo de copias no válidas, el formato del CSV, la proyección de recurrentes, que el año sea la suma de sus doce meses y las plantillas mensual y anual (en pantalla y en CSV).

## Estructura

La lógica, el almacenamiento y la interfaz están separados. La interfaz no sabe que existe IndexedDB.

```
src/
├── main.tsx                 Punto de entrada: aquí se elige el almacenamiento
├── App.tsx                  Estructura, navegación y ventanas de edición
├── styles.css               Estilos: colores y tipografía como variables, modo oscuro
├── domain/                  Lógica pura en TypeScript, sin React ni IndexedDB (con tests)
│   ├── types.ts             Movimiento, Categoría, Recurrente…
│   ├── money.ts             Importes en céntimos: leer lo que escribe el usuario y formatear
│   ├── dates.ts             Fechas "AAAA-MM-DD" y la regla del día 31
│   ├── period.ts            Periodos (un mes o un año): límites, textos y meses que abarcan
│   ├── categories.ts        Categorías iniciales
│   ├── recurring.ts         Calendario de vencimientos, cuotas que quedan y proyección
│   ├── summary.ts           Resumen de un periodo, desglose por categoría y presupuestos
│   ├── annual.ts            El año mes a mes: serie mensual y categorías × meses
│   ├── filters.ts           Búsqueda y filtros
│   ├── validation.ts        Validación de formularios
│   ├── suggestions.ts       Conceptos ya usados y su categoría
│   ├── backup.ts            Copia de seguridad JSON: crear y validar
│   └── csv.ts               Exportación a CSV: movimientos y plantillas mensual y anual
├── storage/
│   ├── FinanceRepository.ts            El contrato del almacenamiento (interfaz)
│   └── IndexedDbFinanceRepository.ts   Su implementación con IndexedDB
├── state/                   Contexto de React, avisos, sincronización entre pestañas y previsión
├── components/              Formularios, ventanas, gráfico, listas…
├── pages/                   Resumen (mes), Año, Movimientos, Recurrentes, Presupuestos y Ajustes
└── ui/                      Navegación con #, descargas y foco
e2e/app.spec.ts              Pruebas en navegador de las comprobaciones pedidas
ejemplo/                     Copia de seguridad con datos de ejemplo
```

## Decisiones de diseño

- **Céntimos enteros.** 12,34 € se guarda como `1234`. Nunca se suman decimales, así que no hay errores de redondeo. El campo de importe acepta `12,5`, `12.50` o `1.234,56`.
- **Fechas sin hora.** Se guardan como `"2026-10-28"` para que el cambio de zona horaria no mueva un gasto de día.
- **Real y previsto.** Un movimiento pagado cuenta en el mes de su fecha de pago; uno pendiente, en el mes de su fecha prevista. El resultado previsto es lo cobrado más lo pendiente de cobrar, menos lo pagado y lo pendiente de pagar en ese mes. Lo real se muestra en trazo sólido y lo previsto «a lápiz» (gris y líneas discontinuas), siempre con su etiqueta.
- **Recurrentes.** Al abrir la app se crean los vencimientos que falten hasta el final del mes siguiente, como pendientes. Cada vencimiento se identifica por *recurrente + fecha programada* con un índice único en IndexedDB, así que no puede existir dos veces aunque se abran varias pestañas a la vez. Si borras un vencimiento, se anota para no volver a crearlo. Si un vencimiento cae en un día 31 y el mes no lo tiene, se usa el último día del mes.
- **Plantillas mensual y anual.** *Resumen* tiene dos vistas, Mes y Año, que comparten los mismos cálculos: reciben un periodo (`src/domain/period.ts`) en lugar de un año y un mes, así que una columna del año coincide siempre con ese mes. El mes añade un detalle por categoría y subcategoría (presupuesto, real, pendiente, total y lo que queda); el año, la evolución mes a mes, una tabla de categorías × meses y el presupuesto anual (el mensual × 12). Las dos se descargan como hoja de cálculo con el mismo formato que el CSV de movimientos.
- **Proyección de recurrentes.** Para los meses posteriores al horizonte de generación, los vencimientos de los recurrentes se calculan al vuelo y cuentan en la previsión como pendientes, marcados como «proyectados». No se guardan, así que no aparecen en Movimientos ni se pueden pagar hasta que la aplicación los cree. Respetan las cuotas, la fecha de fin y los vencimientos eliminados.
- **Marcar como pagado** modifica el mismo movimiento (estado y fecha de pago), no crea otro. Se puede ajustar el importe final, por ejemplo en una factura de luz.
- **Categorías** con un nivel de subcategorías (Vivienda › Luz). El gráfico y los presupuestos usan la categoría principal. La de ingresos se llama «Otros ingresos» para no confundirla con «Otros».
- **Copias.** La restauración valida todo el archivo (tipos, importes, fechas, ids repetidos, referencias) y pide confirmación antes de sustituir nada. El CSV usa `;`, coma decimal, fechas dd/mm/aaaa y gastos en negativo, para que Excel o LibreOffice lo abran bien.
- **Accesibilidad.** Formularios con etiquetas y errores asociados, foco en el primer campo con error, ventanas modales nativas (`<dialog>`), navegación con teclado y contraste AA en modo claro y oscuro. Revisado con axe sin incidencias.

## Límites de esta versión

- Los datos solo existen **en ese navegador y en ese dispositivo**. No hay cuentas de usuario ni sincronización. Si se borran los datos del navegador, se pierden, salvo que tengas una copia. Por eso la app recuerda hacer copias y muestra la fecha de la última.
- No está conectada al banco: el resultado del mes **no es un saldo**, es la diferencia entre lo que entra y lo que sale.
- Una sola moneda (euro).
- Los recurrentes solo crean vencimientos (que se pueden pagar o editar) hasta el final del mes siguiente. En meses más lejanos la previsión los proyecta con el importe de la regla: si sabes que un recibo cambiará, ajústalo cuando se cree.
- Al editar un recurrente se rehacen sus vencimientos pendientes con los datos nuevos. Si habías cambiado a mano alguno de esos pendientes, ese cambio se pierde (los ya pagados no se tocan).
- Los selectores de fecha son los nativos del navegador y muestran el formato de su idioma. Debajo de cada uno se repite la fecha en español («Miércoles, 28 de octubre de 2026») y el resto de la app usa siempre dd/mm/aaaa.
- No es una aplicación instalable (PWA): sin conexión, solo funciona si la página ya estaba abierta.

## Pasar a una base de datos en servidor

Toda la interfaz habla con la interfaz `FinanceRepository` (`src/storage/FinanceRepository.ts`). Para usar un servidor:

1. Escribe una clase que la implemente con llamadas a tu API, por ejemplo:

   ```ts
   export class ApiFinanceRepository implements FinanceRepository {
     private readonly baseUrl: string
     constructor(baseUrl: string) {
       this.baseUrl = baseUrl
     }
     async loadAll() {
       const response = await fetch(`${this.baseUrl}/datos`)
       return response.json()
     }
     async saveMovement(movement: Movement) {
       await fetch(`${this.baseUrl}/movimientos/${movement.id}`, {
         method: 'PUT',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify(movement),
       })
     }
     // …el resto de métodos
   }
   ```

2. Cámbiala en `src/main.tsx`: `const repository = new ApiFinanceRepository('/api')`.

El servidor puede reutilizar las funciones de `src/domain/` (por ejemplo `planOccurrences` para generar vencimientos) y debería mantener la misma garantía con una restricción única sobre `(recurringId, occurrenceDate)`. Para varios usuarios haría falta además autenticación.
