# Feature pantry — Despensa

> Lee antes: /AGENTS.md y src/AGENTS.md. Depende de: `src/api/`, `src/ui/`, `shared/pantry/` y la feature tickets (sus diálogos y TicketActions, por su index.ts). Lo usan: `src/App.tsx` (con el código) y `src/GuestApp.tsx` (invitado), que montan PantryProvider: es la misma página para los dos. En el servidor son los módulos pantry y tickets.

## Qué ve la persona
La Despensa, en este orden (UX-05):
- arriba, «Escanear ticket», «Lista de la compra (n)» y «Nuevo producto», y el aviso del repaso de la semana;
- el selector de persona («Todo», «Compartido» o cada persona), que se recuerda en el navegador, y «Personas» (en el móvil, solo el icono);
- «Para revisar»: los 3 primeros y «Ver las n»;
- el buscador «Buscar producto» y los productos por frecuencia, con «Queda», «Se acabó», «Lo he comprado» o − y +, según cómo se sigan; los bloques sin productos no salen;
- plegado, «Últimas compras, resumen y presupuesto» («Resumen y presupuesto» si no hay tickets): los tickets guardados, el resumen y la estimación mensual con el presupuesto.

Sin el código es lo único que se ve.

## Componentes
| Componente | Archivo | Qué hace | Test e2e |
| --- | --- | --- | --- |
| PantryProvider | `PantryProvider.tsx` y `pantryContext.ts` (usePantry) | El estado de la despensa, entre secciones, y sus acciones; + / − y las revisiones al momento, con una cola por producto | «+ tres veces seguidas suma tres…» y «con el código, volver a la Despensa la enseña al momento…» |
| DespensaPage | `DespensaPage.tsx` | La página: carga o relee al abrirse y al volver a la pestaña, avisos con «Deshacer» y qué diálogo está abierto | `e2e/despensa.spec.ts` y `e2e/tickets.spec.ts` |
| PantryRow | `components/PantryRow.tsx` | Un producto: estado, última compra, botones y + / − | «los botones + y −, marcar como comprado y deshacer» y «dos móviles pulsan + a la vez y el servidor suma los dos» |
| ReviewBlock | `components/ReviewBlock.tsx` | «Para revisar»: lo que se acerca a lo que suele durar | «días después: qué toca revisar…» |
| RecentTickets | `components/RecentTickets.tsx` | «Últimas compras»: los tickets guardados | «lee la captura de un ticket de Lidl…» |
| SummaryBlock, BudgetBlock | `components/SummaryBlock.tsx`, `components/BudgetBlock.tsx` | Lo que falta, la estimación mensual y el presupuesto | — |
| WeeklyReviewCard, WeeklyReviewDialog | `components/WeeklyReview.tsx` | El repaso de la semana, producto a producto | «repaso de la semana: «Hoy no»…» |
| ShoppingListDialog | `components/ShoppingListDialog.tsx` | La lista de la compra: WhatsApp, compartir, copiar, descargar y comprar | «crea una persona y un producto…», «sin portapapeles…» |
| PantryItemDialog, PeopleDialog, PantryBudgetDialog | `components/` | Crear y editar un producto (con la versión con que se abrió: `components/itemEdit.ts`), las personas y el presupuesto | «crea una persona y un producto…» y «dos móviles editan el mismo producto…» |
| OwnerTabs, OwnerSelect, RhythmStatus | `components/owner.tsx`, `components/RhythmStatus.tsx` | Selector de persona y etiqueta del ritmo | los anteriores |

## Estado y datos
- `PantryProvider.tsx` + `pantryContext.ts` (UX-02): el estado de la despensa (personas, productos, ajustes, actividad, tickets y la fecha de hoy) y sus acciones, con `usePantry()`. Lo montan App y GuestApp, sin FinanceProvider, así que dura mientras se cambia de sección. Se carga la primera vez que se abre la Despensa («Cargando la despensa…» solo esa vez); después, DespensaPage lo relee en segundo plano al abrirse y al volver a la pestaña, sin quitar lo que se ve. Una recarga antigua no pisa una escritura más nueva (un contador de escrituras).
- + y −, «Queda», «Queda poco», «Se acabó» y «Lo he comprado» (también en el repaso de la semana) se ven al momento. Cada producto tiene una cola: sus cambios van al servidor de uno en uno y en orden. + y − mandan el paso y el servidor suma sobre su valor (también desde dos móviles a la vez); mientras tanto se enseña lo último del servidor más lo pendiente. Una revisión lleva un id provisional hasta que llega la guardada. Si algo falla, se quita de la pantalla y se avisa. «Deshacer» de una compra sigue comprobando la versión (409).
- `api.ts` (pantryApi) es lo único que hace peticiones: /api/despensa/personas, productos, revisiones, presupuesto, repaso, comprado, actividad y tickets.
- Las acciones de tickets (TicketActions, de la feature tickets) también están en PantryProvider. Guardar un ticket usa los productos que devuelve el servidor (la ventana se cierra tras una sola petición) y relee en segundo plano los tickets y la actividad; cambiar una línea o borrar un ticket recarga toda la despensa.
- El ritmo, los avisos, la lista y el repaso se calculan en la web con `shared/pantry/`, a partir de la actividad (compras de los tickets y revisiones).
- La primera carga enseña un esqueleto con «Cargando la despensa…» (`src/ui/Loading.tsx`). Los cálculos (ritmo, repaso, lista) dependen solo de lo que usan, no de todo el estado (UX-06), y los diálogos de tickets se descargan al abrirlos (`lazyComponent`).
- «Hoy no» del repaso se guarda solo en este navegador (localStorage), hasta mañana. La persona elegida también (`cuentas-claras:despensa-persona`); si ya no existe, se vuelve a «Todo».
- El buscador filtra los productos de la persona elegida por el nombre, sin tildes ni mayúsculas (`matchesName`, en `shared/pantry/pantry.ts`).
- Editar un producto (PAN-01): PantryItemDialog guarda la versión del producto con que se abrió y `updateItem` la envía como `expectedVersion`. Si el servidor responde 409 (alguien lo cambió mientras tanto: otra edición, un + o una compra), el formulario conserva lo escrito y ofrece «Volver a cargar el producto»; `reloadItem` vuelve a leer los productos y el formulario pasa a mostrar el producto como está ahora, con su versión. Nunca se reintenta solo con una versión más nueva: eso pisaría el cambio del otro.

## Textos y accesibilidad
Los e2e usan estos nombres; no los cambies sin cambiar el test:
- botones: «Nuevo producto», «Editar …» (el nombre del producto), «Personas», «Añadir persona», «Guardar producto», «Guardar cambios», «Lista de la compra», «Enviar por WhatsApp», «Copiar», «Marcar todo como comprado», «Deshacer», «Añadir 0,5 kg a Arroz» y «Quitar 0,5 kg de Arroz», «Queda …», «Se acabó …», «Repasar ahora», «Hoy no» y «Terminar»;
- diálogos: «Nuevo producto», «Editar producto», «Personas de casa» y «Lista de la compra»;
- edición en conflicto: el aviso del servidor («Este producto ha cambiado desde que lo abriste (quizá desde otro dispositivo), así que no se ha guardado. Vuelve a cargarlo para ver cómo está ahora.», con role="alert"), el botón «Volver a cargar el producto» y, después, «Este es el producto tal como está ahora. Repite tus cambios y guarda.» (role="status");
- campos y opciones: «Nombre», «De quién es», «Unidad», «Cada cuánto se compra», «Hay ahora», «Quiero tener», «Notas», «Texto de la lista», «Por compras», «Contando», «Todo» y «Buscar producto»;
- lo plegado: «Más detalles» en el formulario del producto (el precio estimado y las notas; abierto si ya tienen algo o hay un error dentro) y «Últimas compras, resumen y presupuesto» (o «Resumen y presupuesto») al final de la página;
- confirmaciones: el diálogo «Eliminar persona» (el botón «Eliminar a …» de «Personas de casa» ya no borra directamente) y «Quitar el presupuesto», con el botón «Quitar presupuesto» (también al vaciar el campo del presupuesto en su ventana);
- sin resultados en el buscador: «Ningún producto se llama «…».» (role="status");
- títulos: «Despensa» (h1) y «Empieza escaneando un ticket».

El foco va al título al cambiar de sección, y las ventanas son `<dialog>` nativos.

## Pruebas
`components/itemEdit.test.ts`: la versión que se envía al editar, qué error es un conflicto y lo que queda tras «Volver a cargar el producto». Las reglas están en `shared/pantry/` (con sus tests) y la API en `server/modules/pantry/`. En el navegador: `npx playwright test e2e/despensa.spec.ts e2e/tickets.spec.ts --project=escritorio`; contra .NET, las mismas con `npm run test:e2e:dotnet` (`e2e/AGENTS.md`).

## Trampas
- La página es la misma para invitado y administrador: no puede usar nada de la feature finance.
- Ya no hay `busyIds`: se puede pulsar + tres veces seguidas (suma tres). Lo que va en orden es la cola de cada producto, en PantryProvider.
- Recargar la página con pasos en la cola pierde los que no habían salido aún: van de uno en uno.
- «Lo he comprado» y «Marcar todo como comprado» apuntan la compra con la fecha del navegador.

## Si cambias esta pantalla
- Textos y roles: `e2e/despensa.spec.ts` y `e2e/tickets.spec.ts`.
- Rutas: `api.ts`, `server/modules/pantry/` y `docs/api.md`.
- Reglas de ritmo, lista o repaso: `shared/pantry/` y sus tests (las usa también el servidor).
