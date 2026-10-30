import { useRef, useState, type FormEvent } from 'react'
import { describeStorageError } from '../api/storageErrors.ts'
import { Dialog, DialogError } from '../ui/Dialog.tsx'
import { Field } from '../ui/forms.tsx'
import { useAuth } from './authContext.ts'

/**
 * Pide el código de acceso. El código solo vive en este formulario: se envía al
 * servidor y se borra al cerrar o al entrar. No se guarda en el navegador.
 */
export function LoginDialog({ onClose }: { onClose: () => void }) {
  const { login } = useAuth()
  const [code, setCode] = useState('')
  const [fieldError, setFieldError] = useState<string | undefined>()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Evita dos envíos aunque se pulse dos veces antes de que React vuelva a pintar.
  const sending = useRef(false)

  const close = () => {
    setCode('')
    onClose()
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (sending.current) return
    setError(null)
    if (code === '') {
      setFieldError('Escribe el código.')
      document.getElementById('login-code')?.focus()
      return
    }
    sending.current = true
    setBusy(true)
    try {
      await login(code)
      setCode('')
      // Al entrar se monta la aplicación completa y este diálogo desaparece con la vista de invitado.
    } catch (failure) {
      setError(describeStorageError(failure))
      setBusy(false)
      sending.current = false
      document.getElementById('login-code')?.focus()
    }
  }

  return (
    <Dialog title="Código de acceso" onClose={close} size="alert">
      <form className="dialog__form" onSubmit={(event) => void submit(event)} noValidate>
        <div className="dialog__body">
          <p>Con el código verás también las cuentas: resumen, movimientos, recurrentes, presupuestos y ajustes.</p>
          <Field id="login-code" label="Código" error={fieldError}>
            {(control) => (
              <input
                {...control}
                type="password"
                className="input"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                value={code}
                onChange={(event) => {
                  setCode(event.target.value)
                  setFieldError(undefined)
                }}
                data-autofocus
              />
            )}
          </Field>
          <DialogError message={error} />
        </div>
        <div className="dialog__footer">
          <button type="button" className="btn" onClick={close}>
            Cancelar
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? 'Comprobando…' : 'Entrar'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
