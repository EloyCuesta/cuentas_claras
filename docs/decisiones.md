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

**Tickets con OCR local.** Los tickets se leen con tesseract.js y el modelo de español de `@tesseract.js-data/spa`, los dos en `node_modules`: no hace falta Internet ni una cuenta en ningún servicio, y las compras no salen de casa. Cada importe se lee varias veces: el texto, la banda de importes solo con cifras y, con imágenes de pantalla, esa banda a otra escala (ver «De la lectura de tickets de Lidl Plus»). Sin una banda clara (otro formato de ticket), si la relectura del final de la línea no trae ningún importe, se repite una vez con un margen más ajustado (Tesseract es sensible al margen; la medición está en el lector): una lectura más que comparar, nunca un importe aceptado sin más. El total del ticket sirve de comprobación, nunca para decidir un importe: lo que no se puede asegurar se marca para revisar en lugar de inventarlo. El lector se abre la primera vez que se usa y se cierra tras 5 minutos sin uso. Las imágenes no se guardan.

**Por compras, no por inventario.** Contar lo que hay en casa es pesado y se desactualiza; con los tickets la app ya sabe qué se compró y cuándo. Por eso los productos nuevos se siguen por compras, y contar queda como opción.

**Accesibilidad.** Formularios con etiquetas y errores asociados, foco en el primer campo con error, ventanas modales nativas (`<dialog>`), navegación con teclado y contraste AA en modo claro y oscuro, revisado con axe sin incidencias.

## De la reestructuración (octubre de 2026)

**Arquitectura hexagonal modular en el servidor.** Cada área es un módulo (auth, finance, pantry, tickets y health), con casos de uso separados de HTTP y de SQL, y puertos para cada dependencia externa. `server/app.ts` los compone a mano: sin contenedores de inyección ni ORM. Así se puede cambiar o probar una pieza sin tocar las demás, y un agente sabe dónde va cada cosa. Lo vigila `tests/architecture.test.ts`. Detalle en `docs/arquitectura.md`.

**El dominio compartido en `shared/`.** La lógica pura que usan la web y el servidor dejó src/domain/ y se reparte por áreas (`common`, `finance`, `pantry` y `tickets`, con `tickets → pantry → common` y `finance → common`). No importa paquetes ni Node, y `tsconfig.shared.json` lo comprueba sin tipos de Node ni de Vite. Se importa con `#shared/…` (campo `imports` de `package.json`), que funciona igual en tsx, Vite, Vitest y `tsc -b`, sin dependencias nuevas.

**Puertos síncronos y una sola UnitOfWork** (hasta la fase MYSQL, que los hizo async: ver abajo). better-sqlite3 es síncrono y sus transacciones no admiten trabajo async (lanza un error si se intenta), así que los puertos de persistencia y `UnitOfWork.run` eran síncronos. Solo el OCR era async. Hay una única UnitOfWork, creada en `server/app.ts` y compartida: cuando tickets crea un producto con el caso de uso de la despensa, la transacción se anida (savepoint) y todo sigue siendo atómico.

**Un reloj y unos ids comunes.** Antes, auth recibía un reloj en milisegundos y la despensa un `now` en ISO. Ahora hay un `Clock` (`nowMs`, `nowISO` y `today`) y un `IdGenerator` en `server/common/ports.ts`. Los ids de la despensa y los tickets salen del mismo `crypto.randomUUID` que los de finanzas (UUID v4 igual que antes).

**Hasher para las huellas de los tickets.** `node:crypto` no puede estar en application/, así que el SHA-256 de las huellas va detrás de un puerto (`Hasher`). El texto del que sale cada huella está en `server/modules/tickets/domain/ticketIdentity.ts`, y un test golden asegura que las huellas ya guardadas siguen coincidiendo.

**Lo que se quedó en el SQL.** Qué líneas cuentan para el ritmo de compra (con producto, verificadas y no «para una ocasión») se filtra en la consulta, para no leer todas las líneas. La agrupación y las devoluciones están en el dominio.

**`imageInfo` en `server/common/`.** Leer el tamaño de una imagen PNG o JPEG lo usan dos adaptadores de tickets (el router, para validar, y Tesseract, para medir). En `server/common/imageInfo.ts` ningún adaptador importa otro.

**Migraciones congeladas.** Las migraciones publicadas no se editan, y un test guarda su huella. Al pasar el dominio a `shared/` solo cambió la línea del import de `DEFAULT_CATEGORIES` en la 001, porque la ruta antigua dejaba de existir; el SQL y los datos son los mismos.

**La web por funcionalidades.** `src/features/{auth,finance,pantry,tickets}` con su `index.ts`, más `src/ui/` (genérico) y `src/api/` (el cliente). Solo los clientes hacen peticiones. Las acciones de los tickets siguen en `usePantry`, porque guardar un ticket recarga toda la despensa; la feature tickets define `TicketActions` y la dependencia va solo de pantry a tickets. Detalle en `docs/frontend.md`.

**Documentación para agentes.** Un `AGENTS.md` en la raíz, en cada zona, en cada módulo y en cada feature, con un `CLAUDE.md` al lado que solo contiene `@AGENTS.md`, y reglas cortas en `.claude/rules/`. Lo comprueba `tests/docs.test.ts`. `.claude/settings.json` impide que un agente lea `server/data/` y `.env`.

**better-sqlite3 12.11.1.** La 13 no trae binarios para Windows con Node 24 y `npm install` falla al compilarla; la 12.11.1 instala los suyos precompilados. Desde la fase MYSQL el servidor no lo usa: solo el esquema de antes (`tools/sqlite/`) y el importador, que se ejecutan desde el repositorio. Por eso es una dependencia de desarrollo (`devDependencies`): `npm install` lo sigue instalando, `npm install --omit=dev` no, y la app no lo necesita para arrancar.

**Pruebas e2e con el Chrome instalado.** En el equipo de desarrollo la descarga de Chromium de Playwright caduca; `CUENTAS_E2E_CHANNEL=chrome` usa el Chrome del sistema (una opción que ya tenía `playwright.config.ts`).

**Los tipos de las e2e también se comprueban.** `e2e/` y `playwright.config.ts` no estaban en ningún tsconfig. Ahora `tsconfig.e2e.json` los incluye en `tsc -b`, con la librería DOM porque el código de `page.evaluate` se ejecuta en el navegador.

**Cómo se hizo.** Se hizo en pasos pequeños y con `npm run check` en verde en cada commit. Primero se midió la línea base: 359 tests de Vitest y 46 pruebas e2e. Los movimientos se hicieron con `git mv` y en commits separados de los que reparten la lógica. Antes de tocar los tickets se escribió un test golden de las huellas con el código de entonces. Al terminar hay 376 tests, porque se añadieron 17 (arquitectura, documentación y guardas) y no se quitó ninguno, y siguen pasando las 46 pruebas e2e.

## De la fase MYSQL (noviembre de 2026)

**MySQL local en lugar de SQLite, antes que .NET.** La persona administra sus datos con MySQL Server 8.4 y MySQL Workbench. Se cambia primero el motor, con el mismo Express y la misma API, para que el corte de datos y el de backend no lleguen a la vez: el backend .NET usará después esta misma base. Detalle y estado en [STATUS.md](migration/STATUS.md).

**mysql2 con SQL explícito, sin ORM.** mysql2 es un driver: las consultas siguen escritas a mano, con parámetros, como con better-sqlite3. El pool usa `decimalNumbers` y `dateStrings` (DECIMAL como número y fechas como texto, nunca un `Date`) y una sentencia por llamada.

**Puertos async y una UnitOfWork con una conexión.** Con MySQL todo lo que toca la base de datos es async. `UnitOfWork.run` usa una sola conexión de principio a fin (AsyncLocalStorage), y las llamadas anidadas se unen a la de fuera con un savepoint, como hacía better-sqlite3. Lo vigila `tests/architecture.test.ts`.

**Bloqueos explícitos.** better-sqlite3 lo serializaba todo; MySQL no. Las escrituras de finanzas toman la fila `finance` de `app_locks`, las de tickets la fila `tickets`, y lo que cambia productos los bloquea con `SELECT … FOR UPDATE` en orden de id. El bloqueo va siempre primero: con REPEATABLE READ, una lectura anterior fija una instantánea que no vería lo que otra conexión confirmó después. Un interbloqueo se reintenta una vez.

**utf8mb4_0900_bin en todo.** Compara como SQLite: mayúsculas, tildes y espacios finales cuentan. La colación por defecto (`utf8mb4_0900_ai_ci`) uniría ids y claves distintas, y `utf8mb4_bin` iguala los espacios finales.

**El esquema en archivos .sql versionados.** `database/mysql/`, con su propio `schema_migrations`, para que .NET aplique exactamente lo mismo. La primera es la versión 5 (el esquema final de SQLite), y una migración a medias se explica en vez de continuar, porque el DDL de MySQL se confirma solo.

**Pruebas con MySQL real.** Ni SQLite ni falsos en su lugar: cada archivo crea sus bases `cuentas_test_*` y las borra. Los contratos de BASE-01 pasan sin tocar sus expectativas: la API no cambió. La prueba de atomicidad provoca una clave primaria repetida en vez de usar un trigger, que con el registro binario activo exige SUPER.

## Del backend .NET (noviembre de 2026)

**MySqlConnector con SQL explícito, solo en Infrastructure.** Es el proveedor de .NET para MySQL, autorizado en DATA-01 con la versión exacta 2.6.2 (licencia MIT). Como mysql2 en Express, es un driver: las consultas siguen escritas a mano, con parámetros, y no hay ORM. Pomelo, el proveedor de EF Core, no tiene versión para EF Core 10. Ni Api ni las capas puras usan sus tipos: lo vigila ArchitectureTests.

**Las mismas migraciones, incrustadas.** El ensamblado de Infrastructure lleva los .sql de `database/mysql/` tal cual, con el mismo historial, la misma clave de GET_LOCK, los mismos estados (base nueva, existente, a medias, más nueva) y los mismos mensajes que Express. Una base que migró uno la abre el otro sin tocarla. Las categorías iniciales se generan en C# como en `shared/finance/categories.ts`, y una prueba las compara con el contrato `http-testing.json`.

**El host .NET puede arrancar sin base de datos.** Sin CUENTAS_DB_USER sirve solo el acceso, y la salud responde 500. Así los E2E de acceso siguen aislados de cualquier base, y `playwright.dotnet.config.ts` lo fuerza aunque el entorno tenga CUENTAS_DB_*. Con CUENTAS_DB_USER, un fallo de MySQL impide arrancar, como en Express.

**Las reglas de tickets en C# siguen a JavaScript, no a .NET (TIC-01).** El corpus `fixtures/migration/rules-tickets.json` manda: C# tiene que dar el mismo resultado con la cultura es-ES y con la invariante. Por eso `backend/src/CuentasClaras.Domain/Common/` reproduce lo que .NET hace distinto: Math.round, String(x) y toFixed, trim y \s, toUpperCase y toLowerCase (con tablas generadas desde Node, porque la invariante de .NET no pasa «ı» a «I» ni «İ» a minúscula y su Unicode depende del Windows), JSON.stringify y las expresiones regulares (copiadas del TypeScript y traducidas al cargar). Lo que usa \p{L} con la bandera u se programa por puntos de código: RegexOptions.ECMAScript no admite \p{L}.

**Tickets sin Domain.Pantry.** ArchitectureTests no deja que un módulo de Domain use otro, y la despensa en C# es de PAN-01. Lo que las reglas de tickets necesitan de la despensa va en tipos propios mínimos: TicketVocabulary (frecuencias, unidades de compra y los límites MAX_PANTRY_CENTS y PANTRY_NAME_MAX), CatalogItem (id y nombre de un producto, para emparejar) y TicketPurchase (la compra que da el historial, con los campos de PantryPurchase). Desde PAN-01 existe Domain.Pantry y una prueba (`backend/tests/CuentasClaras.Tests/PantryRulesCorpusTests.cs`, TicketVocabularyTests) exige que sus valores coincidan con estos; la despensa leerá las compras por un puerto de lectura, como dice ARCHITECTURE.md. No se cambia la regla de arquitectura.

**La validación del cuerpo de los tickets, en Application.** validateTicketSave y validateLineUpdate reciben JSON sin tipar, como ReadCode recibe el cuerpo del login en Api. Pero usan reglas de Domain.Tickets (nameKey, lineProblems, checkTicket) y Api no puede referenciar Domain, así que están en `backend/src/CuentasClaras.Application/Tickets/TicketRequests.cs` y reciben un JsonElement (Undefined es «sin cuerpo»). `backend/src/CuentasClaras.Application/Common/JsonInput.cs` da la semántica de JSON.parse: undefined frente a null, typeof, ±Infinity y sustitutos sueltos. Un campo que es uno de varios textos (el origen del importe, el tipo de ajuste…) tiene que ser un texto: una lista como `["read"]` no vale, aunque String() la convierta en «read». La ruta convertirá el error en un 400 VALIDATION, como ReadCode.

**Una tabla de rutas por módulo y casos de uso que reciben el cuerpo (FIN-01).** Cada módulo registra sus rutas en una tabla (`backend/src/CuentasClaras.Api/Common/ApiRoutes.cs`) con las reglas de Express: barra final, mayúsculas en los segmentos fijos, HEAD como GET, 401 sin sesión antes de mirar nada en las finanzas, y parámetros decodificados con decodeURIComponent (un escape roto da el mismo 500 que Express) y la query como querystring de Node (un parámetro repetido no es un texto). Como Api no puede tocar Domain, el caso de uso recibe el JsonElement, lo valida con FinanceRequests (el mismo orden y los mismos mensajes que `shared/finance/backup.ts`, comprobados con el corpus `fixtures/migration/rules-finance.json`) y devuelve vistas de Application. Un host sin base de datos registra igualmente las rutas de datos y responde 500 si se usan, como la salud.

**La app real contra .NET en los E2E (FIN-01).** `playwright.dotnet.config.ts` ejecuta los mismos `e2e/*.spec.ts` de Express contra Kestrel y una base propia (`cuentas_test_e2e_dotnet`), con la web construida aparte. Como .NET no tiene la ruta de reinicio de pruebas (y no debe tenerla), la base se vacía con SQL directo desde `e2e/dotnet/database.ts`, que comprueba antes en qué base está. Mientras se migraba, las pruebas pasaban a .NET con una etiqueta cuando existían sus rutas, y lo poco que la app pedía al abrir y aún faltaba se respondía en el navegador como con la base vacía; cada ID lo retiraba. Así cada entrega se comprobó con la interfaz real sin esperar a que estuviera todo. Desde TIC-04 no queda nada simulado y se ejecutan todas.

**Un alta no se repite por un fallo de red (FIN-02).** El id de un movimiento, un recurrente o una categoría nuevos se decide al abrir su formulario, así que reintentar después de un error envía el mismo registro (el servidor lo actualiza en lugar de crear otro). Y si la escritura se confirmó pero la relectura de los datos falla, la acción no se da por fallida: el diálogo se cierra y un aviso (tono `warning`) explica que se guardó y que basta con recargar la página. Vale igual con Express y con .NET.

**Los resúmenes, en el servidor solo con .NET (FIN-04).** .NET añade GET /api/summary/month y /api/summary/year, que calculan lo que enseñan las plantillas (cuenta, gastos por categoría, presupuestos, detalle, evolución y categorías por meses, con lo proyectado de los recurrentes sin guardarlo). Express no las tiene: mientras sea el backend de uso diario, la web sigue calculando en el navegador. Para no duplicar reglas, las dos formas salen de `shared/finance/summaryViews.ts`: las páginas lo usan contra Express, el generador del corpus lo usa para las expectativas y C# lo reproduce. La web elige al compilarse (`CUENTAS_BACKEND=dotnet`, por `define` en `vite.config.ts`), no preguntando al servidor: así no hay peticiones que fallan a propósito. Siguen en el navegador la lista de pendientes guardados (se pagan desde ahí), los CSV, los filtros y el estado de los recurrentes.

**Editar un producto exige la versión con que se abrió (PAN-01).** Antes, PUT /api/despensa/productos/:id sobrescribía siempre: si alguien pulsaba + en otro móvil (o editaba el mismo producto) mientras se editaba, el último en guardar pisaba al otro sin enterarse. Ahora el cuerpo lleva `expectedVersion`, la versión del producto con que se abrió el formulario, obligatoria y validada con el resto del cuerpo. El servidor bloquea el producto (FOR UPDATE) y, si la versión ya no es esa, responde 409 sin escribir nada. Es un cambio de contrato a propósito, en Express y en .NET a la vez, con los pasos nuevos en `fixtures/migration/http-pantry.json`. La web conserva lo escrito y ofrece «Volver a cargar el producto»: es la persona quien decide, porque reintentar sola con la versión nueva pisaría igual el cambio del otro. El POST de creación no lleva versión.

**Los contratos de la despensa para los tickets (PAN-01).** Tickets solo puede usar de Pantry lo que está en `Application.Pantry.Contracts` (lo vigila ArchitectureTests): IPantryCatalog, con lo que hoy usa de PantryApi (bloquear, leer, crear y listar productos), y sus propios registros (PantryItemView, NewPantryItem), porque Domain.Pantry no es visible desde Tickets. Lo implementa PantryCatalog con los mismos casos de uso que las rutas; dentro de una transacción de tickets se une a ella. Desde PAN-02 también aplica lo que deja un ticket en precio y cantidad (ApplyTicketPurchase); las revisiones llegan con PAN-03.

**La actividad es de la despensa, y las compras le llegan de los tickets (PAN-03).** En Express, GET /api/despensa/actividad está en el módulo tickets y pide las revisiones a la despensa. En .NET es al revés, como pide ARCHITECTURE.md: la consulta es de Pantry (PantryActivityQueries), con sus revisiones, y las compras le llegan por IPantryPurchaseHistory, un contrato de `Application.Pantry.Contracts` que implementa Tickets en Infrastructure (MySqlTicketPurchaseHistory, con el SQL de purchaseLinesSince y PurchaseHistory de Domain.Tickets). Así Pantry no conoce los tickets, y la respuesta es la misma.

**El OCR de .NET es el de Express, en un proceso Node aparte (TIC-02).** La persona eligió no cambiar de motor: tesseract.js con el modelo de español de node_modules, el mismo código (TesseractTicketReader) y las mismas dos pasadas. `server/modules/tickets/adapters/tesseract/ocrWorker.ts` es una entrada fina que solo reconoce imágenes: no abre la base de datos ni la red. .NET la lanza con `node --import tsx` desde la raíz del repositorio (NodeTicketReader, en Infrastructure detrás de ITicketReader) y habla con ella por stdin/stdout, una línea JSON por petición, de una en una y con un tiempo máximo de 3 minutos; si el proceso muere o no responde, se para y la siguiente lectura arranca otro, y se cierra con el host. La ruta se puede cambiar con `CUENTAS_OCR_WORKER`. Si no arranca, la lectura da el 400 de siempre y la consola explica la causa. El coste: el host .NET necesita Node y node_modules mientras lea imágenes.

**Los bytes de las imágenes, como en Node (TIC-02).** Las huellas de origen de las imágenes se calculan sobre los bytes decodificados, así que .NET decodifica el base64 como `Buffer.from(texto, 'base64')`, que no rechaza nada: el byte bajo de cada carácter, `-` y `_` como `+` y `/`, lo demás se salta y para en el primer `=`. Convert.FromBase64String rechazaría cuerpos que Express acepta y daría otras huellas. La cabecera de PNG y JPEG se lee igual que `server/common/imageInfo.ts`. Lo fija el corpus `fixtures/migration/rules-ticket-read.json`.

## De la lectura de tickets de Lidl Plus (noviembre de 2026)

**Medir antes de cambiar.** Las pruebas estaban en verde, pero ninguna usaba una imagen de Lidl Plus como la que da la app. Con un ticket real, la lectura perdía la mitad de los productos y dejaba cifras mal sin aviso.

Antes de tocar nada se hizo un banco de medida (`tools/banco-tickets/`, en `docs/pruebas.md`):
- mide el mismo camino que la app: la preparación del navegador, el lector real y `parseTicket`;
- usa tickets sintéticos con el formato de Lidl Plus, en sus variantes, y los reales de la persona, que no salen de su carpeta.

Cada cambio de la lectura se decide con su tabla. Lo que cuenta primero es **ninguna cifra mal sin marcar**; después, cuántas líneas salen limpias. La tabla de partida está en `tools/banco-tickets/partida.md`.

**La escala, por la altura de las letras y no por el ancho.** Antes, toda imagen se llevaba a 1300-1800 px de ancho. La imagen completa de Lidl Plus (1080 px, mayúsculas de unos 27 px) se ampliaba así a mayúsculas de unos 33 px, y con letras tan grandes Tesseract separa la columna de importes y la pierde, a veces en una franja entera. No es una pendiente sino un precipicio.

Ahora se mide la altura de las mayúsculas en la imagen y se escala para dejarla en `TARGET_TEXT_HEIGHT` = 21 px. Medido con el banco sintético (18 casos):

| Altura objetivo | Líneas limpias |
| --- | --- |
| 20 px | 85 % |
| 21 px | 88 % |
| 22 px | 85 % |
| 24 px | 43 %: «grande» cae al 2-7 % |

Con el ticket real, de 21 a 24 px iba bien y desde 25 px se hundía. Se elige 21 px, que es lo mejor y queda a 3 px del precipicio. Si la letra no se puede medir (no hay renglones claros), se usa la escala de antes. El aviso de poca resolución también pasa a la altura de las letras: menos de unos 12 px.

**Varias capturas se unen por la imagen, no por el texto.** Unir por el texto exigía que la siguiente captura empezara por las líneas repetidas, y siempre empieza por la barra de estado, la cabecera y una línea cortada. Con 3 capturas sobraban productos y aparecía «Ticket de compra» como producto.

Ahora el navegador las une antes de leer:
1. Quita las filas iguales a la misma altura en todas (con tolerancia para el reloj y la batería).
2. Busca cuánto se desplaza cada captura respecto a la anterior. Compara huellas de filas, solo en las que tienen texto, porque las filas en blanco coinciden en cualquier sitio.
3. Pega lo nuevo desde la mitad del solape, donde las dos tienen renglones enteros.
4. Si vienen desordenadas, las ordena por los solapes.

Una pareja que no se solapa con claridad no se inventa: se avisa antes de leer y va por separado a la unión por texto. No se solapa con claridad si la diferencia es alta o si hay otro desplazamiento casi igual de bueno.

**Recortar al papel, e invertir si hace falta.** Con fondo oscuro alrededor del papel (el modo oscuro, o una foto sobre una mesa), Tesseract partía las líneas en nombres e importes. Ahora se recorta al papel: las columnas y filas del color del papel, contando como papel las filas con los dos márgenes en blanco (así el logotipo, las rayas y los recuadros no lo parten). Si el papel es oscuro con letras claras, se invierte.

**Releer la banda de importes de todas las líneas.** La segunda pasada del OCR releía el final numérico de cada línea a partir de sus palabras, y solo en las que parecían dudosas. Si Tesseract no devolvía la columna de importes de un trozo, no había nada que releer, y el analizador perdía esos productos o los dejaba sin importe.

Ahora el lector calcula con todas las líneas de la imagen dónde está la banda de importes (`server/modules/tickets/adapters/tesseract/amountColumn.ts`):
- empieza tras las 20 columnas del nombre, en la de las multiplicaciones;
- llega al borde derecho, con la letra del IVA;
- relee esa banda en todas las líneas de producto.

Así una línea siempre tiene dos lecturas de su importe y la relectura nunca lee el nombre. En el banco sintético (18 casos), con la imagen ya preparada por la fase anterior, deja las líneas limpias igual (615 → 616 de 696) y cuesta un 4 % más de tiempo de lectura (91 → 95 s). Es la red para cuando se pierde la columna.

**Una tercera lectura para votar.** Dos lecturas de la misma imagen a la misma escala pueden equivocarse igual: «1,22» por 1,29 en las dos. Por eso el lector lee la banda de importes una vez más, a otra escala:
- la banda entera de cada franja, ampliada 1,5 veces y leída de una vez (una llamada por franja, no una por línea);
- decodificar y reescalar el PNG se hace con `node:zlib`, sin dependencias;
- cada renglón leído va a la línea con la que más solapa en altura, en `rereads`.

Cuesta unos 3 s en todo el banco. Con la banda bien calculada llega a 685 de 696 líneas y da el importe correcto en 677. Si se exige que coincidan al menos dos lecturas y que ninguna diga otra cosa (contando como desacuerdo una lectura deformada como «0,739»), saldrían limpias 663 líneas (95 %) sin ninguna cifra mal aceptada. Con fotos en JPEG no hay tercera lectura. Leer el banco pasa de 88 s (partida) a 111 s: 1,27 veces.

**PNG para las imágenes de pantalla.** Una captura o la imagen de la app tienen el fondo liso y van en PNG, sin las manchas del JPEG alrededor de las cifras. Las fotos van en JPEG, igual que una franja que no quepa en los límites. El cuerpo de la lectura (`franjas`) y sus límites no cambian.

Lo que cuesta: la huella de origen sale de los bytes de las franjas, así que un ticket guardado con la preparación de antes y vuelto a escanear sale como **posible duplicado** (misma tienda, fecha, hora y total), no como repetido. Lo comprueba `server/modules/tickets/tickets.test.ts`.

**Votar el importe: sin dudas solo si las lecturas coinciden.** Con la tercera lectura, el analizador da un importe por bueno sin marcarlo solo si la lectura del texto y al menos otra dan exactamente esa cifra y ninguna dice otra cosa (desde FIX-02, abajo). Cuentan como desacuerdo una lectura deformada («0,739») y una cifra sin coma, también la que se descarta por estar en el nombre.

**Qué cifra sin coma sale del nombre (FIX-01).** Antes se descartaba cualquier cifra sin coma que empezara por un número del nombre, y no contaba para nada. Con «LECHE ENTERA 1L», una lectura «149» se descartaba por empezar por «1». Entonces bastaban las dos relecturas de la banda, que son el mismo recorte y pueden equivocarse igual («1,43»), para dar la línea por buena.

Ahora:
- solo se descarta si es igual a un número del nombre, o si empieza por uno de dos cifras o más («SERVILLETAS 100U» y «100»; «MANTEQUILLA 250G» y «2506»);
- aun descartada, no deja votar, porque «100» también puede ser «1,00» sin la coma;
- si dice otra cifra que el importe elegido, la línea se marca: «Las lecturas del importe no coinciden».

Los casos están en `shared/tickets/ticketSafety.test.ts` (4e y 4f) y en el corpus.

Cuando coinciden así, se quitan las marcas que solo eran sospechas:
- «Lectura de baja confianza»;
- «solo se lee en la relectura»;
- la letra del IVA leída como cifra;
- las letras leídas como cifras.

Con solo dos lecturas (fotos en JPEG) todo sigue como antes. En el banco sintético, estas reglas no dejan ninguna cifra mal sin marcar (antes, 22). Se ha medido también releer cada línea sobre la banda ampliada, en lugar de a su escala: dejaba todas las líneas con la misma lectura y se descartó.

**La votación necesita la lectura del texto (FIX-02).** La banda y la banda a 1,5× son el mismo recorte a dos escalas, con la misma lista de cifras permitidas: se equivocan igual. Hasta FIX-02, si el texto no traía importe, esas dos bastaban para dar la línea por buena y quitaban la marca «El importe solo se lee en la relectura de cifras». Ahora solo vota una lectura del texto que coincide con otra. Con tickets reales se podrá medir si las dos de la banda merecen votar solas; mientras, la línea queda marcada.

**Tres lecturas iguales también se equivocan: el IVA dice dónde mirar (FIX-02).** En el banco, «ZANAHORIA BOLSA» de grande/completa-400 se leyó 0,73 en el texto, en la banda y en la banda a 1,5×, y era 0,79. Solo lo delataban el total y el desglose de IVA del grupo A. La confianza de Tesseract (52 en esa palabra) no sirve sola: marcar por debajo de 55 costaba 32 líneas limpias y bien leídas.

Ahora, si un grupo del desglose de IVA no cuadra (o, sin desglose concluyente, el total), se marcan las líneas de ese grupo sin ninguna marca cuyo importe, cambiando una sola cifra por otra que el OCR confunde con ella, haría cuadrar la cuenta: «Con 0,79 €, el desglose de IVA A cuadraría: comprueba esta cifra en la imagen».
- El total sigue sin cambiar ninguna cifra: solo dice dónde mirar.
- Las parejas que se confunden son 0-6, 0-8, 0-9, 1-4, 1-7, 2-7, 3-5, 3-8, 3-9, 5-6, 5-8, 6-8 y 8-9.
- No se marca la línea que comprueba su multiplicación, ni se marca nada si ninguna cifra explica la diferencia.

En el grupo A de ese ticket (20 líneas), solo la zanahoria cumple la condición.

**Cómo es un producto, solo en Lidl (FIX-02).** «Una línea sin importe que no va en mayúsculas no es un producto» vale para Lidl Plus, pero se aplicaba a cualquier tienda: en un ticket pegado con minúsculas y el importe en la línea siguiente, el producto y su importe acababan en «Texto que no parece un producto». Ahora, fuera de Lidl, esa línea se queda como producto y toma el importe de la de debajo.

Del mismo modo:
- «5 KG PATATAS 2,99 B» es un producto, no una línea de peso ni 5 unidades;
- una línea con solo la fecha («28.10.2026 14:32») no es la hora de la barra de estado;
- la cabecera de Lidl acaba también en una línea «… S.A.U.», con la misma definición para el lector y el analizador.

**Unir capturas sin perder filas (FIX-02).** El plan de la unión es una función pura con tests (`src/features/tickets/ticketPlan.ts`), y el navegador lo calcula en un Web Worker, con el hilo principal como respaldo:
- una captura que cabe entera dentro de la anterior (por ejemplo, con un aviso de la app tapando parte del ticket) se trata como repetida, en lugar de recortar la anterior y perder sus últimas filas;
- antes de leer se avisa también cuando no se pueden unir por tamaño, por el color del texto (claras y oscuras) o por los bordes del papel;
- el solape se busca de grueso a fino: primero con la media de cada 4 filas y luego, fila a fila, alrededor de los 8 mejores candidatos, unas 8 veces más rápido y con el mismo resultado en las pruebas;
- lo calculado al elegir las imágenes (cada imagen con su giro y cada plan) se guarda y se reutiliza al leer.

**Los cupones: lo distinto, marcado, y como mucho una línea (FIX-02).** Con la fusión de `c622210`, el test del OCR real de la captura sintética de cupones dejó de pedir la cantidad y el precio exactos: solo que lo distinto quedara marcado. La regla del lector decía que ninguna línea de las imágenes de prueba puede empeorar.

La única línea que cambia es la 1.ª «INSTANT NOODLES»: pierde «2 × 0,65», pero el importe (1,30) sale bien y queda marcada. Releer la banda con el margen ajustado la arregla, pero estropea otras dos. Por eso:
- el test exige que lo distinto quede marcado y que sea como mucho una línea;
- la regla del lector es ahora que ninguna cifra quede mal sin marcar y que las limpias del banco no bajen;
- una línea de las imágenes de prueba puede pasar de bien a marcada solo si el banco no empeora, y se anota en su test (`server/modules/tickets/AGENTS.md`).

**La PROMO sangrada es del producto de encima, por confirmar.** La decisión anterior era no asignar nunca una promoción por cercanía. Pero en el ticket de Lidl Plus, «PROMO LIDL PLUS -0,14» va en azul y sangrada justo debajo de su producto, como un «Desc.», y el desglose de IVA lo confirma: su grupo suma los artículos menos la promoción. Como ajuste general, además, impedía comprobar el desglose de IVA.

Ahora una PROMO sangrada justo debajo de un producto se le propone como descuento:
- sangrada quiere decir más a la derecha en la imagen o, en un texto pegado, con más espacios delante;
- queda marcada para confirmarla;
- el desglose de IVA, ya concluyente, comprueba el grupo.

Sin indicios de sangrado (el texto de Tesseract sin posiciones), sigue siendo un ajuste general. Los cupones también siguen siéndolo.

**Ningún producto desaparece sin decirlo.** Si Tesseract pierde la columna de importes o la línea «EUR», el analizador se quedaba en la cabecera y se saltaba los productos. Ahora, pasada la cabecera de Lidl (empresa, código postal o NIF), una línea en mayúsculas es un producto aunque no tenga importe, y entra marcado.

Lo contrario también se cuida:
- una línea sin importe que no parece un producto (texto de la app, restos) va aparte, a `nonProducts`, y la revisión la enseña plegada por si acaso;
- una línea que empieza como una de peso («34 kg …», «0,544 …») pero no se lee marca el producto de encima, en vez de crear un producto «kg».

**Unir capturas por texto, con tolerancia y avisando.** Cuando las capturas no se pudieron unir por la imagen, la unión por texto quita lo de la app de los bordes (barra de estado, «Ticket de compra», navegación). Después busca el solape aceptando una línea con una cifra confundida (mismo importe y nombre parecido) y una línea cortada al principio o al final. Si no lo encuentra, avisa («No se ha encontrado dónde se solapan las capturas 1 y 2…») en lugar de repetir líneas sin decir nada.

## Pendiente

**Retirar la migración de los datos del navegador** (IndexedDB → la base de datos del servidor), en un PR aparte, cuando se confirme que ningún navegador (el móvil, por ejemplo) tiene datos antiguos sin pasar. Se ganaría:
- unas 700 líneas menos: `src/features/finance/browserMigration/` y sus tests;
- dos dependencias menos, `idb` y `fake-indexeddb`;
- un FinanceProvider sin `beforeOpen` y un README más corto.

El coste: bajarían 19 tests (los de esas dos piezas). La ruta POST /api/import del servidor podría quedarse.

**Tickets reales en las pruebas.** `fixtures/tickets/ticket-cases.json` y el ticket sintético de Torrelavega usan líneas transcritas de un ticket real del dueño de la app (`docs/pruebas.md`). Lo mismo el ticket de Lidl Plus con cupones del 21/11/26, que además guarda el OCR real de su captura (`fixtures/tickets/ocr-real/lidl-plus-captura-422px.json`): es la única lectura de una captura de verdad, y la que mostró que la relectura de cifras podía perder un importe limpio. Las imágenes reales no se guardan; la dirección, el NIF y los datos de la tarjeta y del pago se sustituyen por otros inventados. Si se prefieren datos inventados, habría que sustituirlos sin debilitar las pruebas del lector.
