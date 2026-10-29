# Convenciones

Cómo se escribe el código de Cuentas claras. Antes de cambiar un archivo, imita el que tienes delante: no hay Prettier, y no se reformatean archivos enteros.

## Idioma

| En inglés | En español |
| --- | --- |
| Identificadores (`AdjustItem`, `priceCents`), archivos y carpetas de código (`server/modules/pantry/`, `usePantry.ts`) | Textos de la interfaz, mensajes de error, comentarios, documentación, nombres de tests y commits |

Las migraciones y los documentos también se nombran en español: `server/migrations/004-repaso.ts`, `docs/base-de-datos.md`. Algunos nombres de la API son españoles porque ya lo eran (`/api/despensa/productos`, `{ codigo }`, `{ hoy }`): no se traducen.

## TypeScript

- `strict`, `noUnusedLocals` y `noUnusedParameters` en todos los tsconfig.
- `erasableSyntaxOnly`: nada de `enum`, `namespace` ni propiedades en el constructor. Se declara el campo y se asigna:

  ```ts
  export class AdjustItem {
    private readonly repository: PantryRepository
    private readonly clock: Clock
    private readonly unitOfWork: UnitOfWork

    constructor(repository: PantryRepository, clock: Clock, unitOfWork: UnitOfWork) {
      this.repository = repository
      this.clock = clock
      this.unitOfWork = unitOfWork
    }
  ```

- `verbatimModuleSyntax`: los tipos se importan con `import type` (o `type` dentro de las llaves: `import { checkQuantity, type QuantityCheck }`).
- Los imports llevan la extensión: `'./ports.ts'`, `'./TicketReview.tsx'`.
- Desde `server/` y `src/`, el dominio compartido se importa con `#shared/…` (campo `imports` de `package.json`): `import { formatEuros } from '#shared/common/money.ts'`. Dentro de `shared/`, los imports son relativos.

## Estilo

- 2 espacios, comillas simples, sin punto y coma y comas finales en las listas de varias líneas.
- Líneas de hasta unos 120 caracteres.
- `npm run lint` (oxlint) tiene que quedar sin avisos.
- Funciones pequeñas con nombre. Comentarios para el porqué, no para el qué:

  ```ts
  // Una sola escritura para todos los productos que se cuentan.
  if (pending.length > 0) this.repository.fillToTarget(pending.map((item) => item.id), this.clock.nowISO())
  ```

## Nombres

| Qué | Cómo | Ejemplo |
| --- | --- | --- |
| Componente de React | `PascalCase.tsx`, un componente principal por archivo | `ShoppingListDialog.tsx` |
| Módulo de funciones | `camelCase.ts` | `ticketReviewState.ts`, `pantryRhythm.ts` |
| Caso de uso | Un archivo y una clase PascalCase, verbo + nombre, con `execute` | `AdjustItem`, `SaveTicket`, `GenerateOccurrences` |
| Lecturas de un módulo | `server/modules/<módulo>/application/queries.ts`, una clase `<Módulo>Queries` | `PantryQueries` |
| Puerto | Por lo que hace | `TicketReader`, `Clock`, `PantryRepository` |
| Adaptador | Tecnología + nombre del puerto | `SqlitePantryRepository`, `SqliteFinanceStore`, `TesseractTicketReader`, `Sha256Hasher` |
| Router | `server/modules/<módulo>/adapters/http/routes.ts` (finanzas reparte los suyos en varios archivos y los monta ahí) | `pantryRoutes(deps)` |
| Contexto de React | `xContext.ts` (contexto y hook) + `XProvider.tsx`, como pide `react/only-export-components` | `authContext.ts` + `AuthProvider.tsx` |
| Test | `<archivo>.test.ts`, junto al código que prueba | `shared/pantry/pantry.test.ts` |

## El comentario de cabecera

Cada archivo empieza (o empieza su export principal) con un comentario `/** … */` en español: qué hace, por qué, y qué reglas sigue o qué no debe hacerse. Ejemplo de `server/modules/pantry/application/AdjustItem.ts`:

```ts
/**
 * Botones + y −: suma o resta sobre la cantidad que hay ahora en el servidor,
 * no sobre la que vio el móvil, así que dos móviles a la vez no se pisan.
 * Nunca baja de cero, y solo g, kg, ml y l admiten decimales.
 */
```

Los componentes complejos (TicketReview, WeeklyReview, ShoppingListDialog, TicketScanDialog) cuentan además por qué estados pasan.

## Dinero y fechas

- Importes siempre en **céntimos enteros**: 12,34 € es `1234`. Nunca se suman decimales. Los formularios leen el texto con `parseAmount` y muestran con `formatEuros` (`shared/common/money.ts`).
- Fechas de calendario como texto `AAAA-MM-DD` (`ISODate`), sin hora ni zona horaria. Se comparan como cadenas y se calculan con `shared/common/dates.ts`, nunca con `new Date('2026-03-01')`.
- La fecha de hoy la pone el **navegador** (`hoy`, `date`, `horizon`). El servidor solo usa la suya (`Clock.today()`) donde ya lo hacía, si no le llega.
- Las marcas de tiempo (`createdAt`, `updatedAt`) son instantes ISO que pone el servidor (`Clock.nowISO()`).

## Mensajes de error

Para la persona que usa la app, en español: qué ha pasado y qué hacer. Viajan tal cual del servidor a la pantalla.

- «Esa persona ya no existe. Vuelve a cargar la despensa.»
- «La categoría tiene movimientos: elige a qué categoría pasarlos.»
- «No se puede deshacer: algún producto ha cambiado o se ha borrado después de la compra (quizá desde otro dispositivo). No se ha tocado nada.»

En el servidor se lanza `AppError(código, mensaje)` (`server/common/errors.ts`); el código decide el estado HTTP (`docs/api.md`). Los mensajes no se cambian sin cambiar los tests que los comprueban.

## CSS

- Clases `bloque__elemento--modificador`: `pantry-item__name`, `btn--primary`, `chip--late`.
- Colores, tipografía y radios solo con las variables de `:root` (`var(--accent)`, `var(--step-1)`). El modo oscuro las redefine en `@media (prefers-color-scheme: dark)`.
- Todo está en `src/styles.css`, por secciones (tokens, base, estructura, componentes y páginas); el orden importa por la cascada. Ver `docs/frontend.md`.

## Commits

En español y pequeños: un paso que se entiende solo, con `npm run check` en verde. El asunto dice qué cambia («Módulo pantry», «Mueve las fixtures de tickets a fixtures/tickets») y el cuerpo explica por qué y qué no cambia.
