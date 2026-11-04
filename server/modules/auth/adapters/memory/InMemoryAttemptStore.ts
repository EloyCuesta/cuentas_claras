import type { AttemptStore } from '../../application/ports.ts'
import type { Attempts } from '../../domain/accessPolicy.ts'

/** Intentos fallidos por IP, en memoria (como las sesiones, se pierden al reiniciar). */
export class InMemoryAttemptStore implements AttemptStore {
  private readonly attempts = new Map<string, Attempts>()

  get(ip: string): Attempts | undefined {
    return this.attempts.get(ip)
  }

  set(ip: string, attempts: Attempts): void {
    this.attempts.set(ip, attempts)
  }

  delete(ip: string): void {
    this.attempts.delete(ip)
  }
}
