# Web (frontend)

React 19 con TypeScript, servida por Vite. Está organizada por funcionalidades, con pocas capas, sin librerías de estado ni de rutas y sin arquitectura hexagonal: React con Context y hooks, y la navegación con `#`.

## Estructura

```
src/
├── main.tsx       arranque: estilos, ToastProvider, AuthProvider y Root
├── Root.tsx       con el código, FinanceProvider + App (y la migración del navegador); sin él, GuestApp
├── App.tsx        la app completa: menú, páginas y diálogos de movimientos
├── GuestApp.tsx   el invitado: solo la Despensa y «Tengo el código»
├── styles.css     todos los estilos
├── api/           el cliente de la API y los mensajes de sus errores
├── ui/            componentes y utilidades genéricos
├── features/      auth · finance · pantry · tickets (cada una con su AGENTS.md)
└── test/setup.ts  IndexedDB en memoria para Vitest
```

## Reglas de la web

| Código en… | Puede importar | No puede importar |
| --- | --- | --- |
| `src/api/` | `src/api/`, `shared/` | features ni `src/ui/` |
| `src/ui/` | `src/ui/`, `shared/` y React | features ni `src/api/` |
| `src/features/<f>/` | lo suyo, `src/ui/`, `src/api/` y `shared/`; de otra feature, solo su `index.ts` | el interior de otra feature |
| `main`, `Root`, `App`, `GuestApp` | las features por su `index.ts`, `src/ui/`, `src/api/` y `shared/` | el interior de las features |
| todo `src/` | — | nada de `server/` |

Además, solo `src/api/client.ts` y el cliente de cada feature (`api.ts`, o `ApiFinanceRepository.ts` en finanzas) hacen peticiones: los componentes usan hooks o providers. Lo vigila `tests/architecture.test.ts`.

Hoy las features dependen así: finance → auth (SessionPanel en Ajustes) y pantry → tickets (los diálogos de tickets en la Despensa).

## Estado

- **Sesión** (`src/features/auth/`): AuthProvider pregunta a `/api/auth/me` al abrir y da `role`, `login` y `logout` con `useAuth()`. Cualquier 401 de la API devuelve al modo invitado.
- **Finanzas** (`src/features/finance/`): FinanceProvider solo se monta con el código. Genera los vencimientos al abrir y al cambiar de día, lee todo, da los datos y las acciones con `useFinance()` y vuelve a leer tras cada escritura y cuando otra pestaña avisa (BroadcastChannel).
- **Despensa** (`src/features/pantry/`): `usePantry()`, el mismo para invitado y administrador. Cada escritura refleja lo que confirma el servidor, y al volver a la pestaña se recarga.
- **Avisos**: ToastProvider (`src/ui/`) y `useToast()`, con acción opcional («Deshacer»).
- Patrón de los contextos: `xContext.ts` (el contexto y su hook) + `XProvider.tsx` (el componente), como pide `react/only-export-components`.

## Cliente de la API

`src/api/client.ts`: `apiRequest(método, ruta, cuerpo)` desempaqueta el sobre `{ ok, data }` (`docs/api.md`) y lanza `ApiError` (con el mensaje del servidor, en español), o `ServerUnavailableError` si no hay servidor. `onUnauthorized` avisa de los 401 que no son de `/auth`. `describeStorageError` (`src/api/storageErrors.ts`) convierte cualquier error en un mensaje para la persona. La cookie de sesión es HttpOnly: la página no la ve.

## Navegación

Con el `#` de la URL (`src/ui/useHashRoute.ts`): `#resumen`, `#anual`, `#movimientos`, `#recurrentes`, `#presupuestos`, `#despensa` y `#ajustes`; cualquier otra lleva al resumen. El invitado siempre acaba en `#despensa`. Al cambiar de sección se actualiza el título de la pestaña, se sube arriba y el foco va al título de la página.

## Estilos

- Todo está en `src/styles.css`, en cinco secciones: tokens, base, estructura, componentes y páginas. El orden importa por la cascada.
- La idea es una libreta de cuentas, «tinta y lápiz»: lo real va a tinta (trazo sólido, azul-negro) y lo previsto a lápiz (gris, líneas discontinuas), siempre con su etiqueta. El rojo se reserva para los números negativos y lo vencido.
- Colores, tipografía (Atkinson Hyperlegible, escala ×1,25) y radios son variables de `:root`; los componentes nunca usan un color suelto. El modo oscuro redefine las variables en `@media (prefers-color-scheme: dark)`.
- Clases `bloque__elemento--modificador` (`pantry-item__name`, `btn--primary`).

## Accesibilidad

- Cada campo tiene su etiqueta, y su error asociado (`aria-describedby`). Al enviar con errores, el foco va al primer campo con error (`focusFirstError` en `src/ui/helpers.ts`).
- Ventanas modales nativas (`<dialog>`, en `src/ui/Dialog.tsx`), con el foco dentro y Escape para cerrar.
- Navegable con teclado, con «Saltar al contenido», y avisos con `role="status"` o `role="alert"`.
- Contraste AA en modo claro y oscuro, revisado con axe sin incidencias.
- Los e2e buscan por rol, nombre y etiqueta: un texto de la interfaz es parte del contrato con los tests (cada feature lista los suyos en su AGENTS.md).
