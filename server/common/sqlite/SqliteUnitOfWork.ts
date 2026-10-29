import type Database from 'better-sqlite3'
import type { UnitOfWork } from '../ports.ts'

/**
 * Transacciones con better-sqlite3: `run` ejecuta el trabajo entero o no
 * ejecuta nada (si lanza, se deshace todo).
 *
 * - Síncrono: better-sqlite3 lanza un error si `work` devuelve una promesa,
 *   porque la transacción se confirmaría antes de que acabara el trabajo.
 * - Anidado: dentro de otra transacción, better-sqlite3 usa un savepoint, así
 *   que un caso de uso puede llamar a otro (o a otro módulo) y todo sigue
 *   siendo atómico.
 * - `immediate`: BEGIN IMMEDIATE, que reserva la escritura al empezar (los
 *   tickets lo usan para que dos guardados a la vez no se crucen).
 */
export class SqliteUnitOfWork implements UnitOfWork {
  private readonly db: Database.Database

  constructor(db: Database.Database) {
    this.db = db
  }

  run<T>(work: () => T, { immediate = false }: { immediate?: boolean } = {}): T {
    const transaction = this.db.transaction(work)
    return immediate ? transaction.immediate() : transaction()
  }
}
