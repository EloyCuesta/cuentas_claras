import { GuestApp } from './GuestApp.tsx'
import { useAuth } from './features/auth/index.ts'
import { LoadingScreen } from './ui/Loading.tsx'
import { lazyComponent } from './ui/lazyComponent.tsx'

// Las cuentas van en su propio archivo JS: solo se descargan con el código (UX-06).
const AdminApp = lazyComponent(
  () => import('./AdminApp.tsx').then((loaded) => loaded.default),
  <LoadingScreen label="Abriendo tus cuentas…" />,
)

/**
 * Con el código: la aplicación completa (AdminApp). Sin él: solo la despensa.
 * FinanceProvider solo se monta como administrador; al cerrar la sesión se
 * desmonta y su estado se descarta.
 */
export function Root() {
  const { role } = useAuth()
  return role === 'admin' ? <AdminApp /> : <GuestApp />
}
