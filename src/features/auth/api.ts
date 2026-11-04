import { apiRequest } from '../../api/client.ts'
import type { Role } from './authContext.ts'

/**
 * Cliente de /api/auth. La cookie de sesión es HttpOnly: el navegador la envía
 * sola, y el JavaScript de la página nunca la ve ni guarda el código.
 */
export const authApi = {
  /** ¿Este navegador tiene una sesión válida? */
  me: () => apiRequest<{ rol: Role }>('GET', '/auth/me'),
  /** Lanza ApiError (401 código incorrecto, 429 demasiados intentos) o ServerUnavailableError. */
  login: (code: string) => apiRequest<{ rol: Role }>('POST', '/auth/login', { codigo: code }),
  logout: () => apiRequest<null>('POST', '/auth/logout'),
}
