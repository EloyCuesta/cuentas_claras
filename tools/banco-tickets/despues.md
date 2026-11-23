# Tabla «después» del banco de tickets

La lectura de tickets **después** de las fases 0-4, la fusión `c622210`, FIX-01 y FIX-02 ([terminar-el-proyecto.md](../../docs/terminar-el-proyecto.md)). Se ha medido el 23 de noviembre de 2026 con `npm run medir:tickets -- --solo-sinteticos`, en el mismo equipo que la tabla de partida (`partida.md`): Windows 10, Node 24.13, Chrome 158 y tesseract.js 7. Las imágenes son las que dibujó `npm run generar:tickets` ese día en ese equipo (las de las e2e, devueltas a las de git). Los tiempos solo se comparan en el mismo equipo.

En resumen: 625 de 696 líneas limpias y **0 cifras mal sin marcar** (en la partida, 22). Las líneas que no salen limpias van marcadas: la revisión las enseña como dudosas.

Los tickets reales no están todavía: su fila, anonimizada como «real-N», se añade al medirlos (lo hace la persona, `docs/terminar-el-proyecto.md`, PERSONA).

| Caso | Prod. | Limpias | Bien marc. | Mal marc. | **Mal sin marcar** | Faltan | Sobran (rep./otras) | IVA | Fecha | Hora | Total | Ajustes | Estado | Preparar s | Leer s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| corto/capturas-claro | 15 | 13 (87 %) | 2 | 0 | 0 | 0 | 0/0 | 15/15 | ✓ | ✓ | ✓ | ✓ | pendiente | 0.4 | 2.3 |
| corto/capturas-oscuro | 15 | 12 (80 %) | 3 | 0 | 0 | 0 | 0/0 | 15/15 | ✓ | ✓ | ✓ | ✓ | pendiente | 0.3 | 2.2 |
| corto/completa | 15 | 13 (87 %) | 2 | 0 | 0 | 0 | 0/0 | 15/15 | ✓ | ✓ | ✓ | ✓ | pendiente | 0.2 | 2.2 |
| corto/completa-400 | 15 | 14 (93 %) | 1 | 0 | 0 | 0 | 0/0 | 15/15 | ✓ | ✓ | ✓ | ✓ | pendiente | 0.1 | 2.2 |
| corto/whatsapp-claro | 15 | 12 (80 %) | 3 | 0 | 0 | 0 | 0/0 | 15/15 | ✓ | ✓ | ✓ | ✓ | pendiente | 0.4 | 2.5 |
| corto/whatsapp-oscuro | 15 | 14 (93 %) | 1 | 0 | 0 | 0 | 0/0 | 15/15 | ✓ | ✓ | ✓ | ✓ | pendiente | 0.2 | 2.4 |
| grande/capturas-claro | 60 | 56 (93 %) | 4 | 0 | 0 | 0 | 0/0 | 60/60 | ✓ | ✓ | ✓ | ✓ | pendiente | 0.5 | 8.6 |
| grande/capturas-oscuro | 60 | 52 (87 %) | 8 | 0 | 0 | 0 | 0/0 | 60/60 | ✓ | ✓ | ✓ | ✓ | pendiente | 0.5 | 8.7 |
| grande/completa | 60 | 57 (95 %) | 3 | 0 | 0 | 0 | 0/0 | 60/60 | ✓ | ✓ | ✓ | ✓ | pendiente | 0.5 | 8.7 |
| grande/completa-400 | 60 | 54 (90 %) | 5 | 1 | 0 | 0 | 0/0 | 60/60 | ✓ | ✓ | ✓ | ✓ | no_cuadra | 0.2 | 9.4 |
| grande/whatsapp-claro | 60 | 54 (90 %) | 5 | 1 | 0 | 0 | 0/0 | 60/60 | ✓ | ✓ | ✓ | ✓ | pendiente | 0.3 | 10.1 |
| grande/whatsapp-oscuro | 60 | 54 (90 %) | 6 | 0 | 0 | 0 | 0/0 | 60/60 | ✓ | ✓ | ✓ | ✓ | pendiente | 0.3 | 10.0 |
| mediano/capturas-claro | 41 | 38 (93 %) | 3 | 0 | 0 | 0 | 0/0 | 41/41 | ✓ | ✓ | ✓ | ✓ | pendiente | 0.6 | 5.7 |
| mediano/capturas-oscuro | 41 | 36 (88 %) | 5 | 0 | 0 | 0 | 0/0 | 41/41 | ✓ | ✓ | ✓ | ✓ | pendiente | 0.4 | 5.9 |
| mediano/completa | 41 | 38 (93 %) | 3 | 0 | 0 | 0 | 0/0 | 41/41 | ✓ | ✓ | ✓ | ✓ | pendiente | 0.4 | 5.7 |
| mediano/completa-400 | 41 | 35 (85 %) | 6 | 0 | 0 | 0 | 0/0 | 41/41 | ✓ | ✓ | ✓ | ✓ | pendiente | 0.2 | 5.9 |
| mediano/whatsapp-claro | 41 | 36 (88 %) | 4 | 1 | 0 | 0 | 0/0 | 41/41 | ✓ | ✓ | ✓ | ✓ | no_cuadra | 0.2 | 6.7 |
| mediano/whatsapp-oscuro | 41 | 37 (90 %) | 3 | 1 | 0 | 0 | 0/0 | 41/41 | ✓ | ✓ | ✓ | ✓ | pendiente | 0.2 | 6.8 |

18 de 18 casos leídos · 625 de 696 líneas limpias (90 %) · 0 cifras mal sin marcar · 0 productos perdidos · 0 de sobra · leer: 106.2 s en total
