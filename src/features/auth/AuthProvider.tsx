import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { onUnauthorized } from '../../api/client.ts'
import { describeStorageError } from '../../api/storageErrors.ts'
import { useToast } from '../../ui/toastContext.ts'
import { authApi } from './api.ts'
import { AuthContext, type AuthContextValue, type Role } from './authContext.ts'

type AuthState = { status: 'checking' } | { status: 'error'; message: string } | { status: 'ready'; role: Role }

/**
 * Sabe si este navegador tiene una sesión válida (cookie HttpOnly que el
 * JavaScript no puede leer) preguntando a GET /api/auth/me al abrir la app.
 *
 * Cada cambio de rol incrementa `generation`: una respuesta que llega tarde de
 * una comprobación anterior no puede devolver el modo administrador después de
 * cerrar la sesión o de recibir un 401.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const { notify } = useToast()
  const [state, setState] = useState<AuthState>({ status: 'checking' })
  // Cada «Reintentar» vuelve a lanzar la comprobación.
  const [attempt, setAttempt] = useState(0)
  const generation = useRef(0)
  const roleRef = useRef<Role | null>(null)

  const apply = useCallback((role: Role) => {
    roleRef.current = role
    setState({ status: 'ready', role })
  }, [])

  useEffect(() => {
    const current = ++generation.current
    authApi.me().then(
      ({ rol }) => {
        if (current === generation.current) apply(rol === 'admin' ? 'admin' : 'invitado')
      },
      (error: unknown) => {
        if (current === generation.current) setState({ status: 'error', message: describeStorageError(error) })
      },
    )
  }, [attempt, apply])

  // Una petición financiera rechazada (sesión caducada o servidor reiniciado): a la despensa.
  useEffect(
    () =>
      onUnauthorized(() => {
        if (roleRef.current !== 'admin') return
        generation.current++
        apply('invitado')
        notify('La sesión ha terminado. Escribe el código otra vez para ver tus cuentas.', 'error')
      }),
    [apply, notify],
  )

  const login = useCallback(
    async (code: string) => {
      const current = ++generation.current
      await authApi.login(code)
      if (current !== generation.current) return
      // Sin evento hashchange: la vista de invitado (que se desmonta ahora) no lo devuelve a #despensa.
      history.replaceState(null, '', '#resumen')
      apply('admin')
    },
    [apply],
  )

  const logout = useCallback(async () => {
    // Si falla, se lanza el error y no se cambia nada: la sesión del servidor puede seguir abierta.
    await authApi.logout()
    generation.current++
    apply('invitado')
  }, [apply])

  const role = state.status === 'ready' ? state.role : null
  const value = useMemo<AuthContextValue | null>(() => (role ? { role, login, logout } : null), [role, login, logout])

  if (state.status === 'checking') {
    return (
      <div className="splash" role="status">
        <p>Abriendo Cuentas claras…</p>
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="splash">
        <div className="splash__card" role="alert">
          <h1>No se puede conectar</h1>
          <p>{state.message}</p>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              setState({ status: 'checking' })
              setAttempt((n) => n + 1)
            }}
          >
            Reintentar
          </button>
        </div>
      </div>
    )
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
