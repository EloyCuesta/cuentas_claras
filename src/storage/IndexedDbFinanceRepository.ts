import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { DEFAULT_CATEGORIES, withDescendants } from '../../shared/finance/categories.ts'
import { newId as defaultNewId, nowISO } from '../../shared/common/ids.ts'
import { planOccurrences } from '../../shared/finance/recurring.ts'
import type { ISODate } from '../../shared/common/types.ts'
import type { Category, FinanceData, Movement, RecurringRule } from '../../shared/finance/types.ts'
import type { MetaKey } from '../../shared/finance/meta.ts'
import type { SaveRecurringOptions } from '../../shared/finance/types.ts'
import type { FinanceRepository } from './FinanceRepository.ts'

/**
 * Implementación de FinanceRepository con IndexedDB (librería `idb`, que solo
 * añade promesas sobre la API nativa).
 *
 * Almacenes:
 * - categories, recurring y meta: clave = id / key.
 * - movements: clave = id, con dos índices:
 *   · byRecurring: los vencimientos de un recurrente.
 *   · byOccurrence [recurringId, occurrenceDate] ÚNICO: la propia base de datos
 *     impide que exista dos veces el mismo vencimiento. Los movimientos
 *     normales (recurringId = null) no entran en el índice.
 *
 * Las operaciones que tocan varios registros usan una sola transacción. Las
 * transacciones de escritura sobre los mismos almacenes se ejecutan en orden,
 * así que dos pestañas abiertas a la vez no pueden generar duplicados.
 */

interface FinanceSchema extends DBSchema {
  categories: { key: string; value: Category }
  movements: {
    key: string
    value: Movement
    indexes: { byRecurring: string; byOccurrence: [string, string] }
  }
  recurring: { key: string; value: RecurringRule }
  meta: { key: string; value: { key: string; value: string } }
}

export const DB_NAME = 'cuentas-claras'
const DB_VERSION = 1

export interface IndexedDbOptions {
  dbName?: string
  /** Inyectables para los tests. */
  now?: () => string
  newId?: () => string
}

export class IndexedDbFinanceRepository implements FinanceRepository {
  private readonly dbName: string
  private readonly now: () => string
  private readonly newId: () => string
  private dbPromise: Promise<IDBPDatabase<FinanceSchema>> | null = null

  constructor(options: IndexedDbOptions = {}) {
    this.dbName = options.dbName ?? DB_NAME
    this.now = options.now ?? nowISO
    this.newId = options.newId ?? defaultNewId
  }

  /** Abre la base de datos la primera vez que se necesita y la crea si no existe. */
  private db(): Promise<IDBPDatabase<FinanceSchema>> {
    this.dbPromise ??= openDB<FinanceSchema>(this.dbName, DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, transaction) {
        if (oldVersion < 1) {
          db.createObjectStore('categories', { keyPath: 'id' })
          const movements = db.createObjectStore('movements', { keyPath: 'id' })
          movements.createIndex('byRecurring', 'recurringId')
          movements.createIndex('byOccurrence', ['recurringId', 'occurrenceDate'], { unique: true })
          db.createObjectStore('recurring', { keyPath: 'id' })
          db.createObjectStore('meta', { keyPath: 'key' })
          // Las categorías iniciales se crean una sola vez, junto con la base de datos.
          const categories = transaction.objectStore('categories')
          for (const category of DEFAULT_CATEGORIES) void categories.put({ ...category })
        }
        // Futuras versiones: if (oldVersion < 2) { … migración … }
      },
      blocking: (_currentVersion, _blockedVersion, event) => {
        // Otra pestaña con una versión más nueva necesita actualizar la base de datos.
        ;(event.target as IDBDatabase).close()
        this.dbPromise = null
      },
    }).catch((error: unknown) => {
      // Si no se pudo abrir, el siguiente intento ("Reintentar") vuelve a probar.
      this.dbPromise = null
      throw error
    })
    return this.dbPromise
  }

  async loadAll(): Promise<FinanceData> {
    const db = await this.db()
    const tx = db.transaction(['categories', 'movements', 'recurring'], 'readonly')
    const [categories, movements, recurring] = await Promise.all([
      tx.objectStore('categories').getAll(),
      tx.objectStore('movements').getAll(),
      tx.objectStore('recurring').getAll(),
    ])
    await tx.done
    return { categories, movements, recurring }
  }

  async saveMovement(movement: Movement): Promise<void> {
    const db = await this.db()
    await db.put('movements', movement)
  }

  async deleteMovement(id: string): Promise<void> {
    const db = await this.db()
    const tx = db.transaction(['movements', 'recurring'], 'readwrite')
    const movements = tx.objectStore('movements')
    const movement = await movements.get(id)
    if (movement) {
      // Si es un vencimiento de un recurrente, se recuerda su fecha para no volver a crearlo.
      if (movement.recurringId && movement.occurrenceDate) {
        const rules = tx.objectStore('recurring')
        const rule = await rules.get(movement.recurringId)
        if (rule && !rule.excludedDates.includes(movement.occurrenceDate)) {
          await rules.put({ ...rule, excludedDates: [...rule.excludedDates, movement.occurrenceDate].sort() })
        }
      }
      await movements.delete(id)
    }
    await tx.done
  }

  async saveCategory(category: Category): Promise<void> {
    const db = await this.db()
    await db.put('categories', category)
  }

  async deleteCategory(id: string, replacementId: string | null): Promise<void> {
    const db = await this.db()
    const tx = db.transaction(['categories', 'movements', 'recurring'], 'readwrite')
    const categoryStore = tx.objectStore('categories')
    const all = await categoryStore.getAll()
    const removed = new Set(withDescendants(all, id))
    const target = all.find((c) => c.id === id)
    const replacement = replacementId ? all.find((c) => c.id === replacementId) : undefined
    // Las comprobaciones se hacen antes de escribir nada: si fallan, la
    // transacción termina sin cambios.
    if (target && replacementId && (!replacement || replacement.type !== target.type || removed.has(replacementId))) {
      throw new Error('La categoría de destino no es válida.')
    }

    const now = this.now()
    const movementStore = tx.objectStore('movements')
    const ruleStore = tx.objectStore('recurring')
    const affectedMovements = (await movementStore.getAll()).filter((m) => removed.has(m.categoryId))
    const affectedRules = (await ruleStore.getAll()).filter((r) => removed.has(r.categoryId))
    if ((affectedMovements.length > 0 || affectedRules.length > 0) && !replacementId) {
      throw new Error('La categoría tiene movimientos: elige a qué categoría pasarlos.')
    }
    for (const movement of affectedMovements) {
      await movementStore.put({ ...movement, categoryId: replacementId as string, updatedAt: now })
    }
    for (const rule of affectedRules) {
      await ruleStore.put({ ...rule, categoryId: replacementId as string, updatedAt: now })
    }
    for (const categoryId of removed) await categoryStore.delete(categoryId)
    await tx.done
  }

  async saveRecurring(rule: RecurringRule, options: SaveRecurringOptions): Promise<number> {
    const db = await this.db()
    const tx = db.transaction(['movements', 'recurring'], 'readwrite')
    await tx.objectStore('recurring').put(rule)

    const movements = tx.objectStore('movements')
    const own = await movements.index('byRecurring').getAll(rule.id)
    // Los vencimientos pendientes se rehacen con los datos nuevos; los pagados se conservan.
    const kept: Movement[] = []
    for (const movement of own) {
      if (movement.status === 'pendiente') await movements.delete(movement.id)
      else kept.push(movement)
    }

    const planned = planOccurrences(rule, kept, options.horizon, this.now(), this.newId)
    for (const movement of planned) {
      const paidAlready = options.markPaidBefore && (movement.occurrenceDate as string) < options.markPaidBefore
      await movements.add(paidAlready ? { ...movement, status: 'realizado', paidDate: movement.occurrenceDate } : movement)
    }
    await tx.done
    return planned.length
  }

  async deleteRecurring(id: string): Promise<void> {
    const db = await this.db()
    const tx = db.transaction(['movements', 'recurring'], 'readwrite')
    await tx.objectStore('recurring').delete(id)
    const movements = tx.objectStore('movements')
    for (const movement of await movements.index('byRecurring').getAll(id)) {
      if (movement.status === 'pendiente') await movements.delete(movement.id)
    }
    await tx.done
  }

  async generateOccurrences(horizon: ISODate): Promise<number> {
    const db = await this.db()
    // Leer y escribir en la misma transacción: si otra pestaña está generando a
    // la vez, IndexedDB espera a que termine y aquí ya se ven sus vencimientos.
    const tx = db.transaction(['movements', 'recurring'], 'readwrite')
    const rules = await tx.objectStore('recurring').getAll()
    const movements = tx.objectStore('movements')
    const now = this.now()
    let created = 0
    for (const rule of rules) {
      const own = await movements.index('byRecurring').getAll(rule.id)
      for (const movement of planOccurrences(rule, own, horizon, now, this.newId)) {
        await movements.add(movement)
        created++
      }
    }
    await tx.done
    return created
  }

  async replaceAll(data: FinanceData): Promise<void> {
    const db = await this.db()
    const tx = db.transaction(['categories', 'movements', 'recurring'], 'readwrite')
    const stores = {
      categories: tx.objectStore('categories'),
      movements: tx.objectStore('movements'),
      recurring: tx.objectStore('recurring'),
    }
    await Promise.all([stores.categories.clear(), stores.movements.clear(), stores.recurring.clear()])
    for (const category of data.categories) await stores.categories.add(category)
    for (const rule of data.recurring) await stores.recurring.add(rule)
    for (const movement of data.movements) await stores.movements.add(movement)
    await tx.done
  }

  async getMeta(key: MetaKey): Promise<string | null> {
    const db = await this.db()
    return (await db.get('meta', key))?.value ?? null
  }

  async setMeta(key: MetaKey, value: string): Promise<void> {
    const db = await this.db()
    await db.put('meta', { key, value })
  }

  /** Cierra la conexión (útil en los tests para simular cerrar la app). */
  async close(): Promise<void> {
    if (!this.dbPromise) return
    const db = await this.dbPromise
    db.close()
    this.dbPromise = null
  }
}
