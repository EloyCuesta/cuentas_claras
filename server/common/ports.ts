import type { ISODate } from '#shared/common/types.ts'

/**
 * Puertos comunes a todos los módulos. Los casos de uso dependen de estas
 * interfaces, nunca de Date, de crypto ni de MySQL directamente, así los tests
 * pueden pasar un reloj o unos ids controlados.
 *
 * Las implementaciones reales están en system.ts (reloj e ids) y en
 * mysql/MysqlUnitOfWork.ts (transacciones).
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
 * Zonas cuyas escrituras van en serie: cada una es una fila de app_locks
 * (database/mysql/migrations/005-esquema-inicial.sql).
 */
export type LockName = 'finance' | 'tickets'

/**
 * Una transacción: o se guarda todo o no se guarda nada.
 *
 * Async: la transacción se confirma cuando termina la promesa de `work`, con
 * una sola conexión de principio a fin. Se puede anidar: un caso de uso que
 * llama a otro, o a otro módulo, se une a la transacción de fuera y sigue
 * siendo atómico. `lock` toma la fila de esa zona como primera sentencia, así
 * que dos operaciones de la misma zona van una detrás de otra y la segunda ve
 * lo que guardó la primera.
 */
export interface UnitOfWork {
  run<T>(work: () => Promise<T>, options?: { lock?: LockName }): Promise<T>
}
