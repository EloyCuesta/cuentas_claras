# Cuentas claras — Guía para agentes

## Qué es
Una app web para una sola persona: ingresos, gastos y próximos pagos, y la despensa de casa (productos por persona, tickets leídos con OCR local, ritmo de compra, repaso de la semana y lista de la compra). Se usa en local y desde el móvil por la red de casa, y tiene que ser fácil de usar. Lo que hace, para personas, está en `README.md`.

## Antes de tocar nada
1. Este archivo.
2. `docs/convenciones.md`: cómo se escribe el código.
3. El AGENTS.md de cada zona que vas a tocar y el de sus dependencias (tabla de abajo).
4. Sus tests.
5. `npm run check`, para saber de qué estado partes.

## Mapa del repositorio
```
server/        el servidor: Express + SQLite (server/AGENTS.md)
  common/      lo transversal: errores, HTTP, SQLite, puertos comunes, ayudantes de tests
  migrations/  el esquema de la base de datos (server/migrations/AGENTS.md)
  modules/     auth · finance · pantry · tickets · health, cada uno con su AGENTS.md
  data/        cuentas.db: los datos de la persona (fuera de git; no se lee)
shared/        lógica pura que usan la web y el servidor (shared/AGENTS.md)
src/           la web: React por funcionalidades (src/AGENTS.md)
  features/    auth · finance · pantry · tickets, cada una con su AGENTS.md
e2e/           pruebas en el navegador (e2e/AGENTS.md)
tests/         tests de arquitectura y de documentación
fixtures/      tickets de prueba (inventados o sintéticos)
docs/          lo transversal: convenciones, arquitectura, api, base de datos, pruebas, frontend, glosario y decisiones
.claude/       permisos de los agentes y reglas por tipo de archivo
```

## Si vas a tocar… lee…
| Si vas a tocar… | Lee |
| --- | --- |
| `server/modules/auth/` | su AGENTS.md, `src/features/auth/AGENTS.md` y `docs/api.md` (acceso) |
| `server/modules/finance/` | su AGENTS.md, `shared/AGENTS.md` y `docs/base-de-datos.md` |
| `server/modules/pantry/` | su AGENTS.md y el de `server/modules/tickets/` (lo usa a través de PantryGateway) |
| `server/modules/tickets/` | su AGENTS.md, el de `server/modules/pantry/` (del que depende) y `docs/decisiones.md` (OCR local) |
| `server/modules/health/` | su AGENTS.md |
| `server/common/` o `server/app.ts` | `server/AGENTS.md` y `docs/arquitectura.md` |
| `server/migrations/` | `server/migrations/AGENTS.md` y `docs/base-de-datos.md` |
| `shared/` | `shared/AGENTS.md`: el cambio afecta a la web y al servidor |
| `src/features/auth/` | su AGENTS.md y `src/AGENTS.md` |
| `src/features/finance/` | su AGENTS.md, `src/AGENTS.md` y `server/modules/finance/AGENTS.md` |
| `src/features/pantry/` | su AGENTS.md, el de `src/features/tickets/` (abre sus diálogos) y `server/modules/pantry/AGENTS.md` |
| `src/features/tickets/` | su AGENTS.md, el de `src/features/pantry/` (implementa TicketActions) y `server/modules/tickets/AGENTS.md` |
| `src/ui/`, `src/api/` o la raíz de `src/` | `src/AGENTS.md` y `docs/frontend.md` |
| `src/styles.css` | `docs/frontend.md` (estilos) y `docs/convenciones.md` (CSS) |
| `e2e/` o `playwright.config.ts` | `e2e/AGENTS.md` y `docs/pruebas.md` |
| un test (`*.test.ts`) | `docs/pruebas.md` |
| `docs/`, un AGENTS.md o `.claude/` | la sección «Mantener la documentación», abajo |

## Reglas que no se rompen
- **Mismo comportamiento.** Mismas rutas, métodos, cuerpos, respuestas y códigos HTTP. El sobre es siempre `{ ok, data }` / `{ ok: false, error: { code, message } }`, con los mensajes en español (`docs/api.md`).
- **Acceso.** Salud, acceso, despensa y tickets son públicos; lo financiero va detrás de `requireAdmin`.
  - Cookie HttpOnly `cc_sesion`, con sesiones en memoria de 12 h.
  - 5 fallos desde una IP bloquean 15 minutos, con `trust proxy` solo para loopback.
  - Sin un `CUENTAS_CODIGO` válido, el servidor no arranca.
- **Base de datos.** Una migración publicada no se edita; los cambios van en una nueva (`docs/base-de-datos.md`). Ningún test ni agente toca `server/data/`.
- **Atomicidad.** Cada operación que escribe es una transacción síncrona (`docs/arquitectura.md`).
  - + y − suman sobre el valor del servidor.
  - «Deshacer» comprueba `version` (409).
  - Un vencimiento no existe dos veces.
  - Guardar un ticket es todo o nada.
- **Datos.** Importes en céntimos enteros y fechas `AAAA-MM-DD`. La fecha de hoy la manda el navegador. El OCR es local, las imágenes no se guardan y nada sale a Internet.
- **Interfaz.** Mismos textos, etiquetas, roles y `data-testid`, mismo aspecto en claro y oscuro, y navegación con `#` (`docs/frontend.md`).
- **Arquitectura.** Las capas y quién importa a quién (`docs/arquitectura.md`, `docs/frontend.md`) las vigila `tests/architecture.test.ts`.
- **Dependencias.** Ninguna nueva sin preguntar. Nada de contenedores de inyección, ORM ni librerías de estado o de rutas.
- **TypeScript.**
  - `strict`, `erasableSyntaxOnly`: sin `enum`, `namespace` ni propiedades en el constructor.
  - `verbatimModuleSyntax`: `import type` para los tipos.
  - Imports con extensión `.ts`.

## Comandos
```bash
npm install                      # y copiar .env.example como .env con el código (README)
npm run dev                      # web en :5173 y API en :3001 (con TUS datos de server/data/)
npm run check                    # tipos + oxlint + Vitest: siempre en verde
npm test                         # solo Vitest
npx vitest run shared/pantry     # una carpeta, un archivo o, con -t "nombre", un test
npm run build                    # tipos y la web en dist/
npm run test:e2e                 # navegador (CUENTAS_E2E_CHANNEL=chrome si no hay Chromium)
npx playwright test e2e/tickets.spec.ts --project=escritorio
```
Para probar el servidor a mano sin tocar tus datos, usa `CUENTAS_DB_PATH` apuntando a una carpeta temporal (`server/AGENTS.md`).

## Terminado significa
- `npm run check` y `npm run test:e2e` en verde, con al menos los mismos tests que antes.
- Las reglas de arquitectura se cumplen (las comprueba `tests/architecture.test.ts`).
- Cada zona tiene su AGENTS.md al día, con su CLAUDE.md al lado, y `tests/docs.test.ts` pasa.
- Sin dependencias nuevas, sin cambios de comportamiento ni de textos de la interfaz que no se hayan pedido, y sin datos reales.
- Un resumen de lo que ha cambiado, lo que no, los errores encontrados y lo que no se ha podido comprobar.

## Mantener la documentación
- Cada explicación vive en un solo sitio; los demás enlazan.
- Las rutas entre comillas invertidas deben existir: `tests/docs.test.ts` lo comprueba. Si citas algo que ya no existe, escríbelo sin comillas invertidas.

| Si cambias… | Actualiza |
| --- | --- |
| una ruta, un cuerpo o un mensaje de la API | el AGENTS.md del módulo, `docs/api.md` y el cliente de la feature |
| un caso de uso (nuevo o renombrado) | la tabla «Casos de uso y rutas» del AGENTS.md del módulo |
| una tabla o una migración | `docs/base-de-datos.md` y `server/migrations/AGENTS.md` |
| las capas o la composición | `docs/arquitectura.md` y `tests/architecture.test.ts` |
| un texto, rol o `data-testid` de la interfaz | el AGENTS.md de la feature y los e2e |
| un término | `docs/glosario.md` |
| una decisión de diseño | `docs/decisiones.md` |
| cómo se prueba | `docs/pruebas.md` |
| lo que hace la app para las personas | `README.md` |
| un módulo o una feature nuevos | su AGENTS.md y su CLAUDE.md, la tabla «Si vas a tocar… lee…» y `tests/architecture.test.ts` |

Plantilla del AGENTS.md de un módulo: Qué hace · Acceso · API pública (index.ts) · Casos de uso y rutas · Puertos · Reglas que no se rompen · Datos · Pruebas · Trampas y decisiones · Si cambias este módulo. Plantilla del de una feature: Qué ve la persona · Componentes · Estado y datos · Textos y accesibilidad · Pruebas · Trampas · Si cambias esta pantalla. Junto a cada AGENTS.md va un CLAUDE.md que solo contiene `@AGENTS.md`: así Claude Code lo carga solo. No lo borres por parecer duplicado.
