import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CATEGORIES } from '../../shared/finance/categories.ts'
import type { FinanceData } from '../../shared/finance/types.ts'
import { IndexedDbFinanceRepository } from '../storage/IndexedDbFinanceRepository.ts'
import { movement, NOW, rule } from '../../shared/testing/factories.ts'
import { ApiError } from './apiClient.ts'
import { describeBrowserMigration, migrateBrowserData } from './browserDataMigration.ts'

/**
 * Paso de los datos de IndexedDB (versiones anteriores) al servidor. El
 * servidor se simula: aquí se prueba qué decide el navegador.
 */

let dbCounter = 0
let dbName = ''
const storage = new Map<string, string>()

beforeEach(() => {
  dbName = `migracion-${++dbCounter}`
  storage.clear()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Crea la base de datos del navegador como la dejaba la versión anterior. */
async function seedBrowser(data: Partial<FinanceData>, lastBackupAt?: string) {
  const browser = new IndexedDbFinanceRepository({ dbName, now: () => NOW })
  const current = await browser.loadAll()
  await browser.replaceAll({ ...current, ...data })
  if (lastBackupAt) await browser.setMeta('lastBackupAt', lastBackupAt)
  await browser.close()
}

async function browserData() {
  const browser = new IndexedDbFinanceRepository({ dbName })
  const data = await browser.loadAll()
  await browser.close()
  return data
}

/** Servidor simulado que guarda lo importado (o responde con el error indicado). */
function fakeServer({ conflict = false, loses = false } = {}) {
  let stored: FinanceData = { categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })), movements: [], recurring: [] }
  return {
    importBrowserData: vi.fn(async (data: FinanceData) => {
      if (conflict) throw new ApiError('La base de datos ya tiene datos.', 409, 'CONFLICT')
      stored = loses ? { ...data, movements: [] } : data
      return { movements: data.movements.length, recurring: data.recurring.length }
    }),
    loadAll: vi.fn(async () => stored),
  }
}

describe('migrateBrowserData', () => {
  it('no hace nada si en el navegador no hay base de datos (y no la crea)', async () => {
    const server = fakeServer()
    expect(await migrateBrowserData(server, { dbName })).toEqual({ kind: 'nothing' })
    expect(server.importBrowserData).not.toHaveBeenCalled()
    expect((await indexedDB.databases()).some((d) => d.name === dbName)).toBe(false)
  })

  it('no importa si el navegador solo tiene las categorías iniciales', async () => {
    await seedBrowser({})
    const server = fakeServer()
    expect(await migrateBrowserData(server, { dbName })).toEqual({ kind: 'nothing' })
    expect(server.importBrowserData).not.toHaveBeenCalled()
  })

  it('pasa los datos al servidor, lo comprueba y conserva la copia del navegador', async () => {
    const expense = movement({ concept: 'Del navegador' })
    const rent = rule({ startDate: '2026-10-01' })
    await seedBrowser({ movements: [expense], recurring: [rent] }, '2026-10-01T10:00:00.000Z')
    const server = fakeServer()

    const result = await migrateBrowserData(server, { dbName })
    expect(result).toEqual({ kind: 'imported', movements: 1, recurring: 1 })
    expect(server.importBrowserData).toHaveBeenCalledWith(
      expect.objectContaining({ movements: [expense], recurring: [rent] }),
      '2026-10-01T10:00:00.000Z',
    )
    expect(describeBrowserMigration(result)?.message).toBe(
      'Se han pasado a la base de datos 1 movimiento y 1 recurrente que había en este navegador.',
    )
    // La copia del navegador sigue intacta.
    expect((await browserData()).movements).toEqual([expense])

    // La siguiente apertura no vuelve a importar.
    expect(await migrateBrowserData(server, { dbName })).toEqual({ kind: 'nothing' })
    expect(server.importBrowserData).toHaveBeenCalledTimes(1)
  })

  it('si el servidor ya tiene datos no mezcla nada y lo avisa', async () => {
    await seedBrowser({ movements: [movement()] })
    const result = await migrateBrowserData(fakeServer({ conflict: true }), { dbName })
    expect(result).toEqual({ kind: 'server-has-data' })
    expect(describeBrowserMigration(result)?.tone).toBe('error')
    expect((await browserData()).movements).toHaveLength(1)
  })

  it('si no puede comprobar que ha llegado todo, falla y lo vuelve a intentar la próxima vez', async () => {
    await seedBrowser({ movements: [movement()] })
    await expect(migrateBrowserData(fakeServer({ loses: true }), { dbName })).rejects.toThrow(/completos/)
    const server = fakeServer()
    expect(await migrateBrowserData(server, { dbName })).toMatchObject({ kind: 'imported' })
  })
})
