# Feature pantry — Despensa

> Lee antes: /AGENTS.md y src/AGENTS.md. Depende de: `src/api/`, `src/ui/`, `shared/pantry/` y la feature tickets (sus diálogos y TicketActions, por su index.ts). Lo usan: `src/App.tsx` (con el código) y `src/GuestApp.tsx` (invitado): es la misma página para los dos. En el servidor son los módulos pantry y tickets.

## Qué ve la persona
La Despensa:
- arriba, «Escanear ticket», «Lista de la compra (n)» y «Nuevo producto», y el aviso del repaso de la semana;
- el selector de persona («Todo», «Compartido» o cada persona) y «Personas»;
- lo que conviene revisar, las últimas compras y el resumen con la estimación mensual y el presupuesto;
- los productos por frecuencia, con «Queda», «Se acabó», «Lo he comprado» o − y +, según cómo se sigan.

Sin el código es lo único que se ve.

## Componentes
| Componente | Archivo | Qué hace | Test e2e |
| --- | --- | --- | --- |
| DespensaPage | `DespensaPage.tsx` | La página: estado, avisos con «Deshacer» y qué diálogo está abierto | `e2e/despensa.spec.ts` y `e2e/tickets.spec.ts` |
| PantryRow | `components/PantryRow.tsx` | Un producto: estado, última compra, botones y + / − | «los botones + y −, marcar como comprado y deshacer» y «dos móviles pulsan + a la vez y el servidor suma los dos» |
| ReviewBlock | `components/ReviewBlock.tsx` | «Para revisar»: lo que se acerca a lo que suele durar | «días después: qué toca revisar…» |
| RecentTickets | `components/RecentTickets.tsx` | «Últimas compras»: los tickets guardados | «lee la captura de un ticket de Lidl…» |
| SummaryBlock, BudgetBlock | `components/SummaryBlock.tsx`, `components/BudgetBlock.tsx` | Lo que falta, la estimación mensual y el presupuesto | — |
| WeeklyReviewCard, WeeklyReviewDialog | `components/WeeklyReview.tsx` | El repaso de la semana, producto a producto | «repaso de la semana: «Hoy no»…» |
| ShoppingListDialog | `components/ShoppingListDialog.tsx` | La lista de la compra: WhatsApp, compartir, copiar, descargar y comprar | «crea una persona y un producto…», «sin portapapeles…» |
| PantryItemDialog, PeopleDialog, PantryBudgetDialog | `components/` | Crear y editar un producto (con la versión con que se abrió: `components/itemEdit.ts`), las personas y el presupuesto | «crea una persona y un producto…» y «dos móviles editan el mismo producto…» |
| OwnerTabs, OwnerSelect, RhythmStatus | `components/owner.tsx`, `components/RhythmStatus.tsx` | Selector de persona y etiqueta del ritmo | los anteriores |

## Estado y datos
- `usePantry.ts`: el estado de la despensa (personas, productos, ajustes, actividad, tickets y la fecha de hoy) y sus acciones. Lo usan igual el invitado y el administrador, sin FinanceProvider. Al volver a la pestaña se recarga. Una recarga antigua no pisa una escritura más nueva (contador `writes`).
- `api.ts` (pantryApi) es lo único que hace peticiones: /api/despensa/personas, productos, revisiones, presupuesto, repaso, comprado, actividad y tickets.
- Las acciones de tickets (TicketActions, de la feature tickets) también están en usePantry: guardar, cambiar o borrar un ticket recarga toda la despensa.
- El ritmo, los avisos, la lista y el repaso se calculan en la web con `shared/pantry/`, a partir de la actividad (compras de los tickets y revisiones).
- «Hoy no» del repaso se guarda solo en este navegador (localStorage), hasta mañana.
- Editar un producto (PAN-01): PantryItemDialog guarda la versión del producto con que se abrió y `updateItem` la envía como `expectedVersion`. Si el servidor responde 409 (alguien lo cambió mientras tanto: otra edición, un + o una compra), el formulario conserva lo escrito y ofrece «Volver a cargar el producto»; `reloadItem` vuelve a leer los productos y el formulario pasa a mostrar el producto como está ahora, con su versión. Nunca se reintenta solo con una versión más nueva: eso pisaría el cambio del otro.

## Textos y accesibilidad
Los e2e usan estos nombres; no los cambies sin cambiar el test:
- botones: «Nuevo producto», «Editar …» (el nombre del producto), «Personas», «Añadir persona», «Guardar producto», «Guardar cambios», «Lista de la compra», «Enviar por WhatsApp», «Copiar», «Marcar todo como comprado», «Deshacer», «Añadir 0,5 kg a Arroz» y «Quitar 0,5 kg de Arroz», «Queda …», «Se acabó …», «Repasar ahora», «Hoy no» y «Terminar»;
- diálogos: «Nuevo producto», «Editar producto», «Personas de casa» y «Lista de la compra»;
- edición en conflicto: el aviso del servidor («Este producto ha cambiado desde que lo abriste (quizá desde otro dispositivo), así que no se ha guardado. Vuelve a cargarlo para ver cómo está ahora.», con role="alert"), el botón «Volver a cargar el producto» y, después, «Este es el producto tal como está ahora. Repite tus cambios y guarda.» (role="status");
- campos y opciones: «Nombre», «De quién es», «Unidad», «Cada cuánto se compra», «Hay ahora», «Quiero tener», «Notas», «Texto de la lista», «Por compras», «Contando» y «Todo»;
- títulos: «Despensa» (h1) y «Empieza escaneando un ticket».

El foco va al título al cambiar de sección, y las ventanas son `<dialog>` nativos.

## Pruebas
`components/itemEdit.test.ts`: la versión que se envía al editar, qué error es un conflicto y lo que queda tras «Volver a cargar el producto». Las reglas están en `shared/pantry/` (con sus tests) y la API en `server/modules/pantry/`. En el navegador: `npx playwright test e2e/despensa.spec.ts e2e/tickets.spec.ts --project=escritorio`; contra .NET, los marcados con @dotnet (`e2e/AGENTS.md`).

## Trampas
- La página es la misma para invitado y administrador: no puede usar nada de la feature finance.
- Una acción cada vez por producto (`busyIds`): la siguiente espera a la respuesta del servidor.
- «Lo he comprado» y «Marcar todo como comprado» apuntan la compra con la fecha del navegador.

## Si cambias esta pantalla
- Textos y roles: `e2e/despensa.spec.ts` y `e2e/tickets.spec.ts`.
- Rutas: `api.ts`, `server/modules/pantry/` y `docs/api.md`.
- Reglas de ritmo, lista o repaso: `shared/pantry/` y sus tests (las usa también el servidor).
