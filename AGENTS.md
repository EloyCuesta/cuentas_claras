# Guía de trabajo para Codex

## Contexto y lectura inicial

Cuentas Claras es una aplicación doméstica de finanzas, despensa y tickets. Se está preparando la sustitución de Express + SQLite por ASP.NET Core + MySQL local, conservando React + TypeScript. La arquitectura destino es un monolito modular con puertos y adaptadores. Documentar ese destino no significa que esté implementado.

Antes de cambiar código:

1. Lee [la entrada de migración](docs/migration/README.md) y [STATUS.md](docs/migration/STATUS.md).
2. Revisa [la arquitectura](docs/migration/ARCHITECTURE.md), [los datos](docs/migration/DATA.md) y la sección de [módulos y funcionalidades](docs/migration/MODULES.md) que corresponda a la tarea.
3. Contrasta estos documentos con los archivos y las pruebas de la rama actual. La referencia inicial fue `91832a52b987b8e89f270ee86b4a95b8a4ddad15`; no presupongas que siga siendo la cabecera.
4. Si hay instrucciones `AGENTS.md` más específicas en la zona que vas a modificar, léelas también.

## Forma de implementar

- Trabaja sobre el ID solicitado de `STATUS.md`. Si la petición dice «continuar», elige la primera tarea pendiente cuyas dependencias estén verificadas; si ninguna lo está, explica el bloqueo concreto.
- Una funcionalidad debe conectar reglas, caso de uso, persistencia, HTTP y consumidor React cuando sean necesarios. Mover archivos o crear interfaces vacías no completa una migración.
- Conserva pantallas, navegación, idioma español y comportamiento útil existente. La interfaz debe seguir siendo sencilla para un uso semanal y funcionar en móvil.
- Mantén los contratos HTTP actuales durante la sustitución. Un cambio deliberado, como `expectedVersion`, requiere actualizar contrato, servidor, cliente y pruebas en la misma entrega.
- El backend será la autoridad de validación, recurrencia y persistencia. Conserva `shared/` mientras React lo siga importando y verifica la equivalencia de los cálculos portados a C#.
- No incorpores funcionalidades nuevas al confundirlas con el portado: tickets y despensa no crean movimientos financieros; sus presupuestos son independientes; las personas de despensa no son usuarios.
- Mantén los repositorios centrados en persistencia y las rutas en HTTP. La coordinación de una operación pertenece a Aplicación y las reglas puras a Dominio.
- Usa puertos pequeños donde exista una dependencia externa. No añadas repositorios genéricos, microservicios, CQRS o buses de mensajes sin una necesidad concreta de la tarea.

## Reglas que no se pueden perder

- Importes en céntimos enteros; conserva límites, negativos permitidos y redondeo de cada dominio. Fechas de calendario sin conversión de zona horaria.
- Finanzas privadas mediante sesión; despensa y tickets disponibles para invitado. La autorización se exige en la API.
- Un solo backend escritor para los datos usados a diario. Prueba .NET con bases de ensayo hasta validar el cambio final.
- Guarda un ticket y todos sus efectos sobre productos, equivalencias, precios y cantidades en una sola transacción. OCR antes de abrirla; un único caso exterior confirma.
- Mantén exclusiones de recurrentes, pagos ya realizados, identificadores y protección contra duplicados.
- Exige la versión leída por el formulario al editar productos una vez implementado `PAN-01`; devuelve 409 ante cambios concurrentes. No resuelvas un conflicto sobrescribiendo automáticamente.
- El total de un ticket sirve para comprobarlo, no para inventar un importe dudoso. Una línea pendiente no modifica precios, cantidades ni aprendizaje.
- Una copia JSON financiera no es una copia completa. Restaurarla no debe tocar despensa ni tickets.

## Datos y configuración

El archivo SQLite real del usuario no está incluido. Usa datos sintéticos y fixtures para desarrollar. No marques como verificada una importación de datos reales sin haberla ejecutado y comparado.

No borres la base de datos, no sobrescribas datos de usuario ni publiques credenciales, sesiones, copias o tickets personales. El importador debe leer una copia SQLite consistente y rechazar destinos MySQL con datos de aplicación. El ensayo y el corte final se describen en `DATA.md`.

.NET 10, EF Core 10 y MySQL 8.4 son el destino propuesto. Comprueba un proveedor MySQL estable compatible antes de fijar versiones. No inventes paquetes, versiones publicadas, rutas de soluciones ni comandos que aún no existan.

## Verificación y continuidad

Comandos existentes de la versión Node/React: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` y `npm run test:e2e`. Ejecuta los que correspondan al cambio. En una edición exclusivamente documental basta comprobar enlaces, coherencia y diff; no hace falta instalar dependencias de ejecución.

Cuando exista .NET, usa la solución real para restore/build/test. La persistencia se comprueba con MySQL real; SQLite y EF InMemory no sustituyen sus pruebas de índices, JSON, collations y concurrencia.

Al terminar una tarea:

1. Actualiza su estado y evidencia en `docs/migration/STATUS.md` con archivos, comandos, resultados y limitaciones reales.
2. Actualiza contratos y decisiones afectados; documenta cualquier adaptación temporal, incluido un worker OCR Node.
3. Entrega qué funciona, qué se probó, qué falta y el siguiente ID elegible. No conviertas una prueba no ejecutada en aprobada.

Si falta una dependencia externa, avanza en las partes independientes de la tarea y deja registrado el punto bloqueado. No simules MySQL ni una migración real para aparentar que está completa.
