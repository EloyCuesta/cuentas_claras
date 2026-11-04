# Base de datos

Una base de datos MySQL de este equipo: `cuentas_claras`, en MySQL Server 8.4 (se administra con MySQL Workbench). La base tiene que existir con su usuario (README, «Preparar MySQL»); la aplicación crea sus tablas. Al arrancar, `openDatabase` (`server/common/mysql/MysqlDatabase.ts`):
- lee la conexión de `CUENTAS_DB_*` (`server/common/mysql/config.ts`) y comprueba que MySQL responde;
- fija la sesión de cada conexión: utf8mb4 con `utf8mb4_0900_bin`, el modo estricto y REPEATABLE READ;
- aplica las migraciones pendientes de `database/mysql/` (`server/common/mysql/migrations.ts`).

Nunca borra ni sobrescribe datos al abrir. Si MySQL no responde, rechaza el usuario o la base no existe, el servidor no arranca y explica qué revisar. Ningún test ni ningún agente toca `cuentas_claras`: las pruebas usan bases `cuentas_test_*` y `cuentas_claras_e2e`.

Antes de MySQL los datos estaban en un archivo SQLite, `server/data/cuentas.db`. Su esquema (migraciones 001 a 005) se conserva en `tools/sqlite/` para el importador, que pasa una copia de ese archivo a MySQL ([DATA.md](migration/DATA.md)).

## Tablas

Doce tablas de la aplicación y dos técnicas. Cada tabla de la aplicación tiene un módulo dueño: solo su adaptador MySQL la lee o la escribe.

| Tabla | Módulo | Contenido |
| --- | --- | --- |
| `categories` | finance | Categorías y subcategorías (`parent_id`, un solo nivel). El presupuesto mensual es una columna (`budget_cents`). |
| `movements` | finance | Ingresos y gastos, realizados o pendientes. Incluye los vencimientos de los recurrentes (`recurring_id`, `occurrence_date`) y el número de cuota. |
| `recurring_rules` | finance | Pagos y cobros recurrentes. Las financiaciones son recurrentes con un número de cuotas (`installments`). |
| `recurring_excluded_dates` | finance | Vencimientos eliminados que no deben volver a crearse. |
| `meta` | finance | Datos auxiliares: fecha de la última copia y de la importación desde el navegador. |
| `pantry_people` | pantry | Personas de la despensa. |
| `pantry_items` | pantry | Productos: dueño (`owner_id`, `NULL` = Compartido, borrado restringido), unidad, cantidades, frecuencia, precio en céntimos (`NULL` = desconocido), cómo se sigue (`tracking`: `compras` o `cantidad`) y `version`, que sube en cada escritura para poder deshacer sin pisar cambios. |
| `pantry_settings` | pantry | Una sola fila con el presupuesto mensual de la despensa y el día del último repaso de la semana (`last_review_date`, `NULL` = ninguno todavía). |
| `pantry_events` | pantry | «Queda», «Queda poco», «Se acabó» y «Lo he comprado» de cada producto, con su fecha. Se borran con el producto. |
| `pantry_tickets` | tickets | Tickets guardados: tienda, dirección, fecha, hora, total, ajustes, avisos y una huella única (`fingerprint`) para no guardarlos dos veces. También el `import_id` de la lectura y la huella del origen (`source_fingerprint`), únicos si están. Sin imágenes. |
| `pantry_ticket_lines` | tickets | Las líneas de cada ticket tal como venían (nombre, cantidad, importes, descuento, peso, letra del IVA, «para una ocasión»), si están verificadas o pendientes (`review_status`), si se confirmaron, la evidencia de la lectura y su producto (`NULL` = no se sigue; si se borra el producto, la línea se queda). Se borran con su ticket. |
| `pantry_aliases` | tickets | Lo aprendido: qué producto es cada nombre de ticket en cada tienda, o que no se sigue. Se borra con su producto. |
| `schema_migrations` | migraciones | Migraciones de MySQL aplicadas: versión, nombre, cuándo empezó y cuándo terminó (`applied_at` NULL = a medias). |
| `app_locks` | transacciones | Dos filas, `finance` y `tickets`, que ponen en serie las escrituras de cada zona (`docs/arquitectura.md`). No son datos de la persona. |

## Decisiones del modelo

- **Importes en céntimos enteros** (`BIGINT`, con `CHECK > 0` en las finanzas), cantidades en `DECIMAL(10,3)` (milésimas exactas) y fechas de calendario en `DATE`, que viajan como texto `AAAA-MM-DD`, igual que en la aplicación. Los tipos y tamaños de cada columna, con su porqué, están en [DATA.md](migration/DATA.md) y en la cabecera de `database/mysql/migrations/005-esquema-inicial.sql`.
- **InnoDB, utf8mb4 y `utf8mb4_0900_bin`** en todas las tablas: compara como SQLite («pina», «piña» y «PINA» son claves distintas, y «abc» no es «abc »).
- **Claves foráneas**: los movimientos y recurrentes apuntan a su categoría, y las subcategorías a su categoría principal.
- **Índice único** `(recurring_id, occurrence_date)`: un vencimiento no puede existir dos veces. Los movimientos normales tienen `NULL` y no chocan.
- `movements.recurring_id` **no** es clave foránea a propósito: al borrar un recurrente se conservan sus vencimientos ya pagados.
- **No hay tablas** de cuentas bancarias, vivienda, vehículos, seguros ni financiaciones, para no duplicar información:
  - la app no lleva saldos, así que no hay cuentas;
  - Vivienda, Coche o Seguros son categorías;
  - una financiación es un recurrente con cuotas.
- **Funcionamiento**:
  - cada operación es una transacción (UnitOfWork, ver `docs/arquitectura.md`): se guarda entera o no se guarda nada, y bloquea antes de leer lo que va a cambiar;
  - InnoDB protege la base de datos ante un corte; la copia completa se hace con MySQL Workbench o mysqldump (README);
  - todas las consultas usan parámetros, también las listas `IN (...)`, y una sentencia por llamada, así que el SQL no se puede inyectar.

## Migraciones

Están en `database/mysql/migrations/`, como archivos `.sql` que podrá aplicar igual el backend .NET (`database/mysql/AGENTS.md`). Cada una se aplica una sola vez y queda anotada en `schema_migrations`. Una base de datos de una versión más nueva no se abre, y una migración a medias se explica en vez de continuar (el DDL de MySQL se confirma solo).

| Versión | Archivo | Qué hace |
| --- | --- | --- |
| 5 | `database/mysql/migrations/005-esquema-inicial.sql` | El esquema final de SQLite tras sus migraciones 001 a 005, con las mismas columnas en el mismo orden, sus claves, CHECK e índices, más `app_locks`. Empieza en 5 para que `/api/health` siga diciendo 5. Las categorías iniciales las siembra el servidor solo en una base nueva, nunca al importar. |

Reglas:
- **Una migración publicada no se edita**: los cambios van en una migración nueva. `server/common/mysql/migrations.test.ts` guarda la huella de cada archivo y falla si cambia.
- Nunca se borran datos: `ALTER TABLE`, tablas nuevas o copias de datos.
- Las migraciones de SQLite (`tools/sqlite/`) tampoco se editan, y ya no se añaden: describen la base que lee el importador.

### Cómo añadir una

1. `database/mysql/migrations/006-<que-hace>.sql`, con un comentario que explique qué cambia y por qué no se pierde nada, y el formato de `database/mysql/AGENTS.md` (una sentencia por «;» al final de línea, sin `DELIMITER`).
2. Un test en `server/common/mysql/migrations.test.ts` que parta de una base de la versión anterior con datos y compruebe que no se pierde nada, y las restricciones nuevas en `server/common/mysql/schema.test.ts`.
3. Actualiza el adaptador MySQL del módulo dueño, esta página y el AGENTS.md del módulo. Si cambia una tabla que importa el importador, también el importador.
4. Cuando se publique, añade su huella al test de las migraciones publicadas.
