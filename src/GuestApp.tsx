import { useEffect, useState } from 'react'
import { LoginDialog } from './auth/LoginDialog.tsx'
import { DespensaPage } from './pantry/DespensaPage.tsx'
import { Icon, LogoMark } from './ui/Icon.tsx'

/**
 * Vista de invitado: solo la despensa y el botón «Tengo el código». No usa
 * FinanceProvider, así que no pide datos financieros. Un enlace como #resumen
 * también acaba aquí.
 */
export function GuestApp() {
  const [loggingIn, setLoggingIn] = useState(false)

  useEffect(() => {
    document.title = 'Despensa — Cuentas claras'
    const keepOnPantry = () => {
      if (window.location.hash !== '#despensa') history.replaceState(null, '', '#despensa')
    }
    keepOnPantry()
    window.addEventListener('hashchange', keepOnPantry)
    return () => window.removeEventListener('hashchange', keepOnPantry)
  }, [])

  return (
    <div className="guest">
      <header className="guest__bar">
        <span className="brand">
          <LogoMark />
          <span>Cuentas claras</span>
        </span>
        <button type="button" className="btn" onClick={() => setLoggingIn(true)}>
          <Icon name="lock" />
          Tengo el código
        </button>
      </header>
      <main id="contenido" className="guest__main" tabIndex={-1}>
        <DespensaPage />
      </main>
      {loggingIn && <LoginDialog onClose={() => setLoggingIn(false)} />}
    </div>
  )
}
