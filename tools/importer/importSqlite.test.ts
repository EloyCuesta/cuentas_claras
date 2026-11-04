import Database from 'better-sqlite3'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { FinanceData } from '#shared/finance/types.ts'
import type { PantryItem, PantrySettings } from '#shared/pantry/types.ts'
import type { PantryTicket } from '#shared/tickets/types.ts'
import { startApi, stopApis } from '../../server/common/testing/testApi.ts'
import { removeTempDbs, tempDbPath } from '../../server/common/testing/tempDb.ts'
import { connectTestDatabase, createTestDatabase, dropTestDatabases, openTestDatabase, testDatabaseConfig } from '../../server/common/testing/testDatabase.ts'
import { initialSchema } from '../sqlite/001-esquema-inicial.ts'
import { pantrySchema } from '../sqlite/002-despensa.ts'
import { ticketsSchema } from '../sqlite/003-tickets.ts'
import { reviewSchema } from '../sqlite/004-repaso.ts'
import { importSqlite } from './importSqlite.ts'
import { exitCode } from './report.ts'
import { createSyntheticCopy, SYNTHETIC } from './syntheticCopy.ts'
import { IMPORT_TABLES } from './tables.ts'

/**
 * El importador contra MySQL de verdad, con copias de cuentas.db inventadas
 * (syntheticCopy.ts, creadas con las migraciones 001–005 de SQLite): carga
 * completa y comprobada, lo que ve después la aplicación, y lo que rechaza o
 * deshace sin dejar nada a medias.
 */

const NOW = '2026-11-04T10:00:00.000Z'

afterEach(async () => {
  await stopApis()
  await dropTestDatabases()
  removeTempDbs()
})

/**
 * Ejecuta `work` con la carpeta temporal del sistema (TEMP, TMP y TMPDIR) en una vacía y devuelve lo que quede en
 * ella: el importador lee la copia desde un duplicado ahí y lo tiene que borrar siempre.
 */
async function leftInTempFolder(work: () => Promise<void>): Promise<string[]> {
  const folder = mkdtempSync(join(tmpdir(), 'cuentas-claras-test-temp-'))
  const saved = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR }
  Object.assign(process.env, { TEMP: folder, TMP: folder, TMPDIR: folder })
  try {
    await work()
    return readdirSync(folder)
  } finally {
    for (const [variable, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[variable]
      else process.env[variable] = value
    }
    rmSync(folder, { recursive: true, force: true })
  }
}

/** Una base MySQL de pruebas vacía, sin tablas: como la crea la persona en Workbench. */
async function emptyTarget() {
  const name = await createTestDatabase()
  return { name, config: testDatabaseConfig(name) }
}

/** Filas de cada tabla de la aplicación en MySQL. */
async function counts(name: string): Promise<Record<string, number>> {
  const db = await connectTestDatabase(name)
  const result: Record<string, number> = {}
  for (const table of IMPORT_TABLES) {
    const [rows] = (await db.query(`SELECT COUNT(*) AS n FROM ${table.name}`)) as unknown as [{ n: number }[]]
    result[table.name] = rows[0].n
  }
  return result
}

const empty = Object.fromEntries(IMPORT_TABLES.map((table) => [table.name, 0]))

describe('importador SQLite → MySQL', () => {
  it('importa una copia de la versión 5 sin perder nada y la aplicación la ve igual', async () => {
    const path = tempDbPath()
    createSyntheticCopy(path)
    const { name, config } = await emptyTarget()
    const report = await importSqlite({ sourcePath: path, target: config, now: () => NOW })

    expect([report.resultado, exitCode(report), report.verificadoTrasConfirmar]).toEqual(['válido', 0, true])
    expect(report.origen).toMatchObject({ archivo: 'cuentas.db', versionEsquema: 5, integridad: 'ok', referencias: 'ok' })
    expect(report.origen?.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(report.destino).toMatchObject({ versionEsquema: 5, categoriasSembradas: false })
    expect(Object.entries(report.tablas).map(([table, entry]) => [table, entry.origen.filas, entry.destino?.filas, entry.iguales])).toEqual([
      ['categories', 28, 28, true],
      ['recurring_rules', 2, 2, true],
      ['recurring_excluded_dates', 2, 2, true],
      ['movements', 8, 8, true],
      ['pantry_people', 2, 2, true],
      ['pantry_items', 3, 3, true],
      ['pantry_settings', 1, 1, true],
      ['pantry_tickets', 3, 3, true],
      ['pantry_ticket_lines', 3, 3, true],
      ['pantry_aliases', 2, 2, true],
      ['pantry_events', 4, 4, true],
      ['meta', 2, 2, true],
    ])
    for (const entry of Object.values(report.tablas)) expect(entry.destino?.huella).toBe(entry.origen.huella)
    expect(report.tablas.movements.claves).toEqual(['MOV-A', 'mov-a', 'mov-a ', 'mov-cuota-1', 'mov-cuota-2', 'mov-huerfano', 'mov-max', 'mov-á'])
    expect(report.sumas?.iguales).toBe(true)
    expect(report.sumas?.destino?.finanzas.movimientos).toEqual({
      'gasto/pendiente': { filas: 2, centimos: 22235 },
      'gasto/realizado': { filas: 4, centimos: 22521 },
      'ingreso/realizado': { filas: 2, centimos: 100_000_184_999 },
    })
    expect(report.sumas?.destino?.despensa.productos).toMatchObject({ milesimasCantidad: 2034, sumaVersiones: 11 })
    expect(report.sumas?.destino?.tickets.tickets).toMatchObject({ totalCentimos: 984, devoluciones: 1, sinTotal: 1 })

    // Lo que ve la aplicación con esa base: las finanzas tal cual, sin las categorías iniciales que faltaban.
    const api = await startApi({ database: name })
    const data = (await api.call('GET', '/data')).body.data as FinanceData
    expect(data.categories).toHaveLength(28)
    expect(data.categories.map((c) => c.id)).not.toContain('g-ocio')
    expect(data.categories.find((c) => c.id === 'cat-propia')).toEqual({ id: 'cat-propia', name: 'Ñoño propio', type: 'gasto', parentId: null, order: 2.5, budgetCents: 12345 })
    expect(data.movements.map((m) => m.id)).toEqual(report.tablas.movements.claves)
    expect(data.movements.find((m) => m.id === 'mov-max')?.amountCents).toBe(99_999_999_999)
    expect(data.movements.find((m) => m.id === 'mov-huerfano')).toMatchObject({ recurringId: 'rule-borrado', occurrenceDate: '2026-07-01' })
    expect(data.movements.find((m) => m.id === 'MOV-A')?.notes).toHaveLength(5000)
    expect(data.movements.find((m) => m.id === 'mov-a ')).toMatchObject({ createdAt: 'importado', updatedAt: 'importado' })
    expect(data.recurring.find((r) => r.id === 'rule-alquiler')?.excludedDates).toEqual(['2026-08-01', '2026-12-01'])
    expect(data.recurring.find((r) => r.id === 'rule-cuotas')).toMatchObject({ installments: 12, endDate: '2027-08-15', notes: 'Nota inventada con «comillas» y emoji 🧾' })
    expect((await api.call('GET', '/meta/lastBackupAt')).body.data).toEqual({ value: '2026-10-30T20:00:00.000Z' })

    // La despensa y los tickets, sin repetir los efectos de los tickets: cantidades, precios y versiones de la copia.
    const items = (await api.call('GET', '/despensa/productos', undefined, { cookie: null })).body.data as PantryItem[]
    expect(items.map((i) => [i.id, i.quantity, i.target, i.priceCents, i.version, i.tracking])).toEqual([
      ['item-compartido', 1.234, 999_999.999, 10_000_000, 7, 'compras'],
      ['item-persona', 0.5, 6, null, 1, 'cantidad'],
      ['item-contado', 0.3, 0, 0, 3, 'cantidad'],
    ])
    expect((await api.call('GET', '/despensa/presupuesto', undefined, { cookie: null })).body.data).toEqual({
      monthlyBudgetCents: 25000,
      lastReviewDate: '2026-10-26',
    } satisfies PantrySettings)
    const ticket = (await api.call('GET', '/despensa/tickets/ticket-nuevo', undefined, { cookie: null })).body.data as PantryTicket
    expect(ticket).toMatchObject({ totalCents: -250, issues: ['Línea dudosa: «PAN»'], linesCount: 1 })
    expect(ticket.adjustments).toEqual([{ id: 'a1', label: 'Cupón inventado', kind: 'coupon', amountCents: -10, needsReview: false }])
    expect(ticket.lines[0]).toMatchObject({ reviewStatus: 'pending', itemId: null, evidence: { text: 'PAN -2,50 C', confidence: 0.71, words: [{ text: 'ñandú', confidence: 0.5 }] } })
    const old = (await api.call('GET', '/despensa/tickets/ticket-antiguo', undefined, { cookie: null })).body.data as PantryTicket
    expect(old.lines.map((l) => [l.rawName, l.weightKg, l.occasional, l.confirmed])).toEqual([
      ['Leche entera', null, false, false],
      ['Plátano', 0.544, true, true],
    ])
    // La huella antigua en claro sigue sirviendo para reconocer el mismo ticket.
    const repeated = await api.call('POST', '/despensa/tickets', {
      store: 'lidl', storeName: 'Lidl', address: '', date: '2026-10-24', time: '19:24', totalCents: 1234, acknowledged: true,
      lines: [
        { rawName: 'Leche entera', quantity: 2, unitPriceCents: 95, amountCents: 190, discountCents: 0, weightKg: null, pricePerKgCents: null, taxCode: 'A', occasional: false },
        { rawName: 'Plátano', quantity: 1, unitPriceCents: null, amountCents: 367, discountCents: 20, weightKg: 0.544, pricePerKgCents: 675, taxCode: 'B', occasional: true },
      ],
      decisions: { 'LECHE ENTERA': { kind: 'ignore' }, PLATANO: { kind: 'ignore' } },
    }, { cookie: null })
    expect(repeated.status).toBe(409)
  })

  it('rechaza una base de destino que ya tiene datos (la app sembró sus categorías) y no la toca', async () => {
    const path = tempDbPath()
    createSyntheticCopy(path)
    const opened = await openTestDatabase()
    const report = await importSqlite({ sourcePath: path, target: testDatabaseConfig(opened.name), now: () => NOW })
    expect([report.resultado, exitCode(report)]).toEqual(['rechazado', 2])
    expect(report.mensaje).toMatch(/no está vacía/)
    expect(report.problemas).toEqual(['categories: 27 filas'])
    expect(await counts(opened.name)).toEqual({ ...empty, categories: 27 })
  })

  it('rechaza una copia que no está en la versión 5, una que no es de Cuentas claras y una con cambios en su -wal, sin escribir en MySQL', async () => {
    const { name, config } = await emptyTarget()
    // Versión 4: como la dejaba la app antes de la revisión segura de tickets.
    const v4 = tempDbPath()
    const old = new Database(v4)
    old.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)')
    for (const migration of [initialSchema, pantrySchema, ticketsSchema, reviewSchema]) {
      migration.up(old)
      old.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(migration.version, migration.name, NOW)
    }
    old.close()
    const text = tempDbPath()
    writeFileSync(text, 'esto no es una base de datos')
    const leftovers = await leftInTempFolder(async () => {
      expect((await importSqlite({ sourcePath: v4, target: config })).mensaje).toMatch(/versión 4 del esquema de SQLite y el importador solo lee la 5/)
      const notSqlite = await importSqlite({ sourcePath: text, target: config })
      expect([notSqlite.resultado, exitCode(notSqlite), notSqlite.mensaje]).toEqual(['rechazado', 2, expect.stringMatching(/no es una base de datos SQLite/)])
    })
    // Las dos se leyeron desde un duplicado temporal que se borra también al rechazarlas (en Windows, con SQLite ya cerrado).
    expect(leftovers).toEqual([])

    const withWal = tempDbPath()
    createSyntheticCopy(withWal)
    writeFileSync(`${withWal}-wal`, 'cambios sin pasar')
    const walReport = await importSqlite({ sourcePath: withWal, target: config })
    expect([walReport.resultado, walReport.mensaje]).toEqual(['rechazado', expect.stringMatching(/cuentas\.db-wal» con cambios/)])

    expect((await importSqlite({ sourcePath: `${v4}.no-existe`, target: config })).mensaje).toMatch(/No existe la copia/)
    // Nada llegó a MySQL: ni siquiera las tablas (la copia se comprueba antes de conectar).
    const db = await connectTestDatabase(name)
    expect((await db.query('SHOW TABLES'))[0]).toEqual([])
  })

  it('rechaza los valores que MySQL no guardaría tal cual y dice dónde, sin enseñar el valor', async () => {
    const path = tempDbPath()
    createSyntheticCopy(path)
    const copy = new Database(path)
    const secret = `${SYNTHETIC.privateTexts[0]} ${'x'.repeat(480)}`
    copy.prepare(
      `INSERT INTO movements (id, concept, amount_cents, type, category_id, status, paid_date, notes, created_at, updated_at)
       VALUES ('mov-largo', ?, 100, 'gasto', 'cat-propia', 'realizado', '2026-10-01', '', 'x', 'x')`,
    ).run(secret)
    copy.prepare("INSERT INTO recurring_excluded_dates VALUES ('rule-alquiler', '2026-02-30')").run()
    copy.prepare("UPDATE pantry_items SET quantity = 0.0005 WHERE id = 'item-compartido'").run()
    copy.prepare("UPDATE movements SET amount_cents = 9007199254740993 WHERE id = 'mov-max'").run()
    copy.close()

    const { name, config } = await emptyTarget()
    const report = await importSqlite({ sourcePath: path, target: config })
    expect([report.resultado, exitCode(report)]).toEqual(['rechazado', 2])
    expect(report.mensaje).toMatch(/^Hay 4 valores que no cabrían tal cual en MySQL/)
    expect(report.problemas.sort()).toEqual([
      'movements id mov-largo: «concept» tiene 509 caracteres y en MySQL caben 500',
      'movements id mov-max: «amount_cents» es un número entero demasiado grande para la aplicación',
      'pantry_items id item-compartido: «quantity» tiene más de 3 decimales: MySQL lo redondearía',
      'recurring_excluded_dates (rule_id, date) ["rule-alquiler","2026-02-30"]: «date» no es una fecha que exista con la forma AAAA-MM-DD',
    ])
    expect(JSON.stringify(report)).not.toContain(SYNTHETIC.privateTexts[0])
    expect(await counts(name)).toEqual(empty)
  })

  it('un fallo a mitad de la carga lo deshace todo, y después se puede repetir en la misma base', async () => {
    const path = tempDbPath()
    createSyntheticCopy(path)
    const { name, config } = await emptyTarget()
    const loaded: string[] = []
    const failed = await importSqlite({
      sourcePath: path,
      target: config,
      afterTable: async (table) => {
        loaded.push(table)
        if (table === 'pantry_items') throw new Error('fallo de ensayo')
      },
    })
    expect(loaded).toEqual(['categories', 'recurring_rules', 'recurring_excluded_dates', 'movements', 'pantry_people', 'pantry_items'])
    expect([failed.resultado, exitCode(failed)]).toEqual(['rechazado', 2])
    expect(failed.mensaje).toMatch(/La carga ha fallado al cargar «pantry_items».*Se ha deshecho todo: la base queda vacía/)
    expect(await counts(name)).toEqual(empty)

    const retried = await importSqlite({ sourcePath: path, target: config })
    expect(retried.resultado).toBe('válido')
    expect((await counts(name)).movements).toBe(8)
  })

  it('si lo cargado no coincide con la copia, lo deshace y lo dice con la tabla, la clave y la columna', async () => {
    const path = tempDbPath()
    createSyntheticCopy(path)
    const { name, config } = await emptyTarget()
    const report = await importSqlite({
      sourcePath: path,
      target: config,
      // Como si MySQL hubiera guardado algo distinto de lo que se le dio.
      afterTable: async (table, db) => {
        if (table === 'pantry_items') await db.run("UPDATE pantry_items SET version = version + 1 WHERE id = 'item-persona'")
      },
    })
    expect([report.resultado, exitCode(report)]).toEqual(['con diferencias', 1])
    expect(report.tablas.pantry_items).toMatchObject({ iguales: false, diferencias: { faltan: [], sobran: [], distintas: [{ clave: 'item-persona', columnas: ['version'] }] } })
    expect(report.tablas.pantry_items.destino?.huella).not.toBe(report.tablas.pantry_items.origen.huella)
    expect(Object.entries(report.tablas).filter(([, entry]) => !entry.iguales).map(([table]) => table)).toEqual(['pantry_items'])
    expect(report.sumas?.iguales).toBe(false)
    expect(await counts(name)).toEqual(empty)
  })
})
