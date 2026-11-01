# Migración de Cuentas Claras para Codex

Actualización documental: 1 de noviembre de 2026. Repositorio: [EloyCuesta/cuentas_claras](https://github.com/EloyCuesta/cuentas_claras).

## Situación de partida

El código inspeccionado es `91832a52b987b8e89f270ee86b4a95b8a4ddad15`, integrado el 30 de octubre de 2026. Contenía 210 archivos, React + TypeScript + Vite, una API Express y cinco migraciones SQLite. No había solución .NET ni persistencia MySQL.

Esta entrega añade instrucciones y documentación. No implementa la migración del backend ni convierte una base de datos. El estado comprobado se mantiene en [STATUS.md](STATUS.md), separado de la arquitectura propuesta.

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

Empieza por `STATUS.md`, identifica la tarea y lee el detalle relacionado. El orden inicial es base técnica, esquema, funcionalidades de finanzas, despensa y tickets, y validación del cambio final. El importador puede desarrollarse después del esquema sin esperar a terminar todas las pantallas.

## Cómo interpretar la documentación

- **Actual** describe archivos y comportamiento de la referencia inspeccionada. Contrástalo con la rama cuando retomes el trabajo.
- **Objetivo** expresa decisiones para implementar; no equivale a código disponible ni a una prueba aprobada.
- **Pendiente de validar** identifica una decisión que requiere evidencia, como el proveedor EF/MySQL o el motor OCR definitivo.
- Los contratos y fixtures del código sirven para caracterizar el comportamiento. Si una descripción antigua del README discrepa, comprueba código y pruebas y documenta la decisión; no cambies reglas de negocio para hacer coincidir una frase antigua.
- Ningún resultado histórico de pruebas demuestra que la nueva API o la importación a MySQL funcionen. Guarda la evidencia de la ejecución correspondiente a cada tarea.

## Primera sesión y siguientes sesiones

En la primera sesión, ejecuta `BASE-01`: confirma la línea base y fija ejemplos de contratos y reglas antes de portar. Después, `BASE-02` crea la solución y el acceso; `DATA-01` prepara el esquema. Usa los IDs para pedir trabajos concretos, por ejemplo `FIN-03` para recurrentes o `PAN-02` para comprar y deshacer.

Para retomar, lee el registro de la última tarea y continúa por la primera pendiente con dependencias verificadas. Un bloqueo de datos reales no impide trabajar con fixtures en otros módulos. El cambio final requiere validación completa y un corte de escrituras.
