import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteUnitOfWork } from './SqliteUnitOfWork.ts'

/** Lo que los casos de uso dan por hecho de las transacciones (ver docs/arquitectura.md). */

const opened: Database.Database[] = []

function setup() {
  const db = new Database(':memory:')
  opened.push(db)
  db.exec('CREATE TABLE t (x INTEGER NOT NULL)')
  const insert = (x: number) => db.prepare('INSERT INTO t (x) VALUES (?)').run(x)
  const rows = () => db.prepare('SELECT x FROM t ORDER BY x').pluck().all()
  return { db, unitOfWork: new SqliteUnitOfWork(db), insert, rows }
}

afterEach(() => {
  for (const db of opened.splice(0)) db.close()
})

describe('SqliteUnitOfWork', () => {
  it('guarda todo o nada', () => {
    const { unitOfWork, insert, rows } = setup()
    expect(() =>
      unitOfWork.run(() => {
        insert(1)
        insert(2)
        throw new Error('a medias')
      }),
    ).toThrow('a medias')
    expect(rows()).toEqual([])
    expect(unitOfWork.run(() => (insert(3), 'hecho'))).toBe('hecho')
    expect(rows()).toEqual([3])
  })

  it('se puede anidar: un fallo dentro que se captura solo deshace lo de dentro', () => {
    const { unitOfWork, insert, rows } = setup()
    unitOfWork.run(() => {
      insert(1)
      try {
        unitOfWork.run(() => {
          insert(2)
          throw new Error('dentro')
        })
      } catch {
        // El caso de uso de fuera decide qué hacer; lo de dentro ya se ha deshecho.
      }
    })
    expect(rows()).toEqual([1])
  })

  it('no admite trabajo async: la transacción se confirmaría antes de acabar', () => {
    const { unitOfWork, insert, rows } = setup()
    expect(() => unitOfWork.run(async () => insert(1))).toThrow(/promise/)
    expect(rows()).toEqual([])
  })

  it('immediate abre la transacción reservando ya la escritura', () => {
    const { db, unitOfWork } = setup()
    expect(unitOfWork.run(() => db.inTransaction, { immediate: true })).toBe(true)
    expect(db.inTransaction).toBe(false)
  })
})
