import type { SessionStore } from '../../application/ports.ts'

/**
 * Sesiones en memoria, una instancia por aplicación: reiniciar el servidor las
 * borra todas (hay que volver a escribir el código) y los tests no se mezclan.
 */
export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, number>()

  get(token: string): number | undefined {
    return this.sessions.get(token)
  }

  set(token: string, expiresAt: number): void {
    this.sessions.set(token, expiresAt)
  }

  delete(token: string): void {
    this.sessions.delete(token)
  }

  deleteExpired(now: number): void {
    for (const [token, expiresAt] of this.sessions) if (expiresAt <= now) this.sessions.delete(token)
  }
}
