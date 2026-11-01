# Datos: SQLite a MySQL local

Estado: procedimiento y diseño pendientes de ejecución. El archivo SQLite de la instalación del usuario no está disponible en el repositorio. No se ha importado ninguna fila real a MySQL en esta entrega documental.

## Fuente y alcance

El origen es el esquema resultante de las cinco migraciones de [server/infra/migrations](../../server/infra/migrations). No basta leer la migración 001: 003 añade tickets, tracking y actividad; 004 añade `poco` y último repaso; 005 añade revisión segura, ajustes, incidencias, evidencia y nuevas claves de deduplicación.

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
| `schema_migrations` | Archivo de procedencia | Guardar en el informe/exportación del origen; no reutilizar como historial EF |

Son 12 tablas de aplicación más el control de migraciones SQLite. El historial de EF se inicia por separado. Las sesiones actuales están en memoria y no se importan; el usuario vuelve a iniciar sesión al cambiar de servidor.

## Mapeo de tipos

| Dato | Destino propuesto | Comprobación obligatoria |
| --- | --- | --- |
| Importes en céntimos | `BIGINT` firmado / `long` | Mismos límites de cada dominio; negativos en devoluciones, positivos en movimientos financieros |
| Quantity y target | `DECIMAL(10,3)` | Exactitud en milésimas, unidades admitidas y máximo actual de 1.000.000 |
| Peso en kg | `DECIMAL(10,3)` | Precisión y límites del analizador, sin volver a interpretar la compra |
| Orden de categoría | Tipo que conserve el `REAL` actual; inicialmente evaluar `DOUBLE` | No truncar a entero ni fijar una escala decimal arbitraria |
| Fechas de calendario | `DATE` / `DateOnly` | El mismo día; no aplicar UTC a una fecha sin hora |
| Hora de compra | Campo que conserve el formato actual | No inventar una zona horaria para una hora local del ticket |
| Instantes de creación/cambio | `DATETIME(3)` UTC | Normalización y salida ISO equivalentes a las actuales |
| IDs | `VARCHAR` dimensionado tras perfilar datos y validadores | Conservar valores existentes; no exigir que todos sean Guid |
| Booleanos | Mapeo explícito del proveedor | Conservar false/true y nulabilidad cuando proceda |
| Ajustes, incidencias y evidencia | JSON o texto JSON validado tras ensayo del proveedor | Distinguir SQL NULL, JSON null y listas vacías; comparar contenido normalizado |
| Versión de producto | Entero con token de concurrencia | Conservar el número importado; incrementos y comparación en cada escritura pertinente |

El motor y el ORM deben devolver números JSON compatibles con los consumidores actuales. Usar `long` en C# no autoriza ampliar los límites por encima de lo admitido por JavaScript o por las reglas del dominio.

Usa utf8mb4 con collations explícitas para IDs, huellas y claves normalizadas. Prueba mayúsculas/minúsculas, tildes y espacios finales frente a SQLite antes de elegir la collation. Una comparación más permisiva puede unir equivalencias antes distintas o impedir importar dos claves válidas.

## Restricciones e integridad

- Conserva la unicidad de `fingerprint`, las parejas `(recurring_id, occurrence_date)` y `(ticket_id, position)` y la clave de equivalencias `(store, name_key)`.
- `import_id` y `source_fingerprint` son nullable y únicos cuando tienen valor. En MySQL prueba múltiples nulos y el rechazo de valores no nulos repetidos; no copies la sintaxis de índices parciales de SQLite.
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
