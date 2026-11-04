import { AppError } from '../../../common/errors.ts'
import type { Clock } from '../../../common/ports.ts'
import { afterFailure, attemptsExpired, minutesLeft, SESSION_MS, type Attempts } from '../domain/accessPolicy.ts'
import type { AttemptStore, CodeVerifier, SessionStore, TokenGenerator } from './ports.ts'

/**
 * Entrar con el código: si es correcto, abre una sesión de 12 horas y devuelve
 * su token. Cuenta los fallos de cada IP y, tras cinco, bloquea los intentos
 * 15 minutos (429 con Retry-After), aunque el código sea correcto.
 */
export class Login {
  private readonly verifier: CodeVerifier
  private readonly tokens: TokenGenerator
  private readonly sessions: SessionStore
  private readonly attempts: AttemptStore
  private readonly clock: Clock

  constructor(verifier: CodeVerifier, tokens: TokenGenerator, sessions: SessionStore, attempts: AttemptStore, clock: Clock) {
    this.verifier = verifier
    this.tokens = tokens
    this.sessions = sessions
    this.attempts = attempts
    this.clock = clock
  }

  /** Comprueba el código y devuelve un token de sesión nuevo. Lanza 401 o 429. */
  execute(code: string, ip: string): string {
    const now = this.clock.nowMs()
    const entry = this.currentAttempts(ip, now)
    if (entry?.lockedUntil) {
      const waitMs = entry.lockedUntil - now
      throw new AppError(
        'TOO_MANY_ATTEMPTS',
        `Demasiados intentos con un código incorrecto. Vuelve a intentarlo dentro de ${minutesLeft(waitMs)} min.`,
        { retryAfterSeconds: Math.ceil(waitMs / 1000) },
      )
    }

    if (!this.verifier.matches(code)) {
      this.attempts.set(ip, afterFailure(entry, now))
      throw new AppError('UNAUTHORIZED', 'El código no es correcto.')
    }

    this.attempts.delete(ip)
    this.sessions.deleteExpired(now)
    const token = this.tokens.newToken()
    this.sessions.set(token, now + SESSION_MS)
    return token
  }

  /** Intentos fallidos vigentes de una IP (los caducados se olvidan). */
  private currentAttempts(ip: string, now: number): Attempts | null {
    const entry = this.attempts.get(ip)
    if (!entry) return null
    if (attemptsExpired(entry, now)) {
      this.attempts.delete(ip)
      return null
    }
    return entry
  }
}
