import type Database from 'better-sqlite3'
import type { Clock, IdGenerator, UnitOfWork } from './ports.ts'

/**
 * Lo que app.ts da a cada módulo: la conexión (solo la usan sus adaptadores
 * SQLite, que crea su index.ts), el reloj, los ids y la unidad de trabajo,
 * compartida por todos para que las transacciones se puedan anidar.
 */
export interface ModuleDeps {
  db: Database.Database
  clock: Clock
  ids: IdGenerator
  unitOfWork: UnitOfWork
}
