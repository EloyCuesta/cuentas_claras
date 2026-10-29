import App from './App.tsx'
import { GuestApp } from './GuestApp.tsx'
import {
  ApiFinanceRepository,
  describeBrowserMigration,
  migrateBrowserData,
  FinanceProvider,
} from './features/finance/index.ts'
import { useAuth } from './features/auth/index.ts'

// Único punto donde se elige el almacenamiento: la base de datos SQLite del
// servidor (server/), a través de su API REST.
const repository = new ApiFinanceRepository()

// Antes de abrir por primera vez: pasar al servidor los datos que hubiera en el navegador.
const beforeOpen = async () => describeBrowserMigration(await migrateBrowserData(repository))

/**
 * Con el código: la aplicación completa. Sin él: solo la despensa.
 * FinanceProvider (y con él la migración del navegador y la generación de
 * vencimientos) solo se monta como administrador; al cerrar la sesión se
 * desmonta y su estado se descarta.
 */
export function Root() {
  const { role } = useAuth()
  if (role !== 'admin') return <GuestApp />
  return (
    <FinanceProvider repository={repository} beforeOpen={beforeOpen}>
      <App />
    </FinanceProvider>
  )
}
