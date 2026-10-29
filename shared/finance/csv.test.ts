import { describe, expect, it } from 'vitest'
import { categories, movement } from '../testing/factories.ts'
import { categoryMonthMatrix, monthlySeries } from './annual.ts'
import { monthTemplateCsv, movementsToCsv, yearTemplateCsv } from './csv.ts'
import { monthPeriod } from './period.ts'
import { categoryBreakdown } from './summary.ts'

describe('movementsToCsv', () => {
  it('usa formato español y gastos en negativo', () => {
    const csv = movementsToCsv(
      [
        movement({ concept: 'Mercadona', amountCents: 123456, paidDate: '2026-10-12' }),
        movement({ concept: 'Nómina', type: 'ingreso', categoryId: 'i-nomina', amountCents: 185000, paidDate: '2026-10-01' }),
      ],
      categories(),
    )
    const lines = csv.trimEnd().split('\r\n')
    expect(lines[0]).toBe(
      'Fecha;Tipo;Concepto;Categoría;Subcategoría;Importe (€);Estado;Fecha de pago o cobro;Fecha prevista;Recurrente;Notas',
    )
    expect(lines[1]).toBe('01/10/2026;Ingreso;Nómina;Nómina;;1850,00;Cobrado;01/10/2026;;No;')
    expect(lines[2]).toBe('12/10/2026;Gasto;Mercadona;Alimentación;Supermercado;-1234,56;Pagado;12/10/2026;;No;')
  })

  it('escapa separadores, comillas y posibles fórmulas', () => {
    const csv = movementsToCsv([movement({ concept: '=SUMA(A1)', notes: 'uno; "dos"' })], categories())
    const row = csv.split('\r\n')[1]
    expect(row).toContain(";'=SUMA(A1);")
    expect(row.endsWith(';"uno; ""dos"""')).toBe(true)
  })
})

describe('plantillas', () => {
  const cats = categories().map((c) => (c.id === 'g-alimentacion' ? { ...c, budgetCents: 40000 } : c))
  const data = [
    movement({ type: 'ingreso', categoryId: 'i-nomina', amountCents: 185000, paidDate: '2026-10-01' }),
    movement({ amountCents: 5430, paidDate: '2026-10-12' }),
    movement({ status: 'pendiente', paidDate: null, dueDate: '2026-10-30', categoryId: 'g-vivienda-luz', amountCents: 7235 }),
  ]

  it('la mensual lista categorías, subcategorías, totales y resultado', () => {
    const lines = monthTemplateCsv(categoryBreakdown(data, cats, monthPeriod(2026, 10))).trimEnd().split('\r\n')
    expect(lines[0]).toBe('Tipo;Categoría;Subcategoría;Presupuesto (€);Pagado o cobrado (€);Pendiente (€);Total (€);Queda (€)')
    expect(lines[1]).toBe('Ingreso;Nómina;;;1850,00;0,00;1850,00;')
    expect(lines).toContain('Ingreso;Total ingresos;;;1850,00;0,00;1850,00;')
    expect(lines).toContain('Gasto;Vivienda;;;0,00;72,35;72,35;')
    expect(lines).toContain('Gasto;Vivienda;Luz;;0,00;72,35;72,35;')
    expect(lines).toContain('Gasto;Alimentación;;400,00;54,30;0,00;54,30;345,70')
    // «Queda» solo cuenta las categorías con presupuesto (aquí, Alimentación).
    expect(lines).toContain('Gasto;Total gastos;;400,00;54,30;72,35;126,65;345,70')
    expect(lines.at(-1)).toBe(';Resultado;;;1795,70;-72,35;1723,35;')
  })

  it('la anual tiene una columna por mes y los totales al final', () => {
    const income = categoryMonthMatrix(data, cats, 2026, 'ingreso')
    const expense = categoryMonthMatrix(data, cats, 2026, 'gasto')
    const lines = yearTemplateCsv(income, expense, monthlySeries(data, 2026)).trimEnd().split('\r\n')
    expect(lines[0]).toBe('Tipo;Categoría;Ene;Feb;Mar;Abr;May;Jun;Jul;Ago;Sep;Oct;Nov;Dic;Total')
    const zeros = (n: number) => Array(n).fill('0,00').join(';')
    expect(lines[1]).toBe(`Ingreso;Nómina;${zeros(9)};1850,00;${zeros(2)};1850,00`)
    expect(lines).toContain(`Gasto;Vivienda;${zeros(9)};72,35;${zeros(2)};72,35`)
    expect(lines).toContain(`;Resultado;${zeros(9)};1723,35;${zeros(2)};1723,35`)
    expect(lines).toContain(`;Acumulado;${zeros(9)};1723,35;1723,35;1723,35;1723,35`)
    expect(lines.at(-1)).toBe(`;De lo anterior, pendiente de pagar;${zeros(9)};72,35;${zeros(2)};72,35`)
  })
})
