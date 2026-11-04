import type { MysqlDatabase } from './mysql/MysqlDatabase.ts'
import type { Clock, IdGenerator, UnitOfWork } from './ports.ts'

/**
 * Lo que app.ts da a cada módulo: la conexión (solo la usan sus adaptadores
 * MySQL, que crea su index.ts), el reloj, los ids y la unidad de trabajo,
 * compartida por todos para que las transacciones se puedan anidar.
 */
export interface ModuleDeps {
  db: MysqlDatabase
  clock: Clock
  ids: IdGenerator
  unitOfWork: UnitOfWork
}
