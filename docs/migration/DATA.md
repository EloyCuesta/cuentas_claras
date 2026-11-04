# Datos: SQLite a MySQL local

Estado: el esquema MySQL existe y está probado (MYSQL-01, `database/mysql/`), Express ya usa MySQL (MYSQL-02) y el importador existe y está probado con copias sintéticas (MYSQL-03, `tools/importer/`). La base SQLite de la instalación del usuario queda fuera del trabajo de agentes: no se ha leído ni importado ninguna fila real a MySQL, y las pruebas usan bases temporales y datos de ensayo.

## Fuente y alcance

El origen es el esquema resultante de las cinco migraciones de SQLite, que se conservan en [tools/sqlite](../../tools/sqlite). No basta leer la migración 001: 003 añade tickets, tracking y actividad; 004 añade `poco` y último repaso; 005 añade revisión segura, ajustes, incidencias, evidencia y nuevas claves de deduplicación.

La copia JSON v1 de la aplicación contiene categorías, movimientos y recurrentes. No es la fuente para trasladar toda la instalación. El importador completo partirá de una copia consistente de SQLite, con sus tablas de aplicación y metadatos.

## Inventario que debe conservarse

| Tabla origen | Módulo destino | Contenido y precaución |
| --- | --- | --- |
| `categories` | Finance | Jerarquía, tipo, orden y presupuesto; padres antes de hijos |
| `recurring_rules` | Finance | Fechas, frecuencia, cuotas, notas y estado de las reglas |
| `recurring_excluded_dates` | Finance | Parejas regla/fecha que nunca deben regenerarse |
| `movements` | Finance | Pendientes, realizados, fechas, cuotas y vínculo histórico a recurrentes |
| `pantry_people` | Pantry | Personas y sus IDs; no son cuentas de acceso |
| `pantry_items` | Pantry | Dueño, unidad, tracking, cantidades, objetivo, precio, notas y versión |
| `pantry_settings` | Pantry | Fila opcional con id=1, presupuesto y `last_review_date` |
| `pantry_events` | Pantry | `queda`, `poco`, `se_acabo` y `comprado`, con sus fechas |
| `pantry_tickets` | Tickets | Cabecera, total, fingerprint, ajustes, incidencias, import_id y source_fingerprint |
| `pantry_ticket_lines` | Tickets | Posición, nombres, cantidades, pesos, descuentos, IVA, asociaciones, revisión y evidencia |
| `pantry_aliases` | Tickets | Equivalencias por tienda/nombre normalizado y decisiones de ignorar |
| `meta` | Común | Metadatos, incluida fecha de copia financiera |
| `schema_migrations` | Archivo de procedencia | Se comprueba que el origen está en la versión 5; no se copia: MySQL tiene su propio historial |

Son 12 tablas de aplicación más el control de migraciones SQLite. MySQL tiene su propio `schema_migrations` (desde la versión 5) y la tabla técnica `app_locks`, que no son datos de la persona. Las sesiones actuales están en memoria y no se importan; el usuario vuelve a iniciar sesión al cambiar de servidor.

El inventario se contrasta con [las migraciones de SQLite](../../tools/sqlite/AGENTS.md) y con [la comprobación de las tablas de una base nueva](../../tools/sqlite/migrations.test.ts). La importación `POST /api/import` pasa únicamente finanzas desde IndexedDB a la base del servidor; no es el importador completo SQLite→MySQL de MYSQL-03.

## Mapeo de tipos

Decidido y probado en MYSQL-01: el esquema está en [la migración 5](../../database/mysql/migrations/005-esquema-inicial.sql) y sus pruebas en [schema.test.ts](../../server/common/mysql/schema.test.ts).

| Dato | MySQL | Por qué |
| --- | --- | --- |
| Importes en céntimos | `BIGINT` | Hasta `MAX_CENTS` sin perder nada; negativos en devoluciones, positivos en movimientos financieros (CHECK) |
| Quantity y target | `DECIMAL(10,3)` | Milésimas exactas hasta 1.000.000; mysql2 las devuelve como número (`decimalNumbers`) |
| Peso en kg | `DECIMAL(7,3)` | Hasta 1000 kg en milésimas, como redondea el analizador |
| Orden de categoría | `DOUBLE` | Conserva el `REAL` de SQLite tal cual, sin escala arbitraria |
| Fechas de calendario | `DATE` | El mismo día, sin hora ni zona; viajan como texto `AAAA-MM-DD` (`dateStrings`) y una fecha imposible se rechaza |
| Hora de compra | `VARCHAR(5)` | «HH:MM» tal cual; `TIME` devolvería «HH:MM:SS» |
| Instantes de creación/cambio | `VARCHAR(40)` | La copia financiera admite cualquier texto de hasta 40 caracteres y se restaura idéntica; `DATETIME` rechazaría «…T…Z» |
| IDs | `VARCHAR(100)` | Lo que admiten los validadores; no se exige que sean UUID |
| Huella del ticket | `VARCHAR(255)` | SHA-256 en los nuevos; los de la primera versión guardaron «tienda\|fecha\|hora\|total» y se conservan |
| Booleanos | `TINYINT` 0/1 con CHECK | Como los `INTEGER` 0/1 de SQLite |
| Ajustes, incidencias y evidencia | `MEDIUMTEXT` | Texto exacto y `JSON.parse` como hoy; el tipo JSON devolvería objetos y normalizaría el texto |
| Versión de producto | `INT` | Se conserva el número importado y sube en cada escritura |

mysql2 devuelve números JSON compatibles con los consumidores actuales. Usar `long` en C# no autoriza ampliar los límites por encima de lo admitido por JavaScript o por las reglas del dominio.

Todas las tablas y columnas usan utf8mb4 con `utf8mb4_0900_bin`, que compara como SQLite: «pina», «piña» y «PINA» son claves distintas y «abc» no es «abc ». La colación por defecto (`utf8mb4_0900_ai_ci`) uniría equivalencias de tickets distintas y `utf8mb4_bin` iguala los espacios finales. Cada conexión fija también esa colación para los textos sueltos, el modo estricto y REPEATABLE READ.

## Restricciones e integridad

- Conserva la unicidad de `fingerprint`, las parejas `(recurring_id, occurrence_date)` y `(ticket_id, position)` y la clave de equivalencias `(store, name_key)`.
- `import_id` y `source_fingerprint` son nullable y únicos cuando tienen valor: en MySQL son índices únicos normales, que admiten varios NULL y rechazan un valor repetido (probado).
- Conserva checks, límites, nulabilidad y acciones de claves foráneas del esquema final. Prueba su aplicación con el proveedor real.
- `movements.recurring_id` carece deliberadamente de FK: al borrar una regla se conservan vencimientos realizados con su vínculo histórico. No añadas esa FK por convención de EF.
- Una persona con productos no se borra. Al borrar un producto, las líneas de tickets se conservan con la asociación anulada y sus equivalencias/eventos siguen las acciones previstas por el esquema.
- Preserva IDs, fechas, estados, evidencia y versiones. Importar no es reproducir de nuevo los efectos de compra: no vuelvas a incrementar cantidades ni a aprender equivalencias a partir de tickets históricos.
- No mezcles categorías iniciales sembradas con datos importados. Define explícitamente el modo base nueva frente al modo importación.

## Importador local (MYSQL-03)

Implementado en [tools/importer](../../tools/importer/AGENTS.md), separado del arranque de la API: `npm run importar:sqlite -- <copia de cuentas.db> [--informe <archivo.json>]`, con la base de destino de `CUENTAS_DB_*` (por defecto `cuentas_claras`). Los pasos del corte para la persona están en el README («Pasar los datos de SQLite a MySQL»).

Entradas: la ruta de una copia SQLite consistente, la conexión a una base MySQL vacía y, opcionalmente, dónde dejar el informe (por defecto, junto a la copia). La copia se lee como archivo para su huella SHA-256 y SQLite la abre en solo lectura desde un duplicado temporal, para no dejar `-wal` ni `-shm` a su lado. Las escrituras van con parámetros. Ni la consola ni el informe llevan credenciales ni textos de la persona: tablas, claves, columnas, recuentos, huellas y sumas.

Antes de escribir comprueba, y si algo falla no escribe nada (código de salida 2):

- la copia: que existe, que no tiene un `-wal` con cambios al lado, que es SQLite y está entera (`integrity_check`), que su historial es exactamente 1–5, que sus tablas y columnas son las del esquema final de SQLite (comparadas con uno creado con las migraciones 001–005) y que sus referencias están bien (`foreign_key_check`);
- el destino: que MySQL responde y la base existe (los mensajes de `openDatabase`), que su esquema es el de `database/mysql/` (lo aplica sin sembrar categorías: el DDL se confirma solo y queda aunque la carga se deshaga) y que sus columnas son las mismas que las de la copia, en el mismo orden;
- cada valor de la copia contra su columna de MySQL: textos que no caben, DECIMAL con más decimales de los que guarda (MySQL los redondearía sin avisar), enteros fuera de rango o mayores que los de JavaScript, fechas imposibles y nulos donde no caben. Dice tabla, clave y columna, sin el valor.

La carga va en una sola transacción con los bloqueos `finance` y `tickets` y las claves foráneas activas. Dentro, exige que las doce tablas estén vacías (`schema_migrations` y `app_locks` no cuentan), carga las filas en el orden de [IMPORT_TABLES](../../tools/importer/tables.ts) (categorías principales antes que sus subcategorías; reglas, exclusiones y movimientos; personas, productos y ajustes; tickets, líneas, equivalencias y revisiones; metadatos) con sus ids, versiones y evidencias, y las vuelve a leer. Si alguna fila no coincide, se deshace todo (código 1); si MySQL rechaza una fila o algo falla, también (código 2). Tras confirmar, lo lee otra vez con otra conexión y lo compara de nuevo. No repite los efectos de los tickets ni aprende de nuevo: copia las tablas, no ejecuta casos de uso.

El informe (`cuentas-claras-importacion-v1`) incluye:

1. La copia (archivo, bytes, SHA-256, versión de esquema, integridad y referencias), la fecha y el destino sin secretos (usuario@equipo:puerto/base, versión de MySQL y del esquema, sin categorías sembradas).
2. Por tabla: filas de origen y destino, claves y diferencias por registro (claves que faltan, que sobran y columnas distintas, sin los valores).
3. Sumas de la copia y de MySQL: céntimos por tipo, estado y mes, recurrentes y cuotas, categorías y presupuestos, cantidades y objetivos en milésimas, versiones de productos, importes y descuentos de tickets y líneas.
4. Vencimientos de recurrentes borrados, fechas excluidas, devoluciones, líneas pendientes, decisiones de no seguir, `import_id` y huellas de origen, y los nulos de cada columna.
5. Una huella SHA-256 por tabla del JSON normalizado de sus filas (las marcas de tiempo, los JSON de tickets y los textos, tal cual; los DECIMAL, con sus decimales), además de la comparación fila a fila.
6. El resultado: `válido` (código 0), `con diferencias` (1) o `rechazado` (2); 3 si se importó y comprobó pero no se pudo escribir el informe.

Probado con copias sintéticas creadas con las cinco migraciones (`tools/importer/syntheticCopy.ts`): ids que solo se distinguen por mayúsculas, tildes o un espacio final, el importe máximo, milésimas y REAL con ruido, una huella antigua en claro, devoluciones, JSON con tildes y un vencimiento de un recurrente borrado. La comprobación contra la instalación real es DATA-02 y la hace la persona.

## Ensayo, corte y recuperación

El motor se cambia antes que el backend: primero Express pasa de SQLite a MySQL (corte de datos, DATA-02); después, .NET sustituye a Express sobre la misma base (CUT-01), sin otra importación.

Corte de datos (DATA-02), que hace la persona con los pasos del README («Pasar los datos de SQLite a MySQL»):

1. Para la app para que no haya escrituras y SQLite pase su `-wal` a `cuentas.db` (cierre limpio). No copies solo `cuentas.db` mientras la app escribe: el importador rechaza una copia con un `-wal` con cambios al lado, pero no puede saber si faltó copiarlo.
2. Copia `cuentas.db` fuera del repositorio y consérvala.
3. Importa en una base `cuentas_claras` vacía y revisa el informe: `válido`, todas las tablas iguales y las sumas iguales. Con diferencias o un rechazo no queda nada a medias: se corrige y se repite.
4. Arranca la app con MySQL, comprueba los recorridos habituales y haz una copia completa de MySQL (Workbench *Data Export* o mysqldump, README «Copias de MySQL»). Registra en [STATUS.md](STATUS.md) la fecha y el resultado.

Corte de backend (CUT-01): los recorridos React contra .NET y esa misma base, restauración financiera separada, una copia y recuperación completa de MySQL, y el cambio de configuración con un solo backend escritor. Se registra cuándo empezó a usarse.

Antes de nuevas escrituras en MySQL se puede volver a la copia SQLite original con la versión anterior de la app. Después, volver atrás requiere reconciliar lo nuevo: una copia antigua no lo contiene. No presentes ese retorno como automático.

La copia MySQL completa incluye las 12 tablas y sus relaciones (y el historial y los bloqueos). La copia JSON financiera conserva su alcance reducido, su nombre y su restauración independiente: cambiar de motor no convierte el botón de restaurar finanzas en una restauración de toda la casa.
