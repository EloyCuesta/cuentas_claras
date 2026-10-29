# shared/ — Dominio compartido

> Lee antes: /AGENTS.md. Un cambio aquí afecta a la web y al servidor a la vez: después, el AGENTS.md de la feature y del módulo que lo usan.

Lógica pura en TypeScript, sin React, sin Express, sin base de datos y sin Node: dinero, fechas, cálculos, validación y la lectura de tickets. La usan la web (`src/`) y el servidor (`server/`), que la importan con `#shared/…`.

## Qué hay

| Carpeta | Qué contiene |
| --- | --- |
| `shared/common/` | `money.ts` (céntimos: leer y formatear), `dates.ts` (fechas `AAAA-MM-DD` y la regla del día 31), `ids.ts` (UUID e instantes), `types.ts` (ISODate) y `validation.ts` (ValidationResult y FieldErrors) |
| `shared/finance/` | `types.ts`, `categories.ts`, `recurring.ts` (vencimientos, cuotas y proyección), `summary.ts`, `annual.ts`, `period.ts`, `filters.ts`, `suggestions.ts`, `backup.ts` (copias y validación de lo que llega a la API), `csv.ts`, `validation.ts` (formularios) y `meta.ts` |
| `shared/pantry/` | `types.ts`, `pantry.ts` (cantidades, lista y estimaciones), `pantryRhythm.ts` (cuánto dura cada producto), `pantryReview.ts` (repaso de la semana) y `pantryValidation.ts` |
| `shared/tickets/` | `types.ts`, `ticketParse.ts` (del texto al ticket), `ticketEvidence.ts`, `ticketArithmetic.ts`, `ticketText.ts`, `ticketMatch.ts` (emparejar con productos) y `ticketValidation.ts` |
| `shared/testing/` | `factories.ts`: movimientos y recurrentes de prueba |

## Reglas que no se rompen

- Solo importa de `shared/`: ningún paquete, nada de `node:*`, ni `Buffer` ni `process` (`tests/architecture.test.ts`). `tsconfig.shared.json` lo compila sin tipos de Node ni de Vite.
- Dependencias entre áreas: `tickets → pantry → common` y `finance → common`. Ninguna otra.
- Dentro de `shared/`, imports relativos (`../common/money.ts`).
- Importes en céntimos enteros y fechas como texto `AAAA-MM-DD`. Nunca `new Date('2026-03-01')` para una fecha de calendario.
- Funciones puras y deterministas: la fecha de hoy y los ids llegan como parámetro (o con `newId`/`nowISO` de `ids.ts`).
- Los mensajes de validación están en español y llegan tal cual a la persona: cambiarlos rompe tests de la API y e2e.

## Pruebas

Cada archivo tiene su `*.test.ts` al lado. Los de tickets leen `fixtures/tickets/` (de dónde sale cada fixture: `docs/pruebas.md`). Solo estas: `npx vitest run shared`, o un área: `npx vitest run shared/tickets`.

## Trampas

- Hay dos ValidationResult: el genérico de `shared/common/validation.ts`, con un mensaje (lo que llega a la API), y el de los formularios de finanzas, en `shared/finance/validation.ts`, con errores por campo.
- `shared/tickets/ticketParse.ts` está afinado para Lidl. El total del ticket nunca decide un importe: lo que no se puede asegurar se marca.
- La huella de un ticket guardado no está aquí, sino en `server/modules/tickets/domain/ticketIdentity.ts`, y no debe cambiar.

## Si cambias algo aquí

Los tests de su área, quien lo usa en la web (`src/features/`) y en el servidor (`server/modules/`), y `docs/glosario.md` si cambia un término.
