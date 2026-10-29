import type { RequestHandler, Router } from 'express'
import type { Clock } from '../../common/ports.ts'
import { Sha256CodeVerifier } from './adapters/crypto/Sha256CodeVerifier.ts'
import { RandomTokenGenerator } from './adapters/crypto/RandomTokenGenerator.ts'
import { authRoutes, requireAdmin } from './adapters/http/routes.ts'
import { InMemoryAttemptStore } from './adapters/memory/InMemoryAttemptStore.ts'
import { InMemorySessionStore } from './adapters/memory/InMemorySessionStore.ts'
import { CheckSession } from './application/CheckSession.ts'
import { Login } from './application/Login.ts'
import { Logout } from './application/Logout.ts'
import { checkAccessCode } from './domain/accessCode.ts'

/**
 * Módulo auth: el código de acceso a las finanzas, las sesiones en memoria, el
 * límite de intentos y requireAdmin. API pública del módulo (ver AGENTS.md).
 */

export { checkAccessCode, MIN_CODE_LENGTH } from './domain/accessCode.ts'
export { ATTEMPT_WINDOW_MS, LOCK_MS, MAX_FAILED_ATTEMPTS, SESSION_MS } from './domain/accessPolicy.ts'

export interface AuthModule {
  /** /api/auth/login, /logout y /me (públicas). */
  router: Router
  /** Middleware: sin una sesión válida, 401. app.ts lo monta antes de las rutas financieras. */
  requireAdmin: RequestHandler
}

/** Lanza si el código no vale: nunca hay una aplicación con el acceso abierto. */
export function createAuthModule({ accessCode, clock }: { accessCode: string; clock: Clock }): AuthModule {
  const check = checkAccessCode(accessCode)
  if (!check.ok) throw new Error(check.message)
  // Una instancia de cada almacén por aplicación: las pruebas no se mezclan entre sí.
  const sessions = new InMemorySessionStore()
  const attempts = new InMemoryAttemptStore()
  const login = new Login(new Sha256CodeVerifier(check.code), new RandomTokenGenerator(), sessions, attempts, clock)
  const logout = new Logout(sessions)
  const checkSession = new CheckSession(sessions, clock)
  return { router: authRoutes({ login, logout, checkSession }), requireAdmin: requireAdmin(checkSession) }
}
