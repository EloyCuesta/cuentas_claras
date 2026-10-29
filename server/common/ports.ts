import type { ISODate } from '#shared/common/types.ts'

/**
 * Puertos comunes a todos los módulos. Los casos de uso dependen de estas
 * interfaces, nunca de Date, de crypto ni de SQLite directamente, así los tests
 * pueden pasar un reloj o unos ids controlados.
 *
 * Las implementaciones reales están en system.ts (reloj e ids) y en
 * sqlite/SqliteUnitOfWork.ts (transacciones).
 */

/** La hora del servidor. */
export interface Clock {
  /** Milisegundos desde 1970: caducidad de las sesiones y bloqueos del código de acceso. */
  nowMs(): number
  /** Instante en ISO para createdAt y updatedAt ("2026-10-29T08:00:00.000Z"). */
  nowISO(): string
  /**
   * Fecha de hoy del servidor (AAAA-MM-DD). Solo de respaldo: la fecha de hoy la
   * manda el navegador (hoy, date, horizon) y esta se usa únicamente si no llega.
   */
  today(): ISODate
}

/** Identificadores nuevos (UUID v4) para lo que crea el servidor. */
export interface IdGenerator {
  newId(): string
}

/**
 * Una transacción: o se guarda todo o no se guarda nada.
 *
 * Síncrona a propósito: better-sqlite3 no admite trabajo async dentro de una
 * transacción. Se puede anidar (un caso de uso que llama a otro, o a otro
 * módulo, sigue siendo atómico). `immediate` reserva la escritura desde el
 * principio, como hacen los tickets.
 */
export interface UnitOfWork {
  run<T>(work: () => T, options?: { immediate?: boolean }): T
}
