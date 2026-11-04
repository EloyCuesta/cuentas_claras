import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { removeTempDbs, tempDbPath } from '../../server/common/testing/tempDb.ts'
import { createTestDatabase, dropTestDatabases, testDatabaseConfig } from '../../server/common/testing/testDatabase.ts'
import { createSyntheticCopy, SYNTHETIC } from './syntheticCopy.ts'

/**
 * El comando de verdad (npm run importar:sqlite ejecuta tools/importer/cli.ts),
 * en otro proceso y sin el .env de nadie: códigos de salida, el informe junto a
 * la copia y que ni la consola ni el informe llevan textos de la copia.
 */

afterEach(async () => {
  await dropTestDatabases()
  removeTempDbs()
})

async function runImporter(args: string[], env: Record<string, string>): Promise<{ status: number | null; output: string }> {
  const base = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('CUENTAS_')))
  const child = spawn(process.execPath, ['--import', 'tsx', 'tools/importer/cli.ts', ...args], { env: { ...base, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => (output += chunk))
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => (output += chunk))
  const [status] = (await once(child, 'close')) as [number | null]
  return { status, output }
}

function databaseEnv(name: string): Record<string, string> {
  const config = testDatabaseConfig(name)
  return {
    CUENTAS_DB_HOST: config.host,
    CUENTAS_DB_PORT: String(config.port),
    CUENTAS_DB_USER: config.user,
    CUENTAS_DB_PASSWORD: config.password,
    CUENTAS_DB_NAME: name,
  }
}

describe('npm run importar:sqlite', () => {
  it('importa, deja el informe junto a la copia y no enseña los datos; la segunda vez se niega', async () => {
    const path = tempDbPath()
    createSyntheticCopy(path)
    const name = await createTestDatabase()

    const first = await runImporter([path], databaseEnv(name))
    expect(first.status, first.output).toBe(0)
    expect(first.output).toMatch(/Resultado: válido\. Importadas 60 filas de 12 tablas/)
    expect(first.output).toMatch(/movements 8 · /)
    const reports = readdirSync(dirname(path)).filter((file) => /^informe-importacion-\d{8}-\d{6}\.json$/.test(file))
    expect(reports).toHaveLength(1)
    const report = readFileSync(join(dirname(path), reports[0]), 'utf8')
    expect(JSON.parse(report)).toMatchObject({ formato: 'cuentas-claras-importacion-v1', resultado: 'válido', verificadoTrasConfirmar: true })
    for (const text of SYNTHETIC.privateTexts) {
      expect(first.output).not.toContain(text)
      expect(report).not.toContain(text)
    }
    expect(`${first.output}${report}`).not.toContain(testDatabaseConfig(name).password || 'sin-contraseña')

    // Ya tiene datos: no mezcla nada, sale con 2 y lo explica.
    const second = await runImporter([path, '--informe', join(dirname(path), 'segundo.json')], databaseEnv(name))
    expect(second.status).toBe(2)
    expect(second.output).toMatch(/no está vacía/)
    expect(JSON.parse(readFileSync(join(dirname(path), 'segundo.json'), 'utf8')).resultado).toBe('rechazado')
  })

  it('sin la copia o sin el usuario de MySQL, explica cómo se usa y sale con 2', async () => {
    const name = await createTestDatabase()
    const usage = await runImporter([], databaseEnv(name))
    expect([usage.status, usage.output]).toEqual([2, expect.stringMatching(/Uso: npm run importar:sqlite -- <copia de cuentas\.db>/)])
    const { CUENTAS_DB_USER: _user, ...withoutUser } = databaseEnv(name)
    const noUser = await runImporter([tempDbPath()], withoutUser)
    expect([noUser.status, noUser.output]).toEqual([2, expect.stringMatching(/Falta CUENTAS_DB_USER/)])
  })
})
