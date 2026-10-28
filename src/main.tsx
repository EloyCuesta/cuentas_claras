import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/atkinson-hyperlegible-next'
import './styles.css'
import App from './App.tsx'
import { ToastProvider } from './components/ToastProvider.tsx'
import { ApiFinanceRepository } from './services/ApiFinanceRepository.ts'
import { describeBrowserMigration, migrateBrowserData } from './services/browserDataMigration.ts'
import { FinanceProvider } from './state/FinanceProvider.tsx'

// Único punto donde se elige el almacenamiento: la base de datos SQLite del
// servidor (server/), a través de su API REST.
const repository = new ApiFinanceRepository()

// Antes de abrir por primera vez: pasar al servidor los datos que hubiera en el navegador.
const beforeOpen = async () => describeBrowserMigration(await migrateBrowserData(repository))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <FinanceProvider repository={repository} beforeOpen={beforeOpen}>
        <App />
      </FinanceProvider>
    </ToastProvider>
  </StrictMode>,
)
