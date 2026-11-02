import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/atkinson-hyperlegible-next'
import '../../src/styles.css'
import { AuthProvider } from '../../src/features/auth/index.ts'
import { ToastProvider } from '../../src/ui/ToastProvider.tsx'
import { AuthHarness } from './AuthHarness.tsx'

/** Ensayo del consumidor React real contra .NET; no monta proveedores ni repositorios financieros. */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <AuthProvider>
        <AuthHarness />
      </AuthProvider>
    </ToastProvider>
  </StrictMode>,
)
