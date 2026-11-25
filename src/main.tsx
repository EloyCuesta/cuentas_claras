import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { Root } from './Root.tsx'
import { LoadBoundary } from './ui/Loading.tsx'
import { ToastProvider } from './ui/ToastProvider.tsx'
import { AuthProvider } from './features/auth/index.ts'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <AuthProvider>
        {/* Lo que se descarga aparte (las cuentas, los diálogos de tickets…): si no llega, «Volver a cargar». */}
        <LoadBoundary>
          <Root />
        </LoadBoundary>
      </AuthProvider>
    </ToastProvider>
  </StrictMode>,
)
