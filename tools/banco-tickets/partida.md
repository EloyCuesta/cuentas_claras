# Tabla de partida del banco de tickets

La lectura de tickets **antes de cambiarla**: el código de main del 19 de noviembre de 2026, más el banco y la extracción de `prepareTicketImages` (sin cambios de comportamiento). Se ha medido con `npm run medir:tickets -- --solo-sinteticos` en el equipo de desarrollo: Windows 10, Node 24.13, Chrome 157 y tesseract.js 7. Los tiempos solo se comparan en el mismo equipo.

Los tickets reales no están todavía: su fila, anonimizada como «real-N», se añadirá al medirlos en la etiqueta `banco-partida`.

| Caso | Prod. | Limpias | Bien marc. | Mal marc. | **Mal sin marcar** | Faltan | Sobran (rep./otras) | IVA | Fecha | Hora | Total | Ajustes | Estado | Preparar s | Leer s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| corto/capturas-claro | 15 | 8 (53 %) | 5 | 2 | 0 | 0 | 0/0 | 15/15 | ✓ | ✓ | ✓ | ✓ | no_cuadra | 0.2 | 3.6 |
| corto/capturas-oscuro | 15 | 0 (0 %) | 1 | 12 | **1** | 1 | 0/0 | 0/14 | ✓ | ✓ | ✓ | ✗ | incompleto | 0.2 | 2.6 |
| corto/completa | 15 | 13 (87 %) | 2 | 0 | 0 | 0 | 0/0 | 15/15 | ✓ | ✓ | ✓ | ✓ | pendiente | 0.1 | 2.3 |
| corto/completa-400 | 15 | 14 (93 %) | 0 | 1 | 0 | 0 | 0/0 | 15/15 | ✓ | ✓ | ✓ | ✓ | no_cuadra | 0.3 | 2.2 |
| corto/whatsapp-claro | 15 | 12 (80 %) | 2 | 1 | 0 | 0 | 0/0 | 15/15 | ✓ | ✓ | ✓ | ✓ | no_cuadra | 0.5 | 3.5 |
| corto/whatsapp-oscuro | 15 | 0 (0 %) | 1 | 11 | **2** | 1 | 0/0 | 0/14 | ✓ | ✓ | ✓ | ✗ | incompleto | 0.1 | 2.7 |
| grande/capturas-claro | 60 | 44 (73 %) | 11 | 5 | 0 | 0 | 12/5 | 60/60 | ✓ | ✓ | ✓ | ✗ | incompleto | 0.3 | 8.9 |
| grande/capturas-oscuro | 60 | 0 (0 %) | 6 | 48 | **4** | 2 | 12/6 | 1/58 | ✓ | ✓ | ✓ | ✗ | incompleto | 0.4 | 6.2 |
| grande/completa | 60 | 22 (37 %) | 5 | 29 | **2** | 2 | 0/0 | 25/58 | ✓ | ✓ | ✓ | ✗ | incompleto | 0.3 | 5.7 |
| grande/completa-400 | 60 | 20 (33 %) | 6 | 30 | **2** | 2 | 0/0 | 25/58 | ✓ | ✓ | ✓ | ✗ | incompleto | 0.4 | 5.5 |
| grande/whatsapp-claro | 60 | 57 (95 %) | 2 | 1 | 0 | 0 | 12/5 | 60/60 | ✓ | ✓ | ✓ | ✗ | incompleto | 0.7 | 8.6 |
| grande/whatsapp-oscuro | 60 | 0 (0 %) | 6 | 47 | **5** | 2 | 12/4 | 0/58 | ✓ | ✓ | ✓ | ✗ | incompleto | 0.2 | 6.7 |
| mediano/capturas-claro | 41 | 32 (78 %) | 7 | 2 | 0 | 0 | 7/2 | 41/41 | ✓ | ✓ | ✓ | ✓ | incompleto | 0.3 | 6.4 |
| mediano/capturas-oscuro | 41 | 0 (0 %) | 3 | 34 | **4** | 0 | 7/3 | 0/41 | ✓ | ✓ | ✓ | ✗ | incompleto | 0.3 | 4.5 |
| mediano/completa | 41 | 0 (0 %) | 3 | 38 | 0 | 0 | 0/0 | 0/41 | ✓ | ✓ | ✓ | ✗ | incompleto | 0.3 | 3.6 |
| mediano/completa-400 | 41 | 0 (0 %) | 3 | 38 | 0 | 0 | 0/0 | 0/41 | ✓ | ✓ | ✓ | ✗ | incompleto | 0.3 | 3.7 |
| mediano/whatsapp-claro | 41 | 37 (90 %) | 4 | 0 | 0 | 0 | 7/2 | 41/41 | ✓ | ✓ | ✓ | ✓ | incompleto | 0.5 | 6.4 |
| mediano/whatsapp-oscuro | 41 | 0 (0 %) | 3 | 36 | **2** | 0 | 7/2 | 0/41 | ✓ | ✓ | ✓ | ✗ | incompleto | 0.2 | 4.9 |

18 de 18 casos leídos · 259 de 696 líneas limpias (37 %) · 22 cifras mal sin marcar · 10 productos perdidos · 105 de sobra · leer: 88.0 s en total

## Qué se ve

- **La imagen completa** (1080 px, como la da Lidl Plus) se amplía a 1300 px, y Tesseract pierde la columna de importes:
  - en «mediano» ninguna línea sale limpia;
  - en «grande» se pierden los dos primeros productos, porque el analizador sigue en la cabecera;
  - a 400 px pasa lo mismo, porque también se amplía a 1300.
- **En oscuro**, las capturas pierden casi todo y dejan cifras mal sin marcar. La causa es el fondo oscuro alrededor del papel.
- **Con varias capturas**, la unión por texto repite productos y mete líneas que no son del ticket. Sobran 17 en «grande» y 9 en «mediano».
- **Las cifras mal sin marcar** son las de los puntos 4a-4b de la tarea:
  - una multiplicación con la x pegada al precio («0,95x») se toma como el importe de una unidad;
  - un importe sin coma sale del nombre («SERVILLETAS 1860U» → 18,60 €; «MANTEQUILLA 250G», relectura «2506» → 2,50 €).
