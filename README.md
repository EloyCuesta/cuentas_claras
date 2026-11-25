# Cuentas claras

Aplicación web para apuntar ingresos, gastos y próximos pagos, y responder de un vistazo:

- ¿Cuánto dinero he ingresado y gastado este mes?
- ¿En qué se me va el dinero?
- ¿Qué pagos tengo pendientes?
- ¿Cuánto me quedará después de pagar los gastos previstos?
- ¿Cómo va el año, mes a mes y por categoría?

Hecha con React y TypeScript. Los datos se guardan en una base de datos **MySQL** de tu equipo (MySQL Server 8.4, que puedes ver y administrar con MySQL Workbench), a través de un pequeño servidor Node.js + Express. No hace falta Docker ni registrarse.

Antes los datos estaban en un archivo SQLite (`server/data/cuentas.db`); si vienes de esa versión, mira «Pasar los datos de SQLite a MySQL». La migración prevista del servidor a ASP.NET Core, conservando React y esta misma base MySQL, se prepara en [la guía de migración](docs/migration/README.md). Su [estado comprobado](docs/migration/STATUS.md) distingue lo implementado de lo pendiente; los pasos de uso siguientes corresponden a la aplicación actual.

## Cómo ejecutarla

Necesitas Node.js 22.12 o superior y MySQL Server 8.4 con su base y su usuario (ver «Preparar MySQL»).

```bash
npm install
cp .env.example .env # y escribe tu código y los datos de MySQL (ver «Código de acceso» y «Preparar MySQL»)
npm run dev          # abre http://localhost:5173
```

`npm run dev` arranca a la vez dos procesos, cada uno con su prefijo en la consola:

- `[api]` el servidor (Express + MySQL) en `http://127.0.0.1:3001/api`. Se reinicia solo al cambiar su código.
- `[web]` la interfaz (Vite) en `http://localhost:5173`. Envía a la API todo lo que empieza por `/api`, así que no hay problemas de CORS.

La primera vez se crean las tablas en la base `cuentas_claras`, con las categorías iniciales. Las siguientes veces se abre tal cual y solo se aplican las migraciones nuevas, si las hay. Si MySQL no está en marcha, la base no existe o el usuario o la contraseña no valen, el servidor no arranca y dice qué revisar. Con Ctrl+C se cierran los dos procesos.

Comprobar que el servidor funciona: abre `http://localhost:5173/api/health` (también comprueba que MySQL responde).

Versión de producción:

```bash
npm run build        # comprueba los tipos (también del servidor) y genera dist/
npm run server       # en una terminal: la API en el puerto 3001
npm run preview      # en otra: la web en http://localhost:4173 (también envía /api al servidor)
```

`dist/` sigue siendo un conjunto de archivos estáticos, pero necesita el servidor de la API (y MySQL) para leer y guardar los datos.

**Usarla en el móvil** (misma red wifi): `npm run dev:server` en una terminal y `npm run dev:web -- --host` en otra. Abre en el móvil la dirección «Network» que aparece en la consola. Sin el código solo se ve la Despensa; con «Tengo el código» se ve todo. El móvil y el ordenador ven los mismos datos, porque los dos usan la base de datos del ordenador. MySQL no tiene que estar abierto a la red: solo lo usa el servidor, en el mismo equipo.

**En la pantalla de inicio**: el navegador del móvil puede añadirla como una app (con su icono). Sigue necesitando la red de casa: no funciona sin conexión.

**En el móvil**, la barra de abajo tiene Resumen, Movimientos, Recurrentes, Despensa y Ajustes; los presupuestos se abren desde su bloque del Resumen. Si hay pagos o cobros vencidos, un aviso arriba del Resumen lleva a ellos.

**Datos de ejemplo**: la app empieza vacía. Si quieres verla con datos, ve a *Ajustes › Restaurar una copia…* y elige `ejemplo/copia-de-ejemplo.json` (un mes de octubre de 2026 con nómina, alquiler, un préstamo a 48 cuotas, recibos y presupuestos). En *Resumen › Año* se ve el año completo, con noviembre y diciembre previstos a partir de los recurrentes.

**Si venías de la versión anterior** (datos guardados en el navegador): al entrar con el código en ese navegador, los datos que hubiera en ese navegador se pasan solos a la base de datos, siempre que esta todavía no tenga datos tuyos. Después se comprueba que ha llegado todo. La copia del navegador no se borra. Si la base de datos ya tenía datos, no se mezcla nada y la app lo avisa.

### Variables de entorno

Variables de entorno del servidor. Los scripts `server` y `dev:server` también las leen de `.env`, si existe; una variable ya definida en el entorno tiene prioridad sobre `.env`.

| Variable | Valor por defecto | Para qué |
| --- | --- | --- |
| `CUENTAS_CODIGO` | **obligatoria** | Código de acceso a las cuentas (al menos 4 caracteres) |
| `CUENTAS_DB_HOST` | `127.0.0.1` | Equipo de MySQL Server |
| `CUENTAS_DB_PORT` | `3306` | Puerto de MySQL Server |
| `CUENTAS_DB_USER` | **obligatoria** | Usuario de MySQL de la aplicación (no uses root) |
| `CUENTAS_DB_PASSWORD` | vacía | Su contraseña. Nunca aparece en la consola ni en los mensajes |
| `CUENTAS_DB_NAME` | `cuentas_claras` | La base de datos, que tiene que existir: la aplicación crea sus tablas, pero no la base |
| `CUENTAS_PORT` | `3001` | Puerto de la API |
| `CUENTAS_HOST` | `127.0.0.1` | Dirección: por defecto, solo accesible desde este equipo |
| `CUENTAS_TEST=1` | desactivada | Modo pruebas: solo arranca con `cuentas_claras_e2e` o una base `cuentas_test_*` |

`CUENTAS_DB_PATH`, de la versión con SQLite, ya no se usa: el servidor avisa si la encuentra.

La web usa `CUENTAS_API_URL` (por defecto `http://127.0.0.1:3001`) para saber adónde enviar `/api`.

El backend .NET de ensayo lee las mismas `CUENTAS_*` y, para leer tickets con imágenes, lanza el OCR de Express en un proceso Node aparte (necesita Node y `npm install`). Lo busca en `server/modules/tickets/adapters/tesseract/ocrWorker.ts`, desde la carpeta donde se arranca; `CUENTAS_OCR_WORKER` cambia esa ruta.

### Ensayo con el backend .NET

El backend .NET (`backend/`) atiende las mismas rutas sobre la misma base. Mientras se ensaya, arráncalo en lugar de Express (nunca los dos a la vez sobre la misma base), en dos terminales de PowerShell desde la raíz del repositorio. Necesita el SDK de .NET 10, Node y `npm install` (para el OCR de los tickets).

Terminal 1, la API .NET en el puerto 3201:

```powershell
npm run build:dotnet
$env:CUENTAS_CODIGO = 'tu código de acceso'
$env:CUENTAS_DB_HOST = '127.0.0.1'
$env:CUENTAS_DB_PORT = '3306'
$env:CUENTAS_DB_USER = 'cuentas'
$env:CUENTAS_DB_PASSWORD = Read-Host 'Contraseña de MySQL'
$env:CUENTAS_DB_NAME = 'cuentas_claras'
dotnet run --no-build --project backend/src/CuentasClaras.Api/CuentasClaras.Api.csproj
```

Terminal 2, la web apuntando a .NET:

```powershell
$env:CUENTAS_API_URL = 'http://127.0.0.1:3201'
$env:CUENTAS_BACKEND = 'dotnet'
npm run dev:web
```

Comprueba `http://localhost:5173/api/health` (responde `{ ok: true, data: { status: 'ok', schemaVersion: 5 } }`) y abre `http://localhost:5173`. Para volver a Express, cierra las dos terminales y arranca `npm run dev` como siempre. El cambio de la instalación de cada día está en `docs/migration/DATA.md` («Ensayo, corte y recuperación»).

## Preparar MySQL

Una vez, en el equipo donde se ejecuta la app (los pasos son para Windows; en otros sistemas, lo mismo con su instalador):

1. Instala **MySQL Server 8.4** (la versión LTS) y **MySQL Workbench** desde [MySQL Community Downloads](https://dev.mysql.com/downloads/). Al terminar, MySQL Configurator propone el puerto **3306** y un servicio de Windows (**MySQL84**) que arranca con el equipo: déjalo así y apunta la contraseña de **root**.
2. Abre MySQL Workbench, entra en la conexión local como root y, en una pestaña de consulta, ejecuta esto (con tu propia contraseña, larga):

   ```sql
   CREATE DATABASE cuentas_claras CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
   CREATE USER 'cuentas'@'localhost' IDENTIFIED BY 'escribe-aqui-una-contraseña-larga';
   GRANT ALL PRIVILEGES ON cuentas_claras.* TO 'cuentas'@'localhost';
   ```

3. En `.env`, escribe `CUENTAS_DB_USER=cuentas` y su contraseña en `CUENTAS_DB_PASSWORD=`. El resto (`127.0.0.1`, `3306`, `cuentas_claras`) ya está en `.env.example`.
4. `npm run dev`. La primera vez crea las tablas en `cuentas_claras`; en Workbench las verás en *Schemas* (actualiza la lista). Si vienes de la versión con SQLite, no la arranques todavía: el importador solo carga en una base vacía, así que sigue antes «Pasar los datos de SQLite a MySQL».

La aplicación no usa root ni crea bases de datos: solo trabaja dentro de `cuentas_claras`. Sus tablas usan `utf8mb4_0900_bin`, que distingue mayúsculas, tildes y espacios como hacía SQLite.

## Pasar los datos de SQLite a MySQL

Si ya usabas la app con SQLite, tus datos siguen en `server/data/cuentas.db`: el servidor ya no lo abre, pero no lo borra. Se pasan una sola vez a una base `cuentas_claras` **vacía** con el importador, que copia las doce tablas tal cual (ids, versiones, tickets y lo aprendido; no siembra categorías ni repite lo que hizo cada ticket) y comprueba fila a fila que no se ha perdido nada. Lo haces tú, con tus datos:

1. **Para la app de antes**, la de SQLite (Ctrl+C en la consola de `npm run dev` o de `npm run server`). Al cerrarse pasa a `cuentas.db` lo que quedaba en `cuentas.db-wal` y lo borra. Si en `server/data/` sigue habiendo un `cuentas.db-wal` (la app no se cerró bien), guarda aparte los tres archivos `cuentas.db*` y, desde la carpeta de la app, ejecuta `node -e "const db = require('better-sqlite3')('server/data/cuentas.db'); db.pragma('wal_checkpoint(TRUNCATE)'); db.close()"`: SQLite pasa el `-wal` al archivo y lo borra.
2. **Copia `cuentas.db`** a una carpeta fuera del repositorio, por ejemplo `C:\copias\cuentas-2026-11-04.db`. Guárdala: es tu vuelta atrás.
3. **Prepara MySQL** con los pasos 1 a 3 de «Preparar MySQL» (instalar, crear la base y el usuario, y el `.env`), sin arrancar la app: así la base sigue vacía. Si ya arrancaste la app con MySQL, la base tiene las categorías iniciales y el importador no la usará: si no tiene nada tuyo, bórrala y créala otra vez en Workbench (`DROP DATABASE cuentas_claras;` y el `CREATE DATABASE` de arriba).
4. **Importa**, con las `CUENTAS_DB_*` de tu `.env`. Si acabas de actualizar la app, antes `npm install`: instala mysql2 y, para el importador, better-sqlite3 (es una dependencia de desarrollo, así que `npm install --omit=dev` no lo instala).

   ```bash
   npm run importar:sqlite -- "C:\copias\cuentas-2026-11-04.db"
   ```

5. **Revisa el informe**, que se guarda junto a la copia (`informe-importacion-AAAAMMDD-HHMMSS.json`; con `--informe <archivo>`, donde digas). Tiene que decir `"resultado": "válido"`, cada tabla `"iguales": true` y `"sumas"` con `"iguales": true`; las sumas (céntimos por mes, movimientos, tickets…) sirven para compararlas con lo que conoces. Ni la consola ni el informe enseñan tus conceptos, nombres o notas: solo claves, recuentos, huellas y sumas. El comando sale con 0 si todo coincide; con 1 si algo no coincide; con 2 si no se ha podido importar (la copia no vale, MySQL no responde o la base no está vacía). En los dos últimos casos se deshace todo y la base queda vacía, así que puedes corregirlo y repetir. Con 3, se importó y comprobó pero no se pudo escribir el informe.
6. **Arranca la app** (`npm run dev`) y mira el resumen del mes, los movimientos, la despensa y los últimos tickets.
7. **Haz una copia completa de MySQL** (ver «Copias de MySQL»).

Mientras no escribas nada nuevo en MySQL, volver atrás es arrancar la versión anterior de la app (la de SQLite), que sigue usando `server/data/cuentas.db`; si ese archivo ya no está, pon allí tu copia. Después de escribir en MySQL, esa copia ya no tiene lo nuevo. Cuando todo esté bien y tengas la copia de MySQL, `server/data/cuentas.db` ya no hace falta, pero guarda la copia del paso 2 un tiempo.

## Copias de MySQL

La copia JSON de *Ajustes* solo guarda las finanzas. La copia completa (finanzas, despensa, tickets y lo aprendido) es la de la base `cuentas_claras`:

- **MySQL Workbench**: *Server › Data Export*, marca `cuentas_claras`, elige *Export to Self-Contained File* e *Include Create Schema*, y *Start Export*. Para recuperarla: *Server › Data Import*, en una base vacía.
- **mysqldump** (en Windows está en `C:\Program Files\MySQL\MySQL Server 8.4\bin`):

  ```bash
  mysqldump -u cuentas -p --single-transaction --no-tablespaces --result-file=copia-cuentas_claras.sql cuentas_claras
  ```

  `--no-tablespaces` evita que pida un permiso que el usuario de la app no tiene, y `--result-file` escribe el archivo tal cual (en PowerShell, `>` lo guardaría en UTF-16). Para recuperarla en una base vacía (creada como en «Preparar MySQL»): `mysql -u cuentas -p cuentas_claras --execute="source copia-cuentas_claras.sql"`.

Guarda las copias fuera del equipo de vez en cuando: si el disco falla, se van con él.

## Pruebas

`npm run check` y `npm run test:e2e` prueban contra MySQL de verdad, nunca con tus datos: Vitest crea y borra bases `cuentas_test_…`, y las pruebas en navegador usan `cuentas_claras_e2e` (la crean si falta). Usan el servidor, el usuario y la contraseña de `CUENTAS_DB_*` (de `.env` o del entorno). Dale a ese usuario permiso sobre esas bases, en Workbench como root:

```sql
GRANT ALL PRIVILEGES ON `cuentas\_test\_%`.* TO 'cuentas'@'localhost';
GRANT ALL PRIVILEGES ON cuentas_claras_e2e.* TO 'cuentas'@'localhost';
```

Si MySQL no está en marcha o falta el usuario, las pruebas fallan con un mensaje que dice qué revisar. El detalle está en [docs/pruebas.md](docs/pruebas.md).

## Código de acceso

Las cuentas solo se ven con un código que pones tú. Sin él, cualquiera de casa puede usar la **Despensa** y nada más.

1. Copia `.env.example` como `.env` (`cp .env.example .env`; en Windows, `copy .env.example .env`).
2. Escribe tu código en `CUENTAS_CODIGO=` (al menos 4 caracteres, que no sean solo espacios). `.env` no se sube al repositorio.
3. Arranca como siempre (`npm run dev`, o `npm run dev:server` + `npm run dev:web -- --host` para la red de casa). Sin código, el servidor avisa y no arranca, y no llega a conectar con MySQL.

Cómo funciona:

- **Invitado** (sin código): ve y edita la Despensa (personas, productos, tickets, presupuesto y lista de la compra). No ve el resumen, los movimientos, los recurrentes, los presupuestos ni los ajustes. Un enlace como `#resumen` también lleva a la Despensa.
- **Con el código** («Tengo el código»): toda la aplicación, con la Despensa en el menú.
- La protección está en el **servidor**: cualquier petición a una ruta financiera sin sesión responde `401`, aunque alguien la escriba a mano. Ocultar botones no bastaría, porque Vite reenvía `/api` al servidor.
- Al acertar el código, el servidor da una **sesión de 12 horas** en una cookie `HttpOnly` (el JavaScript de la página no la puede leer). Sobrevive a recargar la página. El código no se guarda en el navegador.
- **Cerrar sesión** está en *Ajustes › Sesión*. También se pierde al **reiniciar el servidor** (las sesiones viven en memoria): hay que volver a escribir el código.
- Tras **5 códigos incorrectos** desde el mismo dispositivo, se bloquean los intentos 15 minutos. Cada móvil cuenta por separado: el proxy de Vite pasa al servidor la IP real de cada uno.

> **Importante:** en la red de casa la app va por **HTTP**, sin cifrar. El código y los datos viajan por la wifi tal cual. Vale para casa, pero **no expongas la aplicación a Internet** (sin abrir puertos en el router ni túneles).

## Apuntar un gasto o un ingreso

«Añadir movimiento» (o la tecla «n» en el ordenador) abre el formulario con el cursor en el importe:
- «Gasto | Ingreso» está al lado del importe, y cambiarlo no te saca de él; en el ordenador hay también «Añadir ingreso»;
- Intro pasa al concepto, que propone la categoría de la última vez (basta con el principio: «Merc» por «Mercadona»);
- las categorías que más usas salen como botones, para elegirlas con un toque;
- la fecha tiene «Hoy» y «Ayer»; el estado (pendiente) y las notas van en «Más opciones», y una fecha futura te propone apuntarlo como pendiente;
- «Guardar y añadir otro» deja el formulario listo para el siguiente, con el mismo tipo y la misma fecha.

Al guardar, el formulario se cierra en cuanto el servidor lo confirma.

**Marcar pagado** (o cobrado) un pendiente se puede deshacer desde el aviso: vuelve a estar pendiente, con su fecha prevista y su importe de antes.

## Despensa

Lo que se compra en casa, separado por persona para que lo individual no se mezcle con lo compartido. Lo más cómodo es **escanear el ticket** después de cada compra: la app apunta qué se compró y cuándo, aprende cada cuánto se compra cada cosa y avisa de lo que conviene mirar. No hace falta ir contando lo que hay.

### Tickets de la compra

- **Escanear ticket**: lo mejor es la imagen completa del ticket que da Lidl Plus; si no, una captura larga o varias que se solapen un poco (hasta 6), o una foto del ticket de papel. Las capturas que se solapan se unen en una sola imagen antes de leerlas, así que nada sale repetido (una que ya está dentro de otra no se usa). Antes de leer, la app avisa si dos no se solapan («puede faltar una parte del ticket») o si no se pueden unir (de distinto tamaño, unas claras y otras oscuras, o con los bordes del papel distintos). También se puede pegar el texto del ticket (por ejemplo, el que llega por email).
- **Se lee en este equipo**: el texto se reconoce con Tesseract (OCR) en el propio servidor, con el modelo de español que se instala con `npm install`. No se envía nada a Internet y **las imágenes no se guardan**: solo los datos del ticket que confirmes. Antes de enviarla, el navegador prepara una copia:
  - la gira si se lo pides (también una foto grande de móvil, que no cabría entera en el lienzo del navegador);
  - la recorta al papel del ticket (fuera la barra de estado, la cabecera y el fondo de la app, también en modo oscuro);
  - la escala para que las letras tengan el tamaño que mejor lee el OCR;
  - la divide en franjas si es muy larga;
  - solo si es una foto de poco contraste (papel gris), estira el contraste y la enfoca.

  La imagen original no se toca y es la que se ve al comparar. Si tiene poca resolución (letras de menos de unos 12 píxeles de alto), avisa antes de leer. Un ticket tarda unos segundos.
- **Varias lecturas por línea**: el texto completo, la columna de importes leída otra vez solo con cifras y, con capturas, esa columna a otra escala. Un importe solo sale «leído sin dudas» si la lectura del texto coincide con al menos otra y ninguna dice otra cosa: las dos lecturas de la columna son el mismo recorte y, solas, no bastan. El texto original del OCR queda guardado con cada línea aunque se corrija.
- **Cada cifra se comprueba**, sin mirar nunca el total del ticket para decidirla:
  - **Precio × cantidad** («4,95X 2 9,90 A») y **peso × precio por kilo** («0,544 kg x 6,75 EUR/kg» = 3,67 €), en céntimos exactos. «5 KG» o «5 QUESOS» son parte del nombre, no la cantidad.
  - Si el importe leído no coincide (el OCR leyó «92,90»), la app busca qué campo tiene el error: si un error de una cifra en el importe lo explica y ninguno en el precio o la cantidad daría esa cifra, **propone el calculado (9,90 €)**; si los dos lo explicarían (5,08 frente a 2,84 × 2), **no elige ninguno** y te enseña las dos opciones. Una segunda lectura que coincide con el cálculo, o lo que confía el OCR en cada palabra, también cuentan.
  - Una lectura con cifras de más («2,939») o con un «-» pegado detrás («1,15-»), la letra del IVA leída como cifra («3,73 5» por «3,79B») o dos lecturas distintas marcan la línea, aunque el total cuadre.
  - Un importe sin coma («2525») nunca se da por bueno, y unas cifras del nombre («SERVILLETAS 100U») nunca son el importe, pero tampoco dejan dar por buena otra cifra que no coincida. Una multiplicación que no se lee entera («2,75X», «79X 2») marca la línea en vez de darla por una unidad, y una línea de peso que no se lee marca su producto.
  - Las letras parecidas a cifras («5,O8», «I,29») solo se cambian dentro de un importe; la B detrás del importe es la letra del IVA, no un 8.
  - Si el desglose de IVA (o el total) no cuadra, se marcan las líneas cuyo importe, con una sola cifra confundida, lo haría cuadrar («Con 0,79 €, el desglose de IVA A cuadraría»). La cifra no cambia: solo se dice dónde mirar.
- **Revisar antes de guardar**, pensado para el móvil:
  - arriba, un resumen (tienda, fecha y hora, total), si cuadra y cuántas líneas faltan por revisar; los datos del ticket se corrigen en «Editar datos del ticket», que se abre solo, con el error junto al campo, si al guardar falta alguno;
  - después, cada línea dudosa en una tarjeta con la línea entera en la imagen (ampliada para que se lea, en el importe), lo leído frente a lo calculado y un botón por opción: **«Usar 9,90 €»**, **«Editar»** y **«Dejar pendiente»** (el porqué, en «Por qué»). Una línea que se parece a un producto que ya tienes pregunta si es ese (**«Sí, es Leche semidesnatada»**). Al resolver una, se pasa a la siguiente;
  - luego los productos, en una lista compacta que se pliega cuando todo está bien.

  **«Guardar ticket»** está siempre a la vista. Cada línea está *leída sin dudas*, *confirmada* por ti, *sugerida* (falta confirmarla) o *pendiente*. Arriba se ve si el ticket **cuadra**, **no cuadra** (con la diferencia), está **incompleto** (faltan importes) o está **pendiente de confirmar** (la suma coincide, pero hay datos dudosos: dos errores pueden compensarse). Si el ticket trae el desglose de IVA, también se comprueba cada grupo. Las líneas del mismo producto van juntas, y los descuentos («Desc.») y las líneas de peso se asocian a su producto. La «PROMO LIDL PLUS» que va sangrada debajo de un producto se le propone como descuento, para que lo confirmes; las promociones sin sangrar y los cupones quedan como ajustes generales. La publicidad de después del ticket (ofertas, puntos) no cuenta, y lo que no parece un producto (texto de la app, restos) se enseña aparte, por si acaso.
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

- **La página**, de arriba abajo:
  - «Escanear ticket», «Lista de la compra» y «Nuevo producto»;
  - la persona (en el móvil, «Personas» es el icono de al lado);
  - «Para revisar», con los 3 primeros y «Ver las n»;
  - el buscador «Buscar producto», que encuentra por cualquier parte del nombre y sin tildes («cafe» → «Café molido»), y los productos;
  - plegado al final, «Últimas compras, resumen y presupuesto».

  Los bloques vacíos no salen.
- **Personas**: cada una tiene su apartado. Arriba se elige «Compartido», una persona o «Todo», y la elección se recuerda en ese navegador. Borrar una persona pide confirmación, y una persona con productos no se puede borrar: primero hay que pasarlos a otra o eliminarlos.
- **Cómo se sigue cada producto**: **por compras** (lo normal, con los tickets) o **contando** (cuánto hay y cuánto quieres tener, con los botones − y +). Los productos nuevos van por compras; los que ya existían antes de los tickets se siguen contando, y se puede cambiar en cada producto.
- **Productos**: nombre, de quién es (o Compartido), unidad y frecuencia; si se cuentan, también cuánto hay y cuánto quieres tener. El precio estimado y las notas van en «Más detalles», que se abre solo si ya tienen algo. Falta la diferencia entre lo que quieres tener y lo que hay. Puede haber más de lo previsto.
- **Editar desde dos móviles**: si alguien cambia un producto (lo edita, pulsa + o −, o lo compra) mientras lo estás editando, al guardar se avisa y no se pisa su cambio. Lo que escribiste sigue en el formulario; «Volver a cargar el producto» lo muestra como está ahora para repetir tus cambios.
- **Unidades**: `ud`, `g`, `kg`, `ml`, `l`, `paquete`, `lata`, `botella`, `bolsa` y `docena`. Solo `g`, `kg`, `ml` y `l` admiten decimales (hasta 3). No se convierten entre sí.
- **Botones − y +** (al contar): restan o suman 1 (100 en `g` y `ml`, 0,5 en `kg` y `l`). Nunca bajan de cero. El servidor hace la cuenta sobre su valor actual, así que dos móviles a la vez no se pisan.
- **Frecuencia**: «Cada semana», «Cada mes» y «De vez en cuando». Al crear un producto desde un ticket se propone según el nombre (aceite, arroz, detergente… cada mes).
- **Precio**: por unidad (por kilo en `g` y por litro en `ml`). Vacío = no se sabe; 0 = gratis. Cada ticket lo actualiza.
- **Estimaciones**: lo que cuesta lo que falta y la **estimación mensual de toda la casa**. Por compras: lo que costó la última compra × las veces que se compra al mes (30,31 días ÷ lo que suele durar); sin tickets todavía, el precio estimado de una unidad. Contando: objetivo × precio × 4,33 si es semanal, × 1 si es mensual y × 0,25 si es ocasional. Los productos sin precio no cuentan y el resultado se marca como parcial. Los importes se calculan en céntimos exactos y cada línea se redondea una sola vez.
- **Presupuesto**: un presupuesto mensual de la despensa para comparar con esa estimación. Quitarlo pide confirmación. Es solo una estimación: **no crea gastos, movimientos, presupuestos ni recurrentes** en las cuentas.
- **Lista de la compra**: lo que se acabó, queda poco o probablemente se acabó (con la cantidad de la última compra) y lo que falta de lo que se cuenta, agrupado en Compartido y cada persona, con negritas de WhatsApp y el total estimado. Se filtra por persona y frecuencia. Se puede:
  - **Enviar por WhatsApp**: abre WhatsApp con el texto escrito (sin enviarlo). Es la opción principal porque funciona aunque la app vaya por HTTP.
  - **Compartir**, si el navegador lo permite (por HTTP en la red de casa normalmente no).
  - **Copiar**: si el navegador no deja copiar solo, selecciona el texto para copiarlo a mano.
  - **Descargar .txt**.
  - **Marcar todo como comprado**: en los que se cuentan, completa lo que hay hasta el objetivo; en los que van por compras, apunta una compra de hoy. Durante unos segundos aparece **Deshacer**. Si mientras tanto alguien ha cambiado alguno de esos productos, no se deshace nada (para no pisar su cambio) y la app lo avisa.
- La Despensa se guarda en la misma base de datos MySQL, en tablas aparte. **Las copias JSON y los CSV no la incluyen**, y restaurar una copia o importar los datos del navegador no la toca.

## Para desarrollar

Cómo está hecha por dentro, cómo se prueba y por qué es así:

- [AGENTS.md](AGENTS.md): la guía de entrada (mapa del repositorio, reglas que no se rompen, comandos y qué leer antes de tocar cada parte). Cada carpeta importante tiene la suya.
- [docs/arquitectura.md](docs/arquitectura.md): el servidor por módulos (hexagonal), el dominio compartido, la web por funcionalidades y la estructura del repositorio.
- [docs/api.md](docs/api.md): las rutas, el formato de las respuestas y los códigos de error.
- [docs/base-de-datos.md](docs/base-de-datos.md): las tablas, las decisiones del modelo y las migraciones.
- [docs/pruebas.md](docs/pruebas.md): las comprobaciones (`npm run check`, `npm run test:e2e`) y qué prueba cada una.
- [docs/frontend.md](docs/frontend.md): la web, los estilos y la accesibilidad.
- [docs/decisiones.md](docs/decisiones.md): las decisiones de diseño (céntimos, fechas sin hora, recurrentes, OCR local…).
- [docs/convenciones.md](docs/convenciones.md) y [docs/glosario.md](docs/glosario.md): cómo se escribe el código y qué es cada término.

## Límites de esta versión

- Los datos están en la base MySQL `cuentas_claras`, **en este equipo**.
  - No hay cuentas de usuario ni sincronización, y el servidor solo escucha en `127.0.0.1` (el móvil llega a través de Vite con `--host`).
  - Si borras la base (o desinstalas MySQL borrando sus datos), se pierden, salvo que tengas una copia. Por eso la app recuerda hacer copias y muestra la fecha de la última.
  - La copia JSON de *Ajustes* solo guarda las finanzas y se puede descargar en cualquier momento. La copia completa (también la Despensa y los tickets) se hace con MySQL Workbench o mysqldump: ver «Copias de MySQL».
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
