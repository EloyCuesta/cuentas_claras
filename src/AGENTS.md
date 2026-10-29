# src/ — La web

> Lee antes: /AGENTS.md y `docs/frontend.md`. Después, el AGENTS.md de la feature que vas a tocar.

React 19 con TypeScript, servida por Vite. Organizada por funcionalidades: pocas capas, sin librerías nuevas, React con Context y hooks y la navegación con `#`.

## Qué hay

| Ruta | Qué es |
| --- | --- |
| `src/main.tsx` | Arranque: estilos, ToastProvider, AuthProvider y Root. |
| `src/Root.tsx` | Con el código: FinanceProvider (con la migración del navegador) y App. Sin él: GuestApp. |
| `src/App.tsx` | La app completa: menú, páginas y diálogos de movimientos. |
| `src/GuestApp.tsx` | Vista de invitado: solo la Despensa y «Tengo el código». |
| `src/styles.css` | Todos los estilos (tokens, base, estructura, componentes y páginas). |
| `src/api/` | `client.ts` (apiRequest, ApiError, ServerUnavailableError, onUnauthorized) y `storageErrors.ts` (mensajes para la persona). |
| `src/ui/` | Componentes y utilidades genéricos: Dialog, Section, forms, Icon, Amount, EmptyState, ToastProvider, BudgetMeter, helpers y useHashRoute. |
| `src/features/` | `auth`, `finance`, `pantry` y `tickets`, cada una con su `index.ts` y su AGENTS.md. |
| `src/test/setup.ts` | IndexedDB en memoria para Vitest. |

## Reglas que valen para toda la web

- Una feature importa `src/ui/`, `src/api/`, `shared/` y lo suyo; de otra feature, solo su `index.ts`. `src/ui/` y `src/api/` no importan features. Nada de `server/` (`tests/architecture.test.ts`).
- Solo `src/api/client.ts` y el cliente de cada feature (`api.ts`, o `ApiFinanceRepository.ts`) hacen peticiones; los componentes usan hooks o providers.
- Contextos: `xContext.ts` + `XProvider.tsx` (`react/only-export-components`).
- Mismos textos, etiquetas, roles y `data-testid` que comprueban los e2e (cada feature lista los suyos).
- Importes con `shared/common/money.ts`, fechas con `shared/common/dates.ts`, y la fecha de hoy con `todayISO()` del navegador.
- Estilos: clases `bloque__elemento--modificador` y colores solo con variables de `:root`; el modo oscuro, redefiniendo variables.
- Accesibilidad: etiqueta y error asociados en cada campo, foco en el primer error, `<dialog>` nativos y contraste AA.

## Cómo probar

- `npx vitest run src`: los tests de la web.
- `npm run build`: comprueba los tipos y genera `dist/`.
- `npm run test:e2e`: en el navegador (`e2e/AGENTS.md`).
- `npm run dev`: abre http://localhost:5173, pero usa tus datos reales.

## Trampas

- El invitado y el administrador comparten DespensaPage: no puede depender de FinanceProvider.
- `GuestApp` fuerza `#despensa`; al entrar con el código, AuthProvider pone `#resumen` sin lanzar `hashchange`.
- Un 401 en cualquier petición (salvo /auth) devuelve al modo invitado y desmonta las finanzas.

## Si cambias algo aquí

El AGENTS.md de la feature, `docs/frontend.md` si cambian las reglas, el estado o los estilos comunes, y los e2e si cambia un texto o un rol.
