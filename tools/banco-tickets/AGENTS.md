# tools/banco-tickets/ — Banco de medida de los tickets

> Lee antes: /AGENTS.md, `docs/pruebas.md` («El banco de los tickets»), `src/features/tickets/AGENTS.md` (la preparación de las imágenes) y `server/modules/tickets/AGENTS.md` (el lector).

Mide la lectura de tickets de punta a punta, con el mismo camino que la app:
1. prepara las imágenes en Chrome con `src/features/tickets/ticketImages.ts`;
2. las lee con el lector real de Tesseract;
3. las analiza con `parseTicket`;
4. compara cada línea con su verdad.

No es una prueba que pase o falle: da una tabla para decidir cambios con números. Lo que no puede salir nunca es una cifra **mal sin marcar**.

## Qué hay

| Archivo | Qué hace |
| --- | --- |
| `tickets.ts` | Los tickets sintéticos, con datos inventados: grande (60 productos), mediano (41) y corto (15) |
| `verdad.ts` | La verdad de cada ticket (importes, total y desglose de IVA), con el formato del JSON de un ticket real |
| `plantilla.ts` | El ticket como HTML con el formato de Lidl Plus. Tiene dos modos: la imagen completa, y la app alrededor para las capturas |
| `generar.ts` | `npm run generar:tickets`: dibuja las variantes con Playwright y escribe las verdades en `fixtures/tickets/banco/` |
| `medir.ts` | `npm run medir:tickets`: el banco |
| `comparar.ts` | Empareja lo leído con la verdad y clasifica cada línea |
| `informe.ts` | La tabla (solo recuentos y ✓/✗) |
| `navegador.ts` | Arranca el servidor de Vite de `pagina/` y el Chrome de Playwright |
| `pagina/` | La página que prepara las imágenes con el código de la web (`globalThis.banco`). Tiene DOM, así que la comprueba `tsconfig.e2e.json` |
| `tipos.ts`, `rutas.ts` | Lo que se pasan Node y la página, y las carpetas |
| `partida.md` | La tabla de partida, antes de cambiar la lectura |
| `despues.md` | La tabla después de las fases 0-4, FIX-01 y FIX-02, en el mismo equipo |

### Las variantes de cada ticket sintético
- `completa`: la imagen entera que da Lidl Plus, de 1080 px de ancho.
- `completa-400`: la misma, reducida a 400 px.
- `capturas-claro` y `capturas-oscuro`: capturas de 1080 × 2400 con un 22 % de solape. Llevan la app alrededor: barra de estado (con el reloj cambiando), la cabecera «Ticket de compra» y la barra de navegación.
- `whatsapp-claro` y `whatsapp-oscuro`: las mismas capturas, a 720 × 1600 y en JPEG de calidad 0,7.

## Reglas que no se rompen

- **Los tickets reales no salen de su carpeta.** La carpeta es CUENTAS_TICKETS_PRIVADOS (por defecto `C:\tickets-privados` en Windows y ~/tickets-privados en otros sistemas, nunca dentro del repositorio). En la tabla aparecen como «real-1…», con recuentos y ✓/✗; nunca un nombre, un importe, la fecha ni la dirección. Su detalle se escribe solo en la carpeta resultados que hay dentro de ella. Nada de ella se copia al repositorio, a un commit ni a la documentación.
- **Los datos sintéticos son inventados**: productos, tiendas, números de operación y tarjetas. Cada verdad lleva su `provenance`.
- **Lo mismo que la app.** La preparación es la de `ticketImages.ts` (`prepareTicketImages`, con las opciones por defecto). El lector es `createTesseractReader` y el análisis, `parseTicket`, como `server/modules/tickets/application/ReadTicket.ts`. Si cambia ese camino, cambia aquí.
- **Una sola regla de arquitectura** (`tests/architecture.test.ts`): solo importa su carpeta, `shared/` y `server/modules/tickets/index.ts`. La página, además, `src/features/tickets/ticketImages.ts`.
- **Sin dependencias nuevas**: Playwright, Vite y tesseract.js ya están.

## Cómo se usa

```bash
npm run generar:tickets                              # imágenes y verdades (unos 10 s)
npm run medir:tickets                                # todos los casos (unos minutos)
npm run medir:tickets -- --caso mediano/whatsapp     # solo los que contienen ese texto
npm run medir:tickets -- --solo-sinteticos --guardar tools/banco-tickets/partida.md
```

- Las imágenes se generan en `.banco-tickets/imagenes/` y el detalle de cada medición va a `.banco-tickets/resultados/`. Las dos carpetas están fuera de git.
- En git van las verdades y las imágenes de las e2e (las de «mediano», en `fixtures/tickets/banco/`).
- Chrome: con CUENTAS_E2E_CHANNEL, como las e2e; sin ella, se usa el Chromium de Playwright o, si no está, el Chrome instalado.

## Cómo se lee la tabla

- **Limpias**: bien leídas y sin marcar.
- **Bien marc.**: bien, pero la revisión la enseña como dudosa.
- **Mal marc.**: alguna cifra mal, pero marcada.
- **Mal sin marcar**: el fallo que no puede pasar. Una cifra es el importe, la cantidad, el precio unitario, el peso, el precio por kilo o el descuento. Cuenta también una línea de más (repetida o que no es un producto) que no va marcada.
- **Faltan**: productos que no salen.
- **Sobran**: líneas de más, repetidas o que no son productos.
- **IVA**: la letra bien sobre las líneas emparejadas.
- **Fecha**, **Hora**, **Total** y **Ajustes**: si están bien.
- **Estado**: el de la comprobación del total.
- **Preparar** y **Leer**: segundos en el navegador y en el lector.

Una PROMO de la verdad vale como ajuste o como descuento de la línea de encima.

## Pruebas

- `comparar.test.ts`: el emparejamiento, las clases, la PROMO y que la tabla no enseña nombres ni importes.
- `verdad.test.ts`: las verdades guardadas son las de `tickets.ts`, las cuentas cuadran, el analizador acepta el desglose dibujado y el formato es de 42 columnas.

## Trampas

- `generar.ts` borra y rehace las imágenes de cada ticket. Si cambias `tickets.ts` o `plantilla.ts`, regenera y vuelve a medir; `verdad.test.ts` avisa si las verdades guardadas quedan atrás.
- Dibujar depende de las fuentes del equipo (Consolas o DejaVu Sans Mono): en otro equipo las imágenes pueden cambiar un poco. Las de las e2e van en git para que no cambien.
- También pueden cambiar en el mismo equipo, por ejemplo al actualizarse Chrome: el 23 de noviembre (Chrome 158) las cinco de las e2e salieron con otros bytes que las de git. `npm run generar:tickets` las reescribe en `fixtures/tickets/banco/`: si no quieres cambiar las e2e, devuélvelas a git (`git checkout -- fixtures/tickets/banco/`). Para comparar dos versiones del código, mide las dos con las mismas imágenes.
- El primer uso del lector tarda en abrirse: el banco lo abre antes con el ticket de ejemplo y no lo cuenta.

## Si cambias algo aquí

`docs/pruebas.md` si cambia cómo se mide, este archivo, y `tests/architecture.test.ts` si cambia lo que importa.
