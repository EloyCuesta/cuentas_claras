# Terminar Cuentas claras: arreglar el último push, una interfaz más fácil y rápida, y el corte a .NET

Revisión del 23 de noviembre de 2026 sobre main en `c622210` (la fusión de las fases 0-4 de la lectura de tickets con `48093ae`). Se hizo leyendo el código y los diffs, sin ejecutar la app ni las pruebas: cada hallazgo lleva su ruta para comprobarlo antes de cambiar nada.

Este archivo es para el agente que termine el proyecto (Claude Code, Codex o similar):
- **Dónde está el proyecto**: la revisión del último push, lo que falta en la interfaz y lo que falta para el corte.
- **Qué autoriza la persona**: las excepciones a `AGENTS.md` que permiten mejorar la interfaz.
- **Tareas**: en orden, una por sesión, con su aceptación.
- **Prompts**: el principal (reutilizable), el de reanudar y el de revisar.
- **Registro**: lo que hace cada sesión, con resultados reales.

La migración sigue registrándose en [STATUS.md](migration/STATUS.md); este archivo no la sustituye.

## Dónde está el proyecto

### La migración
Todo está `verificado` salvo dos tareas ([STATUS.md](migration/STATUS.md)):
- **DATA-02**: la persona importa su copia real con el importador y revisa el informe. Un agente no la cierra con datos sintéticos.
- **CUT-01**: el cambio del uso diario a .NET y la retirada de lo obsoleto. `tests/docs.test.ts` no deja marcarla `verificado` sin DATA-02.

.NET ya atiende las 39 rutas, y los mismos e2e pasan contra Express y contra .NET. El uso diario sigue en Express.

### El último push (`c622210`)
Fusiona la rama de tickets (de `5695bfb` a `cbedcd6`) con `48093ae`:
- un banco de medida (`tools/banco-tickets/AGENTS.md`);
- la escala por la altura de las letras;
- la unión de capturas por la imagen;
- el recorte al papel, con inversión si hace falta;
- la relectura de la banda de importes a dos escalas, con votación;
- un analizador sin errores silenciosos: PROMO sangrada, cifras sin coma, pesos ilegibles y lo que no es un producto;
- la revisión de tickets pensada para el móvil.

El mensaje del commit da estos resultados con MySQL 8.4:

| Comprobación | Resultado |
| --- | --- |
| `npm run check` | 1594 |
| `npm run test:e2e` | 62, y 4 omitidas |
| `dotnet test` | 2266 |
| E2E contra .NET | 68, y 4 omitidas |

Las 4 omitidas son `e2e/capturas-tickets.spec.ts`, dos pruebas por proyecto. Necesitan `CUENTAS_CAPTURAS_DIR` con las capturas reales de la persona.

#### Fallos graves (comprobados en el código)
1. **La app entera se cae al escribir una fecha rara en «Editar datos del ticket».**
   - `src/features/tickets/TicketReview.tsx:106` llama a `formatDate(review.date)` en cada render.
   - `formatDate` (`shared/common/dates.ts`) lanza «Fecha no válida» fuera de 1900-2999.
   - `DateInput` (`src/ui/forms.tsx:121`) pasa el valor crudo del `<input type="date">`, así que un año 0002 llega mientras se escribe.
   - No hay ningún error boundary en `src/`, y ningún e2e edita esos campos.
2. **Girar una foto crea un lienzo del tamaño del original** (`src/features/tickets/ticketImages.ts`, `decode`).
   - `decodeAll` guarda todas las copias hasta el final.
   - Una foto de iPhone de 24 MP pasa el límite de 40 M píxeles de la app, pero supera el del lienzo de Safari (unos 16,7 M), y «Girar» falla con «Este navegador no puede preparar la imagen.».
   - Seis fotos de 12 MP giradas ocupan unos 290 MB a la vez.
   - Antes de la fase 1 se giraba directamente en cada franja.
3. **Un importe mal leído puede quedar sin marcar** (`shared/tickets/ticketParse.ts`, el filtro de `nameNumbers`; igual en `backend/src/CuentasClaras.Domain/Tickets/TicketParser.cs`).
   - Las cifras sin coma se descartan si empiezan por un número del nombre: `digits.startsWith(n)`.
   - Con «LECHE 1L», una lectura «149» que discrepaba se descarta y tampoco frena la votación.
   - Ganan las dos relecturas de la banda («1,43»), que son el mismo recorte y se equivocan igual, y la línea sale «leída sin dudas».
   - Solo lo detectaría el total del ticket.
4. **El decodificador PNG del servidor no tiene límites** (`server/modules/tickets/adapters/tesseract/pngImage.ts`).
   - `inflateSync` va sin `maxOutputLength`: una subida de 8 MB puede expandirse a varios GB en el hilo principal de Express.
   - La ruta de lectura de tickets es pública: no pide el código.
   - Un IHDR corto lanza una excepción en vez de devolver `null`.
   - El decodificador se fía del IHDR que encuentra, no del que valida `server/modules/tickets/adapters/http/readTicketRequest.ts`.

#### Fallos medios (con evidencia; confírmalos al arreglarlos)
- **El análisis de solapes** (`src/features/tickets/TicketScanDialog.tsx`, `src/features/tickets/ticketImageAnalysis.ts`):
  - va en el hilo principal;
  - se repite con una sola imagen, que nunca puede avisar, y en cada «Girar»;
  - no se reutiliza al leer, así que todo se decodifica dos veces;
  - `orderCaptures` puede calcular hasta 30 parejas con 6 capturas.
- **Una línea que solo pide confirmar su producto** (`src/features/tickets/ticketReviewState.ts`, `needsLineCheck`) cuenta como pendiente, pero:
  - no tiene tarjeta;
  - no cuenta en «Faltan N»;
  - la lista de productos se pliega y la esconde.
- **Errores de tienda, fecha, hora y total al guardar**:
  - salen al final de la ventana;
  - sus campos están dentro de un `<details>` cerrado;
  - el foco no va al campo, contra `docs/frontend.md`;
  - una tienda vacía se ve como «Tienda».
- **El recorte de una línea dudosa** (`src/features/tickets/TicketLineCheck.tsx`):
  - ocupa todo el ancho, así que en un Pixel 7 la letra queda en unos 9 px (estimado);
  - «Ampliar» es un `link-btn` de unos 20 px.
- **Al resolver una línea**:
  - la tarjeta desaparece y el foco se pierde;
  - si era la última duda, la lista se pliega aunque haya un editor abierto en ella.
- **La unión de capturas** (`plan()` en `src/features/tickets/ticketImages.ts`) puede perder filas sin avisar si una captura queda dentro de la anterior. `plan()` no tiene tests.
- **La votación da por buena la línea si coinciden la banda y la banda a 1,5×.**
  - Son dos lecturas del mismo recorte (a dos escalas) con la misma lista de cifras, y solo se ha validado con el banco sintético.
  - El comentario «Tres lecturas que coinciden» contradice el código, que pide dos.
- **`looksLikeProduct` es de Lidl pero se aplica a todas las tiendas.** En un ticket pegado con minúsculas y el importe en la línea siguiente, se pierden el producto y su importe en `nonProducts`.
- **Varios documentos prometen «dos lecturas que coinciden», y el código no lo exige con texto pegado ni con una banda vacía**: el README, `docs/glosario.md`, `shared/AGENTS.md` y `docs/decisiones.md`.
- **Un test de la fusión se relajó**: la lectura real de los cupones pedía cantidad y precio exactos, y ahora solo que lo distinto quede marcado. `server/modules/tickets/AGENTS.md` dice que ningún cambio del lector puede empeorar una línea de las imágenes de prueba. Hay que reconciliar las dos reglas, o medir con el banco y decidir.
- **El PNG se decodifica entero y de forma síncrona en Express**, hasta unos 131 MB por franja.

#### Fallos menores
Arréglalos cuando cuesten poco.

**Interfaz de tickets**
- No hay aviso antes de leer si las capturas no se pueden unir por tamaño o por bordes, aunque el README lo promete.
- El `role="status"` de la lectura se anuncia cada segundo: el contador debería ir con `aria-hidden`.
- «Pagado con…» solo sale si hay avisos.
- «Ajustes generales» puede quedar vacía al eliminar o asignar un ajuste.
- «Por qué» puede tener keys duplicadas.
- Hay `<summary>` y `link-btn` de menos de 44 px, y los botones de los ajustes son `btn--small`.
- Miniaturas:
  - las giradas se montan sobre las vecinas;
  - «Quitar» recarga todas las vistas previas;
  - «Volver a empezar» las enseña sin imagen.

**Preparación de imágenes**
- `prepareTicketImages([])` lanza un TypeError.
- Una imagen de tamaño 0 ya no da su error.
- Al unir capturas, invertir los colores lo decide solo la primera.
- Cada tarjeta lleva la franja como data URL de hasta 8 MB, cuando un `URL.createObjectURL` por franja bastaría.
- Hay código y estilos muertos: `review.sections`, `.ticket-group*` y `.ticket-image-options`.

**Analizador**
- `APP_CHROME` puede quitar una línea que solo tiene la fecha.
- «5 KG PATATAS 2,99 B» desaparece por `WEIGHT_LIKE`.
- Hay dos definiciones del final de la cabecera de Lidl: la del lector y la del analizador.
- La evidencia guardada conserva `reread` pero no `rereads`.

**Banco de medida**
- Una línea de más sin marcar no cuenta como «mal sin marcar» (`tools/banco-tickets/comparar.ts`).
- La carpeta privada por defecto (`tools/banco-tickets/rutas.ts`) acaba dentro del repositorio fuera de Windows.

#### Documentación desfasada
`docs/migration/STATUS.md`:
- dice «Última actualización: 19 de noviembre» y «rama tickets-lidl-plus, sin fusionar»;
- habla de 532 casos del corpus, cuando son 535;
- sus cifras son de antes de la fusión: 1586, 2260 y 1086, frente a 1594, 2266 y 1092;
- dice «Sin ejecutar todavía: `npm run test:e2e:dotnet`», pero se ejecutó: 68 y 4 omitidas;
- la tabla «Estado comprobado» sigue con los números del 16 de noviembre;
- faltan las entradas de `48093ae`, de la fase 4 (`cbedcd6`) y de la fusión;
- cita entre comillas invertidas la carpeta de compilación de la API .NET (backend/src/CuentasClaras.Api/bin). En un clon sin compilar no existe, y `tests/docs.test.ts` falla («las rutas citadas entre comillas invertidas existen»).

Además:
- `e2e/AGENTS.md` no cita `e2e/capturas-tickets.spec.ts`;
- `src/features/tickets/AGENTS.md` pone la cuenta en el nombre de las regiones «Para revisar» y «Productos», pero la cuenta está en el título;
- que la segunda relectura con margen ajustado (TAIL_RETRY_PAD) no se aplique sobre la banda solo está explicado en el mensaje del commit;
- `docs/pruebas.md` dice que `fixtures/tickets/ocr-real/` es OCR de imágenes sintéticas, y ya incluye una captura real.

#### Lo que el push deja pendiente
- **Medir con tickets reales.** La fila «real-N» y la etiqueta `banco-partida` que anuncia `tools/banco-tickets/partida.md` no existen.
- **Falta la tabla «después» del banco.** Los números de después (663 de 696 líneas limpias, 0 mal sin marcar) solo están en el texto de `docs/decisiones.md`, medidos antes de la fase 4 y de la fusión.

#### Lo que está bien y hay que conservar
- El análisis de imágenes son funciones puras con tests.
- La unión no inventa un solape dudoso.
- La paridad entre TypeScript y C# es completa: reglas, Unicode y `null` frente a `undefined`.
- El banco respeta la privacidad, sus resultados están en `.gitignore` y no añade dependencias.
- Los estilos nuevos usan variables.
- Los botones de las tarjetas miden 44 px, y «Guardar ticket» queda fijo fuera del scroll, probado en un Pixel 7.
- Los textos que cambian están documentados.

### La interfaz (finanzas y despensa)
El push no las toca. Por impacto:

1. **Cada guardado de finanzas espera a releerlo todo.** Espera el PUT, luego GET `/data` (todos los movimientos de siempre) y GET `/meta`, y solo entonces cierra el diálogo, sin decir que está guardando: `src/features/finance/FinanceProvider.tsx`, `src/features/finance/confirmedWrite.ts` y `src/features/finance/components/MovementDialog.tsx`.
2. **Elegir categoría es lento**: un select vacío con unas 24 opciones. Solo se sugiere si el concepto coincide exacto (`shared/finance/suggestions.ts`).
3. **En la Despensa, los productos (donde están + y −) quedan debajo de seis bloques**: acciones, repaso, personas, «Para revisar», «Últimas compras» y resumen. No hay buscador, y las secciones vacías se ven (`src/features/pantry/DespensaPage.tsx`).
4. **La Despensa se recarga desde cero en cada visita**: 5 GET y «Cargando la despensa…», porque `usePantry()` (`src/features/pantry/usePantry.ts`) vive dentro de la página.
5. **+, −, «Queda», «Se acabó», «Lo he comprado» y el repaso semanal esperan al servidor** (`busyIds`).
6. **La barra inferior del móvil tiene 6 pestañas con letra de 11 px**, y «Presupuestos» y «Recurrentes» se parten.
7. **Un ingreso es un rodeo.** «Añadir» siempre abre un gasto (`src/App.tsx`), y cambiar el tipo, que va antes del importe, quita el foco del importe.
8. **En el Resumen del móvil, los vencidos y pendientes quedan debajo del libro y del gráfico** (`src/features/finance/pages/SummaryPage.tsx`).
9. **Hay objetivos de menos de 44 px en acciones frecuentes**:
   - «Marcar pagado», «Se acabó» y «Lo he comprado» usan `btn--small` (36 px);
   - el nombre del producto, que es la única forma de editarlo, mide 32 px;
   - los `link-btn` no tienen tamaño mínimo.
10. **En el móvil, los avisos y su «Deshacer» salen arriba**, lejos del pulgar (`src/ui/ToastProvider.tsx` y `src/styles.css`).
11. **Faltan**:
    - «Hoy» y «Ayer» en la fecha;
    - «Guardar y añadir otro»;
    - recordar la persona elegida en la Despensa;
    - confirmar antes de borrar una persona o quitar el presupuesto;
    - «Deshacer» tras «Marcar pagado»;
    - `enterKeyHint`;
    - un atajo de teclado para añadir.
12. **La carga y el peso**:
    - no hay `React.lazy`, así que el invitado descarga todas las finanzas (`src/Root.tsx`, `src/App.tsx`);
    - `indexedDB.databases()` se llama en cada apertura, porque la marca solo se guarda si había una base antigua (`src/features/finance/browserMigration/browserDataMigration.ts`);
    - la fuente se importa entera y sin preload;
    - `index.html` dice que los datos están en el navegador;
    - no hay manifest ni icono para la pantalla de inicio;
    - el final de `src/styles.css` tiene colores sueltos y dos secciones «6.».

Lo que está bien y hay que conservar:
- el foco va al importe, con teclado decimal;
- los importes se leen con coma o con punto;
- los ids se deciden al abrir el diálogo, así que reintentar no duplica;
- cada error está asociado a su campo;
- los gráficos son HTML ligero;
- los movimientos se muestran de 100 en 100.

### El corte a .NET (CUT-01)
- **El uso diario sigue en Express**:
  - `npm run dev` y `npm run server` arrancan Express;
  - el proxy de Vite apunta a `:3001`;
  - `__CUENTAS_BACKEND__` vale `express`.

  .NET escucha en `:3201` (`backend/src/CuentasClaras.Api/Composition/HostSettings.cs`). No hay un script que arranque .NET con Vite.
- **El host .NET no lee `.env`** (`backend/src/CuentasClaras.Api/Program.cs`). `docs/migration/ARCHITECTURE.md` pide resolverlo.
- **Quedan restos**:
  - `playwright.dotnet.config.ts` tiene comentarios con la codificación rota («soluciÃ³n»);
  - `tsx` es una dependencia de desarrollo, pero el OCR de .NET lo necesita en ejecución;
  - `backend/tests/CuentasClaras.Tests/HttpContractTests.cs` conserva `MissingRoutes` vacío;
  - `docs/api.md` sigue con el pendiente de Cache-Control.
- **`server/` no se puede borrar**. Dependen de él:
  - el OCR de .NET;
  - el importador;
  - los e2e;
  - los generadores del corpus;
  - los tests de arquitectura y de documentación.

  Express es además la vuelta atrás hasta que la persona confirme el corte.
- **La trampa**: cambiar `npm run dev` a .NET **es** hacer el corte, en cuanto la persona lo arranque con sus datos. Por eso el agente lo prepara todo sin cambiar el uso diario, y solo lo cambia cuando la persona confirme DATA-02 y la copia de MySQL.

## Qué autoriza la persona

Para las tareas de este archivo, la persona autoriza estas excepciones a las reglas «Interfaz» y «Terminado significa» de `AGENTS.md`:

- **Se permite** cambiar textos, etiquetas, orden, roles, clases CSS y `data-testid` de la interfaz cuando la haga más fácil o más rápida. En el mismo cambio hay que actualizar:
  - los e2e, que tienen que pasar contra Express y contra .NET;
  - el AGENTS.md de la feature (sus textos y su regla `busyIds`, si cambia);
  - el README, si cambia lo que ve la persona.
- **Sigue prohibido**:
  - añadir dependencias: ni librerías de interfaz, estado, rutas, gráficos ni virtualización;
  - cambiar contratos de la API. Si una mejora lo pide, se para y se pregunta;
  - tocar la base `cuentas_claras`, `server/data/` o datos reales;
  - cambiar las reglas de datos: céntimos, fechas `AAAA-MM-DD`, atomicidad, el 409 por versión, + y − sobre el valor del servidor, y el invitado sin finanzas;
  - terminar con menos tests que antes;
  - cambiar el uso diario a .NET antes de que la persona lo confirme.
- **Se mantiene**:
  - el aspecto «tinta y lápiz»;
  - claro y oscuro con las variables de `:root`;
  - el contraste AA;
  - la navegación con `#`;
  - los `<dialog>` nativos;
  - todo `src/styles.css` en un solo archivo.

## Tareas

Haz una por sesión, en este orden. Para la aceptación, cada tarea pasa además las comprobaciones del prompt principal. Estados: `pendiente`, `en_curso`, `implementado`, `verificado` y `bloqueado`, como en STATUS.

| ID | Entrega | Depende de | Estado |
| --- | --- | --- | --- |
| FIX-01 | Los cuatro fallos graves del último push | — | pendiente |
| FIX-02 | Los fallos medios de la lectura y la revisión de tickets | FIX-01 | pendiente |
| DOC-02 | Estado y documentación al día tras el push | FIX-02 | pendiente |
| UX-00 | Línea base de la interfaz: capturas y números | DOC-02 | pendiente |
| UX-01 | Guardar sin esperar | UX-00 | pendiente |
| UX-02 | Despensa instantánea | UX-00 | pendiente |
| UX-03 | Añadir movimientos en segundos | UX-01 | pendiente |
| UX-04 | El móvil: navegación, Resumen, toques y avisos | UX-00 | pendiente |
| UX-05 | Despensa más directa | UX-02 | pendiente |
| UX-06 | Carga y peso | UX-00 | pendiente |
| UX-07 | Cierre de la interfaz | UX-01 … UX-06 | pendiente |
| CUT-PREP | Preparar el corte sin cambiar el uso diario | — | pendiente |
| PERSONA | Pasos que solo hace la persona | CUT-PREP | pendiente |
| CUT-FINAL | Cambiar el uso diario a .NET | PERSONA | pendiente |

### FIX-01 · Los cuatro fallos graves
- **La fecha**:
  - el resumen solo formatea una fecha válida (`isValidISODate`), o con un formateador que no lance;
  - un error boundary alrededor de los diálogos, que conserve la app y avise;
  - un e2e que escriba una fecha incompleta y otra válida en «Editar datos del ticket».
- **Girar**:
  - la rotación se aplica al dibujar en el lienzo del análisis y en cada franja, nunca en un lienzo del tamaño original;
  - los lienzos se liberan (`width = height = 0`) en un `finally`;
  - una prueba con una imagen grande girada.
- **Las cifras sin coma**:
  - se descarta una lectura solo si coincide con un número del nombre, o si ese número tiene dos cifras o más;
  - una lectura descartada sigue impidiendo el voto (o marca la línea);
  - el caso «LECHE 1L» va en `shared/tickets/ticketSafety.test.ts`, en TypeScript y en C#, y en el corpus regenerado con `tests/generateTicketRules.ts` (`fixtures/migration/rules-tickets.json`).
- **El PNG**:
  - `maxOutputLength = alto × (ancho × canales + 1)`;
  - un solo IHDR de 13 bytes;
  - los mismos límites que `readTicketRequest.ts` (8000 px, 40 M píxeles, 4096 por franja);
  - `null` ante cualquier imagen malformada, con tests de imágenes rotas y de una «bomba» de compresión.
- **Aceptación**:
  - los cuatro casos tienen su test, y antes fallaban;
  - el banco sintético no tiene ninguna cifra mal sin marcar (`npm run generar:tickets && npm run medir:tickets -- --solo-sinteticos`);
  - las suites de .NET pasan con el corpus nuevo.

### FIX-02 · La lectura y la revisión de tickets
- **El análisis de solapes**:
  - solo con dos imágenes o más;
  - se guarda y se reutiliza al leer;
  - con una búsqueda de grueso a fino;
  - si se puede, en un Web Worker con `new Worker(new URL(…, import.meta.url), { type: 'module' })`, que Vite trae sin dependencias, dejando el camino de ahora como respaldo.
- **Las líneas que solo piden confirmar su producto**: con su tarjeta («Es el producto»), contadas en «Faltan N», y con la lista abierta mientras queden.
- **Los errores al guardar**:
  - el `<details>` controlado se abre;
  - el foco va al campo y el error se ve;
  - una tienda vacía se ve como falta, no como «Tienda».
- **El recorte**:
  - zoom inicial por la altura de las letras (al menos 14-16 px) y centrado en el importe;
  - «Ampliar» de 44 px.
- **El foco**:
  - al resolver una línea, va a la siguiente tarjeta o al resumen;
  - la lista no se pliega con un editor abierto.
- **`plan()`**:
  - pasa a ser una función pura con tests;
  - una captura que no aporta filas se trata como repetida;
  - nunca se pierden filas;
  - avisa antes de leer cuando las capturas no se pueden unir.
- **El analizador**:
  - `looksLikeProduct` solo para Lidl;
  - la votación exige la lectura del texto (o conserva la marca «solo en la relectura») hasta medir con tickets reales;
  - el comentario «Tres lecturas» se corrige;
  - el test relajado de los cupones se decide con el banco, y la regla de `server/modules/tickets/AGENTS.md` se ajusta a lo decidido.
- **El PNG**: decodificar solo las filas de la banda, o fuera del hilo principal.
- **Los menores** que cuesten poco (lista de arriba).
- **Aceptación**:
  - e2e para la línea de «confirmar producto», el aviso de capturas sin solape y los errores de cabecera;
  - la tabla del banco no es peor que la de FIX-01;
  - cada regla cambiada está en TypeScript, en C# y en el corpus.

### DOC-02 · Estado y documentación al día
- **STATUS**:
  - entradas con fecha, base, alcance y resultados reales para `48093ae`, la fase 4, la fusión `c622210`, FIX-01 y FIX-02;
  - corregir la cabecera, «sin fusionar», los recuentos (535 casos y los tests) y la tabla «Estado comprobado»;
  - escribir sin comillas invertidas la carpeta de compilación de la API, para que `tests/docs.test.ts` pase también en un clon sin compilar.
- **Documentos**:
  - corregir «dos lecturas que coinciden» en el README, `docs/glosario.md`, `shared/AGENTS.md` y `docs/decisiones.md`, según lo que haga el código tras FIX-02;
  - TAIL_RETRY_PAD en `docs/decisiones.md`;
  - `e2e/capturas-tickets.spec.ts` en `e2e/AGENTS.md`;
  - `fixtures/tickets/ocr-real/` en `docs/pruebas.md`.
- **El banco**: una tabla «después», junto a `tools/banco-tickets/partida.md`, medida en el mismo equipo y con el código de esta tarea.

### UX-00 · Línea base de la interfaz
- **Capturas** con Playwright (ya es dependencia), en escritorio y en Pixel 7, claro y oscuro:
  - de cada pantalla y de los diálogos de añadir movimiento, pagar, producto y ticket;
  - con una base de pruebas y la copia `ejemplo/copia-de-ejemplo.json`, nunca con datos reales;
  - guardadas fuera de git: una carpeta nueva añadida a `.gitignore`.
- **Números, en el registro**:
  - toques para cada tarea: añadir un gasto, añadir un ingreso, marcar pagado, añadir un producto, + / −, escanear un ticket y ver el mes;
  - JS y CSS iniciales de `npm run build`;
  - peticiones y tiempo al abrir, al guardar un movimiento y al volver a la Despensa;
  - los objetivos de menos de 44 px.

### UX-01 · Guardar sin esperar
- **Al guardar**:
  - en cuanto el servidor confirma la escritura, el cambio entra en el estado local, el diálogo se cierra y se relee en segundo plano;
  - se conserva la semántica de FIN-02: si falla la escritura, el diálogo sigue abierto; si falla la relectura, aviso `warning` (`src/features/finance/AGENTS.md`);
  - mientras guarda, el botón lo indica sin cambiar su nombre accesible, porque los e2e lo vuelven a pulsar al reintentar.
- **Tickets**: al guardar, se usan los `items` que ya devuelve el servidor en vez de releer toda la despensa.
- **Aceptación**: el diálogo se cierra tras una sola petición (medido frente a UX-00), y los e2e de fallo de escritura y de relectura pasan en los dos backends.

### UX-02 · Despensa instantánea
- **Un proveedor de la feature pantry**:
  - con el patrón `xContext.ts` + `XProvider.tsx`;
  - montado en `src/App.tsx` y en `src/GuestApp.tsx`, sin depender de FinanceProvider;
  - al volver a la Despensa se ven los datos de antes al momento, y se refrescan en segundo plano.
- **+, −, «Queda», «Queda poco», «Se acabó», «Lo he comprado» y el repaso semanal**:
  - muestran el resultado al momento;
  - una cola por producto envía los cambios de uno en uno (+ y − siguen sumando sobre el valor del servidor);
  - se concilia con la respuesta;
  - si falla, se revierte y se avisa;
  - «Deshacer» sigue comprobando la versión (409).
- **Documentación**: la regla `busyIds` y el estado en `src/features/pantry/AGENTS.md`.
- **Aceptación**:
  - pulsar + tres veces seguidas suma tres;
  - dos pestañas a la vez no se pisan;
  - volver a la Despensa no enseña «Cargando la despensa…».

### UX-03 · Añadir movimientos en segundos
- **Categoría**: chips con las 4-6 categorías más usadas de ese tipo, y sugerencia por el principio del concepto además de por coincidencia exacta.
- **Gasto o ingreso**:
  - junto al importe, sin quitarle el foco;
  - un «Añadir ingreso» directo.
- **El formulario**:
  - «Hoy» y «Ayer» junto a la fecha;
  - lo opcional (estado y notas) plegado, salvo cuando haga falta (una fecha futura propone «Pendiente»);
  - «Guardar y añadir otro»;
  - `enterKeyHint` y el atajo «n» en el escritorio.
- **Aceptación**: un gasto con una categoría habitual en 3 toques más lo que se escribe (importe, concepto, chip y guardar), medido frente a UX-00.

### UX-04 · El móvil
- **La barra inferior**: 5 pestañas como mucho, con letra de 12 px o más y sin partir palabras. La propuesta es llegar a Presupuestos desde su bloque del Resumen, o usar un «Más». «Resumen», «Despensa» y «Ajustes» siguen visibles, y los e2e se actualizan.
- **El Resumen en el móvil**: vencidos y pendientes antes del gráfico, y un aviso «N vencidos» arriba que lleve a ellos.
- **Avisos**: abajo, encima de la barra.
- **Toques**: objetivos de 44 px o más con `@media (pointer: coarse)`. `.claude/rules/estilos.md` pide «botones grandes».
- **El final de `src/styles.css`**: colores sueltos a variables, secciones numeradas, y la regla de la barra en su sección.
- **Aceptación**: capturas del Pixel 7 frente a UX-00, ningún objetivo frecuente de menos de 44 px, y AA en claro y en oscuro.

### UX-05 · Despensa más directa
- **Buscar**: un buscador de productos por nombre encima de la lista.
- **El orden de la página**:
  - acciones;
  - «Para revisar», plegable si hay más de 3;
  - los productos;
  - el resto (últimas compras, resumen y presupuesto), plegado;
  - los bloques vacíos no se muestran.
- **Personas**:
  - la persona elegida se recuerda en `localStorage`, como el «Hoy no» del repaso;
  - se confirma antes de borrar una persona y antes de quitar el presupuesto.
- **Producto y finanzas**:
  - «Más detalles» plegable en el formulario del producto;
  - «Deshacer» tras «Marcar pagado», si la API actual lo permite sin cambiar contratos.
- **Aceptación**: + / − de cualquier producto sin hacer scroll por los bloques (con el buscador o en la primera pantalla), y menos toques que en UX-00.

### UX-06 · Carga y peso
- **`React.lazy`**:
  - el invitado no descarga las finanzas;
  - los diálogos pesados (escanear y revisar tickets, recurrentes, categorías y copias) van aparte;
  - entrando siempre por el `index.ts` de la feature, como pide `tests/architecture.test.ts`.
- **Mientras carga**: esqueletos accesibles que conservan los textos de carga.
- **Al abrir**: la marca de la migración del navegador se guarda también cuando no hay base antigua.
- **La fuente**: solo los subconjuntos latinos y con preload.
- **`index.html`**: corregir la descripción, más un manifest con iconos y `theme-color`. Sin service worker, porque la app va por HTTP en casa.
- **En las listas**: `useDeferredValue` en la búsqueda de movimientos, y memos que no dependan del estado entero.
- **Aceptación**: JS inicial del invitado y del administrador, y tiempo al abrir, frente a UX-00 (anotados en el registro).

### UX-07 · Cierre de la interfaz
- Las capturas y los números finales, frente a UX-00.
- Un repaso de teclado, foco y contraste en claro y en oscuro.
- Al día:
  - el README («Lo que hace»);
  - los AGENTS.md de las features;
  - los textos protegidos de los e2e (`e2e/AGENTS.md`).

### CUT-PREP · Preparar el corte sin cambiar el uso diario
- **Scripts**: un `dev:dotnet` (.NET + Vite, con el proxy a `:3201` y `CUENTAS_BACKEND=dotnet`) y uno de producción para .NET. `npm run dev` **no cambia**.
- **El host .NET**:
  - lee `.env`, sin dependencias nuevas y con pruebas;
  - una variable del entorno manda sobre `.env`, como en Express.
- **Restos**:
  - la codificación de `playwright.dotnet.config.ts`;
  - `tsx` a `dependencies`, si `tests/architecture.test.ts` lo permite;
  - quitar `MissingRoutes`;
  - el pendiente de Cache-Control en `docs/api.md`.
- **El README**: los pasos del corte, para la persona, sin PowerShell obligatorio, y la vuelta atrás.
- **En STATUS**: CUT-01 pasa a `en_curso`, nunca a `verificado`.

### PERSONA · Lo que solo hace la persona
1. **DATA-02**: importar la copia real con «Pasar los datos de SQLite a MySQL» del README y `docs/migration/DATA.md`, y revisar el informe. Si no hay copia SQLite que importar, decidir y dejar escrito cómo se cierra DATA-02.
2. **La copia**: hacer una copia completa (`mysqldump`), restaurarla en una base de prueba y comparar con `CHECKSUM TABLE`.
3. **Probar .NET**: arrancarlo sobre `cuentas_claras` con `dev:dotnet` y recorrer la app en el ordenador y en el móvil.
4. **Las pruebas en su MySQL**: repetir las suites en su MySQL 8.0.36 con su usuario de pruebas.
5. **Las capturas reales**: dárselas al banco y a `e2e/capturas-tickets.spec.ts` (`CUENTAS_CAPTURAS_DIR`), sin subirlas al repositorio.
6. **Decirle al agente** que ya está, con la fecha y los resultados.

### CUT-FINAL · Cambiar el uso diario a .NET
Solo con la confirmación de la persona:
- **Por defecto a .NET**: `npm run dev`, el proxy de Vite y `__CUENTAS_BACKEND__`.
- **La vuelta atrás**: Express queda como `dev:express` mientras la persona lo quiera.
- **Los e2e** van por defecto contra .NET.
- **Documentación**: la del uso diario (README, `docs/arquitectura.md`, `docs/pruebas.md` y `backend/AGENTS.md`).
- **Retirar** solo lo que ya no tenga ninguna dependencia.
- **STATUS**: CUT-01 pasa a `verificado` solo con la evidencia de la persona.

## Prompt principal reutilizable

Copia este bloque. Deja la `TAREA` como está para seguir el orden, o pon un ID de la tabla de arriba.

```text
Actúa como ingeniero de software sénior y trabaja directamente en Cuentas Claras.

TAREA: la primera tarea pendiente de docs/terminar-el-proyecto.md cuyas dependencias estén verificadas.

Objetivo: terminar el proyecto. Primero, arreglar lo que dejó el último push de tickets. Después, que la interfaz sea más fácil y más rápida de usar (menos toques, nada de esperas innecesarias, bien en el móvil). Por último, preparar el corte a .NET sin cambiar el uso diario hasta que la persona lo confirme.

Lee primero AGENTS.md y docs/terminar-el-proyecto.md (la revisión, lo que autoriza la persona y la tarea). Después lee docs/frontend.md, los AGENTS.md de las zonas que vas a tocar y sus tests. Si tocas tickets, lee también tools/banco-tickets/AGENTS.md; si tocas el corte, docs/migration/STATUS.md y DATA.md. Contrasta cada hallazgo con el código actual antes de cambiarlo: la revisión se hizo leyendo el código, sin ejecutarlo.

Antes de editar, di qué tarea eliges, qué hallazgos confirmas o descartas, qué textos, roles o data-testid vas a cambiar y un plan breve.

Lo que la persona autoriza: cambiar textos, etiquetas, orden, roles, clases y data-testid de la interfaz si así es más fácil o más rápida. En el mismo cambio actualizas los e2e (que pasan contra Express y contra .NET), el AGENTS.md de la feature y el README si cambia lo que ve la persona.

Lo que sigue prohibido:
- Dependencias nuevas.
- Cambiar contratos de la API: si hace falta, para y pregunta.
- Tocar la base cuentas_claras, server/data o datos reales.
- Cambiar las reglas de datos: céntimos, fechas, atomicidad, 409 por versión, + y − sobre el valor del servidor, el invitado sin finanzas.
- Bajar el número de tests.
- Cambiar npm run dev o el backend por defecto a .NET antes de que la persona confirme DATA-02 y su copia de MySQL.

Mantén el aspecto tinta y lápiz, claro y oscuro con las variables de :root, contraste AA, la navegación con # y los <dialog> nativos.

Método: implementa la tarea completa, no te quedes en recomendaciones. Si cambias una regla de shared/tickets/, cámbiala igual en C#, añade su caso en ticketSafety y regenera el corpus con tests/generateTicketRules.ts. Para la interfaz, haz capturas antes y después en escritorio y Pixel 7, claro y oscuro, con una base de pruebas y ejemplo/copia-de-ejemplo.json, guardadas fuera de git. Mide lo que la tarea pide (toques, peticiones, tamaños, tiempos) y compáralo con UX-00.

Comprobaciones, con MySQL en marcha y bases de prueba:
- Siempre: npm run check, npm run build, npm run test:e2e y npm run test:e2e:dotnet.
- Si tocas backend/ o el corpus: npm run build:dotnet y npm run test:dotnet.
- Si tocas la lectura de tickets: npm run generar:tickets y npm run medir:tickets -- --solo-sinteticos, y ninguna cifra mal sin marcar.

Corrige lo que rompa tu cambio. Si algo externo impide una comprobación, anota la evidencia y sigue con lo independiente. No inventes resultados, versiones ni mediciones.

Al terminar, actualiza en docs/terminar-el-proyecto.md el estado de la tarea y añade su entrada al registro. Si tocaste .NET, el corpus o el corte, añade también una entrada a docs/migration/STATUS.md. Termina con: archivos principales, qué mejora (con números frente a UX-00 o al banco), pruebas ejecutadas con sus resultados, lo que no se pudo comprobar y la siguiente tarea.
```

## Reanudar después de una sesión

```text
Continúa terminando Cuentas Claras. Lee AGENTS.md y docs/terminar-el-proyecto.md; comprueba el código y la última entrada del registro. Haz la primera tarea pendiente con sus dependencias verificadas siguiendo el prompt principal de ese archivo. No repitas la revisión completa ni rehagas tareas verificadas sin una discrepancia concreta. Termina con el estado, el registro y las pruebas al día.
```

## Revisar una entrega ya hecha

```text
Revisa la última tarea registrada en docs/terminar-el-proyecto.md sin cambiar código salvo que encuentres un fallo. Comprueba que cumple su aceptación y las reglas de AGENTS.md con las excepciones de ese archivo. Comprueba también que los textos cambiados están en los e2e y en el AGENTS.md de la feature, que no hay dependencias nuevas ni contratos de la API cambiados y que el número de tests no baja. Ejecuta npm run check, npm run test:e2e y npm run test:e2e:dotnet. Da una lista de hallazgos con ruta y gravedad, y no marques nada como verificado sin haberlo ejecutado.
```

## Registro

Una entrada por sesión, la más reciente al final. Sin resultados hipotéticos: lo que no se ejecutó se dice, con el motivo.

Plantilla:
- **ID · fecha · commit base**:
  - alcance;
  - hallazgos confirmados o descartados;
  - archivos principales;
  - textos, roles o `data-testid` cambiados;
  - números antes y después;
  - comandos con su resultado;
  - lo que queda pendiente y la siguiente tarea.
