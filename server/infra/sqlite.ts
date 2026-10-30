import type Database from 'better-sqlite3'
import { newId as defaultNewId, nowISO } from '../../src/domain/ids.ts'

export interface SqliteContextOptions {
  /** Instante actual en ISO (inyectable en los tests). */
  now?: () => string
  /** Generador de ids (inyectable en los tests). */
  newId?: () => string
}

/**
 * Lo que comparten todos los repositorios SQLite: la conexión, el reloj, los
 * ids y la forma de abrir una transacción. Se crea una sola vez por base de
 * datos y se pasa a cada repositorio, así los tres usan el mismo reloj y las
 * mismas reglas.
 */
export class SqliteContext {
  readonly db: Database.Database
  readonly now: () => string
  readonly newId: () => string

  constructor(db: Database.Database, options: SqliteContextOptions = {}) {
    this.db = db
    this.now = options.now ?? nowISO
    this.newId = options.newId ?? defaultNewId
  }

  /**
   * Ejecuta `work` en una transacción: o se guarda todo o no se guarda nada.
   * Dentro de otra transacción se convierte en un punto de guardado.
   * `immediate` toma el bloqueo de escritura al empezar (para lo que lee y
   * luego escribe en función de lo leído, como guardar un ticket).
   */
  transaction<T>(work: () => T, mode: 'deferred' | 'immediate' = 'deferred'): T {
    const tx = this.db.transaction(work)
    return mode === 'immediate' ? tx.immediate() : tx()
  }

  /** Cierra la conexión (en los tests, para simular cerrar la app). */
  close(): void {
    if (this.db.open) this.db.close()
  }
}

/** "?, ?, ?" con tantos parámetros como valores (para IN (...)). */
export const placeholders = (count: number): string => Array.from({ length: count }, () => '?').join(', ')
