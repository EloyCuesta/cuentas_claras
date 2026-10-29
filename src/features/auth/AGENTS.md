# Feature auth — Código de acceso

> Lee antes: /AGENTS.md y src/AGENTS.md. Depende de: `src/api/` y `src/ui/`. Lo usan: `src/main.tsx` (AuthProvider), `src/Root.tsx` (useAuth), `src/GuestApp.tsx` (LoginDialog) y la feature finance (SessionPanel, en Ajustes). En el servidor es el módulo auth (`server/modules/auth/`).

## Qué ve la persona
Sin el código, «Tengo el código» en la barra de la Despensa, que abre el formulario «Código de acceso». Con el código, toda la app; en *Ajustes › Sesión*, «Cerrar sesión». Si la sesión caduca o el servidor se reinicia mientras se usa la app, vuelve a la Despensa con un aviso.

## Componentes
| Componente | Archivo | Qué hace | Test e2e |
| --- | --- | --- | --- |
| AuthProvider | `AuthProvider.tsx` | Pregunta a /api/auth/me si hay sesión, da `role`, `login` y `logout`, y vuelve al modo invitado con cualquier 401 de la API | todos los de `e2e/despensa.spec.ts` y `e2e/app.spec.ts` |
| LoginDialog | `LoginDialog.tsx` | El formulario del código: campo de contraseña sin autocompletar, errores del servidor y foco | «con el código se ve todo; al cerrar la sesión se vuelve a la despensa» |
| SessionPanel | `SessionPanel.tsx` | *Ajustes › Sesión*: cerrar la sesión | el mismo |

## Estado y datos
- `authContext.ts` (contexto y `useAuth`) + `AuthProvider.tsx`, el patrón `xContext.ts` + `XProvider.tsx` que pide `react/only-export-components`.
- `api.ts` (authApi) es lo único que hace peticiones: GET /api/auth/me, POST /api/auth/login y POST /api/auth/logout.
- `onUnauthorized` (`src/api/client.ts`) avisa de cualquier 401 que no sea de /auth: AuthProvider pasa a «invitado» y desmonta las finanzas.
- El código solo vive en el formulario: no se guarda en el navegador. La sesión es una cookie HttpOnly que el JavaScript no puede leer.

## Textos y accesibilidad
Los e2e buscan por estos textos; no los cambies sin cambiar el test:
- botón «Tengo el código», diálogo «Código de acceso», campo «Código» (`type=password`, `autocomplete=off`, con el foco al abrir) y botón «Entrar»;
- el error del servidor en un `role=alert` («El código no es correcto.»);
- en Ajustes, el botón «Cerrar sesión», y el aviso «La sesión ha terminado. Escribe el código otra vez para ver tus cuentas.».

## Pruebas
Sin tests unitarios propios: se prueba en el navegador (`e2e/despensa.spec.ts`: entrar, cerrar sesión, sesión caducada) y en el servidor (`server/modules/auth/auth.test.ts`). Solo esas e2e: `npx playwright test e2e/despensa.spec.ts --project=escritorio`.

## Trampas
- AuthProvider lleva una «generación»: una respuesta que llega tarde de /auth/me no puede devolver el modo administrador después de cerrar sesión o de un 401.
- Al entrar, `history.replaceState` pone `#resumen` sin lanzar `hashchange`, para que la vista de invitado (que se está desmontando) no lo devuelva a `#despensa`.
- Si cerrar la sesión falla, se avisa y no se cambia nada: la sesión del servidor podría seguir abierta.

## Si cambias esta pantalla
- Textos o roles: los e2e de `e2e/despensa.spec.ts`.
- Rutas o respuestas de /api/auth: también `server/modules/auth/` y `docs/api.md`.
