import type { Clock } from '../../../common/ports.ts'
import type { SessionStore } from './ports.ts'

/** ¿El token es de una sesión abierta y sin caducar? Las caducadas se borran al mirarlas. */
export class CheckSession {
  private readonly sessions: SessionStore
  private readonly clock: Clock

  constructor(sessions: SessionStore, clock: Clock) {
    this.sessions = sessions
    this.clock = clock
  }

  execute(token: string | null): boolean {
    if (!token) return false
    const expiresAt = this.sessions.get(token)
    if (expiresAt === undefined) return false
    if (expiresAt <= this.clock.nowMs()) {
      this.sessions.delete(token)
      return false
    }
    return true
  }
}
