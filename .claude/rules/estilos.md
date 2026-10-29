---
paths:
  - "src/**/*.css"
---
# Estilos
- Colores, tipografía y radios solo con las variables de `:root`; nunca un color suelto.
- El modo oscuro redefine las variables en `@media (prefers-color-scheme: dark)`: comprueba los dos modos y el contraste AA.
- Clases `bloque__elemento--modificador`, en la sección que les toca (tokens, base, estructura, componentes o páginas); el orden importa por la cascada.
- «Tinta y lápiz»: lo real en trazo sólido, lo previsto en gris discontinuo, con su etiqueta; el rojo, solo para lo negativo y lo vencido.
- Que funcione en el móvil: la barra inferior y los botones grandes.
- Detalle: docs/frontend.md y docs/convenciones.md
