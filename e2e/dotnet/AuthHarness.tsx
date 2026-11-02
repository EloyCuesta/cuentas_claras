import { useState } from 'react'
import { LoginDialog, SessionPanel, useAuth } from '../../src/features/auth/index.ts'

/** El montaje condicional reproduce el cambio de vista real al entrar y salir, sin peticiones de otros módulos. */
export function AuthHarness() {
  const { role } = useAuth()
  return (
    <main className="page">
      <h1>Ensayo de acceso</h1>
      {role === 'admin' ? <SessionPanel /> : <GuestAccess />}
    </main>
  )
}

function GuestAccess() {
  const [showLogin, setShowLogin] = useState(false)
  return (
    <>
      <button type="button" className="btn" onClick={() => setShowLogin(true)}>Tengo el código</button>
      {showLogin && <LoginDialog onClose={() => setShowLogin(false)} />}
    </>
  )
}
