# Feature tickets — Tickets de la compra

> Lee antes: /AGENTS.md y src/AGENTS.md. Depende de: `src/api/`, `src/ui/` y `shared/tickets/`. Lo usan: la feature pantry, que abre estos diálogos desde la Despensa y les da las acciones (TicketActions). En el servidor es el módulo tickets (`server/modules/tickets/`).

## Qué ve la persona
«Escanear ticket» en la Despensa abre «Escanear un ticket», y la pantalla se piensa primero para el móvil.

Elegir:
- un consejo (mejor la imagen completa que da Lidl Plus; si no, capturas que se solapen un poco);
- las imágenes en fila, con su número, «Girar» y «Quitar»;
- antes de leer, si las capturas se solapan («se unirán en una sola imagen») o no («Las capturas 2 y 3 no se solapan…»);
- «Leer» en el pie, o se pega el texto.

Leyendo: el paso y los segundos («Uniendo 3 capturas», «Leyendo el ticket… 12 s»).

«Revisar el ticket», por orden:
1. arriba, un resumen (tienda, fecha y hora, total), el estado del total y cuántas líneas faltan por revisar, con los datos editables plegados en «Editar datos del ticket»;
2. «Para revisar», una tarjeta por línea dudosa: la línea entera en la imagen, lo leído frente a lo calculado, un botón por opción y la explicación en «Por qué»;
3. «Productos», una fila por producto, plegada si todo está bien, con su editor al tocarla;
4. los ajustes generales, con «Confirmar»;
5. «Texto que no parece un producto», plegado, con «Añadir».

«Guardar ticket» está siempre a la vista, en el pie. «Últimas compras» abre un ticket guardado, donde se puede cambiar a qué producto va cada línea o borrar el ticket.

## Componentes
| Componente | Archivo | Qué hace | Test e2e (`e2e/tickets.spec.ts`) |
| --- | --- | --- | --- |
| TicketScanDialog | `TicketScanDialog.tsx` | Los pasos elegir (miniaturas, aviso de solape y «Leer» en el pie) → leyendo (paso y segundos) → revisar → guardar (con confirmación si hay advertencias) | «lee la captura de un ticket de Lidl, se revisa y se guarda», «une varias capturas con la app alrededor…» |
| TicketReview | `TicketReview.tsx` | La revisión: resumen y estado, tarjetas dudosas, productos (plegados si todo está bien), ajustes y texto que no parece un producto | los mismos, «lee la imagen completa que da Lidl Plus…» y «un importe mal leído…» |
| TicketLineCheck, LineSnippet | `TicketLineCheck.tsx` | La tarjeta de una línea dudosa: la línea entera en la imagen (con «Ampliar»), lo leído frente a lo calculado, las acciones y «Por qué» | «un importe mal leído…», «Dejar pendiente…» |
| TicketDetailDialog | `TicketDetailDialog.tsx` | Un ticket guardado: líneas, cambiar el producto y borrarlo | «lee la captura de un ticket de Lidl…» |
| ticketReviewState | `ticketReviewState.ts` | El estado de la revisión, sin React (estados de cada línea, comprobación y lo que se guarda) | también en `ticketReviewState.test.ts` |
| ticketImages | `ticketImages.ts` | Preparar las imágenes en el navegador (`prepareTicketImages`): girar, unir las capturas que se solapan, recortar al papel, escalar por la altura de las letras, franjas, invertir y contraste; `analyzeTicketImages` avisa antes de leer si dos capturas no se solapan | también en `ticketImages.test.ts` |
| ticketImageAnalysis | `ticketImageAnalysis.ts` | El cálculo, en funciones puras sobre píxeles en gris: tono y recorte del papel, altura de las letras, pantalla o foto, bandas fijas, solape y orden de las capturas | `ticketImageAnalysis.test.ts` |

## Estado y datos
- Esta feature no hace peticiones ni guarda estado global: los diálogos reciben `actions: TicketActions` (`ticketActions.ts`).
- Las implementa `usePantry` (feature pantry), porque guardar, cambiar o borrar un ticket recarga productos, compras y tickets a la vez. Las peticiones (/api/despensa/tickets/leer, /tickets, /tickets/:id y /tickets/:id/lineas/:lineId) están en el `api.ts` de pantry.
- La dependencia va en un solo sentido: pantry → tickets.

## Textos y accesibilidad
Los e2e usan estos nombres y atributos; no los cambies sin cambiar el test:
- botones:
  - del diálogo: «Escanear ticket», «Leer» (en el pie), «O pega el texto del ticket», «Leer el texto», «Guardar ticket» y «Guardar solo líneas fiables en la despensa»;
  - de una línea dudosa: «Usar 9,90 €», «Usar 92,90 € (leído)», «Editar», «Dejar pendiente», «Quitar de pendientes» y «Listo»;
  - de la lista: «Ver los productos (n)» y las filas de producto («Macarrones · 2 líneas · Nuevo…», «… · No se sigue», «… · Ya lo tienes»);
  - de las imágenes: «Girar imagen N» y «Quitar imagen N»;
  - de los ajustes: «Confirmar ajuste N» y «Editar ajuste N»;
- imágenes: «Imagen N» (las elegidas) y «Línea … en la imagen del ticket»;
- grupos y regiones: «Comprobar …» (cada tarjeta dudosa), «Para revisar (n)», «Productos (n)» y «Ajustes generales»;
- textos: «Leído 92,90 €», «2 × 4,95 € = 9,90 €», «no coincide», «41 líneas suman 91,73 €» y «Las 4 capturas se solapan: se unirán en una sola imagen.»;
- campos: «Tienda», «Fecha de la compra», «Hora de la compra», «Total del ticket» (plegados en «Editar datos del ticket»), «Texto del ticket», «Producto de …», «Nombre del producto nuevo», «Es el producto» y «Confirmar línea …»;
- `data-testid="ticket-input"` (el selector de imágenes) y `data-testid="ticket-check"` con `data-status` (la comprobación del total);
- clases que usa `resolveDoubts` en las e2e: `.ticket-line-check--sugerido`, `.ticket-line-check--pendiente` y `.ticket-line-check__head strong`, y `.ticket-editor .ticket-line-editor`.

## Pruebas
- `ticketReviewState.test.ts`, `ticketImages.test.ts` y `ticketImageAnalysis.test.ts` (Vitest).
- La preparación de verdad, en Chrome y con el OCR real: el banco de medida (`tools/banco-tickets/`, `npm run medir:tickets`).
- La lectura del texto, en `shared/tickets/`.
- En el navegador, `e2e/tickets.spec.ts` (con el OCR real del servidor de pruebas): `npx playwright test e2e/tickets.spec.ts --project=escritorio`. Las dos pruebas con el ticket sintético «mediano» (imagen completa y 4 capturas) comprueban en el móvil que el estado y «Guardar ticket» se ven sin desplazarse, que una línea dudosa ocupa como mucho un tercio de pantalla y que, resuelta, la revisión cabe en 3 pantallas.
- Capturas de la interfaz para comparar antes y después: `e2e/capturas-tickets.spec.ts` (solo con CUENTAS_CAPTURAS_DIR).

## Trampas
- Cualquier edición de una línea la deja sin confirmar; las acciones («Usar…», «Confirmar», «Dejar pendiente») dicen ellas mismas cómo queda.
- Las líneas con el mismo nombre normalizado van al mismo producto: si se asocian a productos distintos, no se puede guardar.
- La imagen que se compara es la original; al servidor va una copia preparada, en franjas de como mucho 4096 px de alto. Las capturas que se solapan se unen en una: el `imageIndex` de una franja es el de la imagen unida, no el de la captura elegida.
- La escala sale de la altura de las mayúsculas medida en la imagen (`TARGET_TEXT_HEIGHT`, elegida con el banco de `tools/banco-tickets/`): con letras más grandes Tesseract pierde la columna de importes. Cambiar la preparación cambia la huella de origen (los bytes de las franjas): un ticket ya guardado vuelve a salir como posible duplicado, no como repetido (`server/modules/tickets/tickets.test.ts`).
- El recorte a mano en porcentajes ya no se ofrece: lo sustituye el recorte automático al papel. La opción `crop` de TicketImageOptions sigue existiendo (y validándose) para quien la use.
- Las franjas pueden ser PNG (pantalla) o JPEG (fotos): para enseñarlas, `segmentUrl` de `TicketLineCheck.tsx` pone el tipo correcto.
- Los productos se pliegan solo cuando no queda ninguna línea dudosa; añadir un producto los despliega.

## Si cambias esta pantalla
- Textos o `data-testid`: `e2e/tickets.spec.ts`.
- Lo que se envía al guardar: la validación del servidor (`shared/tickets/ticketValidation.ts`) y `server/modules/tickets/`.
- Las acciones: `TicketActions` y su implementación en `src/features/pantry/usePantry.ts`.
