import App from './App.tsx'
import {
  ApiFinanceRepository,
  describeBrowserMigration,
  migrateBrowserData,
  FinanceProvider,
} from './features/finance/index.ts'

// Único punto donde se elige el almacenamiento: la base de datos MySQL del
// servidor (Express en server/ o, en el ensayo, .NET en backend/), a través de su API REST.
const repository = new ApiFinanceRepository()

// Antes de abrir por primera vez: pasar al servidor los datos que hubiera en el navegador.
const beforeOpen = async () => describeBrowserMigration(await migrateBrowserData(repository))

/**
 * Con el código: las cuentas (FinanceProvider, con la migración del navegador y
 * la generación de vencimientos) y la aplicación completa. Root lo carga con
 * lazyComponent: va en su propio archivo JS, y el invitado no lo descarga (UX-06).
 */
export default function AdminApp() {
  return (
    <FinanceProvider repository={repository} beforeOpen={beforeOpen}>
      <App />
    </FinanceProvider>
  )
}
