# Cuentas claras

Aplicación web para apuntar ingresos, gastos y próximos pagos, y responder de un vistazo:

- ¿Cuánto dinero he ingresado y gastado este mes?
- ¿En qué se me va el dinero?
- ¿Qué pagos tengo pendientes?
- ¿Cuánto me quedará después de pagar los gastos previstos?
- ¿Cómo va el año, mes a mes y por categoría?

Hecha con React y TypeScript. Los datos se guardan en una base de datos **SQLite** de tu equipo (`server/data/cuentas.db`), a través de un pequeño servidor Node.js + Express. No hace falta instalar MySQL, PostgreSQL ni Docker, ni registrarse.

## Cómo ejecutarla

Necesitas Node.js 22.12 o superior.

```bash
npm install
cp .env.example .env # y escribe tu código en CUENTAS_CODIGO (ver «Código de acceso»)
npm run dev          # abre http://localhost:5173
```

`npm run dev` arranca a la vez dos procesos, cada uno con su prefijo en la consola:

- `[api]` el servidor (Express + SQLite) en `http://127.0.0.1:3001/api`. Se reinicia solo al cambiar su código.
- `[web]` la interfaz (Vite) en `http://localhost:5173`. Envía a la API todo lo que empieza por `/api`, así que no hay problemas de CORS.

La primera vez se crea `server/data/cuentas.db` con sus tablas y las categorías iniciales. Las siguientes veces se abre tal cual y solo se aplican las migraciones nuevas, si las hay. Con Ctrl+C se cierran los dos procesos.

Comprobar que el servidor funciona: abre `http://localhost:5173/api/health`.

Versión de producción:

```bash
npm run build        # comprueba los tipos (también del servidor) y genera dist/
npm run server       # en una terminal: la API en el puerto 3001
npm run preview      # en otra: la web en http://localhost:4173 (también envía /api al servidor)
```

`dist/` sigue siendo un conjunto de archivos estáticos, pero ahora necesita el servidor de la API para leer y guardar los datos.

**Usarla en el móvil** (misma red wifi): `npm run dev:server` en una terminal y `npm run dev:web -- --host` en otra. Abre en el móvil la dirección «Network» que aparece en la consola. Sin el código solo se ve la Despensa; con «Tengo el código» se ve todo. El móvil y el ordenador ven los mismos datos, porque los dos usan la base de datos del ordenador.

**Datos de ejemplo**: la app empieza vacía. Si quieres verla con datos, ve a *Ajustes › Restaurar una copia…* y elige `ejemplo/copia-de-ejemplo.json` (un mes de octubre de 2026 con nómina, alquiler, un préstamo a 48 cuotas, recibos y presupuestos). En *Resumen › Año* se ve el año completo, con noviembre y diciembre previstos a partir de los recurrentes.

**Si venías de la versión anterior** (datos guardados en el navegador): al entrar con el código en ese navegador, los datos que hubiera en ese navegador se pasan solos a la base de datos, siempre que esta todavía no tenga datos tuyos. Después se comprueba que ha llegado todo. La copia del navegador no se borra. Si la base de datos ya tenía datos, no se mezcla nada y la app lo avisa.

## Código de acceso

Las cuentas solo se ven con un código que pones tú. Sin él, cualquiera de casa puede usar la **Despensa** y nada más.

1. Copia `.env.example` como `.env` (`cp .env.example .env`; en Windows, `copy .env.example .env`).
2. Escribe tu código en `CUENTAS_CODIGO=` (al menos 4 caracteres, que no sean solo espacios). `.env` no se sube al repositorio.
3. Arranca como siempre (`npm run dev`, o `npm run dev:server` + `npm run dev:web -- --host` para la red de casa). Sin código, el servidor avisa y no arranca, y no llega a abrir ni crear la base de datos.

Cómo funciona:

- **Invitado** (sin código): ve y edita la Despensa (personas, productos, presupuesto y lista de la compra). No ve el resumen, los movimientos, los recurrentes, los presupuestos ni los ajustes. Un enlace como `#resumen` también lleva a la Despensa.
- **Con el código** («Tengo el código»): toda la aplicación, con la Despensa en el menú.
- La protección está en el **servidor**: cualquier petición a una ruta financiera sin sesión responde `401`, aunque alguien la escriba a mano. Ocultar botones no bastaría, porque Vite reenvía `/api` al servidor.
- Al acertar el código, el servidor da una **sesión de 12 horas** en una cookie `HttpOnly` (el JavaScript de la página no la puede leer). Sobrevive a recargar la página. El código no se guarda en el navegador.
- **Cerrar sesión** está en *Ajustes › Sesión*. También se pierde al **reiniciar el servidor** (las sesiones viven en memoria): hay que volver a escribir el código.
- Tras **5 códigos incorrectos** desde el mismo dispositivo, se bloquean los intentos 15 minutos. Cada móvil cuenta por separado: el proxy de Vite pasa al servidor la IP real de cada uno.

> **Importante:** en la red de casa la app va por **HTTP**, sin cifrar. El código y los datos viajan por la wifi tal cual. Vale para casa, pero **no expongas la aplicación a Internet** (sin abrir puertos en el router ni túneles).

## Despensa

Lo que hay en casa y lo que falta, separado por persona para que lo individual no se mezcle con lo compartido.

- **Personas**: cada una tiene su apartado. Arriba se elige «Compartido», una persona o «Todo». Una persona con productos no se puede borrar: primero hay que pasarlos a otra o eliminarlos.
- **Productos**: nombre, de quién es (o Compartido), unidad, cuánto hay, cuánto quieres tener, frecuencia, precio estimado y notas. Falta la diferencia entre lo que quieres tener y lo que hay. Puede haber más de lo previsto.
- **Unidades**: `ud`, `g`, `kg`, `ml`, `l`, `paquete`, `lata`, `botella`, `bolsa` y `docena`. Solo `g`, `kg`, `ml` y `l` admiten decimales (hasta 3). No se convierten entre sí.
- **Botones − y +**: restan o suman 1 (100 en `g` y `ml`, 0,5 en `kg` y `l`). Nunca bajan de cero. El servidor hace la cuenta sobre su valor actual, así que dos móviles a la vez no se pisan.
- **Frecuencia**: «Cada semana», «Cada mes» y «De vez en cuando».
- **Precio**: por unidad (por kilo en `g` y por litro en `ml`). Vacío = no se sabe; 0 = gratis.
- **Estimaciones**: lo que cuesta lo que falta y la **estimación mensual de toda la casa** (objetivo × precio × 4,33 si es semanal, × 1 si es mensual y × 0,25 si es ocasional). Los productos sin precio no cuentan y el resultado se marca como parcial. Los importes se calculan en céntimos exactos y cada línea se redondea una sola vez.
- **Presupuesto**: un presupuesto mensual de la despensa para comparar con esa estimación. Es solo una estimación: **no crea gastos, movimientos, presupuestos ni recurrentes** en las cuentas.
- **Lista de la compra**: el texto de lo que falta, agrupado en Compartido y cada persona, con negritas de WhatsApp y el total estimado. Se filtra por persona y frecuencia. Se puede:
  - **Enviar por WhatsApp**: abre WhatsApp con el texto escrito (sin enviarlo). Es la opción principal porque funciona aunque la app vaya por HTTP.
  - **Compartir**, si el navegador lo permite (por HTTP en la red de casa normalmente no).
  - **Copiar**: si el navegador no deja copiar solo, selecciona el texto para copiarlo a mano.
  - **Descargar .txt**.
  - **Marcar todo como comprado**: completa lo que hay hasta el objetivo en los productos de la lista. Durante unos segundos aparece **Deshacer**, que devuelve las cantidades anteriores. Si mientras tanto alguien ha cambiado alguno de esos productos, no se deshace nada (para no pisar su cambio) y la app lo avisa.
- La Despensa se guarda en la misma base de datos SQLite, en tablas aparte. **Las copias JSON y los CSV no la incluyen**, y restaurar una copia o importar los datos del navegador no la toca.

## Comprobaciones

```bash
npm test                        # pruebas unitarias, del almacenamiento y de la API (Vitest)
npm run typecheck               # TypeScript estricto (interfaz y servidor)
npm run lint                    # oxlint

npx playwright install chromium # solo la primera vez
npm run test:e2e                # pruebas en un navegador real, en escritorio y en móvil
```

Las pruebas **nunca tocan tus datos**:

- Las de Vitest usan bases de datos temporales.
- Las de navegador arrancan su propio servidor (puerto 3101), con su propia base de datos en la carpeta temporal del sistema, su propio código de acceso y su propia web (puerto 4174). Nunca reutilizan un servidor abierto. Antes de cada prueba la base de datos de pruebas se vacía con `POST /api/test/reset`, una ruta que solo existe en ese modo y que también exige sesión. Las pruebas inician sesión como el formulario, sin ningún atajo.

Las comprobaciones pedidas están automatizadas a tres niveles:

| Comprobación | Base de datos (`npm test`) | API HTTP (`npm test`) | Navegador (`npm run test:e2e`) |
| --- | --- | --- | --- |
| Los movimientos se conservan después de recargar | Se cierra la base de datos y se vuelve a abrir | Se reinicia el servidor con el mismo archivo | Se apunta un gasto y se recarga la página |
| Editar o eliminar un movimiento actualiza los totales | Totales del mes tras editar y eliminar | Crear, consultar, modificar y eliminar un gasto | Edición y borrado desde la interfaz |
| Marcar un pago pendiente como pagado no duplica el gasto | Sigue habiendo un solo registro | — | El total pasa de «pendiente» a «pagado» y hay un solo movimiento |
| Abrir varias veces la aplicación no duplica vencimientos | Generación repetida, con dos conexiones a la vez y tras cerrar | Generar dos veces crea 0 la segunda | Tres recargas y dos pestañas nuevas a la vez |
| Exportar y restaurar una copia conserva los datos | Copia → restauración en otra base de datos → datos idénticos | Una copia incoherente se rechaza sin tocar nada | Se descarga la copia, se restaura en una instalación vacía y se compara |

Además se prueban:

- La validación de campos y de peticiones (mensajes en español y códigos 400 y 409).
- Que no se puede inyectar SQL.
- Las migraciones: se aplican una sola vez, no borran nada y no se abre una base de datos de una versión más nueva.
- Las restricciones de la base de datos.
- La importación de los datos del navegador (una sola vez, sin mezclar y conservando la copia).
- La regla del día 31, las cuotas que quedan, el formato del CSV y la proyección de recurrentes.
- Las plantillas mensual y anual.
- El código de acceso: arranque sin código, rutas protegidas (`401`), cookie y caducidad de la sesión, cierre de sesión, sesiones que no sobreviven a un reinicio, y el bloqueo por intentos, por dispositivo y sin poder eludirlo con cabeceras inventadas (con un reloj controlado, sin esperar minutos).
- La despensa: personas, productos, presupuesto, unidades, cálculos sin restos decimales, el texto exacto de la lista, comprar y deshacer (también con cambios de otro dispositivo), la migración desde una base de datos anterior y que las copias e importaciones financieras no la tocan.
- En el navegador: el invitado solo ve la despensa y no pide datos financieros ni ejecuta la migración del navegador; persona, producto, lista y enlace de WhatsApp; + y −, comprar y deshacer; copiar sin portapapeles; entrar con el código, cerrar sesión y sesión caducada.

## Estructura

La lógica, el almacenamiento y la interfaz están separados. La interfaz solo conoce el contrato `FinanceRepository`, no sabe que hay un servidor ni una base de datos.

```
server/                      Servidor Node.js + Express + SQLite (se ejecuta con tsx)
├── index.ts                 Arranque: variables de entorno (código obligatorio), puerto y cierre ordenado
├── app.ts                   La aplicación Express: rutas /api, orden público → requireAdmin → finanzas
├── auth.ts                  Código de acceso: sesiones en memoria, cookie, límite de intentos y requireAdmin
├── pantryRepository.ts      La despensa en SQLite (tablas aparte de las finanzas)
├── database.ts              Abre o crea la base de datos (WAL, claves foráneas) y aplica migraciones
├── migrations/              Migraciones versionadas (001-esquema-inicial.ts, 002-despensa.ts)
├── repository.ts            SqliteFinanceRepository: el contrato FinanceRepository con SQL
├── http.ts                  Formato de las respuestas, errores centralizados y validación
├── routes/                  health, data, movements, categories, recurring, meta, pantry y testing
└── data/                    Aquí se crea cuentas.db (fuera de git: son tus datos)
src/
├── main.tsx                 Punto de entrada
├── Root.tsx                 Con el código, la app completa (aquí se elige el almacenamiento); sin él, GuestApp
├── GuestApp.tsx             Vista de invitado: solo la Despensa y «Tengo el código»
├── App.tsx                  Estructura, navegación y ventanas de edición
├── styles.css               Estilos: colores y tipografía como variables, modo oscuro
├── domain/                  Lógica pura en TypeScript, sin React ni base de datos (con tests).
│   │                        La usan la interfaz y el servidor.
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
│   ├── pantry.ts            Despensa: faltantes, importes, estimaciones y texto de la lista de la compra
│   ├── pantryValidation.ts  Validación de la despensa (formularios y API)
│   ├── backup.ts            Copia de seguridad JSON y validación de datos (también la usa la API)
│   └── csv.ts               Exportación a CSV: movimientos y plantillas mensual y anual
├── services/
│   ├── apiClient.ts                Peticiones a /api y errores del servidor
│   ├── ApiFinanceRepository.ts     El contrato FinanceRepository sobre la API
│   ├── pantryApi.ts                Cliente de la API de la despensa
│   └── browserDataMigration.ts     Paso único de los datos del navegador (IndexedDB) a SQLite
├── storage/
│   ├── FinanceRepository.ts            El contrato del almacenamiento (interfaz)
│   └── IndexedDbFinanceRepository.ts   Implementación anterior (navegador): se usa para leer los datos al migrarlos
├── state/                   Sesión (AuthProvider), finanzas, despensa (usePantry), avisos, pestañas y previsión
├── components/              Formularios, ventanas, gráfico, listas…
├── pages/                   Resumen (mes), Año, Movimientos, Recurrentes, Presupuestos, Despensa y Ajustes
└── ui/                      Navegación con #, descargas y foco
e2e/app.spec.ts              Pruebas en navegador de las funciones financieras (con sesión)
e2e/despensa.spec.ts         Pruebas en navegador del invitado, la despensa y el acceso
ejemplo/                     Copia de seguridad con datos de ejemplo
```

## Base de datos

Nueve tablas, solo con lo que usa la aplicación:

| Tabla | Contenido |
| --- | --- |
| `categories` | Categorías y subcategorías (`parent_id`, un solo nivel). El presupuesto mensual es una columna (`budget_cents`). |
| `movements` | Ingresos y gastos, realizados o pendientes. Incluye los vencimientos de los recurrentes (`recurring_id`, `occurrence_date`) y el número de cuota. |
| `recurring_rules` | Pagos y cobros recurrentes. Las financiaciones son recurrentes con un número de cuotas (`installments`). |
| `recurring_excluded_dates` | Vencimientos eliminados que no deben volver a crearse. |
| `meta` | Datos auxiliares: fecha de la última copia y de la importación desde el navegador. |
| `pantry_people` | Personas de la despensa. |
| `pantry_items` | Productos: dueño (`owner_id`, `NULL` = Compartido, borrado restringido), unidad, cantidades, frecuencia, precio en céntimos (`NULL` = desconocido) y `version`, que sube en cada escritura para poder deshacer sin pisar cambios. |
| `pantry_settings` | Una sola fila con el presupuesto mensual de la despensa. |
| `schema_migrations` | Migraciones aplicadas (versión, nombre y fecha). |

Decisiones sobre el modelo:

- **Importes en céntimos enteros** (`INTEGER`, con `CHECK > 0`) y fechas como texto `AAAA-MM-DD`, igual que en la aplicación.
- **Claves foráneas**: los movimientos y recurrentes apuntan a su categoría, y las subcategorías a su categoría principal.
- **Índice único** `(recurring_id, occurrence_date)`: un vencimiento no puede existir dos veces. Los movimientos normales tienen `NULL` y no chocan.
- `movements.recurring_id` **no** es clave foránea a propósito: al borrar un recurrente se conservan sus vencimientos ya pagados.
- **No hay tablas** de cuentas bancarias, vivienda, vehículos, seguros ni financiaciones:
  - La app no lleva saldos, así que no hay cuentas.
  - Vivienda, Coche o Seguros son categorías.
  - Una financiación es un recurrente con cuotas.
  - Así no se duplica información.
- **Funcionamiento**:
  - Cada operación es una transacción: se guarda entera o no se guarda nada.
  - El modo WAL protege la base de datos ante un corte.
  - Todas las consultas usan parámetros, así que el SQL no se puede inyectar.
- **Migraciones**: cada una se aplica una sola vez, en una transacción, y queda anotada. La `002-despensa` añade las tablas de la despensa sin tocar las demás; los cambios futuros serán migraciones nuevas (`003-…`) que no borran datos. Una base de datos de una versión más nueva no se abre.

## API

Todas las rutas están bajo `/api` y responden con el mismo formato:

- Si todo va bien: `{ "ok": true, "data": … }`.
- Si hay un error: `{ "ok": false, "error": { "code": "…", "message": "…" } }`, con el mensaje en español.

Públicas (sin código):

| Método y ruta | Qué hace |
| --- | --- |
| `GET /api/health` | Estado del servidor y versión del esquema (sin datos ni rutas de archivos) |
| `POST /api/auth/login` | `{ codigo }` → `{ rol: 'admin' }` y la cookie de sesión. `401` si no es correcto, `429` (con `Retry-After`) si hay bloqueo |
| `POST /api/auth/logout` | Cierra la sesión de este navegador y borra la cookie (siempre `200`) |
| `GET /api/auth/me` | `{ rol: 'admin' \| 'invitado' }` |
| `GET` / `POST /api/despensa/personas` | Lista las personas o crea una `{ name }` (`201`) |
| `PUT` / `DELETE /api/despensa/personas/:id` | Renombra o borra (`409` si tiene productos) |
| `GET` / `POST /api/despensa/productos` | Lista los productos o crea uno (`201`; el servidor pone id, versión y fechas) |
| `PUT` / `DELETE /api/despensa/productos/:id` | Edita o borra un producto |
| `POST /api/despensa/productos/:id/ajustar` | `{ delta }`: botones + y − sobre el valor actual |
| `GET` / `PUT /api/despensa/presupuesto` | `{ monthlyBudgetCents }` (número o `null`) |
| `POST /api/despensa/comprado` | `{ ids }` → completa hasta el objetivo; devuelve `{ changes, items }` |
| `POST /api/despensa/comprado/deshacer` | `{ changes }` → devuelve las cantidades anteriores, o `409` si algo cambió después |

Con sesión (sin ella, `401`):

| Método y ruta | Qué hace |
| --- | --- |
| `GET /api/data` | Todas las categorías, movimientos y recurrentes |
| `PUT /api/data` | Sustituye todo (restaurar una copia; se valida entera antes de tocar nada) |
| `PUT /api/movements/:id` | Crea o actualiza un movimiento |
| `DELETE /api/movements/:id` | Elimina un movimiento (si era un vencimiento, no se vuelve a crear) |
| `PUT /api/categories/:id` | Crea o actualiza una categoría |
| `DELETE /api/categories/:id?replacementId=…` | Elimina una categoría; sus movimientos pasan a otra |
| `PUT /api/recurring/:id` | Guarda un recurrente `{ rule, horizon, markPaidBefore }` y devuelve `{ created }` |
| `DELETE /api/recurring/:id` | Elimina un recurrente y sus vencimientos pendientes |
| `POST /api/occurrences/generate` | Crea los vencimientos que falten hasta `{ horizon }` |
| `GET` / `PUT /api/meta/:key` | Datos auxiliares (`lastBackupAt`) |
| `POST /api/import` | Importa los datos del navegador; responde 409 si ya hay datos |

Códigos de error:

| Código | Estado HTTP | Cuándo |
| --- | --- | --- |
| `VALIDATION` | 400 | Datos no válidos |
| `UNAUTHORIZED` | 401 | Ruta financiera sin sesión, o código incorrecto |
| `NOT_FOUND` | 404 | Ruta o dato que no existe |
| `CONFLICT` | 409 | Vencimiento duplicado, categoría en uso, importación con datos ya existentes, persona con productos o «Deshacer» tras otro cambio |
| `TOO_MANY_ATTEMPTS` | 429 | Demasiados códigos incorrectos desde este dispositivo |
| `INTERNAL` | 500 | Error inesperado; el detalle sale en la consola |

Variables de entorno del servidor. Los scripts `server` y `dev:server` también las leen de `.env`, si existe; una variable ya definida en el entorno tiene prioridad sobre `.env`.

| Variable | Valor por defecto | Para qué |
| --- | --- | --- |
| `CUENTAS_CODIGO` | **obligatoria** | Código de acceso a las cuentas (al menos 4 caracteres) |
| `CUENTAS_DB_PATH` | `server/data/cuentas.db` | Archivo de la base de datos |
| `CUENTAS_PORT` | `3001` | Puerto |
| `CUENTAS_HOST` | `127.0.0.1` | Dirección: por defecto, solo accesible desde este equipo |
| `CUENTAS_TEST=1` | desactivada | Modo pruebas |

La web usa `CUENTAS_API_URL` (por defecto `http://127.0.0.1:3001`) para saber adónde enviar `/api`.

## Decisiones de diseño

- **Céntimos enteros.** 12,34 € se guarda como `1234`. Nunca se suman decimales, así que no hay errores de redondeo. El campo de importe acepta `12,5`, `12.50` o `1.234,56`.
- **Fechas sin hora.** Se guardan como `"2026-10-28"` para que el cambio de zona horaria no mueva un gasto de día. La fecha de «hoy» la pone el navegador, no el servidor.
- **Real y previsto.** Un movimiento pagado cuenta en el mes de su fecha de pago; uno pendiente, en el mes de su fecha prevista. El resultado previsto es lo cobrado más lo pendiente de cobrar, menos lo pagado y lo pendiente de pagar en ese mes. Lo real se muestra en trazo sólido y lo previsto «a lápiz» (gris y líneas discontinuas), siempre con su etiqueta.
- **Recurrentes.** Al abrir la app se crean los vencimientos que falten hasta el final del mes siguiente, como pendientes. Cada vencimiento se identifica por *recurrente + fecha programada* con un índice único en la base de datos, así que no puede existir dos veces aunque se abran varias pestañas a la vez. Si borras un vencimiento, se anota para no volver a crearlo. Si un vencimiento cae en un día 31 y el mes no lo tiene, se usa el último día del mes.
- **Plantillas mensual y anual.** *Resumen* tiene dos vistas, Mes y Año, que comparten los mismos cálculos: reciben un periodo (`src/domain/period.ts`) en lugar de un año y un mes, así que una columna del año coincide siempre con ese mes. El mes añade un detalle por categoría y subcategoría (presupuesto, real, pendiente, total y lo que queda); el año, la evolución mes a mes, una tabla de categorías × meses y el presupuesto anual (el mensual × 12). Las dos se descargan como hoja de cálculo con el mismo formato que el CSV de movimientos.
- **Proyección de recurrentes.** Para los meses posteriores al horizonte de generación, los vencimientos de los recurrentes se calculan al vuelo y cuentan en la previsión como pendientes, marcados como «proyectados». No se guardan, así que no aparecen en Movimientos ni se pueden pagar hasta que la aplicación los cree. Respetan las cuotas, la fecha de fin y los vencimientos eliminados.
- **Marcar como pagado** modifica el mismo movimiento (estado y fecha de pago), no crea otro. Se puede ajustar el importe final, por ejemplo en una factura de luz.
- **Categorías** con un nivel de subcategorías (Vivienda › Luz). El gráfico y los presupuestos usan la categoría principal. La de ingresos se llama «Otros ingresos» para no confundirla con «Otros».
- **Copias.** La restauración valida todo el archivo (tipos, importes, fechas, ids repetidos, referencias) y pide confirmación antes de sustituir nada. El servidor vuelve a validarlo con las mismas reglas. El CSV usa `;`, coma decimal, fechas dd/mm/aaaa y gastos en negativo, para que Excel o LibreOffice lo abran bien.
- **Accesibilidad.** Formularios con etiquetas y errores asociados, foco en el primer campo con error, ventanas modales nativas (`<dialog>`), navegación con teclado y contraste AA en modo claro y oscuro. Revisado con axe sin incidencias.

## Límites de esta versión

- Los datos están en `server/data/cuentas.db`, **en este equipo**.
  - No hay cuentas de usuario ni sincronización, y el servidor solo escucha en `127.0.0.1` (el móvil llega a través de Vite con `--host`).
  - Si borras ese archivo, se pierden, salvo que tengas una copia. Por eso la app recuerda hacer copias y muestra la fecha de la última.
  - Para hacer una copia del archivo a mano, cierra antes la app (`cuentas.db-wal` puede tener cambios aún no pasados a `cuentas.db`). La copia JSON de *Ajustes* se puede descargar en cualquier momento.
- No está conectada al banco: el resultado del mes **no es un saldo**, es la diferencia entre lo que entra y lo que sale.
- Una sola moneda (euro).
- Los recurrentes solo crean vencimientos (que se pueden pagar o editar) hasta el final del mes siguiente. En meses más lejanos la previsión los proyecta con el importe de la regla: si sabes que un recibo cambiará, ajústalo cuando se cree.
- Al editar un recurrente se rehacen sus vencimientos pendientes con los datos nuevos. Si habías cambiado a mano alguno de esos pendientes, ese cambio se pierde (los ya pagados no se tocan).
- Los selectores de fecha son los nativos del navegador y muestran el formato de su idioma. Debajo de cada uno se repite la fecha en español («Miércoles, 28 de octubre de 2026») y el resto de la app usa siempre dd/mm/aaaa.
- El código de acceso es uno solo para toda la casa: no hay usuarios ni permisos por persona. Las personas de la despensa son solo apartados, no cuentas.
- La app va por HTTP en la red de casa: el código y los datos no viajan cifrados. No la expongas a Internet.
