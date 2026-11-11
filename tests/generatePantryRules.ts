import { readFileSync, writeFileSync } from 'node:fs'
import { corpusJson } from './ticketRules.ts'
import { PANTRY_OPERATIONS, runPantryRule } from './pantryRules.ts'

/**
 * Genera fixtures/migration/rules-pantry.json: entradas de las reglas de la despensa que usa el servidor y lo que
 * devuelve TypeScript con ellas. Se ejecuta a mano y el resultado se revisa:
 *
 *   npx tsx tests/generatePantryRules.ts             # compara con el corpus guardado y dice qué cambiaría
 *   npx tsx tests/generatePantryRules.ts --escribir  # lo reescribe
 *
 * Las pruebas (tests/migrationPantryRules.test.ts y la de C#) nunca lo regeneran. Cambiar una regla de shared/pantry
 * que use el servidor obliga a regenerarlo, revisar el diff y portar el cambio a C#
 * (backend/src/CuentasClaras.Application/Pantry/ y backend/src/CuentasClaras.Domain/Pantry/).
 */

const FILE = new URL('../fixtures/migration/rules-pantry.json', import.meta.url)

interface Case { id: string; description: string; operation: string; input: unknown; expected: unknown }
const cases: Case[] = []

function add(id: string, description: string, operation: string, input: unknown = {}) {
  if (cases.some((c) => c.id === id)) throw new Error(`Id repetido: ${id}`)
  const clean = corpusJson(input)
  cases.push({ id, description, operation, input: clean, expected: runPantryRule(operation, structuredClone(clean)) })
}

/** Un cuerpo ya en JSON (`body`) o, para lo que JSON no puede escribir (Infinity, -0, claves repetidas, sustitutos sueltos), su texto (`bodyJson`). */
const body = (value: unknown) => ({ body: value })
const bodyJson = (text: string) => ({ bodyJson: text })
const long = (length: number, unit = 'x') => unit.repeat(length)

// ---------------------------------------------------------------------------
// Personas (datos inventados)

add('persona-valida', 'Nombre con espacios a los lados: se recortan', 'validatePersonInput', body({ name: '  Persona de ensayo ' }))
add('persona-sin-cuerpo', 'Sin cuerpo', 'validatePersonInput', {})
add('persona-cuerpo-null', 'El cuerpo es null', 'validatePersonInput', bodyJson('null'))
add('persona-cuerpo-lista', 'El cuerpo es una lista', 'validatePersonInput', body([{ name: 'Ana' }]))
add('persona-sin-nombre', 'Falta el nombre', 'validatePersonInput', body({}))
add('persona-nombre-numero', 'El nombre no es texto', 'validatePersonInput', body({ name: 5 }))
add('persona-nombre-vacio', 'Nombre vacío', 'validatePersonInput', body({ name: '' }))
add('persona-nombre-espacios', 'Solo espacios, también los de no separación y el BOM, que trim quita', 'validatePersonInput', body({ name: '  ﻿  ' }))
add('persona-40', 'Cuarenta letras con tildes caben', 'validatePersonInput', body({ name: long(40, 'Ñ') }))
add('persona-41', 'Cuarenta y una no', 'validatePersonInput', body({ name: long(41, 'Ñ') }))
add('persona-emojis', 'El límite cuenta unidades UTF-16, como length: 20 emojis son 40', 'validatePersonInput', body({ name: long(20, '😀') }))
add('persona-emojis-21', '21 emojis son 42 unidades UTF-16', 'validatePersonInput', body({ name: long(21, '😀') }))
add('persona-clave-repetida', 'Con el nombre repetido vale el último, como JSON.parse', 'validatePersonInput', bodyJson('{"name":"Primera","name":"Segunda"}'))
add('persona-sustituto-suelto', 'Un sustituto suelto se conserva', 'validatePersonInput', bodyJson('{"name":"A\\ud800b"}'))

// ---------------------------------------------------------------------------
// Productos

const milk = { name: 'Leche de ensayo', ownerId: null, unit: 'l', quantity: 2, target: 6, frequency: 'semanal', priceCents: 95, notes: '' }
const item = (changes: Record<string, unknown> = {}) => body({ ...milk, ...changes })
const without = (key: string, changes: Record<string, unknown> = {}) => {
  const value: Record<string, unknown> = { ...milk, ...changes }
  delete value[key]
  return body(value)
}

add('producto-valido', 'Un producto que se cuenta (tracking por defecto)', 'validateItemInput', item())
add('producto-recorta', 'Nombre y notas sin espacios a los lados', 'validateItemInput', item({ name: '  Leche  ', notes: '  entera  ' }))
add('producto-de-una-persona', 'De una persona', 'validateItemInput', item({ ownerId: 'persona-1' }))
add('producto-por-compras', 'Por compras, a 0', 'validateItemInput', item({ tracking: 'compras', quantity: 0, target: 0 }))
add('producto-tracking-null', 'tracking null cuenta como «cantidad» (??)', 'validateItemInput', item({ tracking: null }))
add('producto-sin-opcionales', 'Sin ownerId, tracking, notas ni precio', 'validateItemInput', without('ownerId', { tracking: undefined, notes: undefined, priceCents: undefined }))
add('producto-precio-cero', 'Precio 0: gratis, distinto de desconocido', 'validateItemInput', item({ priceCents: 0 }))
add('producto-precio-maximo', 'Precio máximo de la despensa', 'validateItemInput', item({ priceCents: 10_000_000 }))
add('producto-milesimas', 'Restos binarios tolerados: 0,1 + 0,2 se guarda como 0,3', 'validateItemInput', item({ unit: 'kg', quantity: 0.1 + 0.2, target: 0.001 }))
add('producto-cantidad-maxima', 'Un millón exacto cabe', 'validateItemInput', item({ unit: 'g', quantity: 1_000_000, target: 999_999.999 }))
add('producto-menos-cero', '-0 es una cantidad válida', 'validateItemInput', bodyJson('{"name":"Sal","ownerId":null,"unit":"paquete","quantity":-0,"target":1,"frequency":"mensual","priceCents":null,"notes":""}'))
add('producto-sin-cuerpo', 'Sin cuerpo', 'validateItemInput', {})
add('producto-cuerpo-texto', 'El cuerpo es un texto', 'validateItemInput', body('Leche'))
add('producto-sin-nombre', 'Falta el nombre', 'validateItemInput', without('name'))
add('producto-nombre-vacio', 'Nombre de espacios', 'validateItemInput', item({ name: '   ' }))
add('producto-nombre-largo', 'Nombre de 81 caracteres', 'validateItemInput', item({ name: long(81) }))
add('producto-nombre-80', 'Nombre de 80 caracteres', 'validateItemInput', item({ name: long(80) }))
add('producto-dueno-vacio', 'ownerId vacío', 'validateItemInput', item({ ownerId: '' }))
add('producto-dueno-numero', 'ownerId que no es texto', 'validateItemInput', item({ ownerId: 7 }))
add('producto-unidad-desconocida', 'Unidad desconocida', 'validateItemInput', item({ unit: 'barril' }))
add('producto-unidad-mayusculas', 'La unidad distingue mayúsculas', 'validateItemInput', item({ unit: 'UD' }))
add('producto-sin-unidad', 'Sin unidad', 'validateItemInput', without('unit'))
add('producto-frecuencia', 'Frecuencia desconocida', 'validateItemInput', item({ frequency: 'diaria' }))
add('producto-cantidad-negativa', 'Cantidad negativa', 'validateItemInput', item({ quantity: -1 }))
add('producto-cantidad-texto', 'Cantidad en texto', 'validateItemInput', item({ quantity: '2' }))
add('producto-cantidad-null', 'Cantidad null', 'validateItemInput', item({ quantity: null }))
add('producto-cantidad-infinita', 'Un número que desborda es Infinity', 'validateItemInput', bodyJson('{"name":"Agua","unit":"l","quantity":1e400,"target":1,"frequency":"semanal"}'))
add('producto-cantidad-enorme', 'Por encima del millón', 'validateItemInput', item({ quantity: 1_000_000.001 }))
add('producto-cuatro-decimales', 'Cuatro decimales en kg', 'validateItemInput', item({ unit: 'kg', quantity: 1.0005 }))
add('producto-decimales-ud', 'Decimales en unidades', 'validateItemInput', item({ unit: 'ud', quantity: 1.5 }))
add('producto-decimales-paquete', 'El mensaje nombra la unidad', 'validateItemInput', item({ unit: 'docena', quantity: 1, target: 0.5 }))
add('producto-objetivo-negativo', 'Objetivo negativo', 'validateItemInput', item({ target: -2 }))
add('producto-objetivo-maximo', 'Objetivo enorme', 'validateItemInput', item({ target: Number.MAX_VALUE }))
add('producto-tracking', 'tracking desconocido', 'validateItemInput', item({ tracking: 'a ojo' }))
add('producto-tracking-numero', 'tracking que no es texto', 'validateItemInput', item({ tracking: 1 }))
add('producto-notas-numero', 'Notas que no son texto', 'validateItemInput', item({ notes: 5 }))
add('producto-notas-largas', 'Notas de 121 caracteres', 'validateItemInput', item({ notes: long(121) }))
add('producto-notas-recortadas', '120 caracteres más espacios: el límite es tras recortar', 'validateItemInput', item({ notes: `  ${long(120)}  ` }))
add('producto-precio-decimal', 'Precio con decimales', 'validateItemInput', item({ priceCents: 1.5 }))
add('producto-precio-negativo', 'Precio negativo', 'validateItemInput', item({ priceCents: -5 }))
add('producto-precio-enorme', 'Precio por encima del máximo', 'validateItemInput', item({ priceCents: 10_000_001 }))
add('producto-precio-texto', 'Precio en texto', 'validateItemInput', item({ priceCents: '95' }))
add('producto-precio-booleano', 'Precio booleano', 'validateItemInput', item({ priceCents: true }))
add('producto-orden-nombre-unidad', 'Primero el nombre, después la unidad', 'validateItemInput', item({ name: '', unit: 'barril' }))
add('producto-orden-dueno-unidad', 'El dueño antes que la unidad', 'validateItemInput', item({ ownerId: '', unit: 'barril' }))
add('producto-orden-unidad-frecuencia', 'La unidad antes que la frecuencia', 'validateItemInput', item({ unit: 'barril', frequency: 'diaria' }))
add('producto-orden-frecuencia-cantidad', 'La frecuencia antes que la cantidad', 'validateItemInput', item({ frequency: 'diaria', quantity: -1 }))
add('producto-orden-cantidad-objetivo', 'La cantidad antes que el objetivo', 'validateItemInput', item({ quantity: -1, target: -1 }))
add('producto-orden-objetivo-tracking', 'El objetivo antes que tracking', 'validateItemInput', item({ target: -1, tracking: 'x' }))
add('producto-orden-tracking-notas', 'tracking antes que las notas', 'validateItemInput', item({ tracking: 'x', notes: 5 }))
add('producto-orden-notas-precio', 'Las notas antes que el precio', 'validateItemInput', item({ notes: long(121), priceCents: -1 }))

// ---------------------------------------------------------------------------
// Edición con la versión que se abrió (PAN-01)

add('edicion-valida', 'La versión con que se abrió', 'validateItemUpdate', item({ expectedVersion: 3 }))
add('edicion-version-maxima', 'El mayor entero seguro', 'validateItemUpdate', item({ expectedVersion: Number.MAX_SAFE_INTEGER }))
add('edicion-sin-version', 'Sin expectedVersion', 'validateItemUpdate', item())
add('edicion-version-null', 'expectedVersion null', 'validateItemUpdate', item({ expectedVersion: null }))
add('edicion-version-cero', 'expectedVersion 0', 'validateItemUpdate', item({ expectedVersion: 0 }))
add('edicion-version-negativa', 'expectedVersion negativa', 'validateItemUpdate', item({ expectedVersion: -1 }))
add('edicion-version-decimal', 'expectedVersion con decimales', 'validateItemUpdate', item({ expectedVersion: 1.5 }))
add('edicion-version-texto', 'expectedVersion en texto', 'validateItemUpdate', item({ expectedVersion: '1' }))
add('edicion-version-booleana', 'expectedVersion booleana', 'validateItemUpdate', item({ expectedVersion: true }))
add('edicion-version-insegura', '2^53 ya no es un entero seguro', 'validateItemUpdate', bodyJson(JSON.stringify({ ...milk }).replace(/}$/, ',"expectedVersion":9007199254740992}')))
add('edicion-version-infinita', 'Una versión que desborda', 'validateItemUpdate', bodyJson(JSON.stringify({ ...milk }).replace(/}$/, ',"expectedVersion":1e400}')))
add('edicion-orden', 'El resto del cuerpo se comprueba antes que la versión', 'validateItemUpdate', item({ unit: 'barril', expectedVersion: 0 }))
add('edicion-sin-cuerpo', 'Sin cuerpo', 'validateItemUpdate', {})

// ---------------------------------------------------------------------------
// + y −, comprar y deshacer (PAN-02)

add('delta-suma', 'Un + de 0,5', 'validateDeltaInput', body({ delta: 0.5 }))
add('delta-resta', 'Un − de 100', 'validateDeltaInput', body({ delta: -100 }))
add('delta-limite', 'Un millón exacto vale', 'validateDeltaInput', body({ delta: -1_000_000 }))
add('delta-cero', 'Cero no', 'validateDeltaInput', body({ delta: 0 }))
add('delta-menos-cero', '-0 tampoco', 'validateDeltaInput', bodyJson('{"delta":-0}'))
add('delta-enorme', 'Más de un millón', 'validateDeltaInput', body({ delta: 1_000_000.5 }))
add('delta-infinito', 'Infinity', 'validateDeltaInput', bodyJson('{"delta":1e400}'))
add('delta-texto', 'En texto', 'validateDeltaInput', body({ delta: '1' }))
add('delta-sin-valor', 'Sin delta', 'validateDeltaInput', body({}))
add('delta-sin-cuerpo', 'Sin cuerpo', 'validateDeltaInput', {})

add('compra-valida', 'Ids sin repetir y en el orden en que llegan, y la fecha', 'validatePurchaseInput', body({ ids: ['b', 'a', 'b', 'c', 'a'], date: '2026-10-31' }))
add('compra-sin-fecha', 'Sin fecha: la pone el servidor', 'validatePurchaseInput', body({ ids: ['a'] }))
add('compra-fecha-null', 'Fecha null', 'validatePurchaseInput', body({ ids: ['a'], date: null }))
add('compra-fecha-imposible', 'Un 30 de febrero', 'validatePurchaseInput', body({ ids: ['a'], date: '2026-02-30' }))
add('compra-fecha-numero', 'La fecha no es texto', 'validatePurchaseInput', body({ ids: ['a'], date: 20261031 }))
add('compra-vacia', 'Lista vacía', 'validatePurchaseInput', body({ ids: [] }))
add('compra-sin-lista', 'Sin ids', 'validatePurchaseInput', body({ date: '2026-10-31' }))
add('compra-no-lista', 'ids no es una lista', 'validatePurchaseInput', body({ ids: 'a' }))
add('compra-id-numero', 'Un id que no es texto', 'validatePurchaseInput', body({ ids: ['a', 42] }))
add('compra-id-vacio', 'Un id vacío', 'validatePurchaseInput', body({ ids: [''] }))
add('compra-id-largo', 'Un id de 201 caracteres', 'validatePurchaseInput', body({ ids: [long(201)] }))
add('compra-id-200', 'Un id de 200 caracteres vale', 'validatePurchaseInput', body({ ids: [long(200)] }))
add('compra-mil', 'Mil productos valen', 'validatePurchaseInput', body({ ids: Array.from({ length: 1000 }, (_, i) => 'p-' + i) }))
add('compra-mil-uno', 'Mil uno no', 'validatePurchaseInput', body({ ids: Array.from({ length: 1001 }, () => 'p') }))
add('compra-orden', 'La cantidad de ids se comprueba antes que cada id', 'validatePurchaseInput', body({ ids: Array.from({ length: 1001 }, () => 5) }))
add('compra-sin-cuerpo', 'Sin cuerpo', 'validatePurchaseInput', {})

add('deshacer-valido', 'Una cantidad anterior y una compra apuntada', 'validateUndoInput', body({
  changes: [{ id: 'a', previousQuantity: 0.125, version: 2, extra: true }, { id: 'b', eventId: 'e-1', previousQuantity: 3 }],
}))
add('deshacer-vacio', 'Sin cambios', 'validateUndoInput', body({ changes: [] }))
add('deshacer-no-lista', 'changes no es una lista', 'validateUndoInput', body({ changes: {} }))
add('deshacer-mil-uno', 'Más de mil', 'validateUndoInput', body({ changes: Array.from({ length: 1001 }, (_, i) => ({ id: 'p-' + i, eventId: 'e' })) }))
add('deshacer-no-objeto', 'Un cambio que no es un objeto', 'validateUndoInput', body({ changes: ['a'] }))
add('deshacer-cambio-lista', 'Un cambio que es una lista', 'validateUndoInput', body({ changes: [['a']] }))
add('deshacer-sin-id', 'Sin id', 'validateUndoInput', body({ changes: [{ eventId: 'e' }] }))
add('deshacer-id-repetido', 'El mismo id dos veces', 'validateUndoInput', body({ changes: [{ id: 'a', eventId: 'e' }, { id: 'a', eventId: 'f' }] }))
add('deshacer-evento-null', 'eventId null no es «sin eventId»', 'validateUndoInput', body({ changes: [{ id: 'a', eventId: null, previousQuantity: 1, version: 1 }] }))
add('deshacer-evento-vacio', 'eventId vacío', 'validateUndoInput', body({ changes: [{ id: 'a', eventId: '' }] }))
add('deshacer-evento-largo', 'eventId de 201 caracteres', 'validateUndoInput', body({ changes: [{ id: 'a', eventId: long(201) }] }))
add('deshacer-cantidad-negativa', 'Cantidad anterior negativa', 'validateUndoInput', body({ changes: [{ id: 'a', previousQuantity: -1, version: 1 }] }))
add('deshacer-cantidad-texto', 'Cantidad anterior en texto', 'validateUndoInput', body({ changes: [{ id: 'a', previousQuantity: '1', version: 1 }] }))
add('deshacer-sin-cantidad', 'Sin cantidad anterior', 'validateUndoInput', body({ changes: [{ id: 'a', version: 1 }] }))
add('deshacer-cantidad-infinita', 'Cantidad anterior infinita', 'validateUndoInput', bodyJson('{"changes":[{"id":"a","previousQuantity":1e400,"version":1}]}'))
add('deshacer-version-cero', 'Versión 0', 'validateUndoInput', body({ changes: [{ id: 'a', previousQuantity: 1, version: 0 }] }))
add('deshacer-version-decimal', 'Versión con decimales', 'validateUndoInput', body({ changes: [{ id: 'a', previousQuantity: 1, version: 1.5 }] }))
add('deshacer-version-insegura', 'Versión 2^53', 'validateUndoInput', bodyJson('{"changes":[{"id":"a","previousQuantity":1,"version":9007199254740992}]}'))
add('deshacer-sin-cuerpo', 'Sin cuerpo', 'validateUndoInput', {})

for (const [id, quantity, delta, description] of [
  ['mas-medio', 1, 0.5, '1 + 0,5'],
  ['menos-bajo-cero', 0.3, -5, 'Nunca baja de cero'],
  ['restos', 0.1, 0.2, '0,1 + 0,2 en milésimas'],
  ['paso-diminuto', 2, 0.0004, 'Un paso de menos de media milésima no suma'],
  ['paso-media-milesima', 2, 0.0005, 'Media milésima redondea hacia arriba'],
  ['cantidad-no-valida', -3, 1, 'Una cantidad guardada no válida cuenta como 0'],
  ['cantidad-enorme', 2_000_000, 1, 'Por encima del máximo también cuenta como 0'],
  ['gramos', 250, 100, 'Cien gramos'],
] as const) {
  add('paso-' + id, description, 'stepQuantity', { quantity, delta })
}

// ---------------------------------------------------------------------------
// Cantidades

const quantity = (value: unknown, unit: string) => ({ ...body(value), unit })
for (const [id, value, unit, description] of [
  ['entero-ud', 3, 'ud', 'Unidades enteras'],
  ['decimal-kg', 1.5, 'kg', 'Decimales en kg'],
  ['tres-decimales-g', 0.125, 'g', 'Tres decimales en g'],
  ['resto-binario', 0.1 + 0.2, 'ml', '0,1 + 0,2 sin restos'],
  ['resto-binario-l', 1.1 * 3, 'l', '1,1 × 3 sin restos'],
  ['cero', 0, 'bolsa', 'Cero'],
  ['millon', 1_000_000, 'botella', 'El máximo'],
  ['mas-del-millon', 1_000_000.5, 'kg', 'Por encima del máximo'],
  ['negativa', -0.5, 'kg', 'Negativa'],
  ['cuatro-decimales', 0.0005, 'kg', 'Cuatro decimales'],
  ['casi-entero', 2.0000001, 'ud', 'Un resto que no es binario'],
  ['medio-paquete', 0.5, 'paquete', 'Medio paquete'],
  ['media-lata', 1.5, 'lata', 'Lata'],
  ['media-docena', 0.5, 'docena', 'Docena'],
  ['texto', '1', 'ud', 'Texto'],
  ['null', null, 'ud', 'null'],
  ['booleano', true, 'ud', 'Booleano'],
] as const) {
  add(`cantidad-${id}`, description, 'checkQuantity', quantity(value, unit))
}
add('cantidad-sin-valor', 'Sin valor (undefined)', 'checkQuantity', { unit: 'ud' })
add('cantidad-infinita', 'Infinity', 'checkQuantity', { ...bodyJson('1e400'), unit: 'kg' })
add('cantidad-menos-cero', '-0', 'checkQuantity', { ...bodyJson('-0'), unit: 'kg' })

// ---------------------------------------------------------------------------
// Orden de las listas: localeCompare('es') sin mayúsculas ni tildes, con ellas y por id

const names = ['Íñigo', 'Iñigo', 'iñigo', 'Ana', 'ana', 'Álvaro', 'alvaro', 'Zoe', 'Ñu', 'Nuria', 'nuria', 'María', 'Maria', 'Mari Carmen', 'Mari-Carmen', 'mari carmen', '2 hermanos', 'Óscar', 'oscar', 'Ñandú']
add('personas-por-nombre', 'Personas por nombre: ñ después de n, minúsculas antes que mayúsculas, tildes después', 'sortPeople', {
  people: names.map((name, index) => ({ id: `p-${String(index).padStart(2, '0')}`, name, createdAt: '2026-11-01T08:00:00.000Z' })),
})
add('personas-empate-por-id', 'El mismo nombre: decide el id', 'sortPeople', {
  people: [
    { id: 'p-b', name: 'Ana', createdAt: '2026-11-01T08:00:00.000Z' },
    { id: 'p-a', name: 'Ana', createdAt: '2026-11-01T08:00:00.000Z' },
    { id: 'p-C', name: 'Ana', createdAt: '2026-11-01T08:00:00.000Z' },
  ],
})
const itemNames = ['pina', 'piña', 'PINA', 'Pan', 'pan', 'Harina', 'Ñame', 'Nata', 'árbol', 'Arroz', 'Leche', 'leche', 'Zumo', 'Agua', 'Café', 'Cafe']
const frequencies = ['ocasional', 'semanal', 'mensual']
add('productos-por-frecuencia-y-nombre', 'Semanal, mensual y ocasional; dentro, por nombre', 'sortItems', {
  items: itemNames.map((name, index) => ({ id: `i-${String(index).padStart(2, '0')}`, name, frequency: frequencies[index % 3] })),
})
add('productos-empate-por-id', 'Mismo nombre y frecuencia: decide el id', 'sortItems', {
  items: [
    { id: 'i-2', name: 'Leche', frequency: 'semanal' },
    { id: 'i-10', name: 'Leche', frequency: 'semanal' },
    { id: 'i-1', name: 'leche', frequency: 'semanal' },
    { id: 'i-0', name: 'Leche', frequency: 'mensual' },
  ],
})

// ---------------------------------------------------------------------------

const corpus = {
  format: 'cuentas-claras-pantry-rules-v1',
  provenance: 'Datos inventados para la migración a .NET (PAN-01 y siguientes). Sin datos de la instalación: personas, productos y cantidades de ensayo; las salidas son las de TypeScript.',
  operations: PANTRY_OPERATIONS,
  cases,
}
const text = `${JSON.stringify(corpus, null, 2)}\n`
const used = new Set(cases.map((c) => c.operation))
const unused = PANTRY_OPERATIONS.filter((operation) => !used.has(operation))
if (unused.length > 0) throw new Error(`Operaciones sin casos: ${unused.join(', ')}`)

if (process.argv.includes('--escribir')) {
  writeFileSync(FILE, text)
  console.log(`Escrito ${cases.length} casos en fixtures/migration/rules-pantry.json`)
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
