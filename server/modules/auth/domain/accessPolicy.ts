/**
 * Política de acceso: cuánto dura una sesión y cuándo se bloquean los intentos.
 *
 * - Al acertar el código se abre una sesión de 12 horas.
 * - Cinco fallos seguidos desde la misma IP bloquean los intentos 15 minutos.
 * - Sin bloqueo, los fallos se olvidan pasados 15 minutos desde el primero.
 *
 * Funciones puras: el reloj y los almacenes los ponen los casos de uso.
 */

/** «admin» ha escrito el código y ve todo; «invitado» solo ve la despensa. */
export type Role = 'admin' | 'invitado'

export const SESSION_MS = 12 * 60 * 60 * 1000
export const ATTEMPT_WINDOW_MS = 15 * 60 * 1000
export const LOCK_MS = 15 * 60 * 1000
export const MAX_FAILED_ATTEMPTS = 5

/** Intentos fallidos de un dispositivo (por IP). */
export interface Attempts {
  failures: number
  windowStart: number
  lockedUntil: number | null
}

/** Si los fallos ya no cuentan: el bloqueo ha terminado o, sin bloqueo, ha pasado la ventana. */
export function attemptsExpired(entry: Attempts, now: number): boolean {
  const lockOver = entry.lockedUntil !== null && entry.lockedUntil <= now
  const windowOver = entry.lockedUntil === null && now - entry.windowStart >= ATTEMPT_WINDOW_MS
  return lockOver || windowOver
}

/** Un fallo más: al llegar a MAX_FAILED_ATTEMPTS se bloquea LOCK_MS. */
export function afterFailure(entry: Attempts | null, now: number): Attempts {
  const failures = (entry?.failures ?? 0) + 1
  return {
    failures,
    windowStart: entry?.windowStart ?? now,
    lockedUntil: failures >= MAX_FAILED_ATTEMPTS ? now + LOCK_MS : null,
  }
}

/** Minutos que faltan, redondeando hacia arriba y al menos 1 (para el mensaje del bloqueo). */
export const minutesLeft = (ms: number) => Math.max(1, Math.ceil(ms / 60_000))
