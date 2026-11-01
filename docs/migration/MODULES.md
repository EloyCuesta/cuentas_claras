# Módulos, funcionalidades y contratos actuales

Referencia: `91832a52b987b8e89f270ee86b4a95b8a4ddad15`. Las rutas de esta página ya existen en Express; la implementación .NET está pendiente. Toda ruta lleva el prefijo `/api`. Los cuerpos y respuestas exactos se caracterizan desde tipos, validadores, rutas y consumidores en `BASE-01`; estas tablas no sustituyen esa comprobación.

Cada ID corresponde a una unidad de trabajo en [STATUS.md](STATUS.md). Completar una funcionalidad exige sus reglas, caso de uso, adaptadores, consumidor afectado y comprobaciones, no solo una nueva carpeta.

## Base técnica y acceso

Fuentes: [composición](../../server/app.ts), [acceso](../../server/infra/auth.ts), [errores HTTP](../../server/infra/http.ts), [cliente](../../src/api/apiClient.ts) y [proxy](../../vite.config.ts).

| Función | Contrato actual | Aceptación de la sustitución |
| --- | --- | --- |
| Salud | `GET /api/health` | Contrato caracterizado y estado del almacenamiento comprobable |
| Iniciar sesión | `POST /api/auth/login` con `{ codigo }` | Cookie y `{ rol: 'admin' }`; errores 400/401/429 y limitación por IP |
| Consultar sesión | `GET /api/auth/me` | `{ rol: 'admin' }` o `{ rol: 'invitado' }` sin redirecciones |
| Cerrar sesión | `POST /api/auth/logout` | Invalida sesión y cookie; éxito aunque no hubiera sesión |
| Acceder a finanzas | Todas sus rutas requieren sesión | 401 JSON sin sesión; invitado conserva despensa/tickets |

`BASE-01` deja ejemplos deterministas de peticiones/respuestas y reglas de borde y ejecuta la línea base disponible. `BASE-02` crea la solución .NET, host, composición, configuración, reloj/IDs, errores, acceso y pruebas de dependencias. Debe demostrar arranque y rutas básicas reales; los puertos sin implementación no bastan.

Pruebas de referencia: [server/app.test.ts](../../server/app.test.ts), [server/infra/auth.test.ts](../../server/infra/auth.test.ts) y [e2e/app.spec.ts](../../e2e/app.spec.ts). Conserva caducidad de 12 horas, pérdida de sesión al reiniciar, bloqueo tras cinco fallos, IP de proxy fiable y arranque rechazado si falta código. La ruta de reset de pruebas no puede habilitarse en ejecución normal.

## Finance: finanzas personales

Fuentes: [repositorio](../../server/finance/repository.ts), [rutas](../../server/finance/routes), [reglas y tipos](../../shared/finance), [cliente React](../../src/finance/ApiFinanceRepository.ts) y [pantallas](../../src/finance/pages).

| ID | Funcionalidad y contratos actuales | Reglas y condición de aceptación |
| --- | --- | --- |
| FIN-01 | Leer datos: `GET /api/data`; categorías: `PUT/DELETE /api/categories/:id` y `replacementId`; metadatos: `GET/PUT /api/meta/:key` | Primer recorrido React contra .NET/MySQL. Categorías con un nivel de subcategorías, tipo, orden y presupuesto; borrar coordina sustitución de referencias y subcategorías sin guardados parciales. Solo finanzas en `/data` y sesión exigida |
| FIN-02 | Movimientos y pagos: `PUT/DELETE /api/movements/:id` | Ingreso/gasto y pendiente/realizado conservan fechas e importes válidos. Pagar modifica el mismo movimiento, no crea otro. El ID de URL coincide con el cuerpo; reintentar la misma operación no duplica tras una recarga fallida |
| FIN-03 | Recurrentes: `PUT/DELETE /api/recurring/:id`; `POST /api/occurrences/generate` | Preservar horizon, markPaidBefore, frecuencias, cuotas, exclusiones y pagos realizados. Editar regenera pendientes; borrar conserva realizados. Día 31 se ajusta a fin de mes y vuelve al 31 cuando procede. Dos conexiones no crean la misma ocurrencia dos veces |
| FIN-04 | Resumen mensual/anual, presupuestos, filtros y previsión | Portar reglas de cálculo a consultas de aplicación y adaptar pantallas. La columna anual coincide con el mismo mes; realizado se atribuye a fecha de pago y pendiente a vencimiento. Proyectados no se persisten ni se pagan hasta generarse. Los nuevos endpoints de consulta se diseñan/documentan en esta tarea, no se presuponen existentes |
| FIN-05 | Copia financiera, restauración y exportaciones; `PUT /api/data` y metadatos | Validar todo antes de sustituir, restauración financiera atómica y sin tocar despensa/tickets. Conservar JSON v1 y formato CSV para Excel/LibreOffice. CSV financiero no es una copia completa de la instalación |

Las cifras financieras se guardan positivas y su tipo distingue ingreso/gasto. No traslades sin más a finanzas la admisión de negativos de las devoluciones de tickets.

Reglas a leer: [recurring.ts](../../shared/finance/recurring.ts), [summary.ts](../../shared/finance/summary.ts), [annual.ts](../../shared/finance/annual.ts), [backup.ts](../../shared/finance/backup.ts) y [csv.ts](../../shared/finance/csv.ts). React aún calcula previsión en [useForecastMovements.ts](../../src/finance/useForecastMovements.ts); preserva esos consumidores durante el portado.

Validación: [pruebas del repositorio](../../server/finance/repository.test.ts), pruebas `shared/finance/*.test.ts` y los recorridos financieros de `e2e/app.spec.ts`. Compara resultados C#/TypeScript con la misma fecha, IDs y casos, no con el reloj real de cada ejecución.

## Pantry: despensa

Fuentes: [repositorio](../../server/pantry/repository.ts), [rutas](../../server/pantry/routes.ts), [reglas y tipos](../../shared/pantry), [API React](../../src/pantry/pantryApi.ts), [provider](../../src/pantry/PantryProvider.tsx) y [componentes](../../src/pantry/components).

| ID | Funcionalidad y contratos actuales | Reglas y condición de aceptación |
| --- | --- | --- |
| PAN-01 | Personas: `GET/POST /api/despensa/personas`, `PUT/DELETE /api/despensa/personas/:id`; catálogo: `GET/POST /api/despensa/productos`, `PUT/DELETE /api/despensa/productos/:id` | Compartido es ownerId null; no borrar persona con productos. Preservar unidades, tracking compras/cantidad, frecuencia, precio desconocido frente a cero, cantidades/objetivos y versiones. Añadir expectedVersion al contrato de edición y formulario; dos ediciones concurrentes producen 409 en la obsoleta |
| PAN-02 | Ajustar: `POST /api/despensa/productos/:id/ajustar`; comprar/deshacer: `POST /api/despensa/comprado` y `POST /api/despensa/comprado/deshacer` | Ajuste relativo sobre cantidad vigente y sin negativos. Comprar completa cantidades hasta objetivo o añade evento según tracking. Deshacer usa cambios/versiones devueltos; ante cambio posterior no revierte parcialmente. Dos clientes no pierden incrementos |
| PAN-03 | Revisar: `POST /api/despensa/productos/:id/revision`, `DELETE /api/despensa/revisiones/:id`; configuración: `GET/PUT /api/despensa/presupuesto`, `PUT /api/despensa/repaso`; lectura: `GET /api/despensa/actividad?hoy=AAAA-MM-DD` | Mantener queda/poco/se_acabo/comprado, ritmo por mediana y cantidad, estimación mensual, lista por persona y repaso semanal. Portar consulta de actividad mediante puerto de lectura, sin hacer depender Pantry del dominio Tickets. Repaso guarda cada respuesta y fecha compartida; no crea movimientos financieros |

Cambios explícitos de contrato: la actualización actual de productos incrementa `version` pero `PantryItemInput` no contiene `expectedVersion`. La protección de edición se añade en `PAN-01`; no afirmes que ya existe. El POST de creación no necesita una versión anterior. Guarda la versión del producto que el usuario vio al abrir el formulario y presenta el conflicto con posibilidad de recargar.

Las unidades con fracciones admiten hasta tres decimales según validadores; el resto exige unidades enteras. No conviertas automáticamente litros, mililitros, kilos o gramos al migrar un registro. Los ajustes se calculan en el servidor sobre la cantidad actual. Preserva el significado de `tracking` y las reglas de cambios de modo.

La lista de la compra, compartir/copiar/descargar y WhatsApp son comportamientos del frontend que se mantienen. La migración no debe transformar el enlace de compartir en un envío automático.

Validación: [server/pantry/pantry.test.ts](../../server/pantry/pantry.test.ts), [pantry.test.ts](../../shared/pantry/pantry.test.ts), [rhythm.test.ts](../../shared/pantry/rhythm.test.ts), [review.test.ts](../../shared/pantry/review.test.ts) y [e2e/despensa.spec.ts](../../e2e/despensa.spec.ts). Añade integración MySQL con dos conexiones para edición, ajustes y deshacer.

## Tickets: lectura, revisión y efectos de compra

Fuentes: [servicio](../../server/tickets/service.ts), [OCR](../../server/tickets/ocr.ts), [rutas](../../server/tickets/routes.ts), [validación de lectura](../../server/tickets/request.ts), [repositorio](../../server/tickets/repository.ts), [reglas](../../shared/tickets) y [fixtures](../../shared/tickets/fixtures).

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

Casos y pruebas: [cases.test.ts](../../shared/tickets/cases.test.ts), [safety.test.ts](../../shared/tickets/safety.test.ts), [evidence.test.ts](../../shared/tickets/evidence.test.ts), [savePlan.test.ts](../../shared/tickets/savePlan.test.ts), [fixtures.test.ts](../../shared/tickets/fixtures.test.ts), [server/tickets/tickets.test.ts](../../server/tickets/tickets.test.ts), [ticketReviewState.test.ts](../../src/pantry/components/ticketReviewState.test.ts) y [e2e/tickets.spec.ts](../../e2e/tickets.spec.ts).

## Datos, integración y cambio final

`DATA-01` crea el esquema completo, sus restricciones y pruebas del proveedor según [DATA.md](DATA.md). No introduce una API paralela de importación ni ejecuta una carga al arrancar.

`DATA-02` construye la utilidad de importación y comparación, la demuestra con datos sintéticos y registra por separado la validación con el archivo real cuando esté disponible.

`CUT-01` integra los módulos, ejecuta recorridos de escritorio/móvil contra .NET/MySQL, ensaya backup/recuperación y realiza el corte de escrituras solo cuando se cumplen sus condiciones. La conservación temporal del worker OCR o de cálculos React debe quedar visible; no se declara retirada completa del backend anterior mientras aún tenga dependencias de ejecución necesarias.
