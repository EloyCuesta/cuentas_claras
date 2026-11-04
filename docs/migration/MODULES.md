# Módulos, funcionalidades y contratos actuales

Referencia actual: `7eebed2`, rama refactor/arquitectura-hexagonal. El documento inicial de `9d1df17` describía `91832a5`; las fuentes siguientes corresponden a la rama actual. Las rutas de esta página ya existen en Express; la implementación .NET está pendiente. Toda ruta lleva el prefijo `/api`. Los cuerpos y respuestas exactos se caracterizan desde tipos, validadores, rutas y consumidores en `BASE-01`; estas tablas no sustituyen esa comprobación.

El [índice de la API actual](../api.md) contiene 39 pares método/ruta de aplicación (health 1, auth 3, finance 12, pantry 16 y tickets 7), más `POST /api/test/reset`, exclusivo de pruebas. Las descripciones detalladas siguen en los AGENTS de cada módulo; aquí se asignan a las entregas de migración.

Cada ID corresponde a una unidad de trabajo en [STATUS.md](STATUS.md). Completar una funcionalidad exige sus reglas, caso de uso, adaptadores, consumidor afectado y comprobaciones, no solo una nueva carpeta.

## Base técnica y acceso

Fuentes: [composición](../../server/app.ts), [acceso](../../server/modules/auth/index.ts), [errores HTTP](../../server/common/http/response.ts), [cliente](../../src/api/client.ts) y [proxy](../../vite.config.ts).

| Función | Contrato actual | Aceptación de la sustitución |
| --- | --- | --- |
| Salud | `GET /api/health` | Contrato caracterizado y estado del almacenamiento comprobable |
| Iniciar sesión | `POST /api/auth/login` con `{ codigo }` | Cookie y `{ rol: 'admin' }`; errores 400/401/429 y limitación por IP |
| Consultar sesión | `GET /api/auth/me` | `{ rol: 'admin' }` o `{ rol: 'invitado' }` sin redirecciones |
| Cerrar sesión | `POST /api/auth/logout` | Invalida sesión y cookie; éxito aunque no hubiera sesión |
| Acceder a finanzas | Todas sus rutas requieren sesión | 401 JSON sin sesión; invitado conserva despensa/tickets |

`BASE-01` deja ejemplos deterministas de peticiones/respuestas y reglas de borde y ejecuta la línea base disponible. `BASE-02` crea la solución .NET, host, composición, configuración, reloj/IDs, errores, acceso y pruebas de dependencias. Debe demostrar arranque y rutas básicas reales; los puertos sin implementación no bastan.

Los [contratos de ensayo](../../fixtures/migration) fijan las entradas y salidas para el portado. Su [ejecutor HTTP](../../server/migrationContracts.test.ts) comprueba respuestas completas y cobertura de las rutas actuales; el formato y los comandos se explican en [pruebas](../pruebas.md).

Pruebas de referencia: [server/app.test.ts](../../server/app.test.ts), [server/modules/auth/auth.test.ts](../../server/modules/auth/auth.test.ts) y [e2e/app.spec.ts](../../e2e/app.spec.ts). Conserva caducidad de 12 horas, pérdida de sesión al reiniciar, bloqueo tras cinco fallos, IP de proxy fiable y arranque rechazado si falta código. La ruta de reset de pruebas no puede habilitarse en ejecución normal.

El orden actual del middleware también forma parte de la caracterización: una ruta desconocida de `/api` sin sesión devuelve 401, y con sesión devuelve 404. El lector JSON precede a la autenticación y al router; la diferencia de caché en sus errores está registrada en [ARCHITECTURE.md](ARCHITECTURE.md).

## Finance: finanzas personales

Fuentes: [repositorio](../../server/modules/finance/adapters/mysql/MysqlFinanceStore.ts), [rutas](../../server/modules/finance/adapters/http), [reglas y tipos](../../shared/finance), [cliente React](../../src/features/finance/ApiFinanceRepository.ts) y [pantallas](../../src/features/finance/pages).

| ID | Funcionalidad y contratos actuales | Reglas y condición de aceptación |
| --- | --- | --- |
| FIN-01 | Leer datos: `GET /api/data`; categorías: `PUT/DELETE /api/categories/:id` y `replacementId`; metadatos: `GET/PUT /api/meta/:key` | Primer recorrido React contra .NET/MySQL. Categorías con un nivel de subcategorías, tipo, orden y presupuesto; borrar coordina sustitución de referencias y subcategorías sin guardados parciales. Solo finanzas en `/data` y sesión exigida |
| FIN-02 | Movimientos y pagos: `PUT/DELETE /api/movements/:id` | Ingreso/gasto y pendiente/realizado conservan fechas e importes válidos. Pagar modifica el mismo movimiento, no crea otro. El ID de URL coincide con el cuerpo; reintentar la misma operación no duplica tras una recarga fallida |
| FIN-03 | Recurrentes: `PUT/DELETE /api/recurring/:id`; `POST /api/occurrences/generate` | Preservar horizon, markPaidBefore, frecuencias, cuotas, exclusiones y pagos realizados. Editar regenera pendientes; borrar conserva realizados. Día 31 se ajusta a fin de mes y vuelve al 31 cuando procede. Dos conexiones no crean la misma ocurrencia dos veces |
| FIN-04 | Resumen mensual/anual, presupuestos, filtros y previsión | Portar reglas de cálculo a consultas de aplicación y adaptar pantallas. La columna anual coincide con el mismo mes; realizado se atribuye a fecha de pago y pendiente a vencimiento. Proyectados no se persisten ni se pagan hasta generarse. Los nuevos endpoints de consulta se diseñan/documentan en esta tarea, no se presuponen existentes |
| FIN-05 | Copia financiera, restauración y exportaciones; `PUT /api/data`, `POST /api/import` y metadatos | Validar todo antes de sustituir, restauración financiera atómica y sin tocar despensa/tickets. Conservar JSON v1, formato CSV e importación del navegador mientras siga disponible. CSV financiero no es una copia completa de la instalación |

Las cifras financieras se guardan positivas y su tipo distingue ingreso/gasto. No traslades sin más a finanzas la admisión de negativos de las devoluciones de tickets.

La importación actual recibe `{ data, lastBackupAt }`, devuelve 201 con los recuentos de categorías, movimientos y recurrentes y responde 409 si ya hay datos del usuario. Su consumidor está en [browserMigration](../../src/features/finance/browserMigration); el invitado no ejecuta esa migración. No confundir este recorrido IndexedDB→servidor con el importador SQLite→MySQL ni con DATA-02.

Reglas a leer: [recurring.ts](../../shared/finance/recurring.ts), [summary.ts](../../shared/finance/summary.ts), [annual.ts](../../shared/finance/annual.ts), [backup.ts](../../shared/finance/backup.ts) y [csv.ts](../../shared/finance/csv.ts). React aún calcula previsión en [useForecastMovements.ts](../../src/features/finance/useForecastMovements.ts); preserva esos consumidores durante el portado.

Validación: [pruebas del repositorio](../../server/modules/finance/finance.test.ts), pruebas `shared/finance/*.test.ts` y los recorridos financieros de `e2e/app.spec.ts`. Compara resultados C#/TypeScript con la misma fecha, IDs y casos, no con el reloj real de cada ejecución.

## Pantry: despensa

Fuentes: [repositorio](../../server/modules/pantry/adapters/mysql/MysqlPantryRepository.ts), [rutas](../../server/modules/pantry/adapters/http/routes.ts), [reglas y tipos](../../shared/pantry), [API React](../../src/features/pantry/api.ts), [hook de estado](../../src/features/pantry/usePantry.ts) y [componentes](../../src/features/pantry/components).

| ID | Funcionalidad y contratos actuales | Reglas y condición de aceptación |
| --- | --- | --- |
| PAN-01 | Personas: `GET/POST /api/despensa/personas`, `PUT/DELETE /api/despensa/personas/:id`; catálogo: `GET/POST /api/despensa/productos`, `PUT/DELETE /api/despensa/productos/:id` | Compartido es ownerId null; no borrar persona con productos. Preservar unidades, tracking compras/cantidad, frecuencia, precio desconocido frente a cero, cantidades/objetivos y versiones. Añadir expectedVersion al contrato de edición y formulario; dos ediciones concurrentes producen 409 en la obsoleta |
| PAN-02 | Ajustar: `POST /api/despensa/productos/:id/ajustar`; comprar/deshacer: `POST /api/despensa/comprado` y `POST /api/despensa/comprado/deshacer` | Ajuste relativo sobre cantidad vigente y sin negativos. Comprar completa cantidades hasta objetivo o añade evento según tracking. Deshacer usa cambios/versiones devueltos; ante cambio posterior no revierte parcialmente. Dos clientes no pierden incrementos |
| PAN-03 | Revisar: `POST /api/despensa/productos/:id/revision`, `DELETE /api/despensa/revisiones/:id`; configuración: `GET/PUT /api/despensa/presupuesto`, `PUT /api/despensa/repaso`; lectura: `GET /api/despensa/actividad?hoy=AAAA-MM-DD` | Mantener queda/poco/se_acabo/comprado, ritmo por mediana y cantidad, estimación mensual, lista por persona y repaso semanal. Portar consulta de actividad mediante puerto de lectura, sin hacer depender Pantry del dominio Tickets. Repaso guarda cada respuesta y fecha compartida; no crea movimientos financieros |

Cambios explícitos de contrato: la actualización actual de productos incrementa `version` pero `PantryItemInput` no contiene `expectedVersion`. La protección de edición se añade en `PAN-01`; no afirmes que ya existe. El POST de creación no necesita una versión anterior. Guarda la versión del producto que el usuario vio al abrir el formulario y presenta el conflicto con posibilidad de recargar.

Las unidades con fracciones admiten hasta tres decimales según validadores; el resto exige unidades enteras. No conviertas automáticamente litros, mililitros, kilos o gramos al migrar un registro. Los ajustes se calculan en el servidor sobre la cantidad actual. Preserva el significado de `tracking` y las reglas de cambios de modo.

La lista de la compra, compartir/copiar/descargar y WhatsApp son comportamientos del frontend que se mantienen. La migración no debe transformar el enlace de compartir en un envío automático.

Validación: [server/modules/pantry/pantry.test.ts](../../server/modules/pantry/pantry.test.ts), [pantry.test.ts](../../shared/pantry/pantry.test.ts), [pantryRhythm.test.ts](../../shared/pantry/pantryRhythm.test.ts), [pantryReview.test.ts](../../shared/pantry/pantryReview.test.ts) y [e2e/despensa.spec.ts](../../e2e/despensa.spec.ts). Añade integración MySQL con dos conexiones para edición, ajustes y deshacer.

## Tickets: lectura, revisión y efectos de compra

Fuentes: [lectura](../../server/modules/tickets/application/ReadTicket.ts), [guardado](../../server/modules/tickets/application/SaveTicket.ts), [reglas de compra](../../server/modules/tickets/domain/ticketPurchase.ts), [OCR](../../server/modules/tickets/adapters/tesseract/TesseractTicketReader.ts), [rutas](../../server/modules/tickets/adapters/http/routes.ts), [validación de lectura](../../server/modules/tickets/adapters/http/readTicketRequest.ts), [repositorio](../../server/modules/tickets/adapters/mysql/MysqlTicketRepository.ts), [reglas compartidas](../../shared/tickets) y [fixtures](../../fixtures/tickets).

En esta rama el guardado lo coordina SaveTicket con las reglas de ticketPurchase y ticketArithmetic; no existe el archivo savePlan de la referencia documental anterior. El portado debe partir de estos casos de uso y sus pruebas. La procedencia de los fixtures existentes se explica en [pruebas](../pruebas.md): algunos usan transcripciones aportadas por el dueño; los nuevos casos de BASE-01 son sintéticos.

| ID | Funcionalidad y contratos actuales | Reglas y condición de aceptación |
| --- | --- | --- |
| TIC-01 | Interpretación y plan puro; sin nuevo endpoint | Portar parsing, importes, evidencia, emparejamiento, ajustes, decisiones y plan de guardado con los mismos fixtures. C# reproduce resultados TypeScript y su redondeo; una cifra dudosa sigue visible para revisar |
| TIC-02 | OCR y borrador: `POST /api/despensa/tickets/leer` | Aceptar texto, imágenes o franjas y hoy como en el contrato actual. `ITicketReader` conserva confianza, geometría y alternativas de lectura general/numérica. No guardar tickets durante la lectura. Adaptador local probado con fixtures; registrar si aún requiere worker Node |
| TIC-03 | Guardar revisión: `POST /api/despensa/tickets` | Una transacción para cabecera/líneas, productos, equivalencias y actualizaciones. Comprobar duplicados y catálogo actual; mantener IDs de importación/huellas. 201 con `{ ticket, items }`; 409 ante duplicado sin duplicar efectos. Un fallo intermedio revierte todo |
| TIC-04 | Historial: `GET /api/despensa/tickets` y `GET /api/despensa/tickets/:id`; asociación: `PUT /api/despensa/tickets/:id/lineas/:lineId`; borrado: `DELETE /api/despensa/tickets/:id`; actividad compartida | Mantener resúmenes, detalle y aprendizaje de asociación. Cambiar asociación no equivale a resolver importes pendientes. Borrar retira actividad del ticket sin borrar productos ni deshacer cantidades históricas; verificar efecto en ritmo y repaso |

### Casos que deben sobrevivir al portado

- En nombres como «Patatas nueva 5 kg», la presentación del envase no es automáticamente la cantidad comprada. Una lectura dudosa que parece 92 euros exige evidencia o revisión; no se inventa un precio para cuadrar el total.
- Separadores decimales, miles, letras confundibles con cifras, letras de IVA, duplicados entre capturas, cantidades, precio por unidad, pesos y descuentos mantienen su tratamiento.
- El total sirve para reconciliar y mostrar diferencias. Dos errores pueden compensarse: que la suma coincida no convierte una línea ambigua en fiable.
- Solo líneas aplicables según las reglas actuales modifican catálogo, precio, cantidad y aprendizaje. Las pendientes se conservan con evidencia sin esos efectos. Preserva devoluciones y redondeo de mitades alejándose de cero donde lo exigen las reglas.
- OCR, interpretación, decisión del usuario y plan de persistencia son etapas separadas. No mantengas una transacción de base de datos abierta mientras el OCR trabaja.
- El servidor actual procesa PNG/JPEG y texto; no hay soporte PDF por el mero cambio a .NET. Caracteriza los límites de imágenes/franjas/texto y tamaño de JSON antes de adaptar el host.
- Las imágenes no se guardan actualmente; se conserva texto/evidencia del ticket confirmado. No incorpores almacenamiento permanente de fotos o servicios OCR externos como efecto secundario de la migración.

Casos y pruebas: [ticketCases.test.ts](../../shared/tickets/ticketCases.test.ts), [ticketSafety.test.ts](../../shared/tickets/ticketSafety.test.ts), [ticketEvidence.test.ts](../../shared/tickets/ticketEvidence.test.ts), [ticketFixtures.test.ts](../../shared/tickets/ticketFixtures.test.ts), [guardado, huellas y API](../../server/modules/tickets/tickets.test.ts), [ticketReviewState.test.ts](../../src/features/tickets/ticketReviewState.test.ts) y [e2e/tickets.spec.ts](../../e2e/tickets.spec.ts).

## Datos, integración y cambio final

La fase MYSQL (MYSQL-01 a MYSQL-04, en [STATUS.md](STATUS.md)) cambia primero el motor: Express pasa de SQLite a MySQL con la misma API, y deja el esquema en `database/mysql/` y el importador SQLite→MySQL.

`DATA-01` conecta .NET con ese MySQL: conexión, transacciones y bloqueos sobre las migraciones de `database/mysql/`, sin esquema propio, con pruebas del proveedor según [DATA.md](DATA.md). No introduce una API paralela de importación ni ejecuta una carga al arrancar.

`DATA-02` es la validación del corte de datos real: la persona importa su copia con la herramienta de MYSQL-03, revisa el informe y se registra el resultado.

`CUT-01` integra los módulos, ejecuta recorridos de escritorio/móvil contra .NET sobre la misma base MySQL, ensaya backup/recuperación y cambia el backend, no el motor, solo cuando se cumplen sus condiciones. La conservación temporal del worker OCR o de cálculos React debe quedar visible; no se declara retirada completa del backend anterior mientras aún tenga dependencias de ejecución necesarias.
