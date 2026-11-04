/**
 * Feature auth: el código de acceso en la web (ver AGENTS.md). Es lo único que
 * pueden importar de ella la raíz (main, Root, GuestApp) y las demás features.
 */
export { AuthProvider } from './AuthProvider.tsx'
export { useAuth, type Role } from './authContext.ts'
export { LoginDialog } from './LoginDialog.tsx'
export { SessionPanel } from './SessionPanel.tsx'
