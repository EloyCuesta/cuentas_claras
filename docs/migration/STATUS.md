# Estado y tareas de la migración

Última actualización: 1 de noviembre de 2026. Este archivo es el registro de continuidad de Codex; actualízalo al terminar cada tarea.

## Estado comprobado de partida

| Aspecto | Estado y evidencia |
| --- | --- |
| Referencia inspeccionada | `91832a52b987b8e89f270ee86b4a95b8a4ddad15`, main del 30 de octubre de 2026 |
| Backend ejecutable | Node.js + Express, en `server/`; SQLite con cinco migraciones |
| Frontend | React + TypeScript + Vite, en `src/`; reglas compartidas en `shared/` |
| Backend .NET | No existe en la referencia inspeccionada; ningún `.cs`, `.csproj`, `.sln` ni `.slnx` |
| Persistencia MySQL e importación | Sin implementación ni ejecución comprobada |
| Datos reales del usuario | No disponibles; no se afirma equivalencia de filas reales |
| Resultado de esta entrega | Documentación e instrucciones; no modifica código de ejecución |
| Pruebas de aplicación de esta entrega | No ejecutadas: el alcance es documental. Ningún resultado anterior se presenta como una ejecución nueva |

Este resumen describe el punto de partida. Cuando cambie el runtime, actualiza las filas afectadas y enlaza la evidencia; conserva la referencia histórica para entender el origen.

## Estados permitidos

- `pendiente`: no implementado.
- `en_curso`: trabajo iniciado y todavía incompleto.
- `implementado`: existe código, pero queda validación necesaria.
- `verificado`: cumple la aceptación con evidencia de las comprobaciones correspondientes.
- `bloqueado`: falta un requisito concreto; registra cuál, qué se pudo completar y qué permite avanzar.

Una dependencia se considera cerrada cuando está `verificado`. Para elegir el siguiente trabajo, recorre la tabla y selecciona la primera pendiente cuyas dependencias estén verificadas. Las tareas de datos reales bloqueadas no impiden desarrollar reglas o integraciones independientes con datos sintéticos.

## Plan por módulos y funcionalidades

La aceptación detallada está en [MODULES.md](MODULES.md), [ARCHITECTURE.md](ARCHITECTURE.md) y [DATA.md](DATA.md). No cierres una fila porque solo existan carpetas o interfaces.

| ID | Entrega | Dependencias | Estado |
| --- | --- | --- | --- |
| DOC-01 | Contexto para Codex, arquitectura, datos, módulos, tareas y prompts | — | verificado |
| BASE-01 | Caracterización de contratos/fixtures, inventario confirmado y línea base ejecutada con resultados registrados | DOC-01 | pendiente |
| BASE-02 | Solución .NET, composición, host/configuración, acceso, envoltorios HTTP y pruebas de arquitectura | BASE-01 | pendiente |
| DATA-01 | Modelo MySQL completo, migración inicial y pruebas de tipos/índices/JSON con proveedor estable | BASE-02 | pendiente |
| FIN-01 | Lectura de finanzas, categorías, presupuestos de categoría y metadatos; primer recorrido React | DATA-01 | pendiente |
| FIN-02 | Movimientos, pagos, eliminación e IDs estables ante reintentos | FIN-01 | pendiente |
| FIN-03 | Recurrentes, exclusiones, cuotas y generación sin duplicados concurrentes | FIN-02 | pendiente |
| FIN-04 | Consultas de resumen mensual/anual y previsión, con integración React y equivalencia | FIN-03 | pendiente |
| FIN-05 | Copia/restauración financiera y exportaciones conservadas, sin afectar despensa | FIN-03 | pendiente |
| PAN-01 | Personas, catálogo y edición con expectedVersion y conflicto visible en React | DATA-01 | pendiente |
| PAN-02 | Ajustes de cantidad, comprar y deshacer de forma atómica | PAN-01 | pendiente |
| PAN-03 | Revisiones, actividad, ritmo, lista, presupuesto de despensa y repaso semanal | PAN-02 | pendiente |
| TIC-01 | Reglas puras de parsing, evidencia, emparejamiento y plan de guardado equivalentes | BASE-02 | pendiente |
| TIC-02 | Lectura OCR/texto/franjas mediante puerto local e integración de la revisión | TIC-01, PAN-01 | pendiente |
| TIC-03 | Guardado transaccional, deduplicación y efectos de compra sobre Pantry | TIC-02, PAN-02 | pendiente |
| TIC-04 | Historial, detalle, asociación, borrado y efectos sobre actividad/ritmo | TIC-03, PAN-03 | pendiente |
| DATA-02 | Importador SQLite→MySQL, comparación íntegra y ensayos sintéticos; validación real registrada aparte | DATA-01 | pendiente |
| CUT-01 | E2E completos, backup/restauración, ensayo final, corte y retirada de dependencias obsoletas | FIN-04, FIN-05, PAN-03, TIC-04, DATA-02 | pendiente |

`DATA-02` puede quedar verificada como herramienta con ensayos sintéticos, dejando visible la validación real aún pendiente en la sección siguiente. Eso no autoriza a cerrar `CUT-01`: el corte exige validar también los datos de la instalación.

## Decisiones y verificaciones pendientes

| Elemento | Estado | Evidencia necesaria |
| --- | --- | --- |
| SDK y proveedor EF Core/MySQL | Pendiente de seleccionar y probar | Versión estable exacta, fuente oficial, restore/build y pruebas MySQL |
| OCR definitivo | Pendiente de ensayo | Mismos fixtures, reconocimiento real, arranque y dependencia Node si la hay |
| Copia SQLite real | No disponible | Copia consistente, integridad y versión comprobadas |
| Equivalencia de la importación real | No ejecutada | Informe sin diferencias por tabla/ID y comprobaciones funcionales |
| Recuperación completa de MySQL | No ejecutada | Backup recuperado en otra base y datos comparados |
| Cambio del backend usado a diario | No realizado | Requisitos CUT-01 cumplidos y fecha del corte registrada |

## Verificaciones según el tipo de cambio

Para documentación: enlaces relativos, nombres y IDs consistentes, dependencias sin ciclos, estados honestos y diff limitado a documentación.

Para caracterización/Node/React, usa los scripts existentes pertinentes: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` y `npm run test:e2e`. En `BASE-01` registra la línea base y cualquier limitación del entorno. Los E2E tienen su servidor y base de pruebas; no reutilices los datos de la instalación.

Cuando exista .NET: restore, build y test sobre la ruta de solución real creada. Asegura reglas puras, restricciones de arquitectura, contratos HTTP, integración MySQL y el consumidor React afectado. Documenta los comandos concretos al añadir los proyectos; no afirmes que ya están disponibles.

Casos transversales de cierre:

- Dos conexiones MySQL para generación de ocurrencias, edición/ajustes de producto y guardado duplicado de tickets.
- Fallo intermedio de ticket con rollback de cabecera/líneas, productos, equivalencias y cambios de precio/cantidad.
- Guardado confirmado y posterior recarga fallida sin repetir el alta financiera.
- JSON financiero restaurado sin modificar despensa ni tickets.
- Precisión de céntimos/milésimas, fechas de calendario, nulos, negativos válidos y claves con distintas collations.
- Recorridos de escritorio y móvil, sesión, modo invitado y recuperación completa de MySQL.

## Registro de trabajo

### DOC-01 — 1 de noviembre de 2026

- Base: commit `91832a52b987b8e89f270ee86b4a95b8a4ddad15`.
- Archivos: `AGENTS.md`, entrada del README y documentos en `docs/migration/`.
- Comprobación de fuente: árbol completo sin truncar, dependencias del proyecto, composición, acceso, rutas/clientes HTTP, cinco migraciones, validación de producto y plan de guardado de tickets.
- Validación documental: aprobada el 1 de noviembre de 2026 mediante comprobación local con Python de los ocho Markdown, 70 enlaces relativos, 18 IDs de tareas y sus dependencias sin ciclos. Las 38 rutas extraídas de Express aparecen en el inventario. Se verificó el SHA del README original y que su único cambio es la entrada de migración.
- No se han ejecutado pruebas Node, .NET, MySQL ni importaciones; no hay cambio del runtime.
- Siguiente tarea tras validar la documentación: `BASE-01`.

### Plantilla para la siguiente tarea

Al trabajar en un ID, añade una entrada con fecha, commit base, alcance, archivos modificados, decisiones, contratos afectados y comandos ejecutados con resultados. Si algo no se ejecutó, indica el motivo y el efecto sobre la aceptación. Anota dependencias temporales, datos reales pendientes y el siguiente ID elegible. No rellenes esta plantilla con resultados hipotéticos.
