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

## Código de acceso

Las cuentas solo se ven con un código que pones tú. Sin él, cualquiera de casa puede usar la **Despensa** y nada más.

1. Copia `.env.example` como `.env` (`cp .env.example .env`; en Windows, `copy .env.example .env`).
2. Escribe tu código en `CUENTAS_CODIGO=` (al menos 4 caracteres, que no sean solo espacios). `.env` no se sube al repositorio.
3. Arranca como siempre (`npm run dev`, o `npm run dev:server` + `npm run dev:web -- --host` para la red de casa). Sin código, el servidor avisa y no arranca, y no llega a abrir ni crear la base de datos.

Cómo funciona:

- **Invitado** (sin código): ve y edita la Despensa (personas, productos, tickets, presupuesto y lista de la compra). No ve el resumen, los movimientos, los recurrentes, los presupuestos ni los ajustes. Un enlace como `#resumen` también lleva a la Despensa.
- **Con el código** («Tengo el código»): toda la aplicación, con la Despensa en el menú.
- La protección está en el **servidor**: cualquier petición a una ruta financiera sin sesión responde `401`, aunque alguien la escriba a mano. Ocultar botones no bastaría, porque Vite reenvía `/api` al servidor.
- Al acertar el código, el servidor da una **sesión de 12 horas** en una cookie `HttpOnly` (el JavaScript de la página no la puede leer). Sobrevive a recargar la página. El código no se guarda en el navegador.
- **Cerrar sesión** está en *Ajustes › Sesión*. También se pierde al **reiniciar el servidor** (las sesiones viven en memoria): hay que volver a escribir el código.
- Tras **5 códigos incorrectos** desde el mismo dispositivo, se bloquean los intentos 15 minutos. Cada móvil cuenta por separado: el proxy de Vite pasa al servidor la IP real de cada uno.

> **Importante:** en la red de casa la app va por **HTTP**, sin cifrar. El código y los datos viajan por la wifi tal cual. Vale para casa, pero **no expongas la aplicación a Internet** (sin abrir puertos en el router ni túneles).

## Despensa

Lo que se compra en casa, separado por persona para que lo individual no se mezcle con lo compartido. Lo más cómodo es **escanear el ticket** después de cada compra: la app apunta qué se compró y cuándo, aprende cada cuánto se compra cada cosa y avisa de lo que conviene mirar. No hace falta ir contando lo que hay.

### Tickets de la compra

- **Escanear ticket**: una captura del ticket en la app de la tienda (en Lidl Plus: *Tickets*) o una foto del ticket de papel. Si el ticket es largo se pueden elegir varias capturas seguidas (hasta 6); las líneas repetidas entre una captura y la siguiente se quitan. También se puede pegar el texto del ticket (por ejemplo, el que llega por email).
- **Se lee en este equipo**: el texto se reconoce con Tesseract (OCR) en el propio servidor, con el modelo de español que se instala con `npm install`. No se envía nada a Internet y **las imágenes no se guardan**: solo los datos del ticket que confirmes. Antes de enviarla, el navegador prepara una copia: la gira y recorta si se lo pides, la divide en franjas si es muy larga y, solo si es una foto de poco contraste (papel gris), estira el contraste y la enfoca. La imagen original no se toca y es la que se ve al comparar. Si tiene poca resolución (menos de unos 11 píxeles por letra), avisa antes de leer. Una captura tarda unos segundos.
- **Dos lecturas por línea**: una del texto completo y otra solo de la columna de cifras. Se conservan las dos, y el texto original del OCR queda guardado con cada línea aunque se corrija.
- **Cada cifra se comprueba**, sin mirar nunca el total del ticket para decidirla:
  - **Precio × cantidad** («4,95X 2 9,90 A») y **peso × precio por kilo** («0,544 kg x 6,75 EUR/kg» = 3,67 €), en céntimos exactos. «5 KG» o «5 QUESOS» son parte del nombre, no la cantidad.
  - Si el importe leído no coincide (el OCR leyó «92,90»), la app busca qué campo tiene el error: si un error de una cifra en el importe lo explica y ninguno en el precio o la cantidad daría esa cifra, **propone el calculado (9,90 €)**; si los dos lo explicarían (5,08 frente a 2,84 × 2), **no elige ninguno** y te enseña las dos opciones. Una segunda lectura que coincide con el cálculo, o lo que confía el OCR en cada palabra, también cuentan.
  - Una lectura con cifras de más («2,939»), la letra del IVA leída como cifra («3,73 5» por «3,79B») o dos lecturas distintas marcan la línea, aunque el total cuadre.
  - Las letras parecidas a cifras («5,O8», «I,29») solo se cambian dentro de un importe; la B detrás del importe es la letra del IVA, no un 8.
- **Revisar antes de guardar**: tienda, fecha, total y cada producto con su importe. Cada línea dudosa aparece a la vista con su trozo de imagen, la cantidad, el precio, lo que leyó el OCR, lo calculado y por qué no coinciden, y tres acciones: **«Usar 9,90 €»**, **«Editar»** y **«Dejar pendiente»**. Cada línea está *leída sin dudas*, *confirmada* por ti, *sugerida* (falta confirmarla) o *pendiente*. Arriba se ve si el ticket **cuadra**, **no cuadra** (con la diferencia), está **incompleto** (faltan importes) o está **pendiente de confirmar** (la suma coincide, pero hay datos dudosos: dos errores pueden compensarse). Si el ticket trae el desglose de IVA, también se comprueba cada grupo. Las líneas del mismo producto van juntas, y los descuentos («Desc.») y las líneas de peso se asocian a su producto; las promociones y cupones generales quedan como ajustes. La publicidad de después del ticket (ofertas, puntos) no cuenta.
- **Solo lo fiable cambia la despensa**: una línea sugerida o pendiente se guarda en el ticket (con lo que leyó el OCR), pero no cambia precios, cantidades ni el ritmo de compra hasta confirmarla.
- **Cada producto** se puede asociar a uno que ya tengas, crear como nuevo (con su nombre, de quién es y cada cuánto se compra) o no seguirlo (bolsas, envases…). Una compra «para una ocasión» no cuenta para calcular cada cuánto se compra.
- **Aprende**: la próxima vez, el mismo texto del ticket se empareja solo con su producto (en cada tienda, y aunque el OCR se equivoque en una letra). Si un emparejamiento está mal, se cambia desde el ticket guardado y queda aprendido.
- **Últimas compras**: los tickets guardados, con sus líneas. Un ticket no se puede guardar dos veces. Borrar un ticket quita sus compras del ritmo de cada producto; los productos y lo aprendido se quedan, y las cantidades de los productos que se cuentan no se tocan.
- La lectura está afinada para los tickets de **Lidl** (app y papel). Los de otras tiendas se leen con reglas generales y conviene revisarlos con más calma.

### Lo que conviene mirar

- Cada producto muestra su **última compra**: «Comprado hace 5 días en Lidl (6 ud)».
- **Cuánto suele durar**: con dos compras o más, la mediana de lo que duró cada una (una compra rara no lo estropea). Si se sabe cuánto se compró, se escala: si 2 l duran 7 días, 4 l duran 14. Mientras no hay compras suficientes se usa la frecuencia del producto: 7 días (cada semana), 30 (cada mes) o 121 (de vez en cuando).
- **Para revisar**: cuando se acerca o se pasa ese plazo, el producto aparece arriba con tres botones:
  - **Queda**: todavía hay. Se vuelve a avisar unos días después (el 30 % de lo que suele durar, al menos 2 días), y cuenta para saber que dura más.
  - **Queda poco**: pasa a la lista de la compra, pero para aprender cuenta como «Queda» (todavía no se había acabado).
  - **Se acabó**: pasa a la lista de la compra y cuenta como lo que duró.
- Avisos: «Revisar pronto» (quedan pocos días), «Probablemente se acabó» (ya ha pasado lo que suele durar; entra en la lista), «Queda poco» y «Se acabó».
- **Lo he comprado**: apunta una compra sin ticket. Cada acción se puede deshacer desde el aviso que aparece.

### Repaso de la semana

Una vez a la semana, en un par de minutos, se mira lo que puede acabarse antes de la próxima compra y la lista queda hecha.

- **Cuándo**: a los 7 días del último repaso aparece arriba «Toca el repaso de la semana» (la primera vez, a los 7 días de empezar a usar la Despensa). «Hoy no» lo deja hasta mañana en una línea pequeña, solo en ese navegador. Se puede hacer en cualquier momento con «Repasar ahora».
- **Qué se repasa**: primero lo que ya conviene mirar, luego lo que puede acabarse en los próximos 7 días, lo que no tiene ninguna compra apuntada y, al final, lo que se cuenta. No se pregunta por lo que ya está en la lista ni por lo comprado hoy o ayer. Respeta la persona elegida arriba.
- **Cómo**: un producto cada vez, con botones grandes («Queda», «Queda poco», «Se acabó»); en los que se cuentan, − y +. Se puede saltar uno o volver atrás y cambiar la respuesta (la anterior se borra). Cada respuesta se guarda al momento: si se cierra a medias, lo hecho queda hecho.
- **Al terminar**: un resumen («Has repasado 8 productos; 3 han pasado a la lista») y el botón para abrir la lista de la compra y enviarla por WhatsApp. El día del repaso se guarda en el servidor, así que da igual desde qué móvil se haga.

### Productos, personas y lista

- **Personas**: cada una tiene su apartado. Arriba se elige «Compartido», una persona o «Todo». Una persona con productos no se puede borrar: primero hay que pasarlos a otra o eliminarlos.
- **Cómo se sigue cada producto**: **por compras** (lo normal, con los tickets) o **contando** (cuánto hay y cuánto quieres tener, con los botones − y +). Los productos nuevos van por compras; los que ya existían antes de los tickets se siguen contando, y se puede cambiar en cada producto.
- **Productos**: nombre, de quién es (o Compartido), unidad, frecuencia, precio estimado y notas; si se cuentan, también cuánto hay y cuánto quieres tener. Falta la diferencia entre lo que quieres tener y lo que hay. Puede haber más de lo previsto.
- **Unidades**: `ud`, `g`, `kg`, `ml`, `l`, `paquete`, `lata`, `botella`, `bolsa` y `docena`. Solo `g`, `kg`, `ml` y `l` admiten decimales (hasta 3). No se convierten entre sí.
- **Botones − y +** (al contar): restan o suman 1 (100 en `g` y `ml`, 0,5 en `kg` y `l`). Nunca bajan de cero. El servidor hace la cuenta sobre su valor actual, así que dos móviles a la vez no se pisan.
- **Frecuencia**: «Cada semana», «Cada mes» y «De vez en cuando». Al crear un producto desde un ticket se propone según el nombre (aceite, arroz, detergente… cada mes).
- **Precio**: por unidad (por kilo en `g` y por litro en `ml`). Vacío = no se sabe; 0 = gratis. Cada ticket lo actualiza.
- **Estimaciones**: lo que cuesta lo que falta y la **estimación mensual de toda la casa**. Por compras: lo que costó la última compra × las veces que se compra al mes (30,31 días ÷ lo que suele durar); sin tickets todavía, el precio estimado de una unidad. Contando: objetivo × precio × 4,33 si es semanal, × 1 si es mensual y × 0,25 si es ocasional. Los productos sin precio no cuentan y el resultado se marca como parcial. Los importes se calculan en céntimos exactos y cada línea se redondea una sola vez.
- **Presupuesto**: un presupuesto mensual de la despensa para comparar con esa estimación. Es solo una estimación: **no crea gastos, movimientos, presupuestos ni recurrentes** en las cuentas.
- **Lista de la compra**: lo que se acabó, queda poco o probablemente se acabó (con la cantidad de la última compra) y lo que falta de lo que se cuenta, agrupado en Compartido y cada persona, con negritas de WhatsApp y el total estimado. Se filtra por persona y frecuencia. Se puede:
  - **Enviar por WhatsApp**: abre WhatsApp con el texto escrito (sin enviarlo). Es la opción principal porque funciona aunque la app vaya por HTTP.
  - **Compartir**, si el navegador lo permite (por HTTP en la red de casa normalmente no).
  - **Copiar**: si el navegador no deja copiar solo, selecciona el texto para copiarlo a mano.
  - **Descargar .txt**.
  - **Marcar todo como comprado**: en los que se cuentan, completa lo que hay hasta el objetivo; en los que van por compras, apunta una compra de hoy. Durante unos segundos aparece **Deshacer**. Si mientras tanto alguien ha cambiado alguno de esos productos, no se deshace nada (para no pisar su cambio) y la app lo avisa.
- La Despensa se guarda en la misma base de datos SQLite, en tablas aparte. **Las copias JSON y los CSV no la incluyen** y restaurar una copia no la toca.

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
- La regla del día 31, las cuotas que quedan, el formato del CSV y la proyección de recurrentes.
- Las plantillas mensual y anual.
- El código de acceso: arranque sin código, rutas protegidas (`401`), cookie y caducidad de la sesión, cierre de sesión, sesiones que no sobreviven a un reinicio, y el bloqueo por intentos, por dispositivo y sin poder eludirlo con cabeceras inventadas (con un reloj controlado, sin esperar minutos).
- La despensa: personas, productos, presupuesto, unidades, cálculos sin restos decimales, el texto exacto de la lista, comprar y deshacer (también con cambios de otro dispositivo), la migración desde una base de datos anterior y que las copias financieras no la tocan.
- Los tickets: la lectura con el OCR de verdad de una captura de Lidl **inventada** (`shared/tickets/fixtures/`, con los datos que debe dar), la interpretación de las líneas (cantidades, pesos, descuentos, devoluciones, cifras y letras del IVA mal leídas), la corrección con el total, varias capturas seguidas, otras tiendas, lo aprendido y los nombres parecidos, guardar sin duplicar, cambiar una línea, borrar, la validación de las imágenes y la migración 003.
- El ritmo de compra: lo que dura cada producto (mediana, escalado por cantidad, compras del mismo día), «Queda», «Queda poco», «Se acabó», «Lo he comprado», los avisos, la lista y la estimación mensual.
- El repaso de la semana: cuándo toca (también la primera vez) y qué se repasa y en qué orden; la migración 004 conserva las revisiones que ya había.
- En el navegador: el invitado solo ve la despensa y no pide datos financieros; persona, producto, lista y enlace de WhatsApp; + y −, comprar y deshacer; copiar sin portapapeles; entrar con el código, cerrar sesión y sesión caducada; escanear la captura de un ticket, revisarla (cambiar un nombre, no seguir una línea), guardarla, verla en «Últimas compras» y no poder guardarla dos veces; días después, «Para revisar», «Queda», «Se acabó», la lista y deshacer una compra; y el repaso de la semana («Hoy no», un producto cada vez, volver atrás y cambiar la respuesta, contar con − y +, y la lista hecha al final).

## Estructura

El código está organizado **por módulo**: finanzas (`finance`), despensa (`pantry`) y tickets de la compra (`tickets`). Cada módulo tiene las mismas piezas en tres sitios:

| Pieza | Dónde | Qué hace |
| --- | --- | --- |
| Dominio | `shared/<módulo>/` | Tipos, reglas y cálculos en TypeScript puro (sin React, sin base de datos, sin reloj). Lo usan la web y el servidor. Con pruebas. |
| Servidor | `server/<módulo>/` | Repositorio SQLite, rutas de la API y, si hace falta, un servicio que orquesta varios pasos. |
| Web | `src/<módulo>/` | Provider con el estado (escribir → releer), cliente de la API, páginas y componentes. |

Reglas para mantenerlo así:

- **Las reglas van en `shared/`.** Un repositorio solo lee y escribe; si tiene que decidir algo (qué producto crear, qué precio poner…), esa decisión es una función pura en `shared/` que devuelve un plan, y el repositorio lo aplica (ver `shared/tickets/savePlan.ts`).
- **Las rutas son finas**: comprueban la petición con un validador de `shared/` (o de `server/<módulo>/request.ts`) y llaman al repositorio o al servicio.
- **El estado de la web sigue un solo patrón**: el Provider de cada módulo guarda en el servidor y vuelve a leer el módulo. Los componentes toman las acciones del contexto (`useFinance`, `usePantry`, `usePantryActions`), no por props.
- **Un módulo no importa a otro**, salvo `tickets`, que forma parte de la despensa y usa sus tipos. Lo común está en `shared/core`, `src/ui`, `src/api` y `server/infra`.

```
shared/                       Dominio puro (lo usan la web y el servidor), con sus pruebas
├── core/                     Fechas «AAAA-MM-DD», importes en céntimos, periodos, ids y ValidationResult
├── finance/                  Categorías, movimientos, recurrentes, resumen, año, copias, CSV, validación
│   └── FinanceRepository.ts  El contrato del almacenamiento de las finanzas (lo cumplen el servidor y el cliente de la API)
├── pantry/                   Despensa: cantidades, lista y estimaciones (pantry.ts), modo de seguimiento
│                             (tracking.ts), ritmo de compra (rhythm.ts), repaso de la semana (review.ts), validación
├── tickets/                  Tickets: leerlos (parse.ts y parse/ paso a paso), emparejar productos (match.ts),
│   │                         comprobar cifras (arithmetic.ts, evidence.ts), validar y planear el guardado (savePlan.ts)
│   └── fixtures/             Tickets INVENTADOS para las pruebas: imágenes, lo que lee el OCR y lo que debe salir
└── test/factories.ts         Datos de prueba
server/                       Node.js + Express + SQLite (se ejecuta con tsx)
├── index.ts                  Arranque: variables de entorno (código obligatorio), puerto y cierre ordenado
├── app.ts                    La aplicación Express: crea el SqliteContext y los repositorios y monta las rutas
│                             (públicas → requireAdmin → finanzas)
├── infra/                    SqliteContext (conexión, reloj, ids, transacciones), base de datos y migraciones,
│                             formato HTTP y errores, código de acceso, /health y el reinicio de pruebas
├── finance/                  SqliteFinanceRepository y rutas /data, /movements, /categories, /recurring, /meta
├── pantry/                   SqlitePantryRepository y rutas /despensa (personas, productos, revisiones, compra)
├── tickets/                  Repositorio de tickets, TicketService (leer: OCR → ticket → sugerencias),
│                             comprobación de la petición, OCR con Tesseract y rutas /despensa/tickets
└── data/                     Aquí se crea cuentas.db (fuera de git: son tus datos)
src/                          La web (React)
├── main.tsx · Root.tsx       Entrada; con el código, la app completa; sin él, GuestApp (solo la despensa)
├── App.tsx · GuestApp.tsx    Estructura, navegación y ventanas de edición
├── ui/                       Componentes comunes (Dialog, forms, Icon, Section, avisos…) y utilidades
├── api/                      Cliente de /api y textos de error
├── auth/                     Sesión: AuthProvider, «Tengo el código» y cerrar sesión
├── finance/                  FinanceProvider, cliente de la API, páginas (Resumen, Año, Movimientos,
│                             Recurrentes, Presupuestos, Ajustes) y componentes
├── pantry/                   PantryProvider, cliente de la API, DespensaPage, componentes y preparar las fotos de los tickets
└── styles/                   Estilos por módulo; index.css los carga en orden
e2e/                          Pruebas en navegador: finanzas (app), despensa y acceso, tickets y repaso
ejemplo/                      Copia de seguridad con datos de ejemplo
```

## Base de datos

Trece tablas, solo con lo que usa la aplicación:

| Tabla | Contenido |
| --- | --- |
| `categories` | Categorías y subcategorías (`parent_id`, un solo nivel). El presupuesto mensual es una columna (`budget_cents`). |
| `movements` | Ingresos y gastos, realizados o pendientes. Incluye los vencimientos de los recurrentes (`recurring_id`, `occurrence_date`) y el número de cuota. |
| `recurring_rules` | Pagos y cobros recurrentes. Las financiaciones son recurrentes con un número de cuotas (`installments`). |
| `recurring_excluded_dates` | Vencimientos eliminados que no deben volver a crearse. |
| `meta` | Datos auxiliares: fecha de la última copia. |
| `pantry_people` | Personas de la despensa. |
| `pantry_items` | Productos: dueño (`owner_id`, `NULL` = Compartido, borrado restringido), unidad, cantidades, frecuencia, precio en céntimos (`NULL` = desconocido), cómo se sigue (`tracking`: `compras` o `cantidad`) y `version`, que sube en cada escritura para poder deshacer sin pisar cambios. |
| `pantry_settings` | Una sola fila con el presupuesto mensual de la despensa y el día del último repaso de la semana (`last_review_date`, `NULL` = ninguno todavía). |
| `pantry_tickets` | Tickets guardados: tienda, dirección, fecha, hora, total y una huella única (tienda, fecha, hora y total) para no guardarlos dos veces. Sin imágenes. |
| `pantry_ticket_lines` | Las líneas de cada ticket tal como venían (nombre, cantidad, importes, descuento, peso, letra del IVA, «para una ocasión») y su producto (`NULL` = no se sigue; si se borra el producto, la línea se queda). |
| `pantry_aliases` | Lo aprendido: qué producto es cada nombre de ticket en cada tienda, o que no se sigue. Se borra con su producto. |
| `pantry_events` | «Queda», «Queda poco», «Se acabó» y «Lo he comprado» de cada producto, con su fecha. |
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
- **Migraciones**: cada una se aplica una sola vez, en una transacción, y queda anotada. La `002-despensa` añade las tablas de la despensa sin tocar las demás. La `003-tickets` añade las de los tickets y la columna `tracking`; los productos que ya había siguen contándose (`cantidad`). La `004-repaso` añade el día del último repaso y la revisión «Queda poco»: como SQLite no deja cambiar una regla `CHECK`, copia `pantry_events` entera a una tabla nueva sin perder ninguna fila. Los cambios futuros serán migraciones nuevas (`005-…`) que no borran datos. Una base de datos de una versión más nueva no se abre.

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
| `GET` / `POST /api/despensa/productos` | Lista los productos o crea uno (`201`; el servidor pone id, versión y fechas; `tracking` es `cantidad` si no se indica) |
| `PUT` / `DELETE /api/despensa/productos/:id` | Edita o borra un producto |
| `POST /api/despensa/productos/:id/ajustar` | `{ delta }`: botones + y − sobre el valor actual |
| `POST /api/despensa/productos/:id/revision` | `{ kind, date }` con `kind` = `queda`, `poco`, `se_acabo` o `comprado` (`201`) |
| `DELETE /api/despensa/revisiones/:id` | Deshace una revisión |
| `GET` / `PUT /api/despensa/presupuesto` | `GET` da `{ monthlyBudgetCents, lastReviewDate }`; `PUT` recibe `{ monthlyBudgetCents }` (número o `null`) |
| `PUT /api/despensa/repaso` | `{ date }`: apunta el día del repaso de la semana |
| `POST /api/despensa/comprado` | `{ ids, date }` → completa hasta el objetivo (los que se cuentan) o apunta una compra (los que van por compras); devuelve `{ changes, items }` |
| `POST /api/despensa/comprado/deshacer` | `{ changes }` → lo deja como estaba, o `409` si algo cambió después |
| `POST /api/despensa/tickets/leer` | `{ imagenes: [base64…] }` (PNG o JPEG, hasta 6 de 8 MB) o `{ texto }`, y `{ hoy }` → el ticket leído, lo que se propone para cada producto y si ya estaba guardado. No guarda nada |
| `GET` / `POST /api/despensa/tickets` | Lista los tickets o guarda uno revisado (`201`; `409` si ya estaba guardado) |
| `GET` / `DELETE /api/despensa/tickets/:id` | Un ticket con sus líneas, o borrarlo |
| `PUT /api/despensa/tickets/:id/lineas/:lineId` | `{ itemId }` (o `null`): cambia el producto de esa línea y de las iguales, y lo aprendido |
| `GET /api/despensa/actividad?hoy=` | Compras y revisiones de los últimos 400 días, para el ritmo de compra |

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

Códigos de error:

| Código | Estado HTTP | Cuándo |
| --- | --- | --- |
| `VALIDATION` | 400 | Datos no válidos, o una imagen de ticket que no se puede leer |
| `UNAUTHORIZED` | 401 | Ruta financiera sin sesión, o código incorrecto |
| `NOT_FOUND` | 404 | Ruta o dato que no existe |
| `CONFLICT` | 409 | Vencimiento duplicado, categoría en uso, persona con productos, ticket ya guardado o «Deshacer» tras otro cambio |
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
- **Plantillas mensual y anual.** *Resumen* tiene dos vistas, Mes y Año, que comparten los mismos cálculos: reciben un periodo (`shared/core/period.ts`) en lugar de un año y un mes, así que una columna del año coincide siempre con ese mes. El mes añade un detalle por categoría y subcategoría (presupuesto, real, pendiente, total y lo que queda); el año, la evolución mes a mes, una tabla de categorías × meses y el presupuesto anual (el mensual × 12). Las dos se descargan como hoja de cálculo con el mismo formato que el CSV de movimientos.
- **Proyección de recurrentes.** Para los meses posteriores al horizonte de generación, los vencimientos de los recurrentes se calculan al vuelo y cuentan en la previsión como pendientes, marcados como «proyectados». No se guardan, así que no aparecen en Movimientos ni se pueden pagar hasta que la aplicación los cree. Respetan las cuotas, la fecha de fin y los vencimientos eliminados.
- **Marcar como pagado** modifica el mismo movimiento (estado y fecha de pago), no crea otro. Se puede ajustar el importe final, por ejemplo en una factura de luz.
- **Categorías** con un nivel de subcategorías (Vivienda › Luz). El gráfico y los presupuestos usan la categoría principal. La de ingresos se llama «Otros ingresos» para no confundirla con «Otros».
- **Copias.** La restauración valida todo el archivo (tipos, importes, fechas, ids repetidos, referencias) y pide confirmación antes de sustituir nada. El servidor vuelve a validarlo con las mismas reglas. El CSV usa `;`, coma decimal, fechas dd/mm/aaaa y gastos en negativo, para que Excel o LibreOffice lo abran bien.
- **Tickets con OCR local.** Los tickets se leen con [tesseract.js](https://github.com/naptha/tesseract.js) y el modelo de español de `@tesseract.js-data/spa`, los dos dentro de `node_modules`: no hace falta Internet ni una cuenta en ningún servicio, y las compras no salen de casa. Cada captura se lee dos veces: una para el texto y otra, solo con cifras, para la columna de importes. El total del ticket sirve de comprobación: entre lo leído y lo que se puede calcular (cantidad × precio, peso × precio por kilo) se elige la combinación que cuadra, y lo que no se puede asegurar se marca para revisar en lugar de inventarlo. El lector se abre la primera vez que se usa y se cierra tras 5 minutos sin uso.
- **Por compras, no por inventario.** Contar lo que hay en casa es pesado y se desactualiza; con los tickets la app ya sabe qué se compró y cuándo. Por eso los productos nuevos se siguen por compras, y contar queda como opción para quien lo prefiera.
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
- Los tickets:
  - Las capturas nítidas de la app se leen bien; una foto movida, arrugada o con poca luz puede dejar importes ilegibles o dudosos, que la revisión marca. Conviene mirar siempre que «Cuadra con el total».
  - La lectura está afinada para Lidl. En otras tiendas se leen con reglas generales, sin el formato concreto de cada una.
  - Una compra solo «cuenta» si se guarda su ticket o se pulsa «Lo he comprado»: lo comprado sin apuntar hará que la app avise antes de tiempo (con «Queda» se corrige).
  - Los tickets y su historial son parte de la Despensa: los ve y los cambia cualquiera de casa, también sin el código, y no aparecen en las cuentas ni en las copias.
- La app va por HTTP en la red de casa: el código y los datos no viajan cifrados. No la expongas a Internet.
