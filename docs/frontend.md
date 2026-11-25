# Web (frontend)

React 19 con TypeScript, servida por Vite. Está organizada por funcionalidades, con pocas capas, sin librerías de estado ni de rutas y sin arquitectura hexagonal: React con Context y hooks, y la navegación con `#`.

## Estructura

```
src/
├── main.tsx       arranque: estilos, ToastProvider, AuthProvider, LoadBoundary y Root
├── Root.tsx       con el código, AdminApp (se descarga aparte); sin él, GuestApp
├── AdminApp.tsx   FinanceProvider + App (y la migración del navegador), en su propio archivo JS
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
| `main`, `Root`, `AdminApp`, `App`, `GuestApp` | las features por su `index.ts`, `src/ui/`, `src/api/` y `shared/` | el interior de las features |
| todo `src/` | — | nada de `server/` |

Además, solo `src/api/client.ts` y el cliente de cada feature (`api.ts`, o `ApiFinanceRepository.ts` en finanzas) hacen peticiones: los componentes usan hooks o providers. Lo vigila `tests/architecture.test.ts`.

Hoy las features dependen así: finance → auth (SessionPanel en Ajustes) y pantry → tickets (los diálogos de tickets en la Despensa).

## Estado

- **Sesión** (`src/features/auth/`): AuthProvider pregunta a `/api/auth/me` al abrir y da `role`, `login` y `logout` con `useAuth()`. Cualquier 401 de la API devuelve al modo invitado.
- **Finanzas** (`src/features/finance/`): FinanceProvider solo se monta con el código. Genera los vencimientos al abrir y al cambiar de día, lee todo, da los datos y las acciones con `useFinance()` y vuelve a leer tras cada escritura (en segundo plano: el cambio entra antes en pantalla, UX-01) y cuando otra pestaña avisa (BroadcastChannel).
- **Despensa** (`src/features/pantry/`): PantryProvider (montado en App y en GuestApp) y `usePantry()`, el mismo para invitado y administrador. Dura entre secciones; + / − y las revisiones se ven al momento y van al servidor en una cola por producto; al volver a la Despensa o a la pestaña se relee en segundo plano (UX-02).
- **Avisos**: ToastProvider (`src/ui/`) y `useToast()`, con acción opcional («Deshacer») y tres tonos: `success`, `warning` (algo quedó a medias pero no hay que repetirlo, con los colores de aviso) y `error`.
- Patrón de los contextos: `xContext.ts` (el contexto y su hook) + `XProvider.tsx` (el componente), como pide `react/only-export-components`.

## Carga y peso (UX-06)

- **Archivos aparte**, con `lazyComponent` (`src/ui/lazyComponent.tsx`):
  - AdminApp (las cuentas y App): el invitado no descarga las finanzas;
  - los diálogos de tickets: `src/features/tickets/index.ts` los exporta ya así, y la Despensa sigue entrando por el `index.ts`;
  - el formulario de un recurrente, las copias de seguridad y el editor de categorías, dentro de la propia feature finance.

  `lazyComponent` hace lo mismo que React.lazy: un `import()` dinámico, y Vite saca un archivo aparte. La diferencia es que no usa `<Suspense>`, porque React retrasa unos 300 ms (FALLBACK_THROTTLE_MS) lo que llega después del «fallback»: con React.lazy, abrir las cuentas pasaba de unos 90 ms a unos 860 ms. Las páginas no se cargan así, porque al cambiar de sección el foco va a su título.
- **Mientras carga**: `src/ui/Loading.tsx` tiene los esqueletos, con el texto de carga de siempre visible y con `role="status"` («Abriendo Cuentas claras…», «Abriendo tus cuentas…», «Cargando la despensa…», «Cargando las copias de seguridad…», «Cargando las categorías…»), y LoadBoundary, para cuando un archivo no llega.
- **La fuente**: solo el subconjunto latino de Atkinson Hyperlegible Next, declarado en `src/styles.css` (sección 1) y con `preload` en `index.html`. Los dos apuntan al mismo archivo del paquete, y Vite les da el mismo nombre con su huella.
- **`index.html`**:
  - la descripción, `theme-color` en claro y oscuro;
  - el manifest (`public/manifest.webmanifest`), con el icono SVG, los PNG de 192 y 512 px, uno «maskable» y el `apple-touch-icon`.

  Sin service worker: la app va por HTTP en casa (`docs/decisiones.md`).
- **Listas**:
  - Movimientos filtra con `useDeferredValue`: lo escrito en la búsqueda se ve al momento y la lista llega después;
  - en la Despensa, cada cálculo depende solo de lo que usa, no de todo el estado.

## Cliente de la API

`src/api/client.ts`: `apiRequest(método, ruta, cuerpo)` desempaqueta el sobre `{ ok, data }` (`docs/api.md`) y lanza `ApiError` (con el mensaje del servidor, en español), o `ServerUnavailableError` si no hay servidor. `onUnauthorized` avisa de los 401 que no son de `/auth`. `describeStorageError` (`src/api/storageErrors.ts`) convierte cualquier error en un mensaje para la persona. La cookie de sesión es HttpOnly: la página no la ve.

## Navegación

Con el `#` de la URL (`src/ui/useHashRoute.ts`): `#resumen`, `#anual`, `#movimientos`, `#recurrentes`, `#presupuestos`, `#despensa` y `#ajustes`; cualquier otra lleva al resumen. El invitado siempre acaba en `#despensa`. Al cambiar de sección se actualiza el título de la pestaña, se sube arriba y el foco va al título de la página.

El menú (`src/App.tsx`) tiene seis secciones en el lateral del escritorio. En la barra inferior del móvil hay cinco (Resumen, Movimientos, Recurrentes, Despensa y Ajustes), con letra de 12 px y sin partir palabras. Presupuestos se abre desde su bloque del Resumen, y mientras está abierta se resalta «Resumen» (`nav__link--within`), como en `#anual` (UX-04).

## Estilos

- Todo está en `src/styles.css`, en secciones numeradas: tokens, base, estructura, componentes, páginas, código de acceso y despensa, tickets y ritmo de compra, repaso de la semana, revisión de un ticket, pantallas táctiles y utilidades. El orden importa por la cascada: las dos últimas van al final para que prevalezcan.
- Con el dedo (`@media (pointer: coarse)`, la sección «Pantallas táctiles»), lo que se toca a menudo mide al menos 44 px: botones pequeños, enlaces con aspecto de botón, «Mes | Año», el nombre de un producto y lo que se pliega. Quedan fuera las 12 columnas del gráfico del año.
- Los avisos breves salen abajo en el móvil, encima del botón «Añadir» y de la barra; en el escritorio, abajo a la derecha.
- La idea es una libreta de cuentas, «tinta y lápiz»: lo real va a tinta (trazo sólido, azul-negro) y lo previsto a lápiz (gris, líneas discontinuas), siempre con su etiqueta. El rojo se reserva para los números negativos y lo vencido.
- Colores, tipografía (Atkinson Hyperlegible, escala ×1,25) y radios son variables de `:root`; los componentes nunca usan un color suelto. El modo oscuro redefine las variables en `@media (prefers-color-scheme: dark)`.
- Clases `bloque__elemento--modificador` (`pantry-item__name`, `btn--primary`).

## Accesibilidad

- Cada campo tiene su etiqueta, y su error asociado (`aria-describedby`). Al enviar con errores, el foco va al primer campo con error (`focusFirstError` en `src/ui/helpers.ts`).
- Ventanas modales nativas (`<dialog>`, en `src/ui/Dialog.tsx`), con el foco dentro y Escape para cerrar. Si algo falla al pintar su contenido, la ventana se queda con el aviso «Algo ha fallado al mostrar esta ventana…» (`role="alert"`) y el botón «Cerrar esta ventana» (DialogBoundary), y el resto de la app sigue como estaba.
- Navegable con teclado, con «Saltar al contenido», y avisos con `role="status"` o `role="alert"`.
- Contraste AA en modo claro y oscuro, revisado con axe sin incidencias.
- Los e2e buscan por rol, nombre y etiqueta: un texto de la interfaz es parte del contrato con los tests (cada feature lista los suyos en su AGENTS.md).
