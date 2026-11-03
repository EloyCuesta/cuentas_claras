# Migración de Cuentas Claras para Codex

Actualización documental: 1 de noviembre de 2026. Repositorio: [EloyCuesta/cuentas_claras](https://github.com/EloyCuesta/cuentas_claras).

## Situación de partida

La documentación inicial procede del commit `9d1df17` y describía `91832a52b987b8e89f270ee86b4a95b8a4ddad15`, integrado el 30 de octubre de 2026. BASE-01 la adapta a la rama refactor/arquitectura-hexagonal, con base `7eebed2`: React + TypeScript + Vite, una API Express modular y cinco migraciones SQLite. BASE-02 añadió el host .NET de acceso en `backend/`, y la fase MYSQL pasa Express de SQLite a MySQL antes de sustituir el backend.

BASE-01 caracteriza contratos y reglas de la aplicación existente con datos de ensayo. El estado comprobado se mantiene en [STATUS.md](STATUS.md), separado de la arquitectura propuesta. Esta etapa no sustituye el backend ni convierte una base de datos.

## Objetivo

Conservar la aplicación y sus funcionalidades, sustituyendo el backend por ASP.NET Core con arquitectura hexagonal modular y la persistencia por MySQL Server local. MySQL Workbench es el cliente de administración: el servidor MySQL también tiene que estar instalado y en marcha. React seguirá siendo el frontend.

Se trabajará por funcionalidades completas y con contratos compatibles. Las nuevas piezas se ensayan con datos separados antes del cambio de la instalación usada a diario.

## Documentos y orden de lectura

| Documento | Para qué sirve |
| --- | --- |
| [AGENTS.md](../../AGENTS.md) | Instrucciones de trabajo que Codex encuentra desde la raíz |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Capas, módulos, puertos, acceso y reglas de integración |
| [DATA.md](DATA.md) | Inventario de tablas, mapeo, importación y cambio de motor |
| [MODULES.md](MODULES.md) | Funcionalidades, rutas actuales, archivos de referencia y aceptación |
| [STATUS.md](STATUS.md) | Dependencias, estado real y evidencia de cada tarea |
| [PROMPTS.md](PROMPTS.md) | Prompt reutilizable y selecciones por módulo o funcionalidad |

Empieza por `STATUS.md`, identifica la tarea y lee el detalle relacionado. El orden es base técnica, la fase MYSQL (Express sobre MySQL, esquema e importador), el acceso de .NET a ese MySQL, funcionalidades de finanzas, despensa y tickets, y validación del cambio final.

## Cómo interpretar la documentación

- **Actual** describe archivos y comportamiento de la referencia inspeccionada. Contrástalo con la rama cuando retomes el trabajo.
- **Objetivo** expresa decisiones para implementar; no equivale a código disponible ni a una prueba aprobada.
- **Pendiente de validar** identifica una decisión que requiere evidencia, como el proveedor EF/MySQL o el motor OCR definitivo.
- Los contratos y fixtures del código sirven para caracterizar el comportamiento. Si una descripción antigua del README discrepa, comprueba código y pruebas y documenta la decisión; no cambies reglas de negocio para hacer coincidir una frase antigua.
- Ningún resultado histórico de pruebas demuestra que la nueva API o la importación a MySQL funcionen. Guarda la evidencia de la ejecución correspondiente a cada tarea.

## Primera sesión y siguientes sesiones

En la primera sesión, ejecuta `BASE-01`: confirma la línea base y fija ejemplos de contratos y reglas antes de portar. Después, `BASE-02` crea la solución y el acceso, y la fase MYSQL (`MYSQL-01` a `MYSQL-04`) cambia el motor de Express a MySQL; `DATA-01` conecta .NET con ese esquema. Usa los IDs para pedir trabajos concretos, por ejemplo `FIN-03` para recurrentes o `PAN-02` para comprar y deshacer.

Para retomar, lee el registro de la última tarea y continúa por la primera pendiente con dependencias verificadas. Un bloqueo de datos reales no impide trabajar con fixtures en otros módulos. El cambio final requiere validación completa y un corte de escrituras.
