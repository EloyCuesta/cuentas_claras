import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/atkinson-hyperlegible-next'
import './styles.css'
import { Root } from './Root.tsx'
import { ToastProvider } from './ui/ToastProvider.tsx'
import { AuthProvider } from './features/auth/index.ts'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <AuthProvider>
        <Root />
      </AuthProvider>
    </ToastProvider>
  </StrictMode>,
)
