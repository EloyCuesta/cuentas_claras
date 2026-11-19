import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { readTaxGroups, linesFromText } from '#shared/tickets/ticketParse.ts'
import { COLUMNS, ticketRows } from './plantilla.ts'
import { TICKETS } from './tickets.ts'
import { lineNet, verdadDe } from './verdad.ts'

describe('los tickets sintéticos del banco', () => {
  it('cada verdad guardada en fixtures/tickets/banco/ es la que sale de tickets.ts (regenera con npm run generar:tickets)', () => {
    for (const ticket of TICKETS) {
      const saved = JSON.parse(readFileSync(new URL(`../../fixtures/tickets/banco/${ticket.id}.json`, import.meta.url), 'utf8'))
      expect(saved, ticket.id).toEqual(verdadDe(ticket))
    }
  })

  it('las cuentas cuadran: el total es la suma de las líneas y cada grupo de IVA, la de sus artículos', () => {
    for (const ticket of TICKETS) {
      const truth = verdadDe(ticket)
      expect(truth.totalCents).toBe(ticket.lines.reduce((s, line) => s + lineNet(line), 0))
      expect(truth.taxGroups!.reduce((s, g) => s + g.gross, 0)).toBe(truth.totalCents)
      for (const group of truth.taxGroups!) expect(group.base + group.tax).toBe(group.gross)
    }
  })

  it('el desglose de IVA dibujado lo acepta el analizador, con las mismas cifras', () => {
    for (const ticket of TICKETS) {
      const rows = ticketRows(ticket).filter((row) => /^[ABC] \d+%/.test(row.text))
      const groups = readTaxGroups(linesFromText(rows.map((row) => row.text).join('\n')))
      expect(groups.map((g) => [g.code, g.baseCents, g.taxCents, g.grossCents])).toEqual(
        verdadDe(ticket).taxGroups!.map((g) => [g.code, g.base, g.tax, g.gross]))
    }
  })

  it('el formato es el del ticket: nombres de hasta 20 columnas y filas de 42 como mucho', () => {
    for (const ticket of TICKETS) {
      for (const line of ticket.lines) expect(line.name.length, line.name).toBeLessThanOrEqual(20)
      for (const row of ticketRows(ticket).filter((r) => r.kind === 'mono' || r.kind === 'promo')) expect(row.text.length, row.text).toBeLessThanOrEqual(COLUMNS)
    }
  })

  it('una multiplicación lleva la x minúscula pegada al precio y la PROMO va sangrada en su propia fila', () => {
    const rows = ticketRows(TICKETS.find((t) => t.id === 'corto')!).map((row) => row.text)
    expect(rows).toContain(`CRUASÁN MANTEQUILLA  0,69x   4${' '.repeat(6)}2,76 B`)
    expect(rows).toContain(`  PROMO LIDL PLUS${' '.repeat(18)}-0,20`)
    expect(rows).toContain('  1,032 kg x 1,99   EUR/kg')
    expect(rows).toContain('39700Castro Urdiales')
  })
})
