# Feature tickets — Tickets de la compra

> Lee antes: /AGENTS.md y src/AGENTS.md. Depende de: `src/api/`, `src/ui/` y `shared/tickets/`. Lo usan: la feature pantry, que abre estos diálogos desde la Despensa y les da las acciones (TicketActions). En el servidor es el módulo tickets (`server/modules/tickets/`).

## Qué ve la persona
«Escanear ticket» en la Despensa abre «Escanear un ticket», y la pantalla se piensa primero para el móvil.

Elegir:
- un consejo (mejor la imagen completa que da Lidl Plus; si no, capturas que se solapen un poco);
- las imágenes en fila, con su número, «Girar» y «Quitar» (girada, cada miniatura gira dentro de su marco);
- con dos o más, antes de leer, si las capturas se solapan («se unirán en una sola imagen») o no («Las capturas 2 y 3 no se solapan…»), si no se pueden unir (distinto tamaño, claras y oscuras, bordes distintos) o si una ya está dentro de otra; mientras se calcula, «Comprobando si las capturas se solapan…»;
- «Leer» en el pie, o se pega el texto.

Leyendo: el paso y los segundos («Uniendo 3 capturas», «Leyendo el ticket… 12 s»).

«Revisar el ticket», por orden:
1. arriba, un resumen (tienda, o «Falta la tienda», fecha y hora, total), el estado del total, cuántas líneas faltan por revisar y cómo se pagó, con los datos editables plegados en «Editar datos del ticket». Si al guardar falla uno de ellos, se abre, el error se ve junto al campo y el foco va a él;
2. «Para revisar», una tarjeta por línea dudosa o emparejada solo por parecido: la línea entera en la imagen (ampliada lo justo para leerla y en el importe), lo leído frente a lo calculado con «Por qué» al lado, y un botón por opción («Sí, es …» si hay que confirmar el producto). Al resolver una, el foco pasa a la siguiente o al resumen;
3. «Productos», una fila por producto, plegada si todo está bien (nunca con un editor abierto), con su editor al tocarla;
4. los ajustes generales, con «Confirmar»;
5. «Texto que no parece un producto», plegado, con «Añadir».

«Guardar ticket» está siempre a la vista, en el pie. «Últimas compras» abre un ticket guardado, donde se puede cambiar a qué producto va cada línea o borrar el ticket.

## Componentes
| Componente | Archivo | Qué hace | Test e2e (`e2e/tickets.spec.ts`) |
| --- | --- | --- | --- |
| TicketScanDialog | `TicketScanDialog.tsx` | Los pasos elegir (miniaturas, aviso de solape y «Leer» en el pie) → leyendo (paso y segundos) → revisar → guardar (con confirmación si hay advertencias) | «lee la captura de un ticket de Lidl, se revisa y se guarda», «une varias capturas con la app alrededor…», «avisa antes de leer cuando las capturas no se pueden unir…», «una foto de 24 MP de lado se gira…» |
| TicketReview | `TicketReview.tsx` | La revisión: resumen y estado, tarjetas dudosas, productos (plegados si todo está bien), ajustes y texto que no parece un producto; el foco tras resolver una tarjeta y tras un error de la cabecera | los mismos, «lee la imagen completa que da Lidl Plus…», «un importe mal leído…», «una fecha a medio escribir en «Editar datos del ticket»…» y «los errores de la cabecera al guardar…» |
| TicketLineCheck, LineSnippet | `TicketLineCheck.tsx` | La tarjeta de una línea dudosa: la línea entera en la imagen (con «Ampliar» y «Reducir»), lo leído frente a lo calculado y «Por qué», el producto por confirmar y las acciones | «un importe mal leído…», «Dejar pendiente…», «una línea emparejada solo por parecido…» |
| TicketDetailDialog | `TicketDetailDialog.tsx` | Un ticket guardado: líneas, cambiar el producto y borrarlo | «lee la captura de un ticket de Lidl…» |
| ticketReviewState | `ticketReviewState.ts` | El estado de la revisión, sin React (estados de cada línea, comprobación y lo que se guarda) | también en `ticketReviewState.test.ts` |
| ticketImages | `ticketImages.ts` | Preparar las imágenes en el navegador (`prepareTicketImages`): girar, unir las capturas que se solapan, recortar al papel, escalar por la altura de las letras, franjas, invertir y contraste; `analyzeTicketImages` avisa antes de leer; `createTicketImageCache`, lo ya calculado para no repetirlo | también en `ticketImages.test.ts` |
| ticketPlan | `ticketPlan.ts` y `ticketPlan.worker.ts` | Qué imágenes se envían a leer (`planCaptures`, una función pura): unir las capturas que se solapan sin perder filas, tratar como repetida la que cabe en otra y avisar de lo que no se puede unir. El Web Worker la calcula fuera del hilo principal | `ticketPlan.test.ts` |
| ticketImageAnalysis | `ticketImageAnalysis.ts` | El cálculo, en funciones puras sobre píxeles en gris: tono y recorte del papel, altura de las letras, pantalla o foto, bandas fijas, solape (de grueso a fino) y orden de las capturas | `ticketImageAnalysis.test.ts` |

## Estado y datos
- Esta feature no hace peticiones ni guarda estado global: los diálogos reciben `actions: TicketActions` (`ticketActions.ts`).
- Las implementa `usePantry` (feature pantry), porque guardar, cambiar o borrar un ticket recarga productos, compras y tickets a la vez. Las peticiones (/api/despensa/tickets/leer, /tickets, /tickets/:id y /tickets/:id/lineas/:lineId) están en el `api.ts` de pantry.
- La dependencia va en un solo sentido: pantry → tickets.

## Textos y accesibilidad
Los e2e usan estos nombres y atributos; no los cambies sin cambiar el test:
- botones:
  - del diálogo: «Escanear ticket», «Leer» (en el pie), «O pega el texto del ticket», «Leer el texto», «Guardar ticket» y «Guardar solo líneas fiables en la despensa»;
  - de una línea dudosa: «Usar 9,90 €», «Usar 92,90 € (leído)», «Sí, es Leche semidesnatada», «Editar», «Dejar pendiente», «Quitar de pendientes», «Listo», «Ampliar» y «Reducir»;
  - de la lista: «Ver los productos (n)» y las filas de producto («Macarrones · 2 líneas · Nuevo…», «… · No se sigue», «… · Ya lo tienes»);
  - de las imágenes: «Girar imagen N» y «Quitar imagen N»;
  - de los ajustes: «Confirmar ajuste N» y «Editar ajuste N»;
- imágenes: «Imagen N» (las elegidas) y «Línea … en la imagen del ticket»;
- grupos y regiones: «Comprobar …» (cada tarjeta dudosa, que recibe el foco al resolver la anterior), «Resumen del ticket» (recibe el foco al resolver la última), «Para revisar» y «Productos» (la cuenta va en su título: «Para revisar (n)», «Productos (n)») y «Ajustes generales»;
- textos: «Leído 92,90 €», «2 × 4,95 € = 9,90 €», «no coincide», «41 líneas suman 91,73 €», «Faltan 2 líneas por revisar», «Falta la tienda», «Se parece a tu producto … ¿Es el mismo?», «Las 4 capturas se solapan: se unirán en una sola imagen.», «Las capturas 1 y 2 no se solapan: puede faltar una parte del ticket.» y «Las imágenes no tienen el mismo tamaño y no se pueden unir: …»;
- errores de la cabecera, junto a su campo: «Escribe el nombre de la tienda.», «Elige una fecha válida para el ticket.», «Escribe una hora válida.» y «El total del ticket no es un importe válido.»;
- campos: «Tienda», «Fecha de la compra», «Hora de la compra», «Total del ticket» (plegados en «Editar datos del ticket»), «Texto del ticket», «Producto de …», «Nombre del producto nuevo», «Es el producto» y «Confirmar línea …»;
- `data-testid="ticket-input"` (el selector de imágenes) y `data-testid="ticket-check"` con `data-status` (la comprobación del total);
- clases que usa `resolveDoubts` en las e2e: `.ticket-line-check--sugerido`, `.ticket-line-check--pendiente` y `.ticket-line-check__head strong`, y `.ticket-editor .ticket-line-editor`.

## Pruebas
- `ticketReviewState.test.ts`, `ticketImages.test.ts`, `ticketPlan.test.ts` y `ticketImageAnalysis.test.ts` (Vitest).
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
- Las franjas pueden ser PNG (pantalla) o JPEG (fotos). Para enseñarlas, cada una lleva la URL local de su Blob (ShownSegment), no la imagen en base64 (hasta 8 MB por tarjeta). Las URL de las franjas y de las imágenes elegidas se liberan al quitar una imagen, al volver a leer y al cerrar.
- El análisis de solapes (con dos imágenes o más) va en un Web Worker (`ticketPlan.worker.ts`, que Vite empaqueta como módulo: `worker.format` en `vite.config.ts`). Si el navegador no puede crearlo, el mismo cálculo va en el hilo principal. Lo que calcula queda en la caché de la ventana (createTicketImageCache): «Leer» lo reutiliza y girar una imagen solo vuelve a preparar esa.
- Una línea que solo pide confirmar su producto (emparejada por parecido) es «Pendiente», tiene su tarjeta y cuenta en «Faltan N».
- El recorte de la línea se abre ampliado para que el renglón mida unos 22 px en pantalla (las mayúsculas, unos 15-16 px), y desplazado hasta el importe.
- Girar no crea nunca un lienzo del tamaño de la foto: el giro va en la transformación del lienzo al dibujar la copia de análisis y cada franja (`drawRotated`), y cada lienzo se libera en un `finally`. Safari no da contexto a un lienzo de más de unos 16,7 millones de píxeles, y una foto de iPhone tiene 24. El e2e lo emula en Chrome.
- La fecha del resumen sale de lo que hay en «Fecha de la compra», que mientras se escribe pasa por valores como «0002-10-28»: solo se formatea una fecha válida (`isValidISODate`). Si aun así algo falla al pintar la ventana, `Dialog` (`src/ui/Dialog.tsx`) enseña un aviso en lugar de tirar la app.
- Los productos se pliegan solo cuando no queda ninguna línea dudosa y no hay ningún editor abierto en la lista; añadir un producto los despliega.

## Si cambias esta pantalla
- Textos o `data-testid`: `e2e/tickets.spec.ts`.
- Lo que se envía al guardar: la validación del servidor (`shared/tickets/ticketValidation.ts`) y `server/modules/tickets/`.
- Las acciones: `TicketActions` y su implementación en `src/features/pantry/usePantry.ts`.
