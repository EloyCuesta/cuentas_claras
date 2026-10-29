import type { Attempts } from '../domain/accessPolicy.ts'

/**
 * Puertos del módulo auth. Las sesiones y los intentos viven en memoria
 * (adapters/memory): reiniciar el servidor los borra, y es lo que se quiere.
 * Lo que necesita node:crypto (comparar el código y crear tokens) está en
 * adapters/crypto.
 */

/** Sesiones abiertas: token → instante en que caduca (ms). */
export interface SessionStore {
  get(token: string): number | undefined
  set(token: string, expiresAt: number): void
  delete(token: string): void
  /** Borra las sesiones que ya han caducado. */
  deleteExpired(now: number): void
}

/** Intentos fallidos de cada dispositivo (por IP). */
export interface AttemptStore {
  get(ip: string): Attempts | undefined
  set(ip: string, attempts: Attempts): void
  delete(ip: string): void
}

/** Compara un código con el de CUENTAS_CODIGO sin que el tiempo dependa del código recibido. */
export interface CodeVerifier {
  matches(code: string): boolean
}

/** Tokens de sesión nuevos: aleatorios y de 64 caracteres hexadecimales. */
export interface TokenGenerator {
  newToken(): string
}
