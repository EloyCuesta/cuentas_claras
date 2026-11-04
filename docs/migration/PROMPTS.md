# Prompts de implementación por módulos y funcionalidades

Estos prompts se dirigen a Codex o a un agente de programación en VS Code con acceso al repositorio. La documentación ya está en el proyecto; no hace falta volver a pegar el informe completo en cada sesión.

## Prompt principal reutilizable

Copia este bloque y cambia `TAREA` por un ID de [STATUS.md](STATUS.md), o deja la selección automática para continuar en orden.

```text
Actúa como ingeniero de software sénior y trabaja directamente en Cuentas Claras.

TAREA: la siguiente tarea pendiente de docs/migration/STATUS.md cuyas dependencias estén verificadas.

Lee primero AGENTS.md, docs/migration/README.md y STATUS.md. Consulta ARCHITECTURE.md, DATA.md y la funcionalidad correspondiente de MODULES.md. Contrasta todo con los archivos y pruebas actuales: la documentación distingue código existente, arquitectura objetivo y validaciones pendientes.

Objetivo del proyecto: conservar React/TypeScript y migrar el backend Express (ya sobre MySQL local desde la fase MYSQL) a un backend ASP.NET Core con arquitectura hexagonal modular sobre la misma base MySQL. Trabaja por funcionalidad, sin reescribir toda la aplicación en una sola entrega.

Antes de editar, indica el ID elegido, los contratos y reglas que afecta y un plan breve. Después implementa la tarea: reglas de dominio, caso de uso, puertos/adaptadores, persistencia, API, consumidor React y pruebas cuando correspondan. Para una tarea de caracterización, entrega los fixtures, inventario y resultados necesarios para habilitar la siguiente; para una tarea de implementación no te quedes en recomendaciones o carpetas vacías.

Conserva contratos HTTP y reglas de negocio. Protege finanzas con sesión y mantén despensa/tickets disponibles para invitado. Preserva céntimos, fechas, exclusiones, deduplicación, versiones y transacciones. Un ticket no crea gastos financieros; una restauración financiera no toca despensa. Implementa los cambios deliberados de contrato, como expectedVersion, junto a su consumidor y pruebas.

No borres shared/ mientras React lo importe. No sobrescribas datos reales ni ejecutes el corte de instalación por ser una tarea de desarrollo: usa bases de ensayo. Si falta la copia SQLite real, desarrolla con fixtures y registra la verificación real como pendiente. No inventes versiones de paquetes, comandos, resultados de pruebas ni una importación que no se haya ejecutado.

Ejecuta las comprobaciones adecuadas y corrige los fallos de tu cambio. Si una limitación externa impide completar una validación, registra la evidencia y continúa con las partes independientes. Actualiza STATUS.md y la documentación afectada con el resultado real. Termina indicando archivos principales, comportamiento conseguido, pruebas ejecutadas, limitaciones y siguiente ID elegible.
```

## Seleccionar módulo y funcionalidad

Usa la misma instrucción principal y sustituye su línea `TAREA` por una de estas. No envíes todos los IDs como si fueran una única entrega.

| Quiero trabajar en… | Línea para el prompt | Qué entregar |
| --- | --- | --- |
| Primera sesión | `TAREA: BASE-01.` | Contratos/fixtures caracterizados y línea base registrada |
| Base .NET y acceso | `TAREA: BASE-02.` | Solución ejecutable, acceso, errores, configuración y pruebas de dependencias |
| Express sobre MySQL | `TAREA: MYSQL-01.` (después MYSQL-02, MYSQL-03 y MYSQL-04) | Conexión, transacciones, esquema, módulos, importador y E2E contra MySQL real |
| .NET sobre MySQL | `TAREA: DATA-01.` | Acceso desde .NET al esquema de `database/mysql/`, probado con MySQL real |
| Finanzas: lectura y categorías | `TAREA: FIN-01.` | Primer recorrido React/API/MySQL y categorías/metadatos |
| Finanzas: movimientos y pagos | `TAREA: FIN-02.` | Altas/ediciones/borrados y pagar sin duplicar |
| Finanzas: recurrentes | `TAREA: FIN-03.` | Cuotas, exclusiones, fechas y generación concurrente |
| Finanzas: resúmenes y previsión | `TAREA: FIN-04.` | Consultas equivalentes e integración mensual/anual |
| Finanzas: copias y exportaciones | `TAREA: FIN-05.` | Restauración financiera aislada y formatos conservados |
| Despensa: personas y catálogo | `TAREA: PAN-01.` | CRUD, reglas y edición con expectedVersion/409 en UI |
| Despensa: comprar/deshacer | `TAREA: PAN-02.` | Ajustes y compras atómicas sin perder cambios concurrentes |
| Despensa: revisión semanal | `TAREA: PAN-03.` | Actividad, ritmo, lista, presupuesto y repaso |
| Tickets: reglas de lectura | `TAREA: TIC-01.` | Parser, evidencia, emparejamiento y plan puros equivalentes |
| Tickets: OCR local | `TAREA: TIC-02.` | Puerto/adaptador y borrador revisable, con límites y fixtures |
| Tickets: guardar compra | `TAREA: TIC-03.` | Transacción integral y deduplicación con dos conexiones |
| Tickets: historial | `TAREA: TIC-04.` | Detalle, asociación, borrado y actividad equivalente |
| Validar los datos reales | `TAREA: DATA-02.` | Registro del corte que hace la persona con el importador de MYSQL-03 |
| Integrar y preparar el corte | `TAREA: CUT-01.` | Recorridos completos, recuperación y condiciones de corte verificadas |

Si pides un ID con dependencias pendientes, el agente debe identificarlo y empezar por la primera dependencia necesaria que sí pueda completar; no debe afirmar que migró el módulo copiando su versión TypeScript a otra carpeta. Para seguir el orden sin elegir manualmente, usa la selección automática del prompt principal.

## Reanudar después de una sesión

```text
Continúa la migración de Cuentas Claras. Lee AGENTS.md y docs/migration/STATUS.md; comprueba el código y el registro de la última tarea. Ejecuta la primera tarea pendiente con sus dependencias verificadas siguiendo docs/migration/PROMPTS.md. No repitas una auditoría completa ni rehagas tareas verificadas sin una discrepancia concreta. Implementa la funcionalidad elegida, verifica lo que corresponda y actualiza el estado y las evidencias para la próxima sesión.
```

## Revisar una entrega ya implementada

```text
Revisa la tarea <ID> de docs/migration/STATUS.md contra AGENTS.md, su aceptación en MODULES.md y los archivos reales de esta rama. Comprueba contrato HTTP, reglas, transacciones, consumidor React y pruebas aplicables. Corrige los defectos dentro de esa tarea, ejecuta las comprobaciones pertinentes y registra el resultado real. No marques como verificada una importación real o una prueba MySQL que no hayas ejecutado, y no conviertas el estado anterior en evidencia por sí solo.
```
