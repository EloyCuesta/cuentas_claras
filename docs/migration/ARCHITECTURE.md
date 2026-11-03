# Arquitectura objetivo y decisiones de migración

Estado: diseño por implementar. Consulta [STATUS.md](STATUS.md) para saber qué existe.

La organización actual de Express ya es hexagonal modular y está descrita en [arquitectura actual](../arquitectura.md). Las capas, proyectos y tipos C# de este documento son destino; BASE-01 conserva los puertos y adaptadores TypeScript. El acceso a MySQL desde .NET es una propuesta pendiente de autorizar y validar en DATA-01: MySqlConnector con SQL explícito, como hace Express desde la fase MYSQL, porque AGENTS.md prohíbe los ORM y Pomelo.EntityFrameworkCore.MySql no tiene versión para EF Core 10.

## Producto y límites

Cuentas Claras sirve para registrar ingresos, gastos y próximos pagos, distinguir realizado de previsto, consultar meses y años y gestionar la despensa doméstica mediante productos, compras, repaso semanal y tickets. La instalación será local, con una web, una API y MySQL. Se mantiene un repositorio y un monolito modular.

Finanzas y despensa son ámbitos separados. Los tickets pertenecen al flujo de compra de la despensa y no generan gastos financieros. El presupuesto de despensa es una estimación doméstica, independiente del presupuesto por categorías de finanzas. No se añade un sistema multiusuario.

## Stack propuesto

| Pieza | Destino | Decisión pendiente de comprobar |
| --- | --- | --- |
| API | ASP.NET Core 10 | SDK estable y configuración de arranque en el equipo |
| Negocio y aplicación | C# | Equivalencia con reglas y fixtures TypeScript |
| Persistencia | SQL explícito con MySqlConnector (propuesta) sobre el esquema y las migraciones de `database/mysql/` | Autorizar la dependencia, fijar versión tras restore y prueba real contra MySQL |
| Base de datos | MySQL Server 8.4, InnoDB, utf8mb4 | JSON, precisión, collations, restricciones y concurrencia |
| Administración | MySQL Workbench | Conexión al servidor local; no sustituye al servidor |
| Interfaz | React + TypeScript + Vite existentes | Ajustar consumidores y conservar experiencia de escritorio/móvil |
| OCR | Adaptador local detrás de `ITicketReader` | Ensayo con fixtures antes de elegir implementación definitiva |

No se fija aquí una versión concreta de un paquete MySQL. Comprueba documentación oficial y paquetes estables al ejecutar `DATA-01`, registra la combinación elegida y no uses previews por defecto. El esquema ya existe: .NET aplica las mismas migraciones .sql y el mismo `schema_migrations`.

## Organización propuesta

La carpeta backend/ y los proyectos siguientes son destino, no rutas ya creadas. React puede permanecer en `src/` durante toda la sustitución.

| Proyecto bajo backend/ | Responsabilidad | Referencias permitidas |
| --- | --- | --- |
| `CuentasClaras.Domain` | Entidades, valores y reglas puras; carpetas Finance, Pantry, Tickets y un núcleo común pequeño | Biblioteca estándar |
| `CuentasClaras.Application` | Casos de uso, puertos, DTO de aplicación, contratos públicos entre módulos | Domain |
| `CuentasClaras.Infrastructure` | MySQL/EF, transacciones, OCR y adaptadores de configuración/acceso | Application y Domain |
| `CuentasClaras.Api` | HTTP, políticas, serialización y composición | Application; Infrastructure para registrar adaptadores |

Los tests irán separados del código de ejecución y seguirán las necesidades reales: reglas puras, dependencias arquitectónicas, integración MySQL y contrato HTTP. Conserva y adapta los E2E de React.

Domain no conoce ASP.NET Core, EF Core, React ni el proveedor MySQL. Application no devuelve `IQueryable`, `DbContext`, entidades EF ni conexiones. Los puertos pertenecen a la capa que los necesita y sus implementaciones a Infrastructure. Los DTO HTTP se mapean explícitamente; no se serializan entidades de dominio directamente.

Las capas quedan separadas por ensamblados y los módulos por namespaces dentro de ellos. Esa distribución no impide por sí sola referencias indebidas entre módulos: añade pruebas de arquitectura para verificar las reglas. No atribuyas al compilador una separación que todavía depende de convenciones.

## Límites de módulos

| Módulo | Posee | Colaboración permitida |
| --- | --- | --- |
| Finance | Categorías, movimientos, recurrentes, exclusiones, presupuestos financieros, previsión y copias financieras | Núcleo común y sus puertos |
| Pantry | Personas, catálogo, unidades, cantidades, versiones, revisiones, compras manuales y configuración de despensa | Puerto de lectura de actividad y contratos públicos de aplicación |
| Tickets | OCR, interpretación, revisión, tickets, líneas, equivalencias y deduplicación | Contratos públicos de Pantry para catálogo y efectos de compra |
| Servicios comunes | Reloj, IDs, errores, transacción y acceso | Solo abstracciones pequeñas compartidas de forma justificada |

Pantry no importa el dominio de Tickets. Su historial se obtiene mediante un puerto de lectura implementado en infraestructura. Tickets no llama a un repositorio concreto de Pantry; usa un contrato de aplicación. No sustituyas el acoplamiento actual por un ciclo de dependencias entre proyectos.

## Transacciones y concurrencia

Habrá una unidad de trabajo común con una conexión MySQL por operación, como la de Express (`server/common/mysql/MysqlUnitOfWork.ts`): las llamadas anidadas se unen a la transacción exterior y los bloqueos (`app_locks` y `SELECT … FOR UPDATE` de productos en orden de id) se toman antes de leer. Los repositorios no confirman independientemente una operación coordinada. El caso exterior decide cuándo guardar y confirmar.

`GuardarTicketRevisado` debe comprobar duplicados, consultar el catálogo vigente, calcular el plan, crear productos, guardar equivalencias, aplicar precios/cantidades e insertar cabecera/líneas dentro de una sola transacción. Todos los participantes comparten contexto y transacción. El OCR se ejecuta antes para no mantener bloqueos durante el reconocimiento. Un fallo debe revertir todos los efectos.

La edición de productos incorporará `expectedVersion` en el DTO de actualización, tomado de la versión leída al abrir el formulario. La escritura debe condicionar por esa versión e incrementarla; un conflicto devuelve 409 y la UI conserva el borrador y permite recargar. Refrescar la versión a escondidas y reintentar sobrescribiendo elimina la protección. Esta es una mejora deliberada respecto al contrato actual y se entrega con `PAN-01` en ambos extremos.

Para los ajustes relativos de cantidad, calcula sobre el valor actual y usa una actualización atómica o un mecanismo equivalente verificado con dos conexiones. Comprar/deshacer debe conservar su protección frente a cambios posteriores y su comportamiento de todo o nada.

Recurrentes y tickets requieren índices únicos, además de comprobaciones de aplicación. Prueba las carreras con dos conexiones MySQL; ejecutar una operación dos veces secuencialmente no demuestra ausencia de duplicados concurrentes.

En movimientos financieros conserva el mismo ID cuando se reintenta la misma operación. En FIN-02 la interfaz deberá distinguir «guardado confirmado» de «recarga fallida» para evitar repetir un alta ya confirmada; no se da esa mejora por implementada en React.

## HTTP, acceso y configuración

Mantén las rutas `/api`, nombres de campos, enums, nulabilidad y estados del código actual, descritos en [MODULES.md](MODULES.md). Conserva las respuestas:

```json
{ "ok": true, "data": null }
```

```json
{ "ok": false, "error": { "code": "VALIDATION", "message": "Mensaje en español" } }
```

Los errores automáticos de ASP.NET Core también necesitan adaptación: validación, JSON mal formado, cuerpo demasiado grande, autorización, rutas inexistentes y errores internos no deben introducir HTML, redirecciones o envoltorios distintos. Usa DTO JSON explícitos para conservar camelCase, valores como `realizado` y campos como `rol`.

La política actual a conservar es:

- Finanzas y metadatos requieren sesión; despensa, tickets y salud no requieren código.
- `POST /api/auth/login` recibe `{ codigo }`, devuelve `{ rol: 'admin' }` y cookie de sesión. `GET /api/auth/me` devuelve `admin` o `invitado`; logout devuelve éxito aunque no hubiera sesión.
- Sesiones de 12 horas, cookie `cc_sesion`, HttpOnly, SameSite=Strict y Path=/api. El servidor actual las invalida al reiniciar; no cambies esa semántica por adoptar cookies persistentes de framework sin documentar el cambio.
- Cinco códigos incorrectos bloquean los siguientes intentos durante 15 minutos por IP. Conserva 401/429 y `Retry-After`; confía solo en el proxy local observado, no en cabeceras de cualquier cliente.
- La configuración del código de acceso se valida antes de abrir/crear la base de datos. No puede quedar una API de finanzas abierta por faltar configuración.
- Las respuestas que atraviesan el router de `/api` llevan `Cache-Control: no-store`. Los errores del lector JSON de Express (400/413) se producen antes y actualmente carecen de esa cabecera. BASE-01 registra esa diferencia; BASE-02 deberá aplicar la garantía también a los errores del host y documentar la corrección deliberada.

Vite ya permite seleccionar el servidor con `CUENTAS_API_URL`. Mantén el proxy del mismo origen para las cookies; al arrancar dos APIs de ensayo usa puertos distintos. Conserva `CUENTAS_CODIGO` o documenta su mapeo de forma explícita. ASP.NET Core no debe presuponerse lector automático del `.env` usado por Node: implementa y documenta la carga/configuración local que se elija, sin guardar secretos en git.

## React y retirada del backend anterior

Reutiliza `src/api/client.ts`, `src/features/finance/ApiFinanceRepository.ts` y `src/features/pantry/api.ts`. Adapta cada consumidor cuando cambie su contrato. No reescribas todas las pantallas para cambiar el motor de datos.

La migración de IndexedDB al servidor y `POST /api/import` siguen presentes en esta rama. Conserva el recorrido y sus pruebas mientras no se apruebe su retirada, pendiente en [las decisiones actuales](../decisiones.md).

`shared/` también contiene reglas consumidas por React. La proyección de recurrentes y los resúmenes no están todos en el servidor actual. Antes de retirarlos, porta las reglas y verifica equivalencia; después integra consultas de aplicación con contratos documentados. No inventes que esos endpoints nuevos ya existen.

Se puede mantener temporalmente el worker OCR Node como proceso local detrás de `ITicketReader`, sin acceso de escritura a la base. Registra esa dependencia y sus pasos de arranque. Mientras siga siendo necesario, la retirada de Node del backend está pendiente. Node continuará siendo necesario para desarrollar/compilar React.
