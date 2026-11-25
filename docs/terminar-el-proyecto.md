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
4. **La Despensa se recarga desde cero en cada visita**: 5 GET y «Cargando la despensa…», porque usePantry() (src/features/pantry/usePantry.ts, que ya no existe: UX-02) vivía dentro de la página.
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
| FIX-01 | Los cuatro fallos graves del último push | — | verificado |
| FIX-02 | Los fallos medios de la lectura y la revisión de tickets | FIX-01 | verificado |
| DOC-02 | Estado y documentación al día tras el push | FIX-02 | verificado |
| UX-00 | Línea base de la interfaz: capturas y números | DOC-02 | verificado |
| UX-01 | Guardar sin esperar | UX-00 | verificado |
| UX-02 | Despensa instantánea | UX-00 | verificado |
| UX-03 | Añadir movimientos en segundos | UX-01 | verificado |
| UX-04 | El móvil: navegación, Resumen, toques y avisos | UX-00 | verificado |
| UX-05 | Despensa más directa | UX-02 | verificado |
| UX-06 | Carga y peso | UX-00 | verificado |
| UX-07 | Cierre de la interfaz | UX-01 … UX-06 | verificado |
| CUT-PREP | Preparar el corte sin cambiar el uso diario | — | verificado |
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
- **Tres lecturas iguales y equivocadas** (hallado en FIX-01): con las imágenes que dibuja hoy `npm run generar:tickets`, «ZANAHORIA BOLSA» de grande/completa-400 sale 0,73 en el texto, en la banda y en la banda a 1,5×, y es 0,79. La línea no se marca; solo lo delatan el total y el desglose de IVA del grupo A.
  - Ya pasaba sin FIX-01: la tabla es idéntica con el código de partida.
  - La confianza de Tesseract en la palabra del importe es 52, pero no sirve sola: marcar por debajo de 55 costaría 32 líneas limpias y bien leídas del banco (hay limpias con 0, 3 u 8).
  - La persona decidió el 23 de noviembre que FIX-01 quedara verificado y que este caso entrara en la aceptación de esta tarea.
- **El PNG**: decodificar solo las filas de la banda, o fuera del hilo principal.
- **Los menores** que cuesten poco (lista de arriba).
- **Aceptación**:
  - e2e para la línea de «confirmar producto», el aviso de capturas sin solape y los errores de cabecera;
  - la tabla del banco no es peor que la de FIX-01 (629 de 696 limpias) y no tiene ninguna cifra mal sin marcar, tampoco la zanahoria de grande/completa-400;
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

- **FIX-01 · 23 de noviembre de 2026 · base `d0b383a`** (main `c622210` más este plan), en la rama local terminar-proyecto, sin commit:
  - **Alcance**: los cuatro fallos graves, cada uno con un test que antes fallaba.
  - **Hallazgos**: se confirman los cuatro. Además:
    - el fallo de la fecha también estaba en `src/features/finance/components/MovementDialog.tsx`: una fecha prevista a medio escribir y «Pagado»;
    - la tercera lectura también decodifica `{ imagenes }` enteras, no solo franjas, así que el PNG aplica los límites de imagen. Con franjas, los 4096 de alto quedan garantizados porque se usa la misma cabecera que validó la petición.

    No se descarta ninguno.
  - **Qué cambia**:
    - **La fecha**: el resumen de la revisión y el aviso «Vencimiento previsto» solo formatean una fecha válida. `src/ui/Dialog.tsx` envuelve el contenido de cada ventana en DialogBoundary: si algo falla al pintarla, queda el aviso y el resto de la app sigue. Se comprobó quitando el arreglo de la fecha: la Despensa siguió a la vista y la ventana enseñó el aviso.
    - **Girar**: `drawRotated` y `rotatedSourceRect` (`src/features/tickets/ticketImages.ts`) giran al dibujar la copia de análisis y cada franja, sin lienzos del tamaño de la foto. Los lienzos se liberan (0 × 0) en un `finally`. Sin giro, el dibujo es el mismo de antes.
    - **Las cifras sin coma**: se descarta una cifra solo si es igual a un número del nombre, o si empieza por uno de dos cifras o más. La descartada no deja votar, y si dice otra cifra que el importe marca «Las lecturas del importe no coinciden». Va en `shared/tickets/ticketParse.ts` y `backend/src/CuentasClaras.Domain/Tickets/TicketParser.cs`, con tres casos nuevos en el corpus.
    - **El PNG** (`server/modules/tickets/adapters/tesseract/pngImage.ts`):
      - el primer bloque tiene que ser un IHDR de 13 bytes, y uno solo;
      - límites compartidos con la petición (IMAGE_LIMITS en `server/common/imageInfo.ts`);
      - `maxOutputLength = alto × (ancho × canales + 1)` y exactamente esos bytes;
      - bloques dentro del archivo y filtros 0-4.

      Cualquier otra cosa da null.
  - **Archivos principales**: los cuatro de arriba, `src/features/tickets/TicketReview.tsx` y `tests/generateTicketRules.ts`. Los tests: `shared/tickets/ticketSafety.test.ts` (4e y 4f), `server/modules/tickets/adapters/tesseract/pngImage.test.ts`, `src/features/tickets/ticketImages.test.ts`, `e2e/tickets.spec.ts` y `e2e/app.spec.ts`.
  - **Textos**: ninguno de los de antes cambia. Nuevos, solo cuando algo falla al pintar una ventana: «Algo ha fallado al mostrar esta ventana. Ciérrala y vuelve a intentarlo: lo que ya estaba guardado no se ha perdido.» (`role="alert"`) y el botón «Cerrar esta ventana». No se hicieron capturas porque ninguna pantalla cambia en su estado normal.
  - **Pruebas que antes fallaban** (ejecutadas contra el código de partida):
    - 4e y 4f: «LECHE ENTERA 1L» salía limpia con 1,43 aunque el texto decía «149»;
    - del PNG: un IHDR corto lanzaba RangeError, se leían 8001 px de ancho y la bomba de 64 MB se descomprimía;
    - tres e2e: la foto de 24 MP girada con el límite de lienzo de Safari emulado no llegaba a «Revisar el ticket», y las dos fechas a medio escribir dejaban la página sin la ventana.
  - **Números**:

    | Comprobación | Antes (según el mensaje de `c622210`) | Ahora |
    | --- | --- | --- |
    | Vitest | 1594 | 1606: 9 tests y 3 casos más del corpus |
    | e2e contra Express | 62, y 4 omitidas | 68, y 4 omitidas |
    | e2e contra .NET | 68, y 4 omitidas | 74, y 4 omitidas |
    | .NET | 2266 | 2272 |
    | Corpus de tickets | 535 casos | 538 casos |

    - Banco sintético con las imágenes dibujadas hoy: **629 de 696 limpias (90 %) y 1 mal sin marcar**, idéntico con el código de partida (FIX-01 no cambia ninguna línea).
    - Es «ZANAHORIA BOLSA» de grande/completa-400: las tres lecturas dan 0,73 y es 0,79. Pasa a FIX-02, por decisión de la persona.
    - El texto de `docs/decisiones.md` hablaba de 663 limpias. Se midió antes de la fase 4 y de la fusión, con otras imágenes: hoy, en el mismo equipo, `npm run generar:tickets` dibuja las cinco imágenes de las e2e con otros bytes. Se restauraron las de git.
  - **Comandos** (Windows; MySQL 8.4.13 de ensayo en el 3307 con el usuario cuentas_pruebas; Chrome 158.0.8127.37 con CUENTAS_E2E_CHANNEL=chrome; Node 24.13.0; .NET SDK 10.0.102):
    - `npm run check`: tipos correctos; oxlint con los 2 avisos que ya había (TicketScanDialog y TicketLineCheck); Vitest 1606/1606 en 57 archivos;
    - `npm run build`: correcto;
    - `npm run test:e2e`: 68 pasan y 4 se omiten (las capturas reales);
    - `npm run build:dotnet`: 0 avisos y 0 errores;
    - `npm run test:dotnet`: 2272/2272;
    - `npm run test:e2e:dotnet`: 74 pasan y 4 se omiten;
    - `npm run generar:tickets` y `npm run medir:tickets -- --solo-sinteticos`: lo de arriba.
  - **Pendiente**:
    - la zanahoria, en FIX-02;
    - el corte no se ha tocado;
    - el Chromium de Playwright no está descargado en este equipo, así que se usó el Chrome instalado.
  - **Siguiente tarea**: FIX-02.

- **FIX-02 · 23 de noviembre de 2026 · base `10f3d8f`** (FIX-01 en la rama local terminar-proyecto):
  - **Alcance**: los fallos medios de la lectura y la revisión de tickets, la zanahoria que dejó FIX-01 y los menores que costaban poco.
  - **Hallazgos**: se confirman todos los medios. Además:
    - «Volver a empezar» enseñaba las miniaturas sin imagen solo tras leer un texto pegado: leer el texto liberaba sus URL;
    - la votación ya exigía tres lecturas iguales para quitar dudas, pero dos de ellas podían ser las de la banda (el mismo recorte).

    No se descarta ninguno. Quedan sin hacer dos menores: la evidencia guardada sigue sin `rereads` (cambiaría la validación del guardado en TypeScript y en C#) y el contador de lectura sigue con un aviso de oxlint que ya estaba.
  - **Qué cambia**:
    - **La lectura** (`shared/tickets/ticketParse.ts` y `backend/src/CuentasClaras.Domain/Tickets/TicketParser.cs`, con 7 casos nuevos del corpus):
      - la votación exige la lectura del texto;
      - si el desglose de IVA (o el total) no cuadra, se marcan las líneas cuyo importe, con una sola cifra confundida, lo haría cuadrar: así sale la zanahoria («Con 0,79 €, el total cuadraría…»);
      - `looksLikeProduct` solo en Lidl;
      - «5 KG PATATAS 2,99 B» es un producto de una unidad;
      - una línea con la fecha no es la barra de estado;
      - la cabecera de Lidl tiene una sola definición (`isLidlHeader`), que usa también el lector.
    - **El lector**: `decodePngRows` decodifica solo las filas de la banda, por partes y en el hilo de zlib.
    - **La unión de capturas** (`src/features/tickets/ticketPlan.ts`, con tests):
      - es una función pura que calcula un Web Worker, con el hilo principal de respaldo;
      - una captura que cabe en la anterior se trata como repetida y ya no se pierden filas;
      - se avisa antes de leer si no se pueden unir por tamaño, color o bordes;
      - el solape se busca de grueso a fino;
      - lo calculado al elegir se guarda (TicketImageCache) y «Leer» lo reutiliza;
      - el análisis solo corre con dos imágenes o más.
    - **La revisión**:
      - la línea que solo pide confirmar su producto tiene tarjeta («Sí, es …»), cuenta en «Faltan N» y mantiene abierta la lista;
      - los errores de tienda, fecha, hora y total al guardar abren «Editar datos del ticket», se ven junto al campo y llevan el foco a él;
      - una tienda vacía se ve como «Falta la tienda»;
      - el recorte se abre ampliado por la altura del renglón y en el importe, con «Ampliar» y «Reducir» de 44 px al lado;
      - al resolver una tarjeta, el foco va a la siguiente por resolver o al resumen;
      - la lista no se pliega con un editor abierto.
    - **Menores**:
      - el contador de «Leyendo» fuera del anuncio;
      - «Pagado con…» siempre;
      - «Ajustes generales» no queda vacía;
      - «Por qué» sin claves repetidas y en la fila de lo leído;
      - `<summary>` y enlaces de 44 px en la revisión, y los botones de los ajustes sin `btn--small`;
      - miniaturas que giran dentro de su marco, «Quitar» que no recarga las demás, URL de franjas como Blob;
      - `prepareTicketImages([])` y una imagen de tamaño 0 dan su error;
      - solo se unen capturas con el texto del mismo color;
      - fuera `review.sections`, `.ticket-group*` y `.ticket-image-options`;
      - el banco cuenta una línea de más sin marcar como «mal sin marcar», y su carpeta privada nunca cae dentro del repositorio.
    - **El test de los cupones**: lo distinto, marcado, y como mucho una línea (la 1.ª «INSTANT NOODLES», que pierde «2 × 0,65» pero queda marcada). La regla de `server/modules/tickets/AGENTS.md` dice ahora que ninguna cifra quede mal sin marcar y que las limpias del banco no bajen (`docs/decisiones.md`).
  - **Textos** nuevos: «Sí, es …», «Se parece a tu producto … ¿Es el mismo?», «Falta la tienda», «Comprobando si las capturas se solapan…», «Reducir», los avisos de capturas que no se pueden unir o repetidas, y los errores de la cabecera junto a su campo. «Por qué» pasa de `<details>` a un botón con `aria-expanded`. Ningún texto de antes cambia de nombre.
  - **Números**:

    | Comprobación | FIX-01 | FIX-02 |
    | --- | --- | --- |
    | Vitest | 1606 | 1629 |
    | e2e contra Express | 68, y 4 omitidas | 74, y 4 omitidas |
    | e2e contra .NET | 74, y 4 omitidas | 80, y 4 omitidas |
    | .NET | 2272 | 2286 |
    | Corpus de tickets | 538 casos | 545 casos |
    | Banco sintético (mismas imágenes) | 629 de 696 limpias, **1 mal sin marcar** | 625 de 696 limpias, **0 mal sin marcar** |
    | Preparar, grande/capturas-claro | 1,3 s | 0,5 s |

    - La zanahoria pasa a «mal marcada».
    - **Las 4 limpias de menos no cumplen la aceptación («no peor que 629»)**. Son el mismo caso: el texto lee «3,9», «1,9» o «1559:B» y solo las dos lecturas de la banda dan el importe, que es correcto. Es la regla que pedía esta tarea («la votación exige la lectura del texto, o conserva la marca»): quedan «bien marcadas» y piden un toque. Se eligió la seguridad (ninguna cifra mal sin marcar) frente a la cifra; si con tickets reales las dos lecturas de la banda resultan fiables, basta quitar `textToken !== null` de `voted` en TypeScript y en C#.
  - **Comandos** (Windows; MySQL 8.4.13 de ensayo; Chrome 158 con CUENTAS_E2E_CHANNEL=chrome; Node 24.13.0; .NET SDK 10.0.102):
    - `npm run check`: tipos correctos; oxlint con 1 aviso (antes 2); Vitest 1629/1629 (en una pasada, un `fetch failed` intermitente en `server/app.test.ts`, que no toca esta tarea; repetido, 10/10 y la suite entera en verde);
    - `npm run build`: correcto;
    - `npm run test:e2e`: 74 pasan y 4 se omiten;
    - `npm run build:dotnet`: 0 avisos y 0 errores; `npm run test:dotnet`: 2286/2286;
    - `npm run test:e2e:dotnet`: 80 pasan y 4 se omiten;
    - `npm run generar:tickets` (y las imágenes de las e2e devueltas a git) y `npm run medir:tickets -- --solo-sinteticos`: la tabla de arriba.
  - **Pendiente**: medir con tickets reales (PERSONA) la votación y la marca del IVA. **Siguiente tarea**: DOC-02.

- **DOC-02 · 23 de noviembre de 2026 · base `ea07008`** (FIX-02):
  - **Alcance**: el estado y la documentación al día tras el push y las dos tareas FIX. No cambia código.
  - **STATUS** (`docs/migration/STATUS.md`):
    - entradas para `48093ae`, la fase 4 (`cbedcd6`) y la fusión `c622210`, con los resultados de sus mensajes de commit; FIX-01 y FIX-02 ya tenían la suya;
    - la cabecera, la rama de los tickets (fusionada y borrada), los recuentos de después (535, 538 y 545 casos; los tests de cada paso) y las dos filas de pruebas de «Estado comprobado», con los números de FIX-02;
    - la carpeta de compilación de la API, sin comillas invertidas: `tests/docs.test.ts` pasa también en un clon sin compilar;
    - `npm run test:e2e:dotnet` de la entrada de los tickets: se ejecutó con la fusión (68 y 4 omitidas).
  - **Documentos**:
    - «dos lecturas que coinciden»: el README, `docs/glosario.md`, `shared/AGENTS.md` y `docs/decisiones.md` dicen ya lo que hace el código desde FIX-02 (la del texto y al menos otra); se hizo en el mismo commit de FIX-02;
    - TAIL_RETRY_PAD, con su medida y por qué solo se aplica sin banda, en `docs/decisiones.md`;
    - `e2e/capturas-tickets.spec.ts` en `e2e/AGENTS.md`;
    - `fixtures/tickets/ocr-real/` en `docs/pruebas.md`, que ya dice que incluye una captura real;
    - los recuentos del corpus (545 casos, 1112 pruebas en C#) en `backend/AGENTS.md` y `docs/pruebas.md`;
    - `tools/banco-tickets/partida.md` dice que la etiqueta `banco-partida` solo está en el equipo de desarrollo.
  - **El banco**: la tabla «después» en `tools/banco-tickets/despues.md`, medida en el mismo equipo y con el código de FIX-02: **625 de 696 limpias y 0 cifras mal sin marcar** (la partida: 22 mal sin marcar). La fila «real-N» sigue pendiente de los tickets reales (PERSONA).
  - **Comandos**: `npm run check` (tipos, oxlint con 1 aviso y Vitest 1629/1629, con `tests/docs.test.ts`); `npm run medir:tickets -- --solo-sinteticos --guardar tools/banco-tickets/despues.md`. No se repitieron `npm run build`, los e2e ni las de .NET: esta tarea no cambia código y se pasaron con el mismo código en FIX-02 (74 y 80, con 4 omitidas en cada una; .NET 2286).
  - **Siguiente tarea**: UX-00.

- **UX-00 · 23 de noviembre de 2026 · base `4cd7fa1`** (DOC-02):
  - **Alcance**: la línea base de la interfaz, sin cambiarla. Con `e2e/medidas-interfaz.spec.ts` (nuevo; se salta sin CUENTAS_MEDIDAS_DIR):
    - en la base de pruebas, con `ejemplo/copia-de-ejemplo.json` y seis productos inventados, y el reloj en el 28 de octubre de 2026;
    - capturas de las 7 pantallas y de los diálogos de añadir movimiento, pagar, producto y ticket, en escritorio (1280 × 720) y Pixel 7 (412 × 839), en claro y en oscuro;
    - guardadas en .medidas-interfaz/ux00 (nueva línea en `.gitignore`).
  - **Cómo se cuenta un toque**: pulsar algo es 1; elegir en una lista, 2 (abrirla y elegir); escribir en un campo que no tenía el foco, 1 (tocarlo), y lo escrito va aparte («campos»).
  - **Números** (iguales en escritorio y en el móvil salvo donde se dice):

    | Medida | UX-00 |
    | --- | --- |
    | Añadir un gasto | 5 toques y 2 campos |
    | Añadir un ingreso | 7 toques y 2 campos (cambiar el tipo quita el foco del importe) |
    | Marcar pagado | 2 toques |
    | Añadir un producto | 2 toques y 1 campo (solo el nombre) |
    | + / − del primer producto | 2: hay que desplazarse, el primer + está a 777 px de arriba en escritorio (pantalla de 720) y a 1162 px en el móvil (839) |
    | Escanear un ticket (texto pegado, una duda) | 6 toques y 1 campo |
    | Ver el mes | 0 toques (es lo que se abre) |
    | JS y CSS al abrir (`npm run build`) | un solo archivo para todos: 458,8 kB de JS (136,5 kB comprimido) y 45,4 kB de CSS (9,5 kB); el invitado descarga lo mismo que con el código. Aparte, el Web Worker de los tickets (5,8 kB) y la fuente (34 kB latina y 19 kB latina extendida) |
    | Abrir con el código | 4 peticiones (auth/me, occurrences/generate, data y meta), unos 90 ms |
    | Guardar un movimiento | 3 peticiones (PUT, GET /data y GET /meta) antes de cerrar el diálogo, unos 200-220 ms |
    | Volver a la Despensa | 5 peticiones (todo otra vez), unos 50 ms en local |
    | Objetivos de menos de 44 px (escritorio / móvil) | Resumen 17 / 15, Año 20 / 18, Movimientos 14 / 12, Recurrentes 2 / 0, Presupuestos 11 / 9, Despensa 10 / 8, Ajustes 2 / 0, diálogo de movimiento 18 / 15, diálogo de producto 10 / 8 |

    - Los objetivos pequeños más repetidos: `btn--small` (45), los meses del gráfico del año (12), el nombre de cada producto (12), los enlaces «Mes | Año» (6) y los `link-btn` (8).
    - Los tiempos son en el equipo de desarrollo, con el servidor en local: sirven para comparar, no como lo que tarda en el móvil por la wifi de casa.
  - **Comandos**: `CUENTAS_MEDIDAS_DIR=… npx playwright test e2e/medidas-interfaz.spec.ts` (Chrome 158, MySQL 8.4.13 de ensayo): 2 pasan. En la suite normal se salta: los e2e pasan a tener 6 omitidas (antes 4).
  - **Siguiente tarea**: UX-01.

- **UX-01 · 24 de noviembre de 2026 · base `a55c0c9`** (UX-00):
  - **Alcance**: guardar sin esperar a releer, en las finanzas y al guardar un ticket.
  - **Hallazgos**: se confirman los de la revisión. Guardar esperaba al PUT, a GET /data y a GET /meta antes de cerrar el diálogo; guardar un ticket releía toda la despensa (5 peticiones) aunque el servidor ya devuelve los productos.
  - **Qué cambia**:
    - `src/features/finance/confirmedWrite.ts`: tras confirmar la escritura, el cambio entra en pantalla y la acción termina; la relectura va en segundo plano. Si falla la escritura, el diálogo sigue abierto como antes (FIN-02); si falla la relectura, el mismo aviso `warning`.
    - `src/features/finance/FinanceProvider.tsx`: lo que cambia en pantalla sin releer (movimiento, categoría y recurrente guardados; lo borrado, con los movimientos de una categoría borrada pasados a la elegida y los pendientes de un recurrente borrado; la fecha de la última copia). Un contador impide que una relectura empezada antes pise una escritura más nueva. Restaurar una copia sigue esperando a releer.
    - «Guardar gasto» (y el resto) y «Marcar como pagado»: `aria-busy` y un círculo que gira mientras guardan, con el mismo nombre accesible.
    - src/features/pantry/usePantry.ts (desde UX-02, `src/features/pantry/PantryProvider.tsx`): guardar un ticket usa los `items` que devuelve el servidor; los tickets y la actividad se releen en segundo plano.
  - **Textos, roles y `data-testid`**: ninguno cambia; se añade `aria-busy` a los botones de guardar.
  - **Números** (escritorio, `e2e/medidas-interfaz.spec.ts`, que ahora mide también guardar con GET /api/data retrasado 1,5 s):

    | Guardar un movimiento | UX-00 | UX-01 |
    | --- | --- | --- |
    | Peticiones terminadas al cerrarse el diálogo | 3 (PUT, GET /data y GET /meta) | 1 (el PUT) |
    | Tiempo hasta cerrarse, con la relectura retrasada 1,5 s | 2035 ms | 209 ms |
    | Guardar un ticket: peticiones antes de cerrar | 1 POST y 5 GET | 1 POST |

    El de UX-00 se midió con el mismo script sobre el código de UX-00 (FinanceProvider y confirmedWrite de antes).
  - **Comandos** (MySQL 8.4.13 de ensayo, Chrome 158):
    - `npm run check`: tipos correctos; oxlint con 1 aviso (el de antes); Vitest 1631/1631 (2 tests nuevos en `confirmedWrite.test.ts`);
    - `npm run test:e2e`: 74 pasan y 6 se omiten (las 4 de capturas y las 2 de medidas), con «si se guarda pero la pantalla no se puede recargar…» y «si se pierde la respuesta del guardado…»;
    - `npm run test:e2e:dotnet`: 80 pasan y 6 se omiten;
    - `npm run build` (dentro de los e2e): correcto.
  - **Siguiente tarea**: UX-02.

- **UX-02 · 24 de noviembre de 2026 · base `7ac1c08`** (UX-01):
  - **Alcance**: la Despensa instantánea.
  - **Hallazgos**: se confirman. `usePantry()` vivía dentro de la página: cada visita eran 5 GET y «Cargando la despensa…». + , −, «Queda», «Se acabó», «Lo he comprado» y el repaso esperaban al servidor (`busyIds`).
  - **Qué cambia**:
    - `src/features/pantry/PantryProvider.tsx` y `src/features/pantry/pantryContext.ts` (el patrón contexto + proveedor) sustituyen a usePantry.ts. Los montan `src/App.tsx` y `src/GuestApp.tsx`, sin depender de FinanceProvider. Se carga la primera vez que se abre la Despensa; al volver, lo de antes se ve al momento y DespensaPage lo relee en segundo plano (también al volver a la pestaña).
    - + y −, «Queda», «Queda poco», «Se acabó» y «Lo he comprado» (también en el repaso de la semana) se ven al momento. Cada producto tiene una cola: sus cambios van al servidor de uno en uno. + y − siguen mandando el paso y el servidor suma sobre su valor; mientras tanto se enseña lo último del servidor más lo pendiente. Si falla, se deshace y se avisa. «Deshacer» de una compra sigue comprobando la versión (409).
    - Fuera `busyIds` (DespensaPage, PantryRow y ReviewBlock) y el bloqueo del repaso salvo al terminarlo.
  - **Textos, roles y `data-testid`**: ninguno cambia. PantryRow y la tarjeta del repaso ya no ponen `aria-busy` ni desactivan los botones mientras espera el servidor.
  - **Números**: volver a la Despensa sigue haciendo 5 peticiones, pero ya en segundo plano: con la relectura retrasada 1,5 s, el producto se ve en menos de 500 ms y no aparece «Cargando la despensa…» (antes, la página se vaciaba hasta que llegaban las 5). Tres + seguidos con el servidor tardando 400 ms se ven en menos de 300 ms y suman tres en el servidor.
  - **Pruebas nuevas** (`e2e/despensa.spec.ts`): «+ tres veces seguidas suma tres al momento, y un + que falla se deshace y avisa» y «con el código, volver a la Despensa la enseña al momento, sin «Cargando la despensa…»». Dos pestañas a la vez: la de siempre, «dos móviles pulsan + a la vez…», sigue pasando.
  - **Comandos** (MySQL 8.4.13 de ensayo, Chrome 158):
    - `npm run check`: tipos correctos; oxlint con 1 aviso (el de antes); Vitest 1631/1631;
    - `npm run test:e2e`: 78 pasan y 6 se omiten;
    - `npm run test:e2e:dotnet`: 84 pasan y 6 se omiten;
    - `e2e/medidas-interfaz.spec.ts` en escritorio: pasa.
  - **Siguiente tarea**: UX-03.

- **UX-03 · 24 de noviembre de 2026 · base `433d45c`** (UX-02):
  - **Alcance**: añadir un movimiento en segundos.
  - **Hallazgos**: se confirman los puntos 2 y 7 de la revisión. La categoría era un select de unas 24 opciones y solo se proponía con el concepto exacto. «Gasto | Ingreso» iba antes del importe, y cambiarlo le quitaba el foco. «Añadir» siempre abría un gasto. Además faltaban «Hoy» y «Ayer», y después de guardar había que volver a abrir el diálogo.
  - **Qué cambia**:
    - `shared/finance/suggestions.ts`:
      - `categoryForConcept` busca primero el concepto igual; si no lo hay, busca el más reciente que empieza por lo escrito, con 3 letras o más;
      - `frequentCategories` da las categorías más usadas de un tipo, 6 como mucho;
      - sus tests están en `shared/finance/suggestions.test.ts`. Solo lo usa la web, así que .NET no cambia.
    - `src/features/finance/components/MovementDialog.tsx`:
      - el importe y «Gasto | Ingreso» van en la misma fila;
      - cambiar el tipo con el ratón o el dedo devuelve el foco al importe;
      - Intro en el importe pasa al concepto (`enterKeyHint` «next», en `src/ui/forms.tsx`);
      - el grupo «Más usadas» pone botones con las categorías habituales (`aria-pressed`);
      - «Hoy» y «Ayer» van junto a la fecha;
      - con una fecha futura aparece un aviso con «Marcar como pendiente»;
      - el estado y las notas van en «Más opciones», plegado salvo en un pendiente, con notas o con un error dentro;
      - «Guardar y añadir otro» guarda y deja el formulario vacío con el mismo tipo y la misma fecha, y el foco en el importe.
    - `src/App.tsx`:
      - la tecla «n» abre «Nuevo movimiento» si el foco no está en un campo y no hay otra ventana abierta; el botón lo anuncia con `aria-keyshortcuts`;
      - en el lateral del escritorio hay un «Añadir ingreso».
    - `src/features/finance/pages/MovementsPage.tsx`: «Añadir ingreso» junto a «Añadir movimiento», solo en el escritorio.
    - `src/styles.css`: los estilos de la fila del importe, los botones de categoría (44 px de alto), las fechas rápidas, el aviso de la fecha futura y «Más opciones».
  - **Textos, roles y `data-testid`**: no cambia ninguno de los que había.
    - Botones nuevos: «Añadir ingreso», «Guardar y añadir otro», «Hoy», «Ayer» y «Marcar como pendiente», más un botón por categoría habitual con su nombre corto.
    - Grupos nuevos: «Más usadas» y «Fechas rápidas».
    - El estado («Pagado» o «Cobrado» y «Pendiente») y «Notas» quedan dentro de «Más opciones». Los e2e que marcan «Pendiente» abren antes «Más opciones».
    - Todo esto está en `src/features/finance/AGENTS.md`, `e2e/AGENTS.md` y el README («Apuntar un gasto o un ingreso»).
  - **Números**: toques medidos con `e2e/medidas-interfaz.spec.ts`. El script ahora pasa al concepto con Intro y elige la categoría con un botón de «Más usadas» si lo hay, o en la lista si no.

    | Tarea | UX-00 | UX-03 |
    | --- | --- | --- |
    | Añadir un gasto (escritorio y móvil) | 5 toques + 2 campos escritos | 3 toques + 2 campos escritos |
    | Añadir un ingreso (escritorio y móvil) | 7 toques + 2 campos escritos | 4 toques + 2 campos escritos |

    Los 3 toques del gasto son abrir, la categoría y guardar. El ingreso se mide desde «Añadir movimiento» y cambiando a «Ingreso», que vale también en el móvil. En el escritorio, «Añadir ingreso» lo deja en 3.
  - **Prueba nueva** (`e2e/app.spec.ts`): «un gasto en tres toques: Intro al concepto, la categoría habitual en un botón y «Guardar y añadir otro»». Cubre la tecla «n», el foco al cambiar de tipo, «Merc» proponiendo la categoría de «Mercadona», «Ayer», la fecha futura y «Guardar y añadir otro».
  - **Comandos** (MySQL 8.4.13 de ensayo, Chrome 158):
    - `npm run check`: tipos correctos; oxlint con 1 aviso (el de antes); Vitest 1635/1635 (4 tests nuevos);
    - `npm run test:e2e`: 80 pasan y 6 se omiten;
    - `npm run test:e2e:dotnet`: 86 pasan y 6 se omiten;
    - `e2e/medidas-interfaz.spec.ts` en escritorio y móvil: pasa.
  - **Siguiente tarea**: UX-04.

- **UX-04 · 24 de noviembre de 2026 · base `04ccceb`** (UX-03):
  - **Alcance**: el móvil. Cubre la navegación, el Resumen, los objetivos táctiles, los avisos y el final de `src/styles.css`.
  - **Hallazgos**: se confirman los puntos 6, 8, 9 y 10 de la revisión.
    - La barra tenía 6 pestañas con letra de 11 px, y partía «Presupuestos» y «Recurrentes».
    - En el Resumen, lo pendiente quedaba debajo de la cuenta y del gráfico.
    - En el Pixel 7 había 15 objetivos de menos de 44 px en el Resumen, 12 en Movimientos, 9 en Presupuestos y 8 en la Despensa.
    - Los avisos salían arriba.
  - **Qué cambia**:
    - **La barra inferior** (`src/App.tsx`):
      - cinco pestañas: Resumen, Movimientos, Recurrentes, Despensa y Ajustes;
      - letra de 12 px y sin partir palabras, también en 360 px;
      - Presupuestos (`nav__item--desktop`) solo está en el lateral del escritorio; en el móvil se abre desde su bloque del Resumen, y mientras está abierta se resalta «Resumen» (`nav__link--within`).
    - **El Resumen en una columna** (`src/features/finance/pages/SummaryPage.tsx`):
      - el orden es la cuenta, lo pendiente, el gráfico y los presupuestos (`display: contents` y `order`);
      - si hay vencidos, arriba sale el aviso «N vencidos», con «Ver los vencidos», que lleva el foco al título de lo pendiente;
      - con dos columnas (1100 px o más), el aviso no sale.
    - **Avisos**: en el móvil salen abajo, encima del botón «Añadir» y de la barra; en el escritorio siguen abajo a la derecha.
    - **Pantallas táctiles** (`@media (pointer: coarse)`): miden al menos 44 px:
      - `btn--small`, `link-btn` y los enlaces dentro de un aviso;
      - «Mes | Año», el nombre de un producto (también de ancho) y lo que se pliega;
      - el «Deshacer» y la «×» de los avisos.
      - «Más opciones» lleva su flecha.
    - **`src/styles.css`**:
      - el resaltado sobre la foto del ticket pasa a variables (`--highlight-line` y `--highlight-fill`);
      - las secciones van numeradas del 1 al 11, y la cabecera las lista;
      - «Ticket comparison…» pasa a «9. Revisión de un ticket»;
      - la regla de la barra pasa a «3. Estructura», y `.toast__action` a «Avisos breves»;
      - las utilidades van al final, como dice su comentario.
    - **`e2e/medidas-interfaz.spec.ts`**:
      - en un diálogo cuenta solo los objetivos de dentro; antes sumaba también la página de detrás, así que los números de los diálogos de UX-00 no se comparan;
      - anota la barra inferior del móvil;
      - vuelve a activar el dedo tras cada captura entera. En Chromium, una captura entera de una página larga deja de emular `pointer: coarse`, y el móvil se medía y se capturaba con los tamaños del escritorio. Las medidas de UX-00 no cambian, porque entonces no había reglas para el dedo.
  - **Textos, roles y `data-testid`**:
    - Nuevos: el aviso «N vencidos» («1 vencido») y el botón «Ver los vencidos».
    - En el móvil, el enlace «Presupuestos» ya no está en la barra.
    - No cambia ningún otro. Todo está en `src/features/finance/AGENTS.md`, `docs/frontend.md`, `e2e/AGENTS.md` y el README.
  - **Números** (Pixel 7, `e2e/medidas-interfaz.spec.ts`):

    | | UX-00 | UX-04 |
    | --- | --- | --- |
    | Pestañas en la barra · letra · las que se parten | 6 · 11 px · 2 | 5 · 12 px · 0 (también en 360 px) |
    | Objetivos de menos de 44 px: Resumen, Movimientos, Presupuestos y Despensa | 15, 12, 9 y 8 | 0, 0, 0 y 0 |
    | Objetivos de menos de 44 px: Año | 18 | 12 (las 12 columnas del gráfico, de 24 px de ancho: no son frecuentes y no caben más anchas) |
    | Dónde está lo pendiente en el Resumen | debajo de la cuenta y del gráfico | justo debajo de la cuenta, con «N vencidos» arriba |
    | Avisos | arriba | abajo, encima de «Añadir» |

    En el escritorio (con ratón) los tamaños no cambian.
  - **Contraste**: AA en claro y en oscuro.
    - El aviso de vencidos usa los colores de `notice--error`: rojo sobre rosa en claro, y salmón sobre granate en oscuro.
    - Las pestañas usan `--ink-2` y `--accent` sobre `--sheet`, los de antes.
    - Capturas revisadas a mano: el Resumen en claro y en oscuro, lo pendiente tras «Ver los vencidos» y Presupuestos en 360 px.
  - **Prueba nueva** (`e2e/app.spec.ts`): «en el móvil: cinco pestañas enteras, «N vencidos» lleva a lo pendiente, los avisos abajo y Presupuestos desde el Resumen». En el escritorio comprueba que siguen las seis secciones y que el aviso no sale.
  - **Comandos** (MySQL 8.4.13 de ensayo, Chrome 158):
    - `npm run check`: tipos correctos; oxlint con 1 aviso (el de antes); Vitest 1635/1635;
    - `npm run test:e2e`: 82 pasan y 6 se omiten;
    - `npm run test:e2e:dotnet`: 88 pasan y 6 se omiten;
    - `e2e/medidas-interfaz.spec.ts` en escritorio y móvil: pasa.
  - **Siguiente tarea**: UX-05.

- **UX-05 · 24 de noviembre de 2026 · base `8446eeb`** (UX-04):
  - **Alcance**: una Despensa más directa, más «Deshacer» tras «Marcar pagado».
  - **Hallazgos**: se confirma el punto 3 de la revisión.
    - Antes de los productos había seis bloques: acciones, repaso, personas, «Para revisar» (hasta 8), «Últimas compras» y el resumen. No había buscador, y los bloques vacíos se veían.
    - La persona elegida se perdía al recargar.
    - Borrar una persona y quitar el presupuesto no pedían confirmación.
  - **Qué cambia**:
    - **`src/features/pantry/DespensaPage.tsx`**:
      - el orden es acciones y repaso; la persona; «Para revisar» con 3 y «Ver las n» (`src/features/pantry/components/ReviewBlock.tsx`); el buscador y los productos; y, plegado al final, «Últimas compras, resumen y presupuesto»;
      - los bloques de frecuencia sin productos no salen;
      - el buscador encuentra por cualquier parte del nombre y sin tildes (`matchesName`, en `shared/pantry/pantry.ts`, con sus tests). Sin resultados, dice «Ningún producto se llama «…».»;
      - la persona elegida se guarda en `localStorage`; si ya no existe, vuelve a «Todo»;
      - en el móvil, «Personas» es solo el icono, junto a las pestañas (el nombre sigue para los lectores de pantalla), y el buscador usa el mismo campo con lupa que Movimientos. Así el primer + entra en la primera pantalla.
    - **Confirmaciones** con `ConfirmDialog`, como al borrar un producto:
      - «Eliminar persona»;
      - «Quitar el presupuesto», desde el botón o al vaciar el campo en su ventana.
    - **«Más detalles»** en el formulario del producto: el precio y las notas, abierto si ya tienen algo o hay un error dentro.
    - **«Deshacer» tras «Marcar pagado»** (o cobrado), en `src/features/finance/components/PaymentDialog.tsx`:
      - vuelve a guardar el movimiento como estaba, con el mismo PUT /api/movements/:id;
      - queda pendiente, con su fecha prevista y su importe de antes;
      - avisa «Pago deshecho: vuelve a estar pendiente».
      - La API lo permitía sin cambiar contratos.
  - **Textos, roles y `data-testid`**:
    - Nuevos:
      - «Buscar producto» y «Ningún producto se llama «…».»;
      - «Últimas compras, resumen y presupuesto» (o «Resumen y presupuesto») y «Más detalles»;
      - los diálogos «Eliminar persona» y «Quitar el presupuesto»;
      - el «Deshacer» del pago y su aviso.
    - Cambia el comportamiento de «Eliminar a …» y «Quitar presupuesto»: ahora preguntan antes.
    - Ya no sale «Ningún producto en este bloque.».
    - Los e2e abren lo plegado antes de usarlo:
      - el precio al crear un producto;
      - el resumen en «crea una persona y un producto…»;
      - «Últimas compras», con `recentTickets()` en `e2e/tickets.spec.ts`.
    - Todo está en `src/features/pantry/AGENTS.md`, `src/features/finance/AGENTS.md`, `e2e/AGENTS.md` y el README.
  - **Números** (`e2e/medidas-interfaz.spec.ts`, la misma despensa de ejemplo):

    | | UX-00 móvil | UX-05 móvil | UX-00 escritorio | UX-05 escritorio |
    | --- | --- | --- | --- | --- |
    | Dónde está el primer + al abrir la Despensa | 1162 px (fuera de la primera pantalla) | 809 px (dentro: la pantalla mide 839) | 777 px (fuera: 720) | 503 px (dentro) |
    | Toques para + / − del primer producto | 2 (desplazarse y pulsar) | 1 | 2 | 1 |
    | + de cualquier producto con el buscador | — | 2 toques y 1 campo escrito, sin desplazarse | — | igual |
    | Objetivos de menos de 44 px en la Despensa | 8 | 0 | 10 | 10 (con ratón no cambian) |
  - **Pruebas nuevas**:
    - `e2e/despensa.spec.ts`: «el buscador lleva a + y − de cualquier producto, los bloques vacíos no se ven y la persona elegida se recuerda» y «borrar una persona y quitar el presupuesto se confirman antes»;
    - `e2e/app.spec.ts`: ««Deshacer» tras marcar un pago lo deja pendiente como estaba»;
    - `shared/pantry/pantry.test.ts`: 2 tests de `matchesName`.
  - **Comandos** (MySQL 8.4.13 de ensayo, Chrome 158):
    - `npm run check`: tipos correctos; oxlint con 1 aviso (el de antes); Vitest 1637/1637;
    - `npm run test:e2e`: 88 pasan y 6 se omiten;
    - `npm run test:e2e:dotnet`: 94 pasan y 6 se omiten;
    - `e2e/medidas-interfaz.spec.ts` en escritorio y móvil: pasa.
  - **Siguiente tarea**: UX-06.

- **UX-06 · 25 de noviembre de 2026 · base `e601e54`** (UX-05):
  - **Alcance**: la carga y el peso de la web.
  - **Hallazgos**: se confirman.
    - El invitado descargaba todas las finanzas: un solo archivo de 458,8 kB.
    - Los diálogos pesados iban dentro.
    - La fuente traía también el subconjunto latino extendido.
    - `index.html` decía que los datos se guardan en el navegador y no tenía manifest.
    - La comprobación de la migración del navegador se repetía en cada apertura si no había base antigua.
  - **Qué cambia**:
    - **Archivos aparte**:
      - `src/AdminApp.tsx` (FinanceProvider y App): el invitado ya no lo descarga;
      - los diálogos de tickets, que exporta así `src/features/tickets/index.ts`;
      - el formulario de un recurrente, las copias y el editor de categorías.
    - **Cómo se cargan**: con `src/ui/lazyComponent.tsx`, un `import()` dinámico como el de React.lazy, pero sin `<Suspense>`.
      - Con React.lazy, abrir las cuentas pasó de unos 90 ms a unos 860 ms: React retrasa 300 ms lo que llega tras un «fallback» de Suspense (FALLBACK_THROTTLE_MS), y en la traza el archivo llegaba en 10 ms, pero FinanceProvider empezaba 300 ms después.
      - Con `lazyComponent` vuelve a unos 90 ms.
      - Las páginas no se cargan así, porque al cambiar de sección el foco va a su título.
    - **Mientras carga**: esqueletos accesibles (`src/ui/Loading.tsx`), con el texto de siempre visible y `role="status"`.
      - Usan los de siempre: «Abriendo Cuentas claras…», «Abriendo tus cuentas…» y «Cargando la despensa…».
      - Son nuevos «Cargando las copias de seguridad…» y «Cargando las categorías…».
      - LoadBoundary, en `src/main.tsx`, enseña «Volver a cargar» si un archivo no llega.
    - **Al abrir**: la marca de la migración del navegador se guarda también sin base antigua («sin-base»), con su test. La prueba e2e de la migración escribe la base antigua antes de abrir la app, desde otra página del mismo origen, como pasaría de verdad.
    - **La fuente**: solo el subconjunto latino, declarado en `src/styles.css` y con preload en `index.html`. Los dos apuntan al mismo archivo, y Vite les da el mismo nombre.
    - **`index.html` y `public/`**:
      - la descripción corregida;
      - el manifest (`public/manifest.webmanifest`), con iconos PNG de 180, 192 y 512 px y uno «maskable», dibujados con el SVG del favicon;
      - `theme-color` ya estaba.
      - Sin service worker (`docs/decisiones.md`).
    - **Listas**: Movimientos filtra con `useDeferredValue`, y sus totales van en un memo. En la Despensa, el ritmo y el repaso dependen de los productos, la actividad y la fecha, no de todo el estado.
  - **Textos, roles y `data-testid`**: ninguno cambia. Los textos de carga siguen (en un esqueleto), y se añaden los dos de los Ajustes y el aviso «No se ha podido abrir esta parte» con «Volver a cargar». Están en `docs/frontend.md`, `src/AGENTS.md` y los AGENTS.md de finance, pantry y tickets.
  - **Números** (`npm run build` y `e2e/medidas-interfaz.spec.ts`):

    | | UX-00 | UX-06 |
    | --- | --- | --- |
    | JS al abrir como invitado | 458,8 kB (136,5 kB comprimido) | 302,2 kB (93,4 kB comprimido), un 34 % menos |
    | JS al abrir con el código | 458,8 kB (136,5 kB comprimido) | 396,9 kB (120,1 kB comprimido), un 13 % menos |
    | Aparte, al abrirlos | — | escanear y revisar un ticket 56,9 kB, ver un ticket 3,8 kB, recurrente 6,8 kB, copias 3,9 kB y categorías 6,5 kB |
    | Fuente | latina (34 kB) y latina extendida (19 kB) | solo la latina (34 kB), con preload |
    | Abrir con el código (recargar hasta ver el mes) | 77–93 ms | 86–96 ms (con React.lazy eran 860 ms) |
    | Guardar un movimiento · volver a la Despensa | 102 ms · 54 ms | 46–49 ms · 50–54 ms |
  - **Comandos** (MySQL 8.4.13 de ensayo, Chrome 158):
    - `npm run check`: tipos correctos; oxlint con 1 aviso (el de antes); Vitest 1638/1638 (1 test nuevo de la migración);
    - `npm run test:e2e`: 88 pasan y 6 se omiten;
    - `npm run test:e2e:dotnet`: 94 pasan y 6 se omiten;
    - `e2e/medidas-interfaz.spec.ts` en escritorio y móvil: pasa;
    - `vite` en desarrollo sirve la fuente desde `node_modules` y el manifest.
  - **Siguiente tarea**: UX-07.

- **UX-07 · 25 de noviembre de 2026 · base `ab5be83`** (UX-06):
  - **Alcance**: el cierre de la interfaz. Las capturas y los números finales frente a UX-00, un repaso de teclado, foco y contraste, y la documentación al día.
  - **Capturas**: claro y oscuro, escritorio y Pixel 7, cada pantalla y los diálogos, en .medidas-interfaz/ux07 (fuera de git), para compararlas con .medidas-interfaz/ux00.
  - **Números finales** (`e2e/medidas-interfaz.spec.ts`, la misma copia de ejemplo y la misma despensa):

    | | UX-00 | UX-07 |
    | --- | --- | --- |
    | Añadir un gasto con una categoría habitual (escritorio y móvil) | 5 toques + 2 campos | 3 toques + 2 campos |
    | Añadir un ingreso (escritorio y móvil) | 7 toques + 2 campos | 4 toques + 2 campos |
    | + / − del primer producto | 2 toques (desplazarse) | 1 toque: el primer + está en la primera pantalla (809 de 839 px en el móvil, 503 de 720 en el escritorio) |
    | + de cualquier producto | desplazarse por los bloques | 2 toques + 1 campo, con el buscador |
    | Marcar pagado · añadir un producto · escanear un ticket | 2 · 2 + 1 · 6 + 1 | igual |
    | Objetivos de menos de 44 px en el Pixel 7 | Resumen 15, Año 18, Movimientos 12, Presupuestos 9 y Despensa 8 | 0, salvo las 12 columnas del gráfico del año (no son frecuentes) |
    | Barra inferior del móvil | 6 pestañas, 11 px, 2 se parten | 5 pestañas, 12 px, ninguna se parte (también en 360 px) |
    | Guardar un movimiento: hasta cerrarse el diálogo | 3 peticiones, 202–221 ms | 1 petición, 41–48 ms (207–215 ms con la relectura retrasada 1,5 s, antes 2035 ms) |
    | Volver a la Despensa | 5 peticiones, 47–54 ms, sin «Cargando…» | igual, y lo de antes se ve al momento (UX-02) |
    | JS al abrir: invitado · con el código | 458,8 kB · 458,8 kB | 302,2 kB · 396,9 kB (93,4 y 120,1 kB comprimido) |
    | Abrir con el código | 90–93 ms | 85–98 ms |

    Dos arreglos de la medición. Los números de antes no cambian, porque los de UX-03 a UX-06 ya daban lo mismo cuando no fallaba:
    - **«Más usadas»**: la medición miraba si había un botón sin esperar (`count()`), y a veces contaba la lista desplegable. Ahora espera a que salga, hasta 1 s.
    - **Escribir en un campo**: miraba si el cursor estaba en el mismo instante. Al cambiar «Gasto | Ingreso», el foco vuelve al importe en el siguiente fotograma (`requestAnimationFrame`), así que a veces contaba un toque de más: 5 en lugar de 4 en el ingreso. Ahora espera hasta 0,5 s. La app lo hacía bien; la medición miraba demasiado pronto.
  - **Teclado y foco**:
    - prueba nueva en `e2e/app.spec.ts`, «con el teclado: «Saltar al contenido», la tecla «n», Escape devuelve el foco y cada parada se ve», en escritorio y móvil;
    - «Saltar al contenido» es la primera parada y lleva el foco a `main`;
    - «n» abre «Nuevo movimiento» con el foco en el importe;
    - Escape la cierra y el foco vuelve a `main`;
    - las 10 paradas siguientes tienen contorno de 2 px o más (`:focus-visible`).
  - **Contraste**: se calcularon todos los pares de colores de `:root` (texto sobre fondo, en claro y en oscuro) con la fórmula de WCAG.
    - El texto pasa 4,5:1. El más justo es `--pencil` sobre `--paper` en claro, con 5,02:1.
    - Los bordes y las barras pasan 3:1. El más justo es `--rule-strong` sobre `--sheet` en claro, con 3,29:1.
    - No hubo que cambiar ningún color.
  - **Documentación**:
    - el README dice también lo que hace la Despensa, al principio («Lo que hace»);
    - `docs/frontend.md` (accesibilidad: el teclado y el contraste);
    - `src/features/finance/AGENTS.md` («Saltar al contenido», y la frase de la migración del navegador, que había quedado fuera de sitio en UX-06);
    - `e2e/AGENTS.md` (la prueba del teclado).
  - **Comandos** (MySQL 8.4.13 de ensayo, Chrome 158):
    - `npm run check`: tipos correctos; oxlint con 1 aviso (el de antes); Vitest 1638/1638;
    - `npm run test:e2e`: 90 pasan y 6 se omiten;
    - `npm run test:e2e:dotnet`: 96 pasan y 6 se omiten;
    - `e2e/medidas-interfaz.spec.ts` en escritorio y móvil: pasa, dos veces seguidas con los mismos toques.
  - **Siguiente tarea**: CUT-PREP.

- **CUT-PREP · 24 de noviembre de 2026 · base `d0b383a`** (main en `c622210` más este plan), en la nube:
  - **Por qué esta tarea, fuera de orden.** FIX-01, FIX-02 y DOC-02 están hechos con su commit en la rama local terminar-proyecto del ordenador de la persona, sin subir; UX-00 y UX-01, hechos sin commit (la última sesión se cortó a mitad de una medida, y puede haber un `git stash` pendiente). Ese ordenador no estaba disponible, así que se hizo CUT-PREP, que no depende de ellas, sobre la rama ccr-e3b98276-3xjznb. Al juntar las dos ramas habrá conflictos fáciles en STATUS.md (la cabecera, la línea de la carpeta bin y el final del registro) y en el registro de este archivo.
  - **Hallazgos confirmados**:
    - `npm run dev`, `server` y el proxy de Vite iban a Express, y no había ningún script para .NET;
    - el host .NET no leía `.env`;
    - la codificación rota de `playwright.dotnet.config.ts`;
    - tsx era de desarrollo, pero lo usan `npm run server` y el OCR de .NET;
    - `MissingRoutes`, sin uso desde TIC-04;
    - el pendiente de Cache-Control de `docs/api.md`.
  - **Hallazgo nuevo**: `dotnet run` arranca el host en la carpeta del proyecto (comprobado con /proc), así que un `.env` relativo no se encontraba. El OCR sí se encontraba, porque también se busca desde la carpeta del programa. RunWorkingDirectory lo arranca en la raíz.
  - **Hallazgo confirmado de la revisión**: `tests/docs.test.ts` fallaba en un clon sin compilar por la carpeta bin de la API en STATUS. Corregido aquí, igual que en DOC-02.
  - **Archivos principales**:
    - `package.json`: `dev:dotnet`, `dev:dotnet:api`, `dev:dotnet:web`, `server:dotnet`, `build:web:dotnet` y `preview:dotnet`; `npm run dev` no cambia;
    - `vite.config.ts` (`--mode dotnet`);
    - `backend/src/CuentasClaras.Api/Composition/EnvFile.cs` y `backend/src/CuentasClaras.Api/Program.cs`;
    - `backend/src/CuentasClaras.Api/CuentasClaras.Api.csproj`;
    - `backend/tests/CuentasClaras.Tests/EnvFileTests.cs` y `backend/tests/CuentasClaras.Tests/HttpContractTests.cs`;
    - `tests/architecture.test.ts`;
    - README («Ensayo con el backend .NET», sin PowerShell), `docs/migration/DATA.md` (pasos 3 a 5 del corte) y `docs/decisiones.md`.
  - **Textos, roles y `data-testid`**: ninguno. Sin dependencias nuevas, sin contratos de la API cambiados y sin cambiar el uso diario.
  - **Números**:
    - Vitest: de 1593 de 1594 (fallaba el de la documentación) a 1596/1596 (2 de arquitectura nuevos);
    - .NET: de 2266 a 2274 (8 de EnvFileTests);
    - e2e: 62 y 4 omitidas contra Express, igual que antes;
    - e2e contra .NET: 68 y 4 omitidas, como en `c622210`.
  - **Comandos**, en Linux (Ubuntu 24.04) con .NET SDK 10.0.115, Node 22.23.5, MySQL 8.0.46 (paquete de Ubuntu, usuario limitado a `cuentas\_test\_%` y `cuentas_claras_e2e`) y el Chromium de Playwright 1.63, sin canal:
    - `dotnet restore backend/CuentasClaras.slnx --locked-mode`: correcto;
    - `npm run check`: tipos, oxlint (solo los avisos de antes) y Vitest 1596/1596 en 57 archivos;
    - `npm run build` y `npm run build:dotnet`: 0 avisos y 0 errores;
    - `npm run test:dotnet`: 2274/2274;
    - `npm run test:e2e`: 62 y 4 omitidas;
    - `npm run test:e2e:dotnet`: 68 y 4 omitidas. Las omitidas son las de `e2e/capturas-tickets.spec.ts`, que necesitan CUENTAS_CAPTURAS_DIR.
  - **A mano**, con un `.env` de ensayo (base `cuentas_test_cutprep`, borrados al terminar) y sin CUENTAS_DB_* en el entorno:
    - `npm run dev:dotnet`: la salud por Vite (5173) responde el esquema 5, `/api/data` da 401 sin sesión, el login da admin y `/api/summary/month`, que solo tiene .NET, responde;
    - `npm run build:web:dotnet`, `server:dotnet` y `preview:dotnet`: la salud por 4173. La web para .NET pide los resúmenes al servidor y la de Express no;
    - EnvFile: los valores de su prueba, comparados con `node --env-file` en Node 22.
  - **Sin comprobar**:
    - los scripts en Windows (concurrently con cmd.exe y RunWorkingDirectory con `dotnet run`);
    - el `.env` con Node 24, que usa la persona;
    - las suites en su MySQL 8.0.36.
  - **Siguiente**: en el ordenador de la persona, subir terminar-proyecto, juntarla con esta rama y seguir por UX-01 (o por UX-00 si su medida no quedó guardada). PERSONA puede empezar ya, porque CUT-PREP está verificado. CUT-01 queda `en_curso` en STATUS.

- **Fusión de terminar-proyecto con main · 25 de noviembre de 2026** (la persona pidió juntarlo todo en una rama):
  - **Las dos ramas**:
    - terminar-proyecto: FIX-01 a UX-07 y una CUT-PREP propia (`7ba9c1b`), hechas en el ordenador de la persona;
    - main: la CUT-PREP de la entrada anterior (`315672a` y `efa7b4b`), hecha en la nube mientras ese ordenador no estaba disponible.
  - **CUT-PREP**: se queda la de main y se retira la de terminar-proyecto, que hacía lo mismo de otra manera: el host buscaba él mismo el `.env` (DotEnv, con 4 tests), las pruebas lo apagaban con `CUENTAS_ENV_FILE=ninguno`, y tenía `start:dotnet`. La de main:
    - es más prudente: el host solo lee `.env` cuando el script pasa `--env-file-if-exists=.env`, así que ninguna prueba puede abrir la base de la instalación;
    - tiene más pruebas (8 de EnvFileTests y 2 de arquitectura, frente a 4);
    - ya estaba en GitHub.
  - **Lo de terminar-proyecto que se conserva al resolver**:
    - todo FIX-01 a UX-07;
    - `worker: { format: 'es' }` en `vite.config.ts` (FIX-02: el Web Worker de las capturas), que la versión de main no tenía;
    - los pasos del corte para la persona en el README, ahora en «Probar el backend .NET» (el nombre que ya usaba `docs/pruebas.md`).
  - **Lo que la CUT-PREP de main dejó sin comprobar** («los scripts en Windows», «el `.env` con Node 24»): comprobados en Windows con Node 24.13.0. `npm run dev:dotnet` arranca con concurrently y cmd.exe; la API se abre en la raíz del repositorio («Content root path: D:\PROYECTOS\cuentas_claras», por RunWorkingDirectory) y `--env-file-if-exists` encuentra un archivo de ensayo con ruta relativa, del que toma el código y la base `cuentas_test_cutprep` (creada y borrada para ello). Por el proxy de Vite responden la salud, el acceso y GET /api/summary/month, y `__CUENTAS_BACKEND__` vale `dotnet`. Los 26 valores del archivo de `EnvFileTests.Lee_el_formato_de_Node` coinciden con `node --env-file` de Node 24.13.0.
  - **Comandos** (Windows, MySQL 8.4.13 de ensayo, Chrome 158, Node 24): `npm run build:dotnet` (0 avisos y 0 errores), `npm run test:dotnet` (2294/2294: los 2286 de FIX-02 y los 8 de EnvFileTests), `npm run check` (Vitest 1640/1640: los 1638 de UX-07 y los 2 de arquitectura de la CUT-PREP de main), `npm run test:e2e` (90 pasan y 6 se omiten) y `npm run test:e2e:dotnet` (96 pasan y 6 se omiten).
  - **Siguiente**: PERSONA, y después CUT-FINAL, solo con su confirmación.
