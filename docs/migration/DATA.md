# Datos: SQLite a MySQL local

Estado: el esquema MySQL existe y está probado (MYSQL-01, `database/mysql/`); el importador llega en MYSQL-03. La base SQLite de la instalación del usuario queda fuera del trabajo de agentes: no se ha leído ni importado ninguna fila real a MySQL, y las pruebas usan bases temporales y datos de ensayo.

## Fuente y alcance

El origen es el esquema resultante de las cinco migraciones de [server/migrations](../../server/migrations). No basta leer la migración 001: 003 añade tickets, tracking y actividad; 004 añade `poco` y último repaso; 005 añade revisión segura, ajustes, incidencias, evidencia y nuevas claves de deduplicación.

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

El inventario se contrasta con [las migraciones actuales](../../server/migrations/AGENTS.md) y con [la comprobación de las tablas de una base nueva](../../server/common/sqlite/openDatabase.test.ts). La importación actual `POST /api/import` pasa únicamente finanzas desde IndexedDB a SQLite; no es el importador completo SQLite→MySQL previsto en DATA-02.

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

## Importador local: contrato objetivo de DATA-02

La herramienta será una utilidad separada del arranque normal de la API. Su interfaz concreta y sus comandos se documentarán cuando exista; aquí no se afirma que haya un ejecutable disponible.

Entradas: ruta de una copia SQLite consistente, conexión a una base MySQL de ensayo vacía y ubicación del informe de comparación. Abre el origen en solo lectura, parametriza las escrituras y verifica que origen/destino son los seleccionados. No imprimas credenciales ni datos personales completos en logs.

Antes de escribir, valida versión de esquema, integridad, tablas/columnas finales, recuentos, referencias, tipos y compatibilidad del mapeo. Rechaza un destino con datos de aplicación; las tablas de control EF no cuentan como datos de usuario. Si se necesita repetir el ensayo, crea otro destino vacío sin borrar silenciosamente el anterior.

Aplica el esquema versionado antes de cargar filas. El DDL de MySQL puede provocar commits implícitos: un ROLLBACK no revierte automáticamente la creación/modificación del esquema. La carga de datos InnoDB debe realizarse transaccionalmente y con claves foráneas activas.

Orden de filas: categorías raíz/hijas, reglas y sus exclusiones/movimientos; personas, productos y configuración; tickets y líneas, equivalencias y eventos; metadatos. Los IDs conservados permiten resolver referencias sin reasignación. Un error aborta la carga y deja un informe; no se continúa descartando filas.

El informe debe incluir:

1. Identificación y huella de la copia origen, versión de esquema, fecha del corte y configuración de mapeo sin secretos.
2. Recuentos por tabla, conjuntos de IDs o claves compuestas y diferencias por registro.
3. Sumas financieras por estado y periodo, importes de tickets, cantidades/objetivos y versiones de productos.
4. Referencias, exclusiones, parejas únicas, decisiones de ignorar, devoluciones y valores nulos.
5. Comparación de JSON normalizado y de marcas de tiempo; no basta comparar el número de filas.
6. Resultado final explícito: válido o con diferencias, con código de salida de error ante discrepancias.

Primero demuestra todo esto con una base SQLite sintética que cubra las cinco migraciones. La comprobación contra la instalación real queda pendiente hasta disponer de su copia; no bloquea el portado independiente de reglas y pantallas.

## Ensayo, corte y recuperación

1. Detén las escrituras y obtiene una copia SQLite consistente. Si hay WAL, no copies solo `cuentas.db` mientras la app sigue escribiendo: usa un mecanismo de backup consistente o cierre limpio.
2. Crea un MySQL de ensayo con el esquema final y sin datos de aplicación. Ejecuta el importador y revisa su informe.
3. Ejecuta los recorridos React contra .NET y ese MySQL. Comprueba restauración financiera separada y una copia/recuperación completa de MySQL.
4. Para el corte, detén la app, conserva la copia SQLite final y repite la carga en un destino vacío. Valida antes de permitir nuevas escrituras.
5. Cambia la configuración a .NET/MySQL y registra cuándo empezó a usarse. Mantén un solo backend escritor.
6. Conserva el respaldo y el informe fuera del repositorio. Documenta los comandos reales de backup/restauración elegidos y comprueba una recuperación completa.

Antes de nuevas escrituras en MySQL se puede volver a abrir la copia SQLite original. Después de nuevas escrituras, volver atrás requiere reconciliarlas: una copia antigua no contiene esos cambios. No presentes ese retorno como automático.

La copia MySQL completa incluirá las 12 tablas y sus relaciones. La copia JSON financiera conserva su alcance reducido, su nombre y su restauración independiente. Cambiar de motor no debe convertir el botón de restaurar finanzas en una restauración de toda la casa.
