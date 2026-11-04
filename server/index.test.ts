import { randomBytes } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { closedPort, countingListener, runServer } from './common/testing/serverProcess.ts'
import { createTestDatabase, dropTestDatabases, testDatabaseConfig } from './common/testing/testDatabase.ts'

/**
 * Arranque de server/index.ts de verdad, en otro proceso: si MySQL no está
 * como debe, no arranca y explica en español qué revisar, sin enseñar nunca la
 * contraseña. Las pruebas del código de acceso están en
 * server/modules/auth/auth.test.ts.
 */

afterEach(async () => {
  await dropTestDatabases()
})

/** Las CUENTAS_DB_* de las pruebas para una base, como las escribiría alguien en .env. */
function databaseEnv(name: string): Record<string, string> {
  const config = testDatabaseConfig(name)
  return {
    CUENTAS_CODIGO: 'codigo-de-arranque',
    CUENTAS_DB_HOST: config.host,
    CUENTAS_DB_PORT: String(config.port),
    CUENTAS_DB_USER: config.user,
    CUENTAS_DB_PASSWORD: config.password,
    CUENTAS_DB_NAME: name,
  }
}

describe('arranque del servidor con MySQL', () => {
  it('sin CUENTAS_DB_USER no arranca y dice qué falta', async () => {
    const { status, stderr } = await runServer({ ...databaseEnv('cuentas_test_sin_usuario'), CUENTAS_DB_USER: undefined })
    expect(status).toBe(1)
    expect(stderr).toMatch(/Falta CUENTAS_DB_USER/)
  })

  it('si MySQL no responde, no arranca y explica qué revisar', async () => {
    const port = await closedPort()
    const { status, stderr } = await runServer({ ...databaseEnv('cuentas_test_sin_mysql'), CUENTAS_DB_PORT: String(port) })
    expect(status).toBe(1)
    expect(stderr).toMatch(new RegExp(`MySQL no responde en 127\\.0\\.0\\.1:${port} \\(ECONNREFUSED\\)`))
    expect(stderr).toMatch(/MySQL Workbench/)
  })

  it('si MySQL rechaza el usuario, no arranca y no enseña la contraseña', async () => {
    const name = await createTestDatabase()
    const wrong = `incorrecta-${randomBytes(6).toString('hex')}`
    const { status, stdout, stderr } = await runServer({ ...databaseEnv(name), CUENTAS_DB_PASSWORD: wrong })
    expect(status).toBe(1)
    expect(stderr).toMatch(/MySQL ha rechazado el usuario/)
    expect(stderr).toMatch(/CUENTAS_DB_PASSWORD/)
    expect(`${stdout}${stderr}`).not.toContain(wrong)
  })

  it('si la base de datos no existe, no arranca ni la crea, y lo explica', async () => {
    const missing = `cuentas_test_no_existe_${randomBytes(4).toString('hex')}`
    const { status, stdout, stderr } = await runServer(databaseEnv(missing))
    expect(status).toBe(1)
    expect(stderr).toMatch(new RegExp(`La base de datos «${missing}» no existe en MySQL`))
    expect(`${stdout}${stderr}`).not.toContain(testDatabaseConfig(missing).password || 'sin-contraseña')
  })

  it('en modo pruebas no arranca contra la base de uso diario, ni llega a conectar', async () => {
    const mysql = await countingListener()
    try {
      const { status, stderr } = await runServer({
        ...databaseEnv('cuentas_claras'),
        CUENTAS_DB_PORT: String(mysql.port),
        CUENTAS_TEST: '1',
      })
      expect(status).toBe(1)
      expect(stderr).toMatch(/Con CUENTAS_TEST=1 el servidor solo usa la base de las pruebas/)
      expect(mysql.connections()).toBe(0)
    } finally {
      await mysql.close()
    }
  })

  it('con una base de pruebas y el código, arranca, migra y /api/health hace ping a MySQL', async () => {
    const name = await createTestDatabase()
    const port = await closedPort()
    let health: unknown = null
    const result = await runServer(
      { ...databaseEnv(name), CUENTAS_TEST: '1', CUENTAS_PORT: String(port) },
      {
        whenListening: {
          pattern: /Base de datos MySQL/,
          check: async () => {
            health = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json()
          },
        },
      },
    )
    expect(health).toEqual({ ok: true, data: { status: 'ok', schemaVersion: 5 } })
    // La prueba le pide que se cierre en cuanto responde (SIGTERM; en Windows, SIGINT por IPC): cierra el lector y
    // las conexiones y sale con 0. Un cierre forzado daría null.
    expect(result.status).toBe(0)
    expect(result.stdout).toContain(`Cuentas claras escuchando en http://127.0.0.1:${port}/api`)
    expect(result.stdout).toMatch(new RegExp(`Base de datos MySQL: [^ ]+@127\\.0\\.0\\.1:\\d+/${name} \\(esquema 5\\) · MODO PRUEBAS`))
    expect(result.stdout).not.toContain(testDatabaseConfig(name).password || 'sin-contraseña')
  })
})
