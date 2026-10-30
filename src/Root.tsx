import App from './App.tsx'
import { GuestApp } from './GuestApp.tsx'
import { ApiFinanceRepository } from './services/ApiFinanceRepository.ts'
import { useAuth } from './state/authContext.ts'
import { FinanceProvider } from './state/FinanceProvider.tsx'

// Único punto donde se elige el almacenamiento: la base de datos SQLite del
// servidor (server/), a través de su API REST.
const repository = new ApiFinanceRepository()

/**
 * Con el código: la aplicación completa. Sin él: solo la despensa.
 * FinanceProvider (y con él la generación de vencimientos) solo se monta como
 * administrador; al cerrar la sesión se
 * desmonta y su estado se descarta.
 */
export function Root() {
  const { role } = useAuth()
  if (role !== 'admin') return <GuestApp />
  return (
    <FinanceProvider repository={repository}>
      <App />
    </FinanceProvider>
  )
}
