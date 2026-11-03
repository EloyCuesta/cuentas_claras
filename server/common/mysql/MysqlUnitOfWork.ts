import { isDeadlock } from './errors.ts'
import type { MysqlDatabase, TransactionContext } from './MysqlDatabase.ts'

/** Opciones de una transacción. */
export interface TransactionOptions {
  /**
   * Nombre de una fila de app_locks («finance», «tickets»). Se toma con
   * SELECT … FOR UPDATE como primera sentencia de la transacción y se suelta al
   * confirmar o deshacer: dos operaciones con el mismo nombre van en serie, y la
   * segunda ve todo lo que confirmó la primera.
   */
  lock?: string
}

/**
 * Transacciones en MySQL: `run` guarda todo lo que hace `work` o no guarda nada.
 *
 * - Una sola conexión por operación, de principio a fin, y async: la
 *   transacción se confirma cuando termina la promesa de `work`.
 * - Anidadas: una llamada a `run` dentro de otra (un caso de uso que llama a
 *   otro, o tickets → PantryGateway) se une a la transacción exterior, con un
 *   savepoint propio: si falla y quien la llama lo captura, solo se deshace lo
 *   de dentro. Un bloqueo que pida y que todavía no esté tomado se toma ahí.
 * - Interbloqueo (1213): InnoDB ya ha deshecho todo; se repite la operación
 *   completa una sola vez, con una conexión nueva.
 * - Con REPEATABLE READ, la primera lectura normal fija lo que verá la
 *   transacción: por eso el bloqueo va antes que cualquier lectura.
 */
export class MysqlUnitOfWork {
  private readonly db: MysqlDatabase

  constructor(db: MysqlDatabase) {
    this.db = db
  }

  async run<T>(work: () => Promise<T>, options: TransactionOptions = {}): Promise<T> {
    const current = this.db.currentTransaction()
    if (current) return this.nested(current, work, options)
    try {
      return await this.transaction(work, options)
    } catch (error) {
      if (!isDeadlock(error)) throw error
      return this.transaction(work, options)
    }
  }

  private async transaction<T>(work: () => Promise<T>, { lock }: TransactionOptions): Promise<T> {
    const connection = await this.db.pool.getConnection()
    const context: TransactionContext = { connection, locks: new Set(), savepoints: 0 }
    let broken = false
    try {
      await connection.query('START TRANSACTION')
      if (lock) await takeLock(context, lock)
      const result = await this.db.withTransaction(context, work)
      await connection.query('COMMIT')
      return result
    } catch (error) {
      try {
        await connection.query('ROLLBACK')
      } catch {
        // Conexión perdida: no vuelve al pool.
        broken = true
      }
      throw error
    } finally {
      if (broken) connection.destroy()
      else connection.release()
    }
  }

  private async nested<T>(context: TransactionContext, work: () => Promise<T>, { lock }: TransactionOptions): Promise<T> {
    if (lock && !context.locks.has(lock)) await takeLock(context, lock)
    const savepoint = `cc_anidada_${++context.savepoints}`
    await context.connection.query(`SAVEPOINT ${savepoint}`)
    try {
      const result = await work()
      await context.connection.query(`RELEASE SAVEPOINT ${savepoint}`)
      return result
    } catch (error) {
      // Tras un interbloqueo no queda transacción ni savepoint: lo repite la de fuera.
      if (!isDeadlock(error)) await context.connection.query(`ROLLBACK TO SAVEPOINT ${savepoint}`).catch(() => {})
      throw error
    }
  }
}

async function takeLock(context: TransactionContext, name: string): Promise<void> {
  const [rows] = await context.connection.execute('SELECT name FROM app_locks WHERE name = ? FOR UPDATE', [name])
  if ((rows as unknown[]).length !== 1) {
    throw new Error(`Falta la fila «${name}» en app_locks: la base de datos no tiene el esquema completo (database/mysql/migrations).`)
  }
  context.locks.add(name)
}
