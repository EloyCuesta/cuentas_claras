# Base de datos

Un solo archivo SQLite: `server/data/cuentas.db`, fuera de git porque son los datos de la persona. Lo abre `server/common/sqlite/openDatabase.ts` (o el de `CUENTAS_DB_PATH`):
- si falta la carpeta, la crea;
- activa WAL, las claves foráneas y una espera de 5 s si otro proceso escribe;
- aplica las migraciones pendientes.

Nunca borra ni sobrescribe datos al abrir. Ningún test ni ningún agente lo toca.

## Tablas

Trece tablas, solo con lo que usa la aplicación. Cada una tiene un módulo dueño: solo su adaptador SQLite la lee o la escribe.

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
| `schema_migrations` | migraciones | Migraciones aplicadas (versión, nombre y fecha). |

## Decisiones del modelo

- **Importes en céntimos enteros** (`INTEGER`, con `CHECK > 0` en las finanzas) y fechas como texto `AAAA-MM-DD`, igual que en la aplicación.
- **Claves foráneas**: los movimientos y recurrentes apuntan a su categoría, y las subcategorías a su categoría principal.
- **Índice único** `(recurring_id, occurrence_date)`: un vencimiento no puede existir dos veces. Los movimientos normales tienen `NULL` y no chocan.
- `movements.recurring_id` **no** es clave foránea a propósito: al borrar un recurrente se conservan sus vencimientos ya pagados.
- **No hay tablas** de cuentas bancarias, vivienda, vehículos, seguros ni financiaciones, para no duplicar información:
  - la app no lleva saldos, así que no hay cuentas;
  - Vivienda, Coche o Seguros son categorías;
  - una financiación es un recurrente con cuotas.
- **Funcionamiento**:
  - cada operación es una transacción (UnitOfWork, ver `docs/arquitectura.md`): se guarda entera o no se guarda nada;
  - el modo WAL protege la base de datos ante un corte;
  - todas las consultas usan parámetros, también las listas `IN (...)`, así que el SQL no se puede inyectar.

## Migraciones

Están en `server/migrations/`. Cada una se aplica una sola vez, dentro de una transacción, y queda anotada en `schema_migrations`. Una base de datos de una versión más nueva no se abre.

| Versión | Archivo | Qué hace |
| --- | --- | --- |
| 1 | `server/migrations/001-esquema-inicial.ts` | Las tablas de las finanzas y las categorías iniciales (`DEFAULT_CATEGORIES`, de `shared/finance/categories.ts`). |
| 2 | `server/migrations/002-despensa.ts` | Las tablas de la despensa, sin tocar las demás. |
| 3 | `server/migrations/003-tickets.ts` | Los tickets, lo aprendido, las revisiones y la columna `tracking`; los productos que ya había siguen contándose (`cantidad`). |
| 4 | `server/migrations/004-repaso.ts` | El día del último repaso y la revisión «Queda poco». Como SQLite no deja cambiar una regla `CHECK`, copia `pantry_events` entera a una tabla nueva sin perder ninguna fila. |
| 5 | `server/migrations/005-ticket-review.ts` | Revisión segura de los tickets. Rehace `pantry_tickets` (el total admite negativos, por las devoluciones) y `pantry_ticket_lines`, conservando todas las filas y sus ids. Añade los ajustes, los avisos, `import_id` y `source_fingerprint` (únicos), y el estado, la confirmación y la evidencia de cada línea. Comprueba las claves foráneas al terminar. |

Reglas:
- **Una migración publicada no se edita**: los cambios van en una migración nueva. `server/migrations/migrations.test.ts` guarda la huella de 001 a 005 y falla si cambian. En la 001 solo cambió la línea del import al pasar el dominio a `shared/`.
- Nunca se borran datos: `ALTER TABLE`, tablas nuevas o copias de datos.
- Una migración solo importa librerías, `shared/` y otras migraciones.

### Cómo añadir una

1. `server/migrations/006-<qué-hace>.ts`, que exporta un objeto `Migration` (`version: 6`, `name` en español y `up(db)`), con un comentario que explique qué cambia y por qué no se pierde nada.
2. Añádela al final de `MIGRATIONS`, en `server/migrations/index.ts`.
3. Un test en `server/migrations/migrations.test.ts` que parta de una base de datos de la versión anterior con datos y compruebe que no se pierde nada. Actualiza la lista de tablas de `server/common/sqlite/openDatabase.test.ts` si añades alguna.
4. Actualiza el adaptador SQLite del módulo dueño, esta página y el AGENTS.md del módulo.
5. Cuando se publique, añade su huella al test de las migraciones congeladas.
