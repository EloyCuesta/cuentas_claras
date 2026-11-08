import { readFileSync, writeFileSync } from 'node:fs'
import { MAX_CENTS } from '../shared/common/money.ts'
import { DEFAULT_CATEGORIES } from '../shared/finance/categories.ts'
import { corpusJson } from './ticketRules.ts'
import { FINANCE_OPERATIONS, runFinanceRule } from './financeRules.ts'

/**
 * Genera fixtures/migration/rules-finance.json: entradas de las reglas de finanzas que usa el
 * servidor y lo que devuelve TypeScript con ellas. Se ejecuta a mano y el resultado se revisa:
 *
 *   npx tsx tests/generateFinanceRules.ts             # compara con el corpus guardado y dice qué cambiaría
 *   npx tsx tests/generateFinanceRules.ts --escribir  # lo reescribe
 *
 * Las pruebas (tests/migrationFinanceRules.test.ts y la de C#) nunca lo regeneran. Cambiar una
 * regla de shared/finance que use el servidor obliga a regenerarlo, revisar el diff y portar el
 * cambio a C# (backend/src/CuentasClaras.Application/Finance/ y backend/src/CuentasClaras.Domain/Finance/).
 */

const FILE = new URL('../fixtures/migration/rules-finance.json', import.meta.url)

interface Case { id: string; description: string; operation: string; input: unknown; expected: unknown }
const cases: Case[] = []

function add(id: string, description: string, operation: string, input: unknown = {}) {
  if (cases.some((c) => c.id === id)) throw new Error(`Id repetido: ${id}`)
  const clean = corpusJson(input)
  cases.push({ id, description, operation, input: clean, expected: runFinanceRule(operation, structuredClone(clean)) })
}

/** Un cuerpo ya en JSON (`body`) o, para lo que JSON no puede escribir (Infinity, -0, claves repetidas, sustitutos sueltos), su texto (`bodyJson`). */
const body = (value: unknown) => ({ body: value })
const bodyJson = (text: string) => ({ bodyJson: text })
const long = (length: number, unit = 'x') => unit.repeat(length)

// ---------------------------------------------------------------------------
// Registros válidos de partida (datos inventados)

const category = { id: 'g-ensayo', name: 'Categoría de ensayo', type: 'gasto', parentId: null, order: 1.5, budgetCents: 12345 }
const pending = {
  id: 'mov-ensayo', concept: 'Compra de ensayo', amountCents: 1234, type: 'gasto', categoryId: 'g-ensayo', status: 'pendiente',
  paidDate: null, dueDate: '2026-11-15', notes: '', recurringId: null, occurrenceDate: null, installmentNumber: null,
  createdAt: '2026-11-01T08:00:00.000Z', updatedAt: '2026-11-01T08:00:00.000Z',
}
const paid = { ...pending, id: 'mov-pagado', status: 'realizado', paidDate: '2026-11-01', dueDate: null }
const rule = {
  id: 'regla-ensayo', concept: 'Cuota de ensayo', amountCents: 5000, type: 'gasto', categoryId: 'g-ensayo', frequency: 'mensual',
  startDate: '2026-01-31', endDate: null, installments: 3, notes: 'Préstamo inventado', excludedDates: ['2026-02-28'],
  createdAt: '2026-11-01T08:00:00.000Z', updatedAt: '2026-11-01T08:00:00.000Z',
}
const without = (record: Record<string, unknown>, key: string) => Object.fromEntries(Object.entries(record).filter(([k]) => k !== key))

// ---------------------------------------------------------------------------
// validateCategory

add('categoria-valida', 'Una categoría completa', 'validateCategory', body(category))
add('categoria-campos-extra', 'Solo se quedan los campos conocidos', 'validateCategory', body({ ...category, extra: 1, children: [] }))
add('categoria-sin-padre', 'parentId que falta es null', 'validateCategory', body(without(category, 'parentId')))
add('categoria-sin-presupuesto', 'budgetCents que falta es null', 'validateCategory', body(without(category, 'budgetCents')))
for (const [id, value] of [['sin-cuerpo', undefined], ['nula', null], ['lista', []], ['texto', 'categoria'], ['numero', 42]] as const) {
  add(`categoria-${id}`, 'Un cuerpo que no es un objeto', 'validateCategory', value === undefined ? {} : body(value))
}
const categoryFields: [string, string, unknown][] = [
  ['id-falta', 'id', undefined], ['id-numero', 'id', 7], ['id-vacio', 'id', ''], ['id-espacios', 'id', '   '],
  ['id-bom', 'id', '﻿'], ['id-nel', 'id', '\u0085'], ['id-100', 'id', long(100)], ['id-101', 'id', long(101)],
  ['id-astral-50', 'id', long(50, '𝟏')], ['id-astral-51', 'id', long(51, '𝟏')],
  ['nombre-200', 'name', long(200)], ['nombre-201', 'name', long(201)], ['nombre-lista', 'name', ['Vivienda']],
  ['tipo-ingreso', 'type', 'ingreso'], ['tipo-mayuscula', 'type', 'Gasto'], ['tipo-lista', 'type', ['gasto']], ['tipo-falta', 'type', undefined],
  ['padre-vacio', 'parentId', ''], ['padre-101', 'parentId', long(101)], ['padre-numero', 'parentId', 3],
  ['orden-texto', 'order', '1'], ['orden-cero', 'order', 0], ['orden-negativo', 'order', -2.25], ['orden-nulo', 'order', null],
  ['orden-falta', 'order', undefined],
  ['presupuesto-nulo', 'budgetCents', null], ['presupuesto-negativo', 'budgetCents', -1], ['presupuesto-cero', 'budgetCents', 0],
  ['presupuesto-maximo', 'budgetCents', MAX_CENTS], ['presupuesto-mas-del-maximo', 'budgetCents', MAX_CENTS + 1],
  ['presupuesto-decimal', 'budgetCents', 1.5], ['presupuesto-texto', 'budgetCents', '100'],
]
for (const [id, key, value] of categoryFields) {
  add(`categoria-${id}`, `validateCategory: «${key}»`, 'validateCategory', body(value === undefined ? without(category, key) : { ...category, [key]: value }))
}
add('categoria-orden-infinito', 'Un número que desborda el doble es Infinity y no vale', 'validateCategory',
  bodyJson('{"id":"g-x","name":"X","type":"gasto","parentId":null,"order":1e400,"budgetCents":null}'))
add('categoria-orden-menos-cero', '-0 es un número válido y se escribe 0', 'validateCategory',
  bodyJson('{"id":"g-x","name":"X","type":"gasto","parentId":null,"order":-0,"budgetCents":-0}'))
add('categoria-presupuesto-exponente', '1e2 es el entero 100', 'validateCategory',
  bodyJson('{"id":"g-x","name":"X","type":"gasto","parentId":null,"order":1,"budgetCents":1e2}'))
add('categoria-claves-repetidas', 'Con una clave repetida vale la última, como JSON.parse', 'validateCategory',
  bodyJson('{"id":"g-x","name":"Primero","name":"Último","type":"gasto","parentId":null,"order":1,"budgetCents":null}'))
add('categoria-sustituto-suelto', 'Un sustituto suelto se conserva y cuenta como una unidad', 'validateCategory',
  bodyJson('{"id":"g-\\ud800","name":"Nombre \\udc00","type":"gasto","parentId":null,"order":1,"budgetCents":null}'))

// ---------------------------------------------------------------------------
// validateMovement

add('movimiento-pendiente', 'Un pendiente con fecha prevista', 'validateMovement', body(pending))
add('movimiento-realizado', 'Un realizado con fecha de pago', 'validateMovement', body(paid))
add('movimiento-campos-extra', 'Solo se quedan los campos conocidos', 'validateMovement', body({ ...pending, projected: true }))
add('movimiento-sin-cuerpo', 'Sin cuerpo', 'validateMovement', {})
add('movimiento-realizado-sin-pago', 'Realizado sin fecha de pago', 'validateMovement', body({ ...paid, paidDate: null }))
add('movimiento-pendiente-sin-prevista', 'Pendiente sin fecha prevista', 'validateMovement', body({ ...pending, dueDate: null }))
add('movimiento-realizado-con-las-dos', 'Realizado con las dos fechas', 'validateMovement', body({ ...paid, dueDate: '2026-11-15' }))
const movementFields: [string, string, unknown][] = [
  ['importe-cero', 'amountCents', 0], ['importe-uno', 'amountCents', 1], ['importe-maximo', 'amountCents', MAX_CENTS],
  ['importe-mas-del-maximo', 'amountCents', MAX_CENTS + 1], ['importe-decimal', 'amountCents', 12.5], ['importe-negativo', 'amountCents', -100],
  ['importe-texto', 'amountCents', '1234'],
  ['tipo-otro', 'type', 'traspaso'], ['estado-otro', 'status', 'pagado'], ['estado-lista', 'status', ['pendiente']],
  ['prevista-imposible', 'dueDate', '2026-02-29'], ['prevista-sin-ceros', 'dueDate', '2026-1-5'], ['prevista-numero', 'dueDate', 20261115],
  ['prevista-antes-de-1900', 'dueDate', '1899-12-31'], ['prevista-bisiesto', 'dueDate', '2028-02-29'],
  ['notas-vacias', 'notes', ''], ['notas-espacios', 'notes', '   '], ['notas-5000', 'notes', long(5000)], ['notas-5001', 'notes', long(5001)],
  ['notas-falta', 'notes', undefined], ['notas-nulas', 'notes', null],
  ['concepto-500', 'concept', long(500)], ['concepto-501', 'concept', long(501)], ['concepto-espacios', 'concept', ' \t\n'],
  ['categoria-vacia', 'categoryId', ''], ['recurrente-vacio', 'recurringId', ''], ['recurrente-falta', 'recurringId', undefined],
  ['recurrente-101', 'recurringId', long(101)], ['vencimiento-imposible', 'occurrenceDate', '2026-04-31'],
  ['cuota-cero', 'installmentNumber', 0], ['cuota-uno', 'installmentNumber', 1], ['cuota-1200', 'installmentNumber', 1200],
  ['cuota-1201', 'installmentNumber', 1201], ['cuota-decimal', 'installmentNumber', 2.5],
  ['creado-40', 'createdAt', long(40)], ['creado-41', 'createdAt', long(41)], ['creado-vacio', 'createdAt', ''],
  ['actualizado-falta', 'updatedAt', undefined],
]
for (const [id, key, value] of movementFields) {
  add(`movimiento-${id}`, `validateMovement: «${key}»`, 'validateMovement', body(value === undefined ? without(pending, key) : { ...pending, [key]: value }))
}
add('movimiento-vencimiento', 'Un vencimiento de un recurrente', 'validateMovement',
  body({ ...pending, recurringId: 'regla-ensayo', occurrenceDate: '2026-01-31', installmentNumber: 1, dueDate: '2026-01-31' }))
add('movimiento-dos-errores', 'Se informa el primer campo en el orden de lectura', 'validateMovement',
  body({ ...pending, concept: '', amountCents: 0, status: 'otro' }))

// ---------------------------------------------------------------------------
// validateRecurring

add('recurrente-valido', 'Un recurrente con cuotas y una fecha excluida', 'validateRecurring', body(rule))
add('recurrente-campos-extra', 'Solo se quedan los campos conocidos', 'validateRecurring', body({ ...rule, status: 'activo' }))
add('recurrente-sin-excluidas', 'excludedDates que falta es una lista vacía', 'validateRecurring', body(without(rule, 'excludedDates')))
add('recurrente-excluidas-nulas', 'excludedDates null es una lista vacía', 'validateRecurring', body({ ...rule, excludedDates: null }))
const ruleFields: [string, string, unknown][] = [
  ['excluidas-texto', 'excludedDates', '2026-02-28'], ['excluidas-imposible', 'excludedDates', ['2026-02-29']],
  ['excluidas-numero', 'excludedDates', [20260228]], ['excluidas-vacias', 'excludedDates', []],
  ['frecuencia-otra', 'frequency', 'semanal'], ['frecuencia-anual', 'frequency', 'anual'],
  ['inicio-imposible', 'startDate', '2026-13-01'], ['inicio-falta', 'startDate', undefined],
  ['fin-antes', 'endDate', '2026-01-30'], ['fin-igual', 'endDate', '2026-01-31'], ['fin-imposible', 'endDate', '2026-02-30'],
  ['cuotas-cero', 'installments', 0], ['cuotas-1200', 'installments', 1200], ['cuotas-1201', 'installments', 1201],
  ['cuotas-nulas', 'installments', null], ['importe-cero', 'amountCents', 0], ['notas-falta', 'notes', undefined],
]
for (const [id, key, value] of ruleFields) {
  add(`recurrente-${id}`, `validateRecurring: «${key}»`, 'validateRecurring', body(value === undefined ? without(rule, key) : { ...rule, [key]: value }))
}

// ---------------------------------------------------------------------------
// validateFinanceData: las tres listas, cada registro y sus referencias

const sub = { id: 'g-ensayo-sub', name: 'Subcategoría de ensayo', type: 'gasto', parentId: 'g-ensayo', order: 0, budgetCents: null }
const income = { id: 'i-ensayo', name: 'Ingresos de ensayo', type: 'ingreso', parentId: null, order: 0, budgetCents: null }
const data = { categories: [category, sub, income], movements: [pending, paid], recurring: [rule] }
add('datos-validos', 'Las tres listas completas', 'validateFinanceData', body(data))
add('datos-vacios', 'Tres listas vacías', 'validateFinanceData', body({ categories: [], movements: [], recurring: [] }))
add('datos-iniciales', 'Las categorías iniciales', 'validateFinanceData', body({ categories: DEFAULT_CATEGORIES, movements: [], recurring: [] }))
add('datos-campos-extra', 'Solo se quedan los campos conocidos, también arriba', 'validateFinanceData',
  body({ ...data, meta: { lastBackupAt: 'x' }, categories: data.categories.map((c) => ({ ...c, extra: true })) }))
for (const [id, value] of [['sin-cuerpo', undefined], ['nulo', null], ['lista', []], ['texto', 'datos']] as const) {
  add(`datos-${id}`, 'Sin un objeto no hay datos', 'validateFinanceData', value === undefined ? {} : body(value))
}
for (const key of ['categories', 'movements', 'recurring']) {
  add(`datos-sin-${key}`, `Falta la lista «${key}»`, 'validateFinanceData', body(without(data, key)))
  add(`datos-${key}-objeto`, `«${key}» no es una lista`, 'validateFinanceData', body({ ...data, [key]: {} }))
}
add('datos-categoria-mala', 'La etiqueta lleva el número del registro', 'validateFinanceData',
  body({ ...data, categories: [category, { ...sub, name: ' ' }] }))
add('datos-movimiento-malo', 'Movimiento nº 2', 'validateFinanceData', body({ ...data, movements: [pending, { ...paid, paidDate: null }] }))
add('datos-recurrente-malo', 'Recurrente nº 1', 'validateFinanceData', body({ ...data, recurring: [{ ...rule, frequency: 'diaria' }] }))
add('datos-categoria-repetida', 'Ids de categoría repetidos', 'validateFinanceData', body({ ...data, categories: [category, sub, income, { ...income, name: 'Otra' }] }))
add('datos-movimiento-repetido', 'Ids de movimiento repetidos', 'validateFinanceData', body({ ...data, movements: [pending, { ...paid, id: pending.id }] }))
add('datos-recurrente-repetido', 'Ids de recurrente repetidos', 'validateFinanceData', body({ ...data, recurring: [rule, rule] }))
add('datos-registro-antes-que-referencias', 'Los registros se validan antes que las referencias', 'validateFinanceData',
  body({ ...data, categories: [category, category], movements: [{ ...pending, amountCents: 0 }] }))
add('datos-sub-sin-padre', 'Una subcategoría cuyo padre no existe', 'validateFinanceData',
  body({ ...data, categories: [category, { ...sub, parentId: 'g-no-existe' }, income] }))
add('datos-sub-de-sub', 'Un padre que ya es subcategoría', 'validateFinanceData',
  body({ ...data, categories: [category, sub, income, { ...sub, id: 'g-nieta', name: 'Nieta', parentId: 'g-ensayo-sub' }] }))
add('datos-sub-de-otro-tipo', 'Un padre de otro tipo', 'validateFinanceData',
  body({ ...data, categories: [category, income, { ...sub, parentId: 'i-ensayo' }] }))
add('datos-movimiento-sin-categoria', 'Un movimiento con una categoría que no existe', 'validateFinanceData',
  body({ ...data, movements: [pending, { ...paid, categoryId: 'g-no-existe' }] }))
add('datos-movimiento-de-otro-tipo', 'Un gasto con una categoría de ingresos', 'validateFinanceData',
  body({ ...data, movements: [{ ...pending, categoryId: 'i-ensayo' }] }))
add('datos-recurrente-sin-categoria', 'Un recurrente con una categoría que no existe', 'validateFinanceData',
  body({ ...data, recurring: [{ ...rule, categoryId: 'g-otra' }] }))
const occurrence = { ...pending, recurringId: 'regla-ensayo', occurrenceDate: '2026-02-28', dueDate: '2026-02-28', concept: 'Cuota de ensayo' }
add('datos-vencimiento-repetido', 'Dos movimientos para el mismo vencimiento', 'validateFinanceData',
  body({ ...data, movements: [occurrence, { ...occurrence, id: 'mov-otro' }] }))
add('datos-vencimientos-distintos', 'El mismo recurrente en dos fechas', 'validateFinanceData',
  body({ ...data, movements: [occurrence, { ...occurrence, id: 'mov-otro', occurrenceDate: '2026-03-31', dueDate: '2026-03-31' }] }))

// ---------------------------------------------------------------------------
// withDescendants

add('descendientes-con-hijas', 'La categoría y sus subcategorías, en el orden de la lista', 'withDescendants',
  { categories: DEFAULT_CATEGORIES, categoryId: 'g-vivienda' })
add('descendientes-sin-hijas', 'Una categoría sin subcategorías', 'withDescendants', { categories: DEFAULT_CATEGORIES, categoryId: 'g-ocio' })
add('descendientes-no-existe', 'Una categoría que no está en la lista', 'withDescendants', { categories: DEFAULT_CATEGORIES, categoryId: 'g-no-existe' })

// ---------------------------------------------------------------------------
// Recurrentes (FIN-03): fechas, día 31, frecuencias, cuotas, fin y exclusiones

for (const [id, value, months] of [
  ['31-enero-mas-1', '2026-01-31', 1], ['31-enero-mas-2', '2026-01-31', 2], ['31-enero-bisiesto', '2028-01-31', 1],
  ['cambio-de-ano', '2026-12-15', 1], ['menos-1', '2026-03-31', -1], ['menos-13', '2026-01-31', -13], ['mas-12', '2026-05-31', 12],
  ['cero', '2999-12-31', 0], ['29-febrero-un-ano', '2028-02-29', 12], ['30-abril-mas-1', '2026-04-30', 1],
] as const) add(`meses-${id}`, 'addMonthsClamped: conserva el día o usa el último del mes', 'addMonthsClamped', { value, months })
for (const [id, today] of [['octubre', '2026-10-28'], ['diciembre', '2026-12-05'], ['31-enero', '2027-01-31'], ['bisiesto', '2028-01-15'], ['noviembre', '2026-11-30']] as const) {
  add(`horizonte-${id}`, 'generationHorizon: el final del mes siguiente', 'generationHorizon', { today })
}
const schedule = { startDate: '2026-01-31', endDate: null, installments: null, frequency: 'mensual' }
for (const [id, overrides, until] of [
  ['mensual-31', {}, '2026-07-31'],
  ['trimestral-31', { frequency: 'trimestral' }, '2027-01-31'],
  ['semestral', { frequency: 'semestral', startDate: '2026-08-31' }, '2028-03-01'],
  ['anual-29-febrero', { frequency: 'anual', startDate: '2028-02-29' }, '2033-01-01'],
  ['cuotas', { installments: 3 }, '2027-12-31'],
  ['fin-incluido', { endDate: '2026-04-30' }, '2027-12-31'],
  ['fin-antes-del-siguiente', { endDate: '2026-04-29' }, '2027-12-31'],
  ['hasta-incluido', {}, '2026-03-31'],
  ['hasta-antes-del-inicio', {}, '2026-01-30'],
  ['sin-fin-tope', { startDate: '2026-01-01' }, '2999-12-31'],
  ['cuotas-de-mas', { installments: 5000, frequency: 'anual', startDate: '2026-06-15' }, '2999-12-31'],
] as const) {
  add(`calendario-${id}`, 'scheduleDates: fechas desde el inicio, con fin, cuotas y hasta incluidos', 'scheduleDates', { rule: { ...schedule, ...overrides }, until })
}
const plannedRule = { ...rule, id: 'regla-ensayo', startDate: '2026-01-31', installments: 6, excludedDates: ['2026-03-31'] }
const done = (date: string, overrides: Record<string, unknown> = {}) => ({
  ...pending, id: `hecho-${date}`, recurringId: 'regla-ensayo', occurrenceDate: date, dueDate: date, ...overrides,
})
add('planificar-vacio', 'planOccurrences: todo lo que falta hasta el horizonte, con su número de cuota', 'planOccurrences',
  { rule: plannedRule, existing: [], horizon: '2026-06-30', now: '2026-06-01T10:00:00.000Z' })
add('planificar-con-hechos-y-excluidos', 'Lo ya creado y lo excluido se salta; la cuota no se desplaza', 'planOccurrences', {
  rule: plannedRule, horizon: '2026-06-30', now: '2026-06-01T10:00:00.000Z',
  existing: [done('2026-01-31', { status: 'realizado', paidDate: '2026-01-31' }), done('2026-02-28'), { ...done('2026-04-30'), recurringId: 'otra-regla' }],
})
add('planificar-sin-cuotas', 'Sin número de cuotas, installmentNumber es null', 'planOccurrences',
  { rule: { ...plannedRule, installments: null, excludedDates: [] }, existing: [], horizon: '2026-03-31', now: '2026-03-01T00:00:00.000Z' })
add('planificar-vencimiento-movido', 'Un vencimiento con otra fecha prevista sigue ocupando su fecha programada', 'planOccurrences', {
  rule: { ...plannedRule, excludedDates: [] }, horizon: '2026-02-28', now: '2026-02-01T00:00:00.000Z',
  existing: [done('2026-02-28', { dueDate: '2026-03-05' })],
})
add('planificar-sin-fecha-programada', 'Un movimiento de la regla sin occurrenceDate no ocupa ninguna fecha', 'planOccurrences', {
  rule: { ...plannedRule, excludedDates: [] }, horizon: '2026-01-31', now: '2026-01-01T00:00:00.000Z',
  existing: [{ ...pending, id: 'suelto', recurringId: 'regla-ensayo', occurrenceDate: null }],
})

// ---------------------------------------------------------------------------
// Resúmenes mensual y anual y previsión (FIN-04)

const summaryCategories = [
  ...DEFAULT_CATEGORIES.map((c) =>
    c.id === 'g-alimentacion' ? { ...c, budgetCents: 30000 } : c.id === 'g-ocio' ? { ...c, budgetCents: 0 } : c),
  // Mismo orden que Alimentación: decide el nombre con localeCompare('es').
  { id: 'g-abaco', name: 'Ábaco', type: 'gasto', parentId: null, order: 2, budgetCents: 5000 },
  { id: 'g-nu', name: 'Ñu', type: 'gasto', parentId: null, order: 2, budgetCents: null },
  { id: 'i-zz', name: 'Zz ingresos', type: 'ingreso', parentId: null, order: 0.5, budgetCents: null },
]
const m = (id: string, overrides: Record<string, unknown>) => ({ ...pending, id, concept: `Concepto ${id}`, categoryId: 'g-alimentacion', ...overrides })
const paidOn = (date: string) => ({ status: 'realizado', paidDate: date, dueDate: null })
const dueOn = (date: string) => ({ status: 'pendiente', paidDate: null, dueDate: date })
const summaryData = {
  categories: summaryCategories,
  movements: [
    m('a-super', { ...paidOn('2026-10-03'), amountCents: 4520, categoryId: 'g-alimentacion-supermercado' }),
    m('b-fuera', { ...dueOn('2026-10-30'), amountCents: 3200, categoryId: 'g-alimentacion-comidas-fuera' }),
    m('c-directo', { ...paidOn('2026-10-15'), amountCents: 1000, categoryId: 'g-alimentacion' }),
    m('d-luz', { ...paidOn('2026-10-20'), amountCents: 6000, categoryId: 'g-vivienda-luz' }),
    m('e-abaco', { ...paidOn('2026-10-21'), amountCents: 6000, categoryId: 'g-abaco' }),
    m('f-nu', { ...dueOn('2026-11-04'), amountCents: 6000, categoryId: 'g-nu' }),
    m('g-borrada', { ...paidOn('2026-10-09'), amountCents: 777, categoryId: 'g-borrada' }),
    m('h-nomina', { ...paidOn('2026-10-01'), amountCents: 185000, type: 'ingreso', categoryId: 'i-nomina' }),
    m('i-extra', { ...dueOn('2026-11-15'), amountCents: 12000, type: 'ingreso', categoryId: 'i-extra' }),
    m('j-pagado-antes', { status: 'realizado', paidDate: '2026-09-28', dueDate: '2026-10-05', amountCents: 2500, categoryId: 'g-suscripciones' }),
    m('k-alquiler-sep', { ...paidOn('2026-09-01'), amountCents: 65000, categoryId: 'g-vivienda-alquiler', recurringId: 'r-alquiler', occurrenceDate: '2026-09-01' }),
    m('l-alquiler-oct', { ...paidOn('2026-10-01'), amountCents: 65000, categoryId: 'g-vivienda-alquiler', recurringId: 'r-alquiler', occurrenceDate: '2026-10-01' }),
    m('n-alquiler-nov', { ...dueOn('2026-11-01'), amountCents: 66000, categoryId: 'g-vivienda-alquiler', recurringId: 'r-alquiler', occurrenceDate: '2026-11-01' }),
    m('o-ingreso-zz', { ...paidOn('2026-12-10'), amountCents: 900, type: 'ingreso', categoryId: 'i-zz' }),
  ],
  recurring: [
    { ...rule, id: 'r-alquiler', concept: 'Alquiler', amountCents: 65000, categoryId: 'g-vivienda-alquiler', startDate: '2026-09-01', installments: null, excludedDates: ['2027-02-01'], updatedAt: '2026-08-30T10:00:00.000Z' },
    { ...rule, id: 'r-seguro', concept: 'Seguro', amountCents: 12000, categoryId: 'g-seguros-hogar', frequency: 'trimestral', startDate: '2026-03-31', installments: 6, excludedDates: [] },
    { ...rule, id: 'r-cuota', concept: 'Cuota anual', amountCents: 3000, categoryId: 'g-ocio', frequency: 'anual', startDate: '2025-12-15', endDate: '2027-12-15', installments: null, excludedDates: [] },
  ],
}
const emptyData = { categories: DEFAULT_CATEGORIES, movements: [], recurring: [] }
for (const [id, today, year, month] of [
  ['octubre', '2026-10-28', 2026, 10], ['noviembre', '2026-10-28', 2026, 11], ['diciembre-proyectado', '2026-10-28', 2026, 12],
  ['marzo-trimestral', '2026-10-28', 2027, 3], ['febrero-excluido', '2026-10-28', 2027, 2], ['pasado-vacio', '2026-10-28', 2025, 6],
  ['septiembre', '2026-10-28', 2026, 9], ['otro-hoy', '2026-12-31', 2027, 1],
] as const) add(`mes-${id}`, 'monthView: cuenta, gastos por categoría, presupuestos y detalle', 'monthView', { data: summaryData, today, year, month })
add('mes-sin-datos', 'monthView de una base nueva: todo a cero y las categorías iniciales', 'monthView', { data: emptyData, today: '2026-10-28', year: 2026, month: 10 })
for (const [id, today, year] of [['2026', '2026-10-28', 2026], ['2027', '2026-10-28', 2027], ['2025', '2026-10-28', 2025], ['2027-otro-hoy', '2027-03-15', 2027]] as const) {
  add(`ano-${id}`, 'yearView: cuenta, evolución, categorías por meses y presupuesto anual', 'yearView', { data: summaryData, today, year })
}
add('ano-sin-datos', 'yearView de una base nueva', 'yearView', { data: emptyData, today: '2026-10-28', year: 2026 })
add('prevision-hasta-marzo', 'forecastMovements: los guardados y lo proyectado después del horizonte', 'forecastMovements', { data: summaryData, today: '2026-10-28', until: '2027-03-31' })
add('prevision-hasta-el-horizonte', 'forecastMovements: hasta el horizonte no se proyecta nada', 'forecastMovements', { data: summaryData, today: '2026-10-28', until: '2026-11-30' })
// Los mismos datos, tal como los guarda y los lee la API (sin categorías borradas y en orden de id): las pruebas HTTP
// de .NET los restauran con PUT /api/data y comparan GET /api/summary/* con este resultado de TypeScript.
const byId = <T extends { id: string }>(list: readonly T[]) => [...list].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
const storedSummaryData = {
  categories: byId(summaryData.categories),
  movements: byId(summaryData.movements.filter((movement) => movement.categoryId !== 'g-borrada')),
  recurring: byId(summaryData.recurring),
}
add('api-mes-octubre', 'monthView de datos que se pueden restaurar: lo que debe responder GET /api/summary/month', 'monthView',
  { data: storedSummaryData, today: '2026-10-28', year: 2026, month: 10 })
add('api-mes-diciembre', 'monthView con proyecciones de datos que se pueden restaurar', 'monthView',
  { data: storedSummaryData, today: '2026-10-28', year: 2026, month: 12 })
add('api-ano-2026', 'yearView de datos que se pueden restaurar: lo que debe responder GET /api/summary/year', 'yearView',
  { data: storedSummaryData, today: '2026-10-28', year: 2026 })
add('comparar-nombres', 'localeCompare(…, «es»): ñ después de n, tildes y mayúsculas, signos y cifras', 'compareNames', {
  names: [
    'Alimentación', 'alimentación', 'Alimentacion', 'Ábaco', 'abaco', 'Abaco', 'Ñu', 'Nu', 'nu', 'Nube', 'Ocio', 'Otros',
    'Otros ingresos', 'Préstamos', 'Préstamos y letras', 'Sin categoría', 'Sin subcategoría', 'co-op', 'coop', 'co op', 'a b',
    'ab', 'a-b', '1', '10', '2', '', ' ', 'Çedilla', 'Cedilla', 'über', 'uber', 'Zz ingresos', 'zz', 'Ll', 'Lz', 'ch', 'cz',
  ],
})

// ---------------------------------------------------------------------------

const corpus = {
  format: 'cuentas-claras-finance-rules-v1',
  provenance: 'Datos inventados para la migración a .NET (FIN-01 y siguientes). Sin datos de la instalación: categorías iniciales, movimientos y recurrentes de ensayo; las salidas son las de TypeScript.',
  operations: FINANCE_OPERATIONS,
  cases,
}
const text = `${JSON.stringify(corpus, null, 2)}\n`
const used = new Set(cases.map((c) => c.operation))
const unused = FINANCE_OPERATIONS.filter((operation) => !used.has(operation))
if (unused.length > 0) throw new Error(`Operaciones sin casos: ${unused.join(', ')}`)

if (process.argv.includes('--escribir')) {
  writeFileSync(FILE, text)
  console.log(`Escrito ${cases.length} casos en fixtures/migration/rules-finance.json`)
} else {
  let saved: { cases: Case[] } = { cases: [] }
  try {
    saved = JSON.parse(readFileSync(FILE, 'utf8'))
  } catch {
    console.log('No hay corpus guardado todavía.')
  }
  const before = new Map(saved.cases.map((c) => [c.id, JSON.stringify(c)]))
  const changed = cases.filter((c) => before.get(c.id) !== JSON.stringify(c)).map((c) => c.id)
  const removed = [...before.keys()].filter((id) => !cases.some((c) => c.id === id))
  console.log(`${cases.length} casos; cambiarían ${changed.length}${changed.length ? `: ${changed.join(', ')}` : ''}; se quitarían ${removed.length}${removed.length ? `: ${removed.join(', ')}` : ''}`)
}
