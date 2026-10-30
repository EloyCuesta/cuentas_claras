import { readFileSync } from 'node:fs'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import type { PantryActivity, PantryItem, PantryPurchaseChange } from '../../shared/pantry/types.ts'
import type { TicketSuggestion } from '../../shared/tickets/match.ts'
import { parseTicket, type ParsedTicket } from '../../shared/tickets/parse.ts'
import type { OcrLine, PantryTicket, PantryTicketSummary, TicketDecision, TicketSaveInput } from '../../shared/tickets/types.ts'
import { startApi, stopApis, type TestApi } from '../api-test-helpers.ts'
import { removeTempDbs } from '../test-helpers.ts'
import { createTesseractReader, type TicketReader } from './ocr.ts'

/**
 * Tickets de la compra por la API. El ticket es INVENTADO (fixtures/ticket-lidl-ejemplo.png).
 * La primera prueba usa el OCR real; las demás, un lector falso que devuelve lo
 * que el OCR leyó de esa imagen (fixtures/ticket-lidl-ejemplo.ocr.json), para ir rápido.
 */

const FIXTURE_PNG = readFileSync(new URL('../../shared/tickets/fixtures/ticket-lidl-ejemplo.png', import.meta.url))
const FIXTURE_OCR = JSON.parse(readFileSync(new URL('../../shared/tickets/fixtures/ticket-lidl-ejemplo.ocr.json', import.meta.url), 'utf8')) as OcrLine[]
const TRUTH = JSON.parse(readFileSync(new URL('../../shared/tickets/fixtures/ticket-lidl-ejemplo.json', import.meta.url), 'utf8')) as {
  totalCents: number
  lines: { rawName: string; amountCents: number }[]
}

afterEach(async () => {
  await stopApis()
  removeTempDbs()
})

const fakeReader = (pages: OcrLine[][] = [FIXTURE_OCR]): TicketReader => ({ read: async () => pages, close: async () => undefined })

interface Draft {
  ticket: ParsedTicket
  suggestions: Record<string, TicketSuggestion>
  duplicate: PantryTicketSummary | null
}

const guest = (api: TestApi) => ({
  call: (method: string, path: string, body?: unknown) => api.call(method, path, body, { cookie: null }),
})

async function read(api: TestApi, body: Record<string, unknown> = { imagenes: [FIXTURE_PNG.toString('base64')], hoy: '2026-10-25' }) {
  const result = await guest(api).call('POST', '/despensa/tickets/leer', body)
  return { ...result, draft: result.body.data as Draft }
}

/** Lo que enviaría la revisión aceptando todas las sugerencias (con cambios opcionales). */
function saveInput(draft: Draft, overrides: Partial<TicketSaveInput> = {}, decide?: (key: string, s: TicketSuggestion) => TicketDecision | null): TicketSaveInput {
  const decisions: Record<string, TicketDecision> = {}
  for (const [key, suggestion] of Object.entries(draft.suggestions)) {
    decisions[key] =
      decide?.(key, suggestion) ??
      (suggestion.kind === 'new'
        ? { kind: 'new', name: suggestion.name, ownerId: null, frequency: suggestion.frequency }
        : suggestion.kind === 'ignore'
          ? { kind: 'ignore' }
          : { kind: 'item', itemId: suggestion.itemId })
  }
  return {
    store: draft.ticket.store,
    storeName: draft.ticket.storeName,
    address: draft.ticket.address,
    date: draft.ticket.date ?? '2026-10-25',
    time: draft.ticket.time,
    totalCents: draft.ticket.totalCents,
    adjustments: draft.ticket.adjustments.map(a => ({ ...a, needsReview: false })),
    acknowledged: true,
    lines: draft.ticket.lines.map((line) => ({
      rawName: line.rawName,
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents,
      amountCents: line.amountCents,
      discountCents: line.discountCents,
      weightKg: line.weightKg,
      pricePerKgCents: line.pricePerKgCents,
      taxCode: line.taxCode,
      occasional: false,
    })),
    decisions,
    ...overrides,
  }
}

const items = async (api: TestApi) => (await guest(api).call('GET', '/despensa/productos')).body.data as PantryItem[]
const byName = (list: PantryItem[], name: string) => list.find((item) => item.name === name)

describe('lector de tickets (OCR real)', () => {
  const reader = createTesseractReader()
  afterAll(() => reader.close())

  it('lee la captura del ticket de ejemplo: los importes suman el total', { timeout: 120_000 }, async () => {
    const pages = await reader.read([FIXTURE_PNG])
    const ticket = parseTicket(pages)
    // Tesseract da poca confianza a algún importe de esta imagen: la suma coincide, pero esas
    // líneas quedan por confirmar («pendiente») salvo que una multiplicación las compruebe.
    expect(['cuadra', 'pendiente']).toContain(ticket.check.status)
    expect(ticket.check.differenceCents).toBe(0)
    for (const line of ticket.lines.filter(l => l.flags.length)) {
      expect(line.weightKg === null && line.unitPriceCents === null, line.rawName).toBe(true)
      expect(line.evidence?.issues.length, line.rawName).toBeGreaterThan(0)
    }
    expect(ticket.totalCents).toBe(TRUTH.totalCents)
    expect(ticket.lines.map((l) => [l.rawName, l.amountCents])).toEqual(TRUTH.lines.map((l) => [l.rawName, l.amountCents]))
  })
})

describe('lector de tickets (OCR real) con el ticket sintético de Torrelavega', () => {
  const reader = createTesseractReader()
  afterAll(() => reader.close())
  const truth = JSON.parse(readFileSync(new URL('../../shared/tickets/fixtures/ticket-torrelavega-sintetico.json', import.meta.url), 'utf8')) as {
    totalCents: number; lines: { rawName: string; amountCents: number; quantity: number; unitPriceCents: number | null; weightKg: number | null }[]
  }
  it('lee multiplicaciones, pesos, IVA y publicidad sin aceptar ningún importe erróneo en silencio', { timeout: 120_000 }, async () => {
    // Imagen SINTÉTICA con las líneas del ticket real que aportó el usuario; no es su captura de Lidl Plus.
    const ticket = parseTicket(await reader.read([readFileSync(new URL('../../shared/tickets/fixtures/ticket-torrelavega-sintetico.png', import.meta.url))]))
    expect(ticket).toMatchObject({ totalCents: truth.totalCents, date: '2026-10-28', time: '19:24', paymentMethod: 'Lidl Pay' })
    expect(ticket.taxGroups?.map(g => g.code)).toEqual(['A', 'B', 'C'])
    expect(ticket.lines.map(l => l.rawName)).toEqual(truth.lines.map(l => l.rawName))
    truth.lines.forEach((real, i) => {
      const line = ticket.lines[i]
      expect([line.quantity, line.unitPriceCents, line.weightKg], real.rawName).toEqual([real.quantity, real.unitPriceCents, real.weightKg])
      if (line.amountCents !== real.amountCents) expect(line.flags.length, real.rawName).toBeGreaterThan(0)
    })
    // La publicidad de después («CHOCOLATE NEGRO 72% 1,29 B») no es una compra.
    expect(ticket.lines.some(l => /CHOCOLATE/.test(l.rawName))).toBe(false)
  })
})

describe('API de tickets', () => {
  it('lee un ticket sin guardar nada y propone productos nuevos con nombres legibles', async () => {
    const api = await startApi({ login: false, ticketReader: fakeReader() })
    const { status, draft } = await read(api)
    expect(status).toBe(200)
    expect(draft.ticket).toMatchObject({ store: 'lidl', date: '2026-10-24', time: '18:05', totalCents: 5251 })
    // La suma coincide; las tres lecturas con cifras de más quedan por confirmar.
    expect(draft.ticket.check).toMatchObject({ status: 'pendiente', differenceCents: 0, pending: 3 })
    expect(draft.duplicate).toBeNull()
    expect(draft.suggestions['LECHE SEMIDESNATADA']).toEqual({ kind: 'new', name: 'Leche semidesnatada', frequency: 'semanal' })
    expect(draft.suggestions['PAPEL HIGIENICO 12R']).toMatchObject({ kind: 'new', frequency: 'mensual' })
    expect(await items(api)).toEqual([])
    expect((await guest(api).call('GET', '/despensa/tickets')).body.data).toEqual([])
  })

  it('un importe mal leído («92,90» por 9,90): se guarda con su evidencia y no toca la despensa hasta confirmarlo', async () => {
    const api = await startApi({ login: false, ticketReader: fakeReader() })
    const potatoes = 'LIDL SUPERMERCADOS S.A.U.\nEUR\nPATATA NUEVA 5 KG   4,95X   2   92,90 A\nTOTAL 9,90\nLidl Pay 9,90\nFECHA: 28/10/26\nHORA: 19:24:38'
    const { status, draft } = await read(api, { texto: potatoes, hoy: '2026-10-29' })
    expect(status).toBe(200)
    const line = draft.ticket.lines[0]
    expect(line).toMatchObject({ amountCents: 990, unitPriceCents: 495, quantity: 2, flags: ['corregido', 'dudoso'],
      evidence: { recognizedCents: 9290, calculatedCents: 990, discrepancy: { verdict: 'calculation' } } })
    const base = saveInput(draft)
    const toSave = (confirmed: boolean, extra: Partial<TicketSaveInput> = {}) => ({ ...base, ...extra,
      lines: base.lines.map(l => ({ ...l, confirmed, evidence: line.evidence })) })

    // Sin confirmar: el ticket se guarda (historial), la línea queda pendiente y no crea producto ni precio.
    const pending = await guest(api).call('POST', '/despensa/tickets', toSave(false))
    expect(pending.status).toBe(201)
    const saved = (await guest(api).call('GET', `/despensa/tickets/${(pending.body.data as { ticket: PantryTicket }).ticket.id}`)).body.data as PantryTicket
    expect(saved.lines[0]).toMatchObject({ amountCents: 990, reviewStatus: 'pending', confirmed: false, itemId: null,
      evidence: { recognizedCents: 9290, discrepancy: { recognizedCents: 9290, calculatedCents: 990, verdict: 'calculation' },
        options: [{ cents: 990, origin: 'calculation' }, { cents: 9290, origin: 'read' }] } })
    expect(byName(await items(api), 'Patata nueva 5 kg')).toBeUndefined()

    // Confirmado (otra compra): ahora sí crea el producto, con el precio de 9,90 € / 2.
    const confirmed = await guest(api).call('POST', '/despensa/tickets', toSave(true, { time: '20:00', distinctPurchase: true,
      importId: undefined, sourceFingerprint: undefined }))
    expect(confirmed.status).toBe(201)
    expect(byName(await items(api), 'Patata nueva 5 kg')).toMatchObject({ priceCents: 495 })
  })

  it('la API nunca acepta como fiable 92,90 € con 4,95 × 2, aunque el cliente diga que está confirmado', async () => {
    const api = await startApi({ login: false, ticketReader: fakeReader() })
    const { draft } = await read(api, { texto: 'LIDL\nEUR\nPATATA NUEVA 5 KG   4,95X   2   92,90 A\nTOTAL 92,90\nFECHA: 28/10/26', hoy: '2026-10-29' })
    const base = saveInput(draft)
    const forced = { ...base, lines: base.lines.map(l => ({ ...l, amountCents: 9290, confirmed: true })) }
    const result = await guest(api).call('POST', '/despensa/tickets', forced)
    expect(result.status).toBe(201)
    const saved = (await guest(api).call('GET', `/despensa/tickets/${(result.body.data as { ticket: PantryTicket }).ticket.id}`)).body.data as PantryTicket
    expect(saved.lines[0]).toMatchObject({ amountCents: 9290, reviewStatus: 'pending' })
    expect(byName(await items(api), 'Patata nueva 5 kg')).toBeUndefined()
  })

  it('valida las imágenes y acepta texto pegado', async () => {
    const api = await startApi({ login: false, ticketReader: fakeReader() })
    const g = guest(api)
    expect((await g.call('POST', '/despensa/tickets/leer', { imagenes: [] })).status).toBe(400)
    expect((await g.call('POST', '/despensa/tickets/leer', { imagenes: [Buffer.from('hola').toString('base64')] })).body.error?.message).toMatch(/PNG o JPEG/)
    expect((await g.call('POST', '/despensa/tickets/leer', { imagenes: Array(7).fill(FIXTURE_PNG.toString('base64')) })).status).toBe(400)
    expect((await g.call('POST', '/despensa/tickets/leer', { texto: '   ' })).status).toBe(400)
    expect((await g.call('POST', '/despensa/tickets/leer', { texto: 'Hola\nAdiós' })).body.error?.message).toMatch(/ningún producto/)
    const pasted = await read(api, { texto: 'MERCADONA, S.A.\n28/10/2026 19:24\n1 PAN BARRA   0,60\nTOTAL   0,60', hoy: '2026-10-28' })
    expect(pasted.draft.ticket).toMatchObject({ store: 'otra', storeName: 'Mercadona', totalCents: 60 })
    // Un fallo del OCR se explica sin tumbar el servidor.
    const broken = await startApi({ login: false, ticketReader: { read: () => Promise.reject(new Error('x')), close: async () => undefined } })
    const failed = await guest(broken).call('POST', '/despensa/tickets/leer', { imagenes: [FIXTURE_PNG.toString('base64')] })
    expect(failed).toMatchObject({ status: 400, body: { error: { message: expect.stringMatching(/más nítida/) } } })
  })

  it('guarda el ticket: crea los productos, recuerda lo aprendido y no lo guarda dos veces', async () => {
    const api = await startApi({ login: false, ticketReader: fakeReader() })
    const { draft } = await read(api)
    const input = saveInput(draft, {}, (key) => (key === 'DETERGENTE LIQUIDO' ? { kind: 'ignore' } : null))
    const saved = await guest(api).call('POST', '/despensa/tickets', input)
    expect(saved.status).toBe(201)
    const { ticket } = saved.body.data as { ticket: PantryTicket; items: PantryItem[] }
    expect(ticket).toMatchObject({ storeName: 'Lidl', date: '2026-10-24', totalCents: 5251, linesCount: 18 })
    expect(ticket.lines.find((l) => l.rawName === 'DETERGENTE LÍQUIDO')?.itemId).toBeNull()

    const list = await items(api)
    // 18 líneas: los macarrones dos veces y el detergente no se sigue.
    expect(list).toHaveLength(16)
    expect(byName(list, 'Leche semidesnatada')).toMatchObject({ tracking: 'compras', unit: 'ud', priceCents: 95 })
    expect(byName(list, 'Pechuga de pollo')).toMatchObject({ unit: 'kg', priceCents: 693 })
    // La promoción general no se asigna al café; el descuento del pollo sí afecta a su precio por kilo.
    expect(byName(list, 'Café molido natural')).toMatchObject({ priceCents: 329, frequency: 'mensual' })
    expect(ticket.productsCount).toBe(16)

    expect((await guest(api).call('POST', '/despensa/tickets', input)).status).toBe(409)
    const again = await read(api)
    expect(again.draft.duplicate).toMatchObject({ id: ticket.id })
    // Lo aprendido: la próxima vez todo llega emparejado (y el detergente, sin seguir).
    expect(again.draft.suggestions['LECHE SEMIDESNATADA']).toEqual({
      kind: 'item',
      itemId: byName(list, 'Leche semidesnatada')!.id,
      how: 'recordado',
    })
    expect(again.draft.suggestions['DETERGENTE LIQUIDO']).toEqual({ kind: 'ignore', how: 'recordado' })
  })

  it('en los productos que se cuentan, suma lo comprado y actualiza el precio', async () => {
    const api = await startApi({ login: false, ticketReader: fakeReader() })
    const rice = (
      await guest(api).call('POST', '/despensa/productos', {
        name: 'Arroz',
        ownerId: null,
        unit: 'paquete',
        tracking: 'cantidad',
        quantity: 1,
        target: 3,
        frequency: 'mensual',
        priceCents: 100,
        notes: '',
      })
    ).body.data as PantryItem
    const { draft } = await read(api)
    expect(draft.suggestions['ARROZ REDONDO']).toMatchObject({ kind: 'new' })
    await guest(api).call('POST', '/despensa/tickets', saveInput(draft, {}, (key) => (key === 'ARROZ REDONDO' ? { kind: 'item', itemId: rice.id } : null)))
    expect(byName(await items(api), 'Arroz')).toMatchObject({ quantity: 2, priceCents: 115, version: 3 })
  })

  it('rechaza decisiones que no encajan sin guardar nada', async () => {
    const api = await startApi({ login: false, ticketReader: fakeReader() })
    const { draft } = await read(api)
    const g = guest(api)
    const noDecision = saveInput(draft)
    delete noDecision.decisions['LECHE SEMIDESNATADA']
    expect((await g.call('POST', '/despensa/tickets', noDecision)).status).toBe(400)
    const ghost = saveInput(draft, {}, (key) => (key === 'LECHE SEMIDESNATADA' ? { kind: 'item', itemId: 'no-existe' } : null))
    expect((await g.call('POST', '/despensa/tickets', ghost)).status).toBe(400)
    const noPerson = saveInput(draft, {}, (key) => (key === 'LECHE SEMIDESNATADA' ? { kind: 'new', name: 'Leche', ownerId: 'nadie', frequency: 'semanal' } : null))
    expect((await g.call('POST', '/despensa/tickets', noPerson)).status).toBe(400)
    expect((await g.call('POST', '/despensa/tickets', { ...saveInput(draft), date: '24/10/2026' })).status).toBe(400)
    expect((await g.call('POST', '/despensa/tickets', { ...saveInput(draft), lines: [] })).status).toBe(400)
    expect(await items(api)).toEqual([])
    expect((await g.call('GET', '/despensa/tickets')).body.data).toEqual([])
  })

  it('da el historial de compras para el ritmo, sin las compras «para una ocasión»', async () => {
    const api = await startApi({ login: false, ticketReader: fakeReader() })
    const { draft } = await read(api)
    const input = saveInput(draft)
    input.lines = input.lines.map((line) => (line.rawName === 'QUESO EN LONCHAS' ? { ...line, occasional: true } : line))
    await guest(api).call('POST', '/despensa/tickets', input)
    const list = await items(api)
    const activity = (await guest(api).call('GET', '/despensa/actividad?hoy=2026-10-30')).body.data as PantryActivity
    const of = (name: string) => activity.purchases.filter((p) => p.itemId === byName(list, name)?.id)
    expect(of('Plátano canario')).toEqual([expect.objectContaining({ date: '2026-10-24', amount: 0.812, measure: 'kg', costCents: 231, store: 'Lidl' })])
    expect(of('Macarrones')).toEqual([expect.objectContaining({ amount: 2, measure: 'ud', costCents: 170 })])
    expect(of('Pechuga de pollo')).toEqual([expect.objectContaining({ costCents: 527 - 53 })])
    expect(of('Queso en lonchas')).toEqual([])
    expect(activity.events).toEqual([])
  })

  it('«Queda», «Se acabó» y «Lo he comprado», y comprar desde la lista con deshacer', async () => {
    const api = await startApi({ login: false, ticketReader: fakeReader() })
    const g = guest(api)
    const { draft } = await read(api)
    await g.call('POST', '/despensa/tickets', saveInput(draft))
    const milk = byName(await items(api), 'Leche semidesnatada')!

    const out = await g.call('POST', `/despensa/productos/${milk.id}/revision`, { kind: 'se_acabo', date: '2026-10-28' })
    expect(out.status).toBe(201)
    expect(out.body.data).toMatchObject({ itemId: milk.id, kind: 'se_acabo', date: '2026-10-28' })
    expect((await g.call('POST', `/despensa/productos/${milk.id}/revision`, { kind: 'otra', date: '2026-10-28' })).status).toBe(400)
    expect((await g.call('POST', `/despensa/productos/${milk.id}/revision`, { kind: 'queda' })).status).toBe(400)
    expect((await g.call('POST', '/despensa/productos/no-existe/revision', { kind: 'queda', date: '2026-10-28' })).status).toBe(404)

    const bought = await g.call('POST', '/despensa/comprado', { ids: [milk.id], date: '2026-10-29' })
    const { changes } = bought.body.data as { changes: PantryPurchaseChange[] }
    expect(changes).toEqual([{ id: milk.id, eventId: expect.any(String) }])
    let activity = (await g.call('GET', '/despensa/actividad?hoy=2026-10-30')).body.data as PantryActivity
    expect(activity.events.map((e) => [e.kind, e.date])).toEqual([
      ['se_acabo', '2026-10-28'],
      ['comprado', '2026-10-29'],
    ])
    expect((await g.call('POST', '/despensa/comprado/deshacer', { changes })).status).toBe(200)
    expect((await g.call('POST', '/despensa/comprado/deshacer', { changes })).status).toBe(409)
    activity = (await g.call('GET', '/despensa/actividad?hoy=2026-10-30')).body.data as PantryActivity
    expect(activity.events.map((e) => e.kind)).toEqual(['se_acabo'])

    expect((await g.call('DELETE', `/despensa/revisiones/${(out.body.data as { id: string }).id}`)).status).toBe(200)
    expect((await g.call('DELETE', '/despensa/revisiones/no-existe')).status).toBe(404)
  })

  it('«Queda poco» y el día del repaso de la semana, también sin el código', async () => {
    const api = await startApi({ login: false, ticketReader: fakeReader() })
    const g = guest(api)
    const { draft } = await read(api)
    await g.call('POST', '/despensa/tickets', saveInput(draft))
    const milk = byName(await items(api), 'Leche semidesnatada')!

    const low = await g.call('POST', `/despensa/productos/${milk.id}/revision`, { kind: 'poco', date: '2026-10-28' })
    expect(low.status).toBe(201)
    expect(low.body.data).toMatchObject({ itemId: milk.id, kind: 'poco', date: '2026-10-28' })

    expect((await g.call('GET', '/despensa/presupuesto')).body.data).toEqual({ monthlyBudgetCents: null, lastReviewDate: null })
    const reviewed = await g.call('PUT', '/despensa/repaso', { date: '2026-10-29' })
    expect(reviewed.status).toBe(200)
    expect(reviewed.body.data).toEqual({ monthlyBudgetCents: null, lastReviewDate: '2026-10-29' })
    expect((await g.call('PUT', '/despensa/repaso', { date: 'ayer' })).status).toBe(400)
    expect((await g.call('PUT', '/despensa/repaso', {})).status).toBe(400)
    // El presupuesto y el repaso no se pisan.
    expect((await g.call('PUT', '/despensa/presupuesto', { monthlyBudgetCents: 25000 })).body.data).toEqual({
      monthlyBudgetCents: 25000,
      lastReviewDate: '2026-10-29',
    })
  })

  it('cambia el producto de una línea guardada (y de sus iguales) y borra tickets sin borrar productos', async () => {
    const api = await startApi({ login: false, ticketReader: fakeReader() })
    const g = guest(api)
    const { draft } = await read(api)
    const { ticket } = (await g.call('POST', '/despensa/tickets', saveInput(draft))).body.data as { ticket: PantryTicket }
    const list = await items(api)
    const pasta = ticket.lines.find((l) => l.rawName === 'MACARRONES')!
    const rice = byName(list, 'Arroz redondo')!

    const updated = (await g.call('PUT', `/despensa/tickets/${ticket.id}/lineas/${pasta.id}`, { itemId: rice.id })).body.data as PantryTicket
    expect(updated.lines.filter((l) => l.rawName === 'MACARRONES').map((l) => l.itemId)).toEqual([rice.id, rice.id])
    expect((await g.call('PUT', `/despensa/tickets/${ticket.id}/lineas/${pasta.id}`, { itemId: 'no-existe' })).status).toBe(400)
    expect((await g.call('PUT', `/despensa/tickets/${ticket.id}/lineas/otra`, { itemId: null })).status).toBe(404)
    expect((await read(api)).draft.suggestions['MACARRONES']).toEqual({ kind: 'item', itemId: rice.id, how: 'recordado' })

    // Borrar un producto deja la línea sin producto; borrar el ticket quita sus compras pero no los productos.
    await g.call('DELETE', `/despensa/productos/${byName(list, 'Yogur griego')!.id}`)
    const afterDelete = (await g.call('GET', `/despensa/tickets/${ticket.id}`)).body.data as PantryTicket
    expect(afterDelete.lines.find((l) => l.rawName === 'YOGUR GRIEGO')?.itemId).toBeNull()
    expect((await g.call('DELETE', `/despensa/tickets/${ticket.id}`)).status).toBe(200)
    expect((await g.call('GET', `/despensa/tickets/${ticket.id}`)).status).toBe(404)
    expect(((await g.call('GET', '/despensa/actividad')).body.data as PantryActivity).purchases).toEqual([])
    expect(await items(api)).toHaveLength(list.length - 1)
  })

  it('los tickets no aparecen en las finanzas', async () => {
    const api = await startApi({ ticketReader: fakeReader() })
    const { draft } = await read(api)
    await guest(api).call('POST', '/despensa/tickets', saveInput(draft))
    const data = (await api.call('GET', '/data')).body.data as Record<string, unknown[]>
    expect(data.movements).toEqual([])
    expect(JSON.stringify(data)).not.toMatch(/LECHE|Lidl/)
  })
})
