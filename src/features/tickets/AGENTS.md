# Feature tickets — Tickets de la compra

> Lee antes: /AGENTS.md y src/AGENTS.md. Depende de: `src/api/`, `src/ui/` y `shared/tickets/`. Lo usan: la feature pantry, que abre estos diálogos desde la Despensa y les da las acciones (TicketActions). En el servidor es el módulo tickets (`server/modules/tickets/`).

## Qué ve la persona
«Escanear ticket» en la Despensa abre «Escanear un ticket»: se eligen las capturas o se pega el texto, se lee y se revisa en «Revisar el ticket». Ahí se ve la tienda, la fecha, el total, si cuadra y cada producto con su importe, con las líneas dudosas a la vista. «Últimas compras» abre un ticket guardado, donde se puede cambiar a qué producto va cada línea o borrar el ticket.

## Componentes
| Componente | Archivo | Qué hace | Test e2e (`e2e/tickets.spec.ts`) |
| --- | --- | --- | --- |
| TicketScanDialog | `TicketScanDialog.tsx` | Los pasos elegir → leyendo → revisar → guardar (con confirmación si hay advertencias) | «lee la captura de un ticket de Lidl, se revisa y se guarda» |
| TicketReview | `TicketReview.tsx` | El formulario de la revisión: cabecera, comprobación del total, apartados y líneas | el mismo y «un importe mal leído…» |
| TicketLineCheck, LineSnippet | `TicketLineCheck.tsx` | La comprobación de una línea dudosa: trozo de imagen, lectura, cálculo y acciones | «un importe mal leído…», «Dejar pendiente…» |
| TicketDetailDialog | `TicketDetailDialog.tsx` | Un ticket guardado: líneas, cambiar el producto y borrarlo | «lee la captura de un ticket de Lidl…» |
| ticketReviewState | `ticketReviewState.ts` | El estado de la revisión, sin React (estados de cada línea, comprobación y lo que se guarda) | también en `ticketReviewState.test.ts` |
| ticketImages | `ticketImages.ts` | Preparar las imágenes en el navegador: girar, recortar, franjas y contraste | también en `ticketImages.test.ts` |

## Estado y datos
- Esta feature no hace peticiones ni guarda estado global: los diálogos reciben `actions: TicketActions` (`ticketActions.ts`).
- Las implementa `usePantry` (feature pantry), porque guardar, cambiar o borrar un ticket recarga productos, compras y tickets a la vez. Las peticiones (/api/despensa/tickets/leer, /tickets, /tickets/:id y /tickets/:id/lineas/:lineId) están en el `api.ts` de pantry.
- La dependencia va en un solo sentido: pantry → tickets.

## Textos y accesibilidad
Los e2e usan estos nombres y atributos; no los cambies sin cambiar el test:
- botones: «Escanear ticket», «Leer imágenes», «O pega el texto del ticket», «Leer el texto», «Guardar ticket», «Guardar solo líneas fiables en la despensa», «Usar 9,90 €», «Usar 92,90 € (leído)», «Editar», «Dejar pendiente», «Quitar de pendientes» y «Listo»;
- campos: «Tienda», «Fecha de la compra», «Total del ticket», «Texto del ticket», «Producto de …», «Nombre del producto nuevo», «Es el producto», «Confirmar línea …» y «Confirmar ajuste 1»;
- `data-testid="ticket-input"` (el selector de imágenes) y `data-testid="ticket-check"` con `data-status` (la comprobación del total).

## Pruebas
- `ticketReviewState.test.ts` y `ticketImages.test.ts` (Vitest).
- La lectura del texto, en `shared/tickets/`.
- En el navegador, `e2e/tickets.spec.ts` (con el OCR real del servidor de pruebas): `npx playwright test e2e/tickets.spec.ts --project=escritorio`.

## Trampas
- Cualquier edición de una línea la deja sin confirmar; las acciones («Usar…», «Confirmar», «Dejar pendiente») dicen ellas mismas cómo queda.
- Las líneas con el mismo nombre normalizado van al mismo producto: si se asocian a productos distintos, no se puede guardar.
- La imagen que se compara es la original; al servidor va una copia preparada, en franjas de como mucho 4096 px de alto.

## Si cambias esta pantalla
- Textos o `data-testid`: `e2e/tickets.spec.ts`.
- Lo que se envía al guardar: la validación del servidor (`shared/tickets/ticketValidation.ts`) y `server/modules/tickets/`.
- Las acciones: `TicketActions` y su implementación en `src/features/pantry/usePantry.ts`.
