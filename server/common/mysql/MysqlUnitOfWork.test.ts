import { afterEach, describe, expect, it } from 'vitest'
import { connectTestDatabase, dropTestDatabases, openTestDatabase } from '../testing/testDatabase.ts'
import { MysqlUnitOfWork } from './MysqlUnitOfWork.ts'

/**
 * Lo que los casos de uso dan por hecho de las transacciones (docs/arquitectura.md),
 * contra MySQL de verdad y, cuando hace falta, con dos conexiones.
 */

afterEach(async () => {
  await dropTestDatabases()
})

/** Una base de prueba con una tabla t (x) y su UnitOfWork. */
async function setup(name?: string) {
  const opened = await openTestDatabase(name)
  const { db } = opened
  await db.run('CREATE TABLE IF NOT EXISTS t (x INT NOT NULL) ENGINE=InnoDB')
  const insert = (x: number) => db.run('INSERT INTO t (x) VALUES (?)', [x])
  const rows = async () => (await db.rows<{ x: number }>('SELECT x FROM t ORDER BY x')).map((row) => row.x)
  return { ...opened, unitOfWork: new MysqlUnitOfWork(db), insert, rows }
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Una promesa que se resuelve desde fuera. */
function signal() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => (resolve = done))
  return { promise, resolve }
}

describe('MysqlUnitOfWork', () => {
  it('guarda todo o nada', async () => {
    const { unitOfWork, insert, rows } = await setup()
    await expect(
      unitOfWork.run(async () => {
        await insert(1)
        await insert(2)
        throw new Error('a medias')
      }),
    ).rejects.toThrow('a medias')
    expect(await rows()).toEqual([])
    expect(await unitOfWork.run(async () => (await insert(3), 'hecho'))).toBe('hecho')
    expect(await rows()).toEqual([3])
  })

  it('el trabajo es async y se confirma al terminar su promesa, no antes', async () => {
    const { name, unitOfWork, insert } = await setup()
    const other = await connectTestDatabase(name)
    const count = async () => ((await other.query('SELECT COUNT(*) AS n FROM t')) as [{ n: number }[], unknown])[0][0].n
    const inside = signal()
    const finish = signal()
    const running = unitOfWork.run(async () => {
      await insert(1)
      await pause(20)
      await insert(2)
      inside.resolve()
      await finish.promise
    })
    await inside.promise
    expect(await count()).toBe(0)
    finish.resolve()
    await running
    expect(await count()).toBe(2)
  })

  it('las anidadas usan la misma conexión, y un fallo dentro que se captura solo deshace lo de dentro', async () => {
    const { db, unitOfWork, insert, rows } = await setup()
    const connection = async () => (await db.rows<{ id: number }>('SELECT CONNECTION_ID() AS id'))[0].id
    const ids: number[] = []
    await unitOfWork.run(async () => {
      ids.push(await connection())
      await insert(1)
      await unitOfWork.run(async () => {
        ids.push(await connection())
        await insert(2)
      })
      try {
        await unitOfWork.run(async () => {
          await insert(3)
          throw new Error('dentro')
        })
      } catch {
        // El caso de uso de fuera decide qué hacer; lo de dentro ya se ha deshecho.
      }
    })
    expect(new Set(ids).size).toBe(1)
    expect(await rows()).toEqual([1, 2])
  })

  it('fuera de una transacción cada consulta va al pool y se confirma sola', async () => {
    const { db, insert, rows } = await setup()
    expect(db.currentTransaction()).toBeUndefined()
    await insert(7)
    expect(await rows()).toEqual([7])
  })

  it('un bloqueo con nombre pone en serie dos operaciones de dos conexiones, y la segunda ve lo de la primera', async () => {
    const first = await setup()
    // Otro proceso: su propio pool contra la misma base.
    const second = await setup(first.name)
    type Side = typeof first
    const readThenWrite = ({ db, unitOfWork, insert }: Side, value: number, lock?: string) =>
      unitOfWork.run(
        async () => {
          const [{ n }] = await db.rows<{ n: number }>('SELECT COUNT(*) AS n FROM t')
          await pause(100)
          await insert(value)
          return n
        },
        { lock },
      )
    // Sin bloqueo, las dos leen a la vez lo mismo: lo que serializaba SQLite ya no se da por hecho.
    expect(await Promise.all([readThenWrite(first, 1), readThenWrite(second, 2)])).toEqual([0, 0])
    // Con el bloqueo, la segunda espera y ve lo que confirmó la primera.
    const seen = await Promise.all([readThenWrite(first, 3, 'finance'), readThenWrite(second, 4, 'finance')])
    expect(seen.sort()).toEqual([2, 3])
    expect(await first.rows()).toEqual([1, 2, 3, 4])
  })

  it('el bloqueo va el primero: una lectura anterior fija una instantánea que no ve lo confirmado después', async () => {
    const { name, db, unitOfWork } = await setup()
    const other = await connectTestDatabase(name)
    const values = await unitOfWork.run(async () => {
      const before = await db.rows<{ n: number }>('SELECT COUNT(*) AS n FROM t')
      await other.query('INSERT INTO t (x) VALUES (1)')
      // Con REPEATABLE READ la instantánea ya está fijada: el bloqueo tardío no la cambia…
      await unitOfWork.run(async () => {}, { lock: 'finance' })
      const after = await db.rows<{ n: number }>('SELECT COUNT(*) AS n FROM t')
      // …aunque una lectura con bloqueo sí ve la fila confirmada.
      const current = await db.rows<{ n: number }>('SELECT COUNT(*) AS n FROM t FOR UPDATE')
      return [before[0].n, after[0].n, current[0].n]
    })
    expect(values).toEqual([0, 0, 1])
    // Tomado como primera sentencia, la transacción sí ve lo que otra conexión confirmó antes.
    await other.query('INSERT INTO t (x) VALUES (2)')
    expect(await unitOfWork.run(async () => (await db.rows<{ n: number }>('SELECT COUNT(*) AS n FROM t'))[0].n, { lock: 'finance' })).toBe(2)
  })

  it('si falta la fila del bloqueo, lo dice en vez de seguir sin bloquear', async () => {
    const { unitOfWork, insert, rows } = await setup()
    await expect(unitOfWork.run(async () => insert(1), { lock: 'no-existe' })).rejects.toThrow(/Falta la fila «no-existe» en app_locks/)
    expect(await rows()).toEqual([])
  })

  it('ante un interbloqueo repite la operación completa una sola vez', async () => {
    const { name, db, unitOfWork } = await setup()
    await db.run('CREATE TABLE d (id INT PRIMARY KEY, v INT NOT NULL) ENGINE=InnoDB')
    await db.run('INSERT INTO d (id, v) VALUES (1, 0), (2, 0), (3, 0), (4, 0), (5, 0)')
    const other = await connectTestDatabase(name)
    // La otra conexión cambia varias filas (es la transacción «grande», la que InnoDB no deshace) y retiene la 2.
    await other.query('START TRANSACTION')
    await other.query('UPDATE d SET v = v + 10 WHERE id IN (2, 3, 4, 5)')
    const firstLock = signal()
    let attempts = 0
    const running = unitOfWork.run(async () => {
      attempts++
      await db.rows('SELECT v FROM d WHERE id = 1 FOR UPDATE')
      if (attempts === 1) firstLock.resolve()
      await db.rows('SELECT v FROM d WHERE id = 2 FOR UPDATE')
      await db.run('UPDATE d SET v = v + 1 WHERE id IN (1, 2)')
    })
    await firstLock.promise
    await pause(100)
    // Ahora pide la 1, que tiene la transacción de la UnitOfWork: el ciclo es un interbloqueo.
    await other.query('SELECT v FROM d WHERE id = 1 FOR UPDATE')
    await other.query('COMMIT')
    await running
    expect(attempts).toBe(2)
    expect(await db.rows('SELECT id, v FROM d ORDER BY id')).toEqual([
      { id: 1, v: 1 },
      { id: 2, v: 11 },
      { id: 3, v: 10 },
      { id: 4, v: 10 },
      { id: 5, v: 10 },
    ])
  })
})
