import { createContext, useContext } from 'react'

/** «admin» ha escrito el código y ve todo; «invitado» solo ve la despensa. */
export type Role = 'admin' | 'invitado'

export interface AuthContextValue {
  role: Role
  /** Comprueba el código en el servidor. Lanza ApiError (401, 429…) o ServerUnavailableError. */
  login(code: string): Promise<void>
  /** Cierra la sesión en el servidor. Si falla, lanza y la sesión sigue como estaba. */
  logout(): Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth debe usarse dentro de <AuthProvider>.')
  return value
}
