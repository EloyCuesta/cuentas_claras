import type { SessionStore } from './ports.ts'

/** Cerrar la sesión: el token deja de valer. Sin token, no hace nada (y no falla). */
export class Logout {
  private readonly sessions: SessionStore

  constructor(sessions: SessionStore) {
    this.sessions = sessions
  }

  execute(token: string | null): void {
    if (token) this.sessions.delete(token)
  }
}
