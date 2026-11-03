import { createServer } from 'node:net'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { createTestDatabase, dropTestDatabases, openTestDatabase, testDatabaseConfig } from '../testing/testDatabase.ts'
import { MysqlDatabase, openDatabase, type SqlParam } from './MysqlDatabase.ts'

/** La conexión con MySQL de verdad: sesión, parámetros y lo que pasa cuando MySQL no se puede usar. */

const extra: MysqlDatabase[] = []

afterEach(async () => {
  for (const db of extra.splice(0)) await db.close().catch(() => {})
  await dropTestDatabases()
})

/** Un puerto en el que no escucha nadie. */
async function closedPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  await new Promise((resolve) => server.close(resolve))
  return port
}

describe('MysqlDatabase', () => {
  it('cada conexión fija utf8mb4_0900_bin, el modo estricto y REPEATABLE READ', async () => {
    const { db } = await openTestDatabase()
    // Varias conexiones a la vez: todas pasan por la preparación de la sesión.
    const sessions = await Promise.all(
      Array.from({ length: 4 }, () =>
        db.rows<{ collation: string; mode: string; isolation: string; sleep: number }>(
          'SELECT @@collation_connection AS collation, @@sql_mode AS mode, @@transaction_isolation AS isolation, SLEEP(0.05) AS sleep',
        ),
      ),
    )
    for (const [session] of sessions) {
      expect(session.collation).toBe('utf8mb4_0900_bin')
      expect(session.mode.split(',')).toEqual(expect.arrayContaining(['STRICT_TRANS_TABLES', 'NO_ZERO_DATE', 'NO_ZERO_IN_DATE']))
      expect(session.mode).not.toMatch(/IGNORE_SPACE|NO_BACKSLASH_ESCAPES/)
      expect(session.isolation).toBe('REPEATABLE-READ')
    }
    // También los textos sueltos comparan como SQLite: «abc » no es «abc».
    expect(await db.rows("SELECT ? = 'abc' AS same", ['abc '])).toEqual([{ same: 0 }])
  })

  it('solo admite texto, números finitos y null como parámetros (nunca un Date)', async () => {
    const { db } = await openTestDatabase()
    for (const value of [new Date('2026-01-01'), true, undefined, Number.NaN, 10n, { a: 1 }]) {
      await expect(db.rows('SELECT ? AS v', [value as unknown as SqlParam]), String(value)).rejects.toThrow(/Parámetro SQL no admitido/)
    }
    expect(await db.rows('SELECT ? AS texto, ? AS numero, ? AS nada', ['2026-01-01', 12.5, null])).toEqual([{ texto: '2026-01-01', numero: 12.5, nada: null }])
  })

  it('una sentencia por llamada: dos sentencias seguidas fallan', async () => {
    const { db } = await openTestDatabase()
    await expect(db.run('DELETE FROM meta; DELETE FROM categories')).rejects.toMatchObject({ code: 'ER_PARSE_ERROR' })
    expect((await db.rows<{ n: number }>('SELECT COUNT(*) AS n FROM categories'))[0].n).toBeGreaterThan(0)
  })

  it('si MySQL no responde, no se abre y explica qué revisar', async () => {
    const config = { ...testDatabaseConfig('cuentas_test_sin_servidor'), port: await closedPort() }
    await expect(openDatabase(config)).rejects.toThrow(new RegExp(`MySQL no responde en 127\\.0\\.0\\.1:${config.port} \\(ECONNREFUSED\\)`))
  })

  it('si MySQL rechaza el usuario, lo explica sin mostrar la contraseña', async () => {
    const name = await createTestDatabase()
    const config = { ...testDatabaseConfig(name), password: 'contraseña-equivocada-de-ensayo' }
    const error = await openDatabase(config).then(
      () => null,
      (reason: unknown) => reason as Error,
    )
    expect(error?.message).toMatch(new RegExp(`MySQL ha rechazado el usuario «${config.user}»`))
    expect(error?.message).not.toContain(config.password)
  })

  it('si la base de datos no existe, lo dice y no la crea', async () => {
    const config = testDatabaseConfig('cuentas_test_que_no_existe')
    await expect(openDatabase(config)).rejects.toThrow(/La base de datos «cuentas_test_que_no_existe» no existe/)
    const { db } = await openTestDatabase()
    expect(await db.rows("SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = 'cuentas_test_que_no_existe'")).toEqual([])
  })
})
