import { useState } from 'react'
import { useAuth } from '../state/authContext.ts'
import { describeStorageError } from '../state/storageErrors.ts'
import { Icon } from './Icon.tsx'
import { Section } from './Section.tsx'

/** Ajustes › Sesión: cerrar la sesión de este navegador y volver a la despensa. */
export function SessionPanel() {
  const { logout } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const close = async () => {
    setBusy(true)
    setError(null)
    try {
      await logout()
    } catch (failure) {
      setError(
        `No se ha podido cerrar la sesión: ${describeStorageError(failure)} La sesión sigue abierta en el servidor; vuelve a intentarlo.`,
      )
      setBusy(false)
    }
  }

  return (
    <Section id="session" title="Sesión">
      <div className="stack">
        <p className="muted">
          Este navegador tiene acceso a las cuentas durante 12 horas desde que escribiste el código, o hasta que se reinicie
          el servidor. Al cerrar la sesión solo quedará a la vista la despensa.
        </p>
        {error && (
          <p className="notice notice--error" role="alert">
            <Icon name="alert" />
            <span>{error}</span>
          </p>
        )}
        <div>
          <button type="button" className="btn" onClick={() => void close()} disabled={busy}>
            <Icon name="lock" />
            {busy ? 'Cerrando sesión…' : 'Cerrar sesión'}
          </button>
        </div>
      </div>
    </Section>
  )
}
