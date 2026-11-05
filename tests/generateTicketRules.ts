import { readFileSync, writeFileSync } from 'node:fs'
import { linesFromText, parseTicket, type ParsedTicketLine } from '../shared/tickets/ticketParse.ts'
import { nameKey } from '../shared/tickets/ticketText.ts'
import { validateTicketSave } from '../shared/tickets/ticketValidation.ts'
import type { OcrLine, TicketSaveLine } from '../shared/tickets/types.ts'
import { corpusJson, runTicketRule, TICKET_OPERATIONS } from './ticketRules.ts'

/**
 * Genera fixtures/migration/rules-tickets.json: las entradas de las reglas de tickets y lo que
 * devuelve TypeScript con ellas. Se ejecuta a mano, una vez, y el resultado se revisa:
 *
 *   npx tsx tests/generateTicketRules.ts             # compara con el corpus guardado y dice qué cambiaría
 *   npx tsx tests/generateTicketRules.ts --escribir  # lo reescribe
 *
 * Las pruebas (tests/migrationTicketRules.test.ts y la de C#) nunca lo regeneran. Cambiar una
 * regla de shared/tickets o de server/modules/tickets/domain obliga a regenerarlo, revisar el
 * diff y portar el cambio a C# (backend/src/CuentasClaras.Domain/Tickets/).
 */

const FILE = new URL('../fixtures/migration/rules-tickets.json', import.meta.url)
const fixture = (path: string) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'))

interface Case { id: string; description: string; operation: string; input: unknown; expected: unknown }
const cases: Case[] = []

/** Guarda la entrada tal como la verá quien lea el JSON (sin undefined) y lo que devuelve TypeScript con ella. */
function add(id: string, description: string, operation: string, input: unknown = {}) {
  if (cases.some((c) => c.id === id)) throw new Error(`Id repetido: ${id}`)
  const clean = corpusJson(input)
  cases.push({ id, description, operation, input: clean, expected: runTicketRule(operation, structuredClone(clean)) })
}

// ---------------------------------------------------------------------------
// Ayudantes copiados de los tests de shared/tickets

const ocr = (...rows: (string | [string, string])[]): OcrLine[] =>
  rows.map((row) => (typeof row === 'string' ? { text: row, reread: null } : { text: row[0], reread: row[1] }))
const HEADER = ['LIDL SUPERMERCADOS S.A.U.', 'Calle del Ejemplo, 12', '39001Santander', 'NIF A00000000', 'EUR']
const FOOTER = ['FECHA: 24/10/26', 'HORA: 18:05:12']
/** ticketCases.test.ts */
const lidl = (...rows: (string | [string, string])[]): OcrLine[] => [...linesFromText('LIDL SUPERMERCADOS S.A.U.\nEUR'), ...ocr(...rows)]
const LIDL_FOOTER = ['Lidl Pay 0,00', 'FECHA: 28/10/26', 'HORA: 19:24:38']
const lidlPages = (...rows: (string | [string, string])[]) => [lidl(...rows, ...LIDL_FOOTER)]
/** ticketSafety.test.ts */
const safetyPages = (...lines: string[]) => [linesFromText(['LIDL', 'EUR', ...lines].join('\n'))]

const asSaved = (line: ParsedTicketLine, confirmed = false): TicketSaveLine => ({
  rawName: line.rawName, quantity: line.quantity, unitPriceCents: line.unitPriceCents, amountCents: line.amountCents,
  discountCents: line.discountCents, weightKg: line.weightKg, pricePerKgCents: line.pricePerKgCents, taxCode: line.taxCode,
  occasional: false, confirmed, evidence: line.evidence,
})
const firstLine = (pages: OcrLine[][]) => parseTicket(pages).lines[0]

// ---------------------------------------------------------------------------
// shared/common: lo que usan los tickets

const euros: [number, 'always'?][] = [[0], [1], [5], [99], [100], [990], [123456], [-123456], [-1], [100000000], [99999999999], [100, 'always'], [0, 'always'], [-5, 'always']]
for (const [cents, sign] of euros) {
  add(`euros-${cents}${sign ? '-siempre' : ''}`, 'formatEuros: separador de miles «.», coma, U+00A0 antes de € y U+2212 en negativos', 'formatEuros', { cents, sign })
}
const dates: [string, unknown][] = [
  ['valida', '2026-10-28'], ['bisiesto', '2024-02-29'], ['no-bisiesto', '2026-02-29'], ['salto-final', '2026-10-28\n'],
  ['antes-de-1900', '1899-12-31'], ['sin-ceros', '2026-1-28'], ['numero', 20261028], ['nula', null],
  ['cifras-anchas', '２０２６-10-28'], ['cifras-arabes', '2026-10-٢٨'], ['mes-13', '2026-13-01'],
]
for (const [id, value] of dates) add(`fecha-${id}`, 'isValidISODate: AAAA-MM-DD real; «$» de JS no admite un salto final y \\d solo es ASCII', 'isValidISODate', { value })
add('fecha-componer', 'toISODate rellena con ceros', 'toISODate', { year: 2026, month: 10, day: 5 })
add('fecha-componer-ano-corto', 'toISODate rellena el año a cuatro cifras', 'toISODate', { year: 26, month: 1, day: 5 })

// ---------------------------------------------------------------------------
// shared/tickets/ticketText.ts

for (const [id, text] of [
  ['tildes', 'Jamón serrano reser.'], ['enes', 'LASAÑA  BOLOÑESA'], ['vacio', ''], ['solo-signos', '¡¿!?·'],
  ['expansiones', 'ß ﬁ ﬀ ﬃ ﬆ ŉ ẚ K Å'], ['sin-punto', 'ı ſ İ'], ['espacios-js', ' pan﻿de\u0085molde '],
  ['ya-descompuesto', 'Jamón'], ['sustituto-suelto', 'PAN\uD800DE'], ['astral', '𝐀PAN 𝟏𝟐'], ['digrafos', 'Ǆ ǅ ǆ ĳ'],
  ['cifras-otras', '٣ ３ 3'], ['griego', 'ΟΔΟΣ ΐ'],
] as const) add(`clave-${id}`, 'nameKey: NFD, sin marcas, mayúsculas de JS (que expanden) y solo A-Z 0-9', 'nameKey', { text })

// Todos los puntos de código cuya clave no es vacía: nameKey tiene que dar lo mismo carácter a carácter.
const keyed: string[] = []
for (let cp = 0; cp <= 0x10ffff; cp++) {
  if (cp >= 0xd800 && cp <= 0xdfff) continue
  const s = String.fromCodePoint(cp)
  if (nameKey(s) !== '') keyed.push(s)
}
add('clave-cada-caracter', `nameKey de cada uno de los ${keyed.length} puntos de código con clave no vacía`, 'nameKeyEach', { texts: keyed })

for (const [id, a, b] of [
  ['ocr-una-letra', 'FTLETE DE PECHUGA', 'FILETE DE PECHUGA'], ['distintos', 'PIZZA BARBACOA', 'PIZZA JAMON Y QUESO'], ['iguales', 'LECHE', 'LECHE'],
  ['ocr-pizza', 'PTZZA BARBACOA', 'PIZZA BARBACOA'], ['vacios', '', ''], ['uno-vacio', 'PAN', ''], ['orden', 'PECHUGA FILETE', 'FILETE PECHUGA'],
  ['expansion', 'STRAßE', 'STRASSE'], ['letra-sola', 'A', 'B'], ['tildes', 'Plátano', 'PLATANO'],
] as const) add(`parecido-${id}`, 'similarity: el mayor entre distancia de edición y Dice', 'similarity', { a, b })

for (const [id, raw] of [
  ['molde', 'PAN DE MOLDE INTEGRA'], ['tilde', 'PLÁTANO  CANARIO'], ['talla-l', 'HUEVOS CAMPEROS L'], ['talla-xl', 'CAMISETA XL'],
  ['y-a', 'PAN Y LECHE A GRANEL'], ['tallas', 'XL XXL XXXS M L PAN Y'], ['eszett', 'STRAßE'], ['eszett-inicial', 'ßÜ'],
  ['i-con-punto', 'İSTANBUL'], ['sigma-final', 'ΟΔΟΣ ΑΓΙΟΣ'], ['sigma-sola', 'Σ ΣΑ'], ['ligadura', 'ﬁNO'],
  ['astral', '𐐀𐐁 PAN'], ['espacios-js', ' ﻿PAN\u0085DE  MOLDE\t'], ['digrafo', 'ǄEMAL'], ['n-apostrofo', 'ŉ'],
] as const) add(`bonito-${id}`, 'prettyName: minúsculas de es con contexto (sigma final, İ) y la primera unidad UTF-16 en mayúscula', 'prettyName', { raw })

const cased: string[] = []
for (let cp = 0; cp <= 0x10ffff; cp++) {
  if (cp >= 0xd800 && cp <= 0xdfff) continue
  const s = String.fromCodePoint(cp)
  if (s.toUpperCase() !== s || s.toLowerCase() !== s) cased.push(s)
}
add('bonito-cada-caracter', `prettyName de cada uno de los ${cased.length} puntos de código que cambian con mayúsculas o minúsculas`, 'prettyNameEach', { texts: cased })

for (const [id, raw] of [
  ['papel', 'PAPEL HIGIÉNICO 12R'], ['aceite', 'ACEITE DE OLIVA V.E.'], ['pechuga', 'PECHUGA DE POLLO'], ['te', 'TE VERDE'],
  ['teja', 'TEJA'], ['salsa', 'SALSA BRAVA'], ['gelatina', 'GELATINA'], ['angel', 'ANGEL'], ['cafe', 'Café molido'],
  ['congelado', 'GUISANTES CONGELADOS'], ['vacio', ''],
] as const) add(`frecuencia-${id}`, 'guessFrequency: palabras mensuales al principio de una palabra', 'guessFrequency', { raw })

// ---------------------------------------------------------------------------
// shared/tickets/ticketArithmetic.ts

for (const [id, numerator, denominator] of [
  ['peso-lomo', 544 * 675, 1000], ['peso-pechuga', 547 * 758, 1000], ['mitad', 5, 2], ['mitad-negativa', -5, 2],
  ['cero', 0, 7], ['menos-cero', -1, 1000], ['mitad-1000', 2500, 1000], ['mitad-negativa-1000', -3500, 1000],
  ['maximo-seguro', 2 ** 53 - 1, 1], ['maximo-seguro-par', 2 ** 53 - 1, 2], ['dos-maximos', 2 ** 53 - 1, 2 ** 53 - 1],
  ['no-seguro', 2 ** 53, 1], ['no-seguro-negativo', -(2 ** 53), 1], ['denominador-no-seguro', 1, 2 ** 53],
  ['denominador-cero', 1, 0], ['denominador-negativo', 1, -2], ['decimal', 1.5, 2], ['denominador-decimal', 3, 2.5],
] as const) add(`redondeo-${id}`, 'roundRatio: mitades lejos de cero y error si un operando no es un entero seguro de JS', 'roundRatio', { numerator, denominator })

const line = (overrides: Partial<TicketSaveLine> = {}): TicketSaveLine => ({
  rawName: 'PAN DE ENSAYO', quantity: 1, unitPriceCents: null, amountCents: 100, discountCents: 0, weightKg: null,
  pricePerKgCents: null, taxCode: null, occasional: false, ...overrides,
})
for (const [id, overrides] of [
  ['unidades', { quantity: 2, unitPriceCents: 495, amountCents: 990 }],
  ['devolucion-unidades', { quantity: 2, unitPriceCents: 89, amountCents: -178 }],
  ['sin-precio', { unitPriceCents: null }],
  ['peso', { weightKg: 0.544, pricePerKgCents: 675, amountCents: 367 }],
  ['peso-mitad-por-arriba', { weightKg: 0.0025, pricePerKgCents: 1000, amountCents: 3 }],
  ['peso-mitad-562-5', { weightKg: 0.5625, pricePerKgCents: 1000, amountCents: 563 }],
  ['peso-negativo-mitad', { weightKg: -0.0035, pricePerKgCents: 1000, amountCents: -3 }],
  ['peso-1-0005', { weightKg: 1.0005, pricePerKgCents: 1000, amountCents: 1000 }],
  ['peso-desborda', { weightKg: 1e13, pricePerKgCents: 10000, amountCents: 1 }],
  ['importe-nulo-peso', { weightKg: 0.5, pricePerKgCents: 99, amountCents: null }],
] as const) {
  add(`calculado-${id}`, 'calculatedAmount: peso redondeado como Math.round y signo del importe', 'calculatedAmount', { line: line(overrides) })
}
for (const [id, overrides] of [
  ['bien', {}], ['sin-importe', { amountCents: null }], ['cantidad-cero', { quantity: 0 }], ['cantidad-1000', { quantity: 1000 }],
  ['peso-0-0004', { weightKg: 0.0004 }], ['peso-0-0005', { weightKg: 0.0005, pricePerKgCents: null }], ['peso-cero', { weightKg: 0 }],
  ['no-cuadra', { quantity: 2, unitPriceCents: 495, amountCents: 9290 }], ['descuento-mayor', { discountCents: 101 }],
  ['descuento-en-devolucion', { amountCents: -100, discountCents: 1 }], ['varios', { amountCents: 5, quantity: 0, unitPriceCents: 3, discountCents: 9 }],
] as const) add(`problemas-${id}`, 'lineProblems: problemas de una línea, en su orden', 'lineProblems', { line: line(overrides) })

for (const [id, overrides] of [
  ['verificada', { reviewStatus: 'verified' }], ['pendiente', { reviewStatus: 'pending', confirmed: true }],
  ['devolucion', { amountCents: -100, confirmed: true }], ['sin-importe', { amountCents: null }],
  ['con-incidencias', { evidence: { text: 'PAN 1,00', reread: null, recognizedCents: 100, calculatedCents: null, selectedBy: 'read', issues: ['Lectura de baja confianza'] } }],
  ['con-incidencias-confirmada', { confirmed: true, evidence: { text: 'PAN 1,00', reread: null, recognizedCents: 100, calculatedCents: null, selectedBy: 'read', issues: ['Lectura de baja confianza'] } }],
  ['incidencias-vacias', { evidence: { text: 'PAN 1,00', reread: null, recognizedCents: 100, calculatedCents: null, selectedBy: 'read', issues: [] } }],
] as const) add(`aplicable-${id}`, 'canApplyLine: solo líneas fiables cambian la despensa', 'canApplyLine', { line: line(overrides as Partial<TicketSaveLine>) })

// ---------------------------------------------------------------------------
// shared/tickets/ticketEvidence.ts (casos de ticketEvidence.test.ts y trampas)

for (const [read, expected] of [
  ['9290', '990'], ['7920', '790'], ['508', '568'], ['99', '990'], ['909', '990'], ['464', '415'], ['990', '990'], ['9a0', '990'],
  ['٣', '3'], ['', ''], ['', '5'], ['12', '21'], ['1234', '1243'], ['1234', '2134'], ['1324', '1234'], ['0', '00'],
] as const) add(`un-error-${read || 'vacio'}-${expected || 'vacio'}`, 'singleDigitEdit: un solo error de una cifra (\\d solo ASCII)', 'singleDigitEdit', { read, expected })
for (const digits of ['495', '0', '', '00', '0544', '990']) {
  add(`variantes-${digits || 'vacio'}`, 'singleEditVariants: en orden de inserción (decide qué alternativa se cita primero)', 'singleEditVariants', { digits })
}
for (const cents of [990, 95, -178, 0, 5, 100000, -5]) add(`cifras-${cents}`, 'printedDigits: las cifras como se imprimen', 'printedDigits', { cents })

const reading = (cents: number, rawDigits?: string, malformed = false) => ({ cents, rawDigits: rawDigits ?? `${Math.floor(Math.abs(cents) / 100)}${String(Math.abs(cents) % 100).padStart(2, '0')}`, malformed })
const one = (r: ReturnType<typeof reading>) => ({ recognized: r, readings: [r], inputsStable: false, amountStable: false })
for (const [id, input] of [
  ['coherente', { ...one(reading(990)), unitCents: 495, quantity: 2 }],
  ['cifra-de-mas', { ...one(reading(9290)), unitCents: 495, quantity: 2 }],
  ['ambiguo', { ...one(reading(508)), unitCents: 284, quantity: 2 }],
  ['segunda-lectura', { recognized: reading(508), readings: [reading(508), reading(568)], inputsStable: true, amountStable: false, unitCents: 284, quantity: 2 }],
  ['confianza', { ...one(reading(508)), unitCents: 284, quantity: 2, confidence: { amount: 55, inputs: 93 } }],
  ['inestable', { recognized: reading(792, '7920', true), readings: [reading(792, '7920', true), reading(720)], inputsStable: true, amountStable: false, unitCents: 395, quantity: 2 }],
  ['precio-mal-leido', { ...one(reading(990)), unitCents: 435, quantity: 2 }],
  ['cantidad-mal-leida', { ...one(reading(1485)), unitCents: 495, quantity: 2 }],
  ['varios-errores', { ...one(reading(1234)), unitCents: 495, quantity: 2 }],
  ['devolucion', { ...one(reading(-178)), unitCents: 89, quantity: 2 }],
  ['devolucion-mal', { ...one(reading(-1780)), unitCents: 89, quantity: 2 }],
  ['importe-cero', { ...one(reading(0)), unitCents: 89, quantity: 2 }],
  ['deformado-impreso', { recognized: { ...reading(792, '7920', true), printed: '7,920' }, readings: [{ ...reading(792, '7920', true), printed: '7,920' }], inputsStable: false, amountStable: false, unitCents: 395, quantity: 2 }],
  ['estable-importe', { recognized: reading(990), readings: [reading(990), reading(990)], inputsStable: false, amountStable: true, unitCents: 435, quantity: 2 }],
  ['confianza-mitades', { ...one(reading(508)), unitCents: 284, quantity: 2, confidence: { amount: 84.5, inputs: 99.5 } }],
  ['confianza-importe', { ...one(reading(990)), unitCents: 435, quantity: 2, confidence: { amount: 98.5, inputs: 2.5 } }],
  ['confianza-negativa', { ...one(reading(508)), unitCents: 284, quantity: 2, confidence: { amount: -2.5, inputs: 90 } }],
  ['confianza-negativa-impar', { ...one(reading(508)), unitCents: 284, quantity: 2, confidence: { amount: -3.5, inputs: 90 } }],
] as const) add(`unidades-${id}`, 'assessUnits: qué cifra de precio × cantidad está mal leída', 'assessUnits', { input })
for (const [id, input] of [
  ['coherente', { ...one(reading(367)), grams: 544, pricePerKgCents: 675 }],
  ['intercambiadas', { ...one(reading(376)), grams: 544, pricePerKgCents: 675 }],
  ['ambiguo', { ...one(reading(464)), grams: 547, pricePerKgCents: 758, inputsStable: true }],
  ['orden-de-variantes', { ...one(reading(55)), grams: 544, pricePerKgCents: 100 }],
  ['orden-precio', { ...one(reading(600)), grams: 1000, pricePerKgCents: 500 }],
  ['gramos-grandes', { ...one(reading(1)), grams: 1234567, pricePerKgCents: 1 }],
  ['gramos-pocos', { ...one(reading(9)), grams: 5, pricePerKgCents: 1000 }],
  ['gramos-negativos', { ...one(reading(-9)), grams: -5, pricePerKgCents: 1000 }],
  ['devolucion', { ...one(reading(-367)), grams: 544, pricePerKgCents: 675 }],
] as const) add(`peso-${id}`, 'assessWeight: qué cifra de peso × precio por kilo está mal leída (toFixed(3) a mano)', 'assessWeight', { input })

// ---------------------------------------------------------------------------
// shared/tickets/ticketParse.ts: fixtures de fixtures/tickets/

add('ticket-lidl-ejemplo', 'parseTicket: lo que leyó el OCR del ticket inventado (ticket-lidl-ejemplo.ocr.json)', 'parseTicket', { pages: [fixture('fixtures/tickets/ticket-lidl-ejemplo.ocr.json')] })
for (const name of ['ejemplo-franja-navegador', 'torrelavega-400px', 'torrelavega-foto-800', 'torrelavega-foto-1600-mejorada']) {
  add(`ocr-real-${name}`, `parseTicket: OCR real de una imagen sintética (ocr-real/${name}.json)`, 'parseTicket', { pages: [fixture(`fixtures/tickets/ocr-real/${name}.json`).lines] })
}
for (const fixtureCase of fixture('fixtures/tickets/ticket-cases.json') as { id: string; text: string }[]) {
  add(`caso-${fixtureCase.id}`, `parseTicket: ticket-cases.json, ${fixtureCase.id}`, 'parseTicket', { pages: [linesFromText(fixtureCase.text)] })
  add(`texto-${fixtureCase.id}`, `linesFromText: ticket-cases.json, ${fixtureCase.id}`, 'linesFromText', { text: fixtureCase.text })
}

// ticketParse.test.ts
const torrelavega = [ocr(...HEADER,
  ['CHOCO SHELLS                        1,79 B', '1,725'],
  ['PECHUGA DE POLLO                    3,79B', '3,73 5'],
  ['ACEITUNAS VERDES ANC                3,29 B', '2,23 B'],
  ['BURGER CERDO Y VACU. 3,95x   2     7,920 B', '3, 95Xx 2 7,20 B'],
  ['HUEVOS MEDIANOS M     2,84X   2     5,08 A', '2 ,84X 2 5,08 A'],
  ['PATATA NUEVA 5 KG     4,95X 2     92,90 A', '4, 95Xx 2 92,390 A'],
  'TOTAL 32,35', ...FOOTER)]
const parseTests: [string, string, OcrLine[][]][] = [
  ['torrelavega-dos-lecturas', 'lecturas reales de un ticket de Torrelavega (28/10/26)', torrelavega],
  ['segunda-lectura', 'usa la segunda lectura cuando la primera se equivoca', [ocr(...HEADER,
    ['PIZZA FAMI JAM Y QUE                32D', '3,75 6'], ['FRUTA Y LECHE MEDIT.                T::19::6', '1,15C'],
    ['MANDARINA NACIONAL                  1,839 A', '1,89 A'], ['PAPEL HIGIÉNICO 12R                 3,75 €', '12 3,75 C'],
    'TOTAL                                 10,54', ...FOOTER)]],
  ['multiplicacion-corrige', 'cantidad × precio y peso × precio por kilo corrigen un importe', [ocr(...HEADER,
    ['BURGER CERDO Y VACU. 3,95x   2     7,20 8', '3,95 2 7,20 8'], ['LASAÑA 5 QUESOS       2:79X 2     5,50 B', '2,75 2 5,50 B'],
    ['FILETE DE PECHUGA                   4,64 B', '4,64 B'], ['0,547 kg x 7,58 EUR/ke', '0,547 kg x 7,58 EUR/kg'],
    'TOTAL                                 17,55', ...FOOTER)]],
  ['desc-y-promo', 'Desc. al artículo y la promoción como ajuste', [ocr(...HEADER,
    ['PECHUGA DE POLLO                    3,79 B', '3,79 B'], ['Desc,                          -0,60', '-0,60'],
    ['COOKIES PEPITAS CHOC                1,29 B', '1,29 B'], 'PROMO LIDL PLUS               -0, 14',
    'TOTAL                                  4,34', ...FOOTER)]],
  ['ilegible-sin-evidencia', 'un importe ilegible no se despeja del total', [ocr(...HEADER,
    ['ARROZ LARGO                         1,09 A', '1,09 A'], ['COOKIES PEPITAS CHOC                1-29:B', '1,2398'],
    'TOTAL                                  2,38', ...FOOTER)]],
  ['no-cambia-cifra', 'no cambia una cifra para explicar el total', [ocr(...HEADER, ['RULO DE CABRA                       2,23 A', '2,23 A'], ['DÁTIL SIN HUESO 1,25 A', '1,25 A'], 'TOTAL 3,54', ...FOOTER)]],
  ['no-cuadra', 'si no cuadra, lo dice', [ocr(...HEADER,
    ['PIZZA JAMON Y QUESO                 2,33 B', '2,3 8'], ['RULO DE CABRA                       2,23 A', '2,23 A'],
    'NOCILLA                             4,45 B', 'TOTAL                                  9,12', ...FOOTER)]],
  ['dos-ilegibles', 'dos ilegibles, ninguno deducido', [ocr(...HEADER, ['PAN 1-29:B', '?'], ['SAL 9;9;9', '?'], 'TOTAL 2,00')]],
  ['devolucion', 'una devolución resta', [ocr(...HEADER, 'LECHE ENTERA 0,89 A', 'LECHE ENTERA -0,89 A', 'PAN 1,00 A', 'TOTAL 1,00', ...FOOTER)]],
  ['sin-total', 'sin total no está bien', [ocr(...HEADER, 'PAN 1,00 A')]],
  ['otra-tienda', 'ticket genérico con la cantidad delante', [linesFromText(['MERCADONA, S.A.', 'C/ EJEMPLO, 1', '28/10/2026 19:24  OP: 123456',
    'Descripción          P. Unit  Importe', '1 PAN BARRA                     0,60', '2 YOGUR GRIEGO           1,20   2,40',
    '1 PLATANO                       1,95', 'TOTAL (€)                       4,95', 'TARJETA BANCARIA                4,95'].join('\n'))]],
]
for (const [id, description, pages] of parseTests) add(`analisis-${id}`, `parseTicket (ticketParse.test.ts): ${description}`, 'parseTicket', { pages })

add('unir-solape', 'mergePages quita el solape entre capturas', 'mergePages', { pages: [ocr('EUR', 'PAN 1,00 A', 'LECHE 0,89 A', 'HUEVOS 2,10 A'), ocr('LECHE 0,89 A', 'HUEVOS 2,10 A', 'SAL 0,40 A', 'TOTAL 4,39')] })
add('unir-repetido', 'mergePages no confunde un producto repetido con el solape', 'mergePages', { pages: [ocr('EUR', 'FIDEOS 0,65 B'), ocr('FIDEOS 0,65 B', 'TOTAL 1,30')] })
add('comprobar-cuadra', 'checkTicket tras corregir importes', 'checkTicket', { lines: [{ amountCents: 100, discountCents: 10 }, { amountCents: 50, discountCents: 0 }], totalCents: 140 })
add('comprobar-incompleto', 'checkTicket con un importe ilegible', 'checkTicket', { lines: [{ amountCents: null, discountCents: 0 }], totalCents: 140 })
add('comprobar-pendiente', 'checkTicket con una línea pendiente', 'checkTicket', { lines: [{ amountCents: 140, discountCents: 0, pending: true }], totalCents: 140 })
add('comprobar-sin-total', 'checkTicket sin total', 'checkTicket', { lines: [{ amountCents: 140, discountCents: 0 }], totalCents: null })
add('comprobar-ajustes', 'checkTicket con ajustes, uno sin importe, e incompleto por tamaño', 'checkTicket', {
  lines: [{ amountCents: 140, discountCents: 0 }], totalCents: 130, adjustments: [{ amountCents: -10 }, { amountCents: null }], options: { incomplete: true } })
add('comprobar-no-cuadra', 'checkTicket con diferencia', 'checkTicket', { lines: [{ amountCents: 140, discountCents: 5 }], totalCents: 140, adjustments: [{ amountCents: -10 }] })
add('etiquetas', 'CHECK_LABELS', 'checkLabels')

// ticketCases.test.ts
const multipliers = [
  'BURGER CERDO Y VACU. 3,95x 2 7,90 B', 'HUEVOS MEDIANOS M   2,84X 2 5,68 A', 'PATATA NUEVA 5 KG   4,95X 2 9,90 A',
  'LASAÑA 5 QUESOS 2,75 × 2 5,50 B', 'BURGER 3,95 * 2 7,90 B', 'BURGER 3,95Xx 2 7,90 B', 'PATATA NUEVA 5 KG 4,95x2 9,90 A',
]
multipliers.forEach((text, i) => add(`casos-1-multiplicador-${i + 1}`, `parseTicket (ticketCases 1): ${text}`, 'parseTicket', { pages: lidlPages(text) }))
const caseParses: [string, string, OcrLine[][]][] = [
  ['2-peso', 'peso × precio por kilo', lidlPages('LOMO ADOBADO 3,67 B', '0,544 kg x 6,75 EUR/kg', 'FILETE DE PECHUGA 4,15 B', '0,547 kg x 7,58 EUR/kg', 'TOTAL 7,82')],
  ['2-peso-intercambiado', 'importe de peso con dos cifras intercambiadas', lidlPages('LOMO ADOBADO 3,76 B', '0,544 kg x 6,75 EUR/kg', 'TOTAL 3,67')],
  ['3-cifra-de-mas', '«9,90» leído «92,90»', lidlPages('PATATA NUEVA 5 KG   4,95X   2   92,90 A', 'TOTAL 9,90')],
  ['3-otras-cifras', '«7,920» y «5,08» con segunda lectura', lidlPages('BURGER CERDO Y VACU. 3,95Xx 2 7,920 B', ['HUEVOS MEDIANOS M   2 ,84X 2 5,08 A', '2,84X 2 5,68 A'], 'TOTAL 13,58')],
  ['3-precio-dudoso', 'precio unitario también dudoso', lidlPages('HUEVOS MEDIANOS M   2 ,84X 2 5,08 A', 'TOTAL 5,68')],
  ['4-relectura', '«3,79B» con relectura «3,73 5»', lidlPages(['PECHUGA DE POLLO 3,79B', '3,73 5'], 'TOTAL 3,79')],
  ['4-iva-como-cifra', 'solo «3,73 5»', lidlPages('PECHUGA DE POLLO 3,73 5', 'TOTAL 3,73')],
  ['4-letras', 'letras en un importe', lidlPages('PAN 1,O9 A', 'SAL I,29 B', 'LECHE 3,79B', 'AGUA 1,5l 0,45 A', 'BOLSA 3,7B', 'TOTAL 0,00')],
  ['4-iva-pegado', '«1,798» y «2,992 A»', lidlPages('CHOCO SHELLS 1,798', 'HUEVOS 2,992 A', 'TOTAL 4,78')],
  ['5-sin-multiplicacion', 'no se inventa el importe', lidlPages('ARROZ LARGO 1,09 A', 'COOKIES PEPITAS CHOC 1-29:B', 'TOTAL 2,38')],
  ['5-deducido', 'precio × cantidad legibles', lidlPages('PATATA NUEVA 5 KG 4,95X 2 9,?0 A', 'TOTAL 9,90')],
  ['5-relectura-sin-coma', '«3,72B» y «2795»', lidlPages(['PECHUGA DE POLLO 3,72B', '2795'], 'TOTAL 3,72')],
  ['6-repetidos', 'dos líneas iguales son dos compras', lidlPages('LECHE ENTERA 0,89 A', 'LECHE ENTERA 0,89 A', 'TOTAL 1,78')],
  ['7-descuentos', 'Desc. y PROMO LIDL PLUS', lidlPages('PECHUGA DE POLLO 5,27 B', '0,684 kg x 7,70 EUR/kg', 'Desc. -0,53', 'CAFÉ MOLIDO NATURAL 3,29 B', 'PROMO LIDL PLUS -0,33', 'TOTAL 7,70')],
  ['8-cupon', 'un cupón no se reparte', lidlPages('PAN 1,00 A', 'LECHE 1,00 A', 'CUPON LIDL PLUS -0,50', 'TOTAL 1,50')],
  ['9-publicidad', 'ofertas y puntos después del ticket', [lidl('PAN 1,00 A', 'TOTAL 1,00', 'Lidl Pay 1,00', 'FECHA: 28/10/26', 'Ofertas Lidl Plus', 'CHOCOLATE NEGRO 72% 1,29 B', '-20% Yogures naturales', 'Puntos Lidl Plus: 150', 'Compra realizada en', 'Torrelavega 2,00 A')]],
  ['9-publicidad-sin-total', 'la publicidad cierra la lista', [lidl('PAN 1,00 A', 'Ofertas Lidl Plus', 'CHOCOLATE 2,99 B')]],
  ['10-recortado', 'sin final del ticket', [lidl('PAN 1,00 A', 'LECHE 0,89 A')]],
  ['11-devoluciones', 'devoluciones, también con multiplicación', lidlPages('LECHE ENTERA 0,89 A', 'LECHE ENTERA -0,89 A', 'YOGUR 0,55x 2 -1,10 A', 'PAN 2,10 A', 'TOTAL 1,00')],
  ['11-devolucion-sola', 'una devolución sola', lidlPages('LECHE ENTERA -0,89 A', 'TOTAL -0,89')],
  ['12-diferencia', 'diferencia con el total', lidlPages('RULO DE CABRA 2,23 A', 'DATIL SIN HUESO 1,25 A', 'TOTAL 3,54')],
  ['13-compensados', 'dos lecturas dudosas que se compensan', lidlPages(['PAN 1,00 A', '1,10 A'], ['SAL 1,00 A', '0,90 A'], 'TOTAL 2,00')],
  ['13-desglose-iva', 'el desglose de IVA descubre dos errores', [lidl('PAN 1,00 A', 'LECHE 1,00 B', 'TOTAL 2,00', 'Lidl Pay 2,00', 'IVA% BASE CUOTA TOTAL', 'A 4% 1,15 0,05 1,20', 'B 10% 0,73 0,07 0,80', 'FECHA: 28/10/26')]],
  ['14-poca-nitidez', 'muchas líneas con poca confianza', [[...linesFromText('LIDL\nEUR'), ...['PAN 1,00 A', 'SAL 0,40 A', 'LECHE 0,89 A'].map(text => ({ text, reread: null, confidence: 40 })), ...linesFromText('TOTAL 2,29')]]],
]
for (const [id, description, pages] of caseParses) add(`casos-${id}`, `parseTicket (ticketCases): ${description}`, 'parseTicket', { pages })
const longRows = Array.from({ length: 200 }, (_, i) => `PRODUCTO ${String.fromCharCode(65 + (i % 26))}${i} 1,${String(i % 100).padStart(2, '0')} A`)
const longTotal = longRows.reduce((sum, _, i) => sum + 100 + (i % 100), 0)
add('casos-10-largo', 'parseTicket (ticketCases 10): 200 líneas que cuadran', 'parseTicket', { pages: lidlPages(...longRows, `TOTAL ${Math.floor(longTotal / 100)},${String(longTotal % 100).padStart(2, '0')}`) })
add('casos-10-demasiado-largo', 'parseTicket (ticketCases 10): más de 300 líneas', 'parseTicket', { pages: lidlPages(...Array.from({ length: 305 }, (_, i) => `PRODUCTO N${i} 1,00 A`), 'TOTAL 305,00') })
const at = (text: string, y: number, segmentIndex: number): OcrLine => ({ text, reread: null, confidence: 90,
  source: { imageIndex: 0, segmentIndex, width: 1300, height: 8000, box: { x0: 100, x1: 1200, y0: y, y1: y + 30 } } })
add('casos-6-franjas', 'mergePages (ticketCases 6): en franjas de una imagen solo se quita lo que coincide en posición', 'mergePages', { pages: [
  [at('EUR', 100, 0), at('LECHE ENTERA 0,89 A', 3900, 0), at('LECHE ENTERA 0,89 A', 4000, 0)],
  [at('LECHE ENTERA 0,89 A', 4000, 1), at('LECHE ENTERA 0,89 A', 4100, 1), at('TOTAL 2,67', 4200, 1)]] })
add('casos-6-franjas-confianza', 'mergePages: en un solape por posición se queda la lectura con más confianza', 'mergePages', { pages: [
  [at('EUR', 100, 0), { ...at('LECHE ENTERA 0,89 A', 4000, 0), confidence: 70 }],
  [{ ...at('LECHE ENTERA 0,88 A', 4002.5, 1), confidence: 95 }, { ...at('PAN 1,00 A', 4050, 1), confidence: 80 }, at('TOTAL 1,89', 4200, 1)]] })
add('casos-6-franjas-ticket', 'parseTicket con franjas que se solapan', 'parseTicket', { pages: [
  [at('LIDL', 50, 0), at('EUR', 100, 0), at('LECHE ENTERA 0,89 A', 3900, 0), at('LECHE ENTERA 0,89 A', 4000, 0)],
  [at('LECHE ENTERA 0,89 A', 4000, 1), at('LECHE ENTERA 0,89 A', 4100, 1), at('TOTAL 2,67', 4200, 1)]] })
add('casos-13-desglose-incoherente', 'readTaxGroups (ticketCases 13): un desglose incoherente no se usa', 'readTaxGroups', { lines: linesFromText('A 4% 1,00 0,50\nB 10% 2,00 0,20 9,99') })
add('casos-13-desglose-coherente', 'readTaxGroups: base, cuota y total, y la letra repetida «Cc»', 'readTaxGroups', { lines: linesFromText('IVA A 4% 1,15 0,05 1,20\nCc 21% 10,00 2,10\nB 10,5% 10,00 1,05 11,05\nA 4% 9,00 0,36') })
add('casos-13-iva-sin-grupos', 'checkTaxGroups (ticketCases 13) sin grupos', 'checkTaxGroups', { lines: [{ amountCents: 100, discountCents: 0, taxCode: 'A' }], groups: [], adjustments: [] })
add('casos-13-iva-con-grupos', 'checkTaxGroups con grupos, una diferencia y un ajuste a cero', 'checkTaxGroups', {
  lines: [{ amountCents: 100, discountCents: 0, taxCode: 'A' }, { amountCents: 100, discountCents: 10, taxCode: 'B' }, { amountCents: 50, discountCents: 0, taxCode: 'B' }],
  groups: [{ code: 'A', rateBasisPoints: 400, baseCents: 115, taxCents: 5, grossCents: 120 }, { code: 'B', rateBasisPoints: 1000, baseCents: 127, taxCents: 13, grossCents: 140 }],
  adjustments: [{ amountCents: 0 }] })
add('casos-13-iva-no-concluyente', 'checkTaxGroups no concluyente: una línea sin letra y otra sin importe', 'checkTaxGroups', {
  lines: [{ amountCents: 100, discountCents: 0, taxCode: null }, { amountCents: null, discountCents: 0, taxCode: 'A' }],
  groups: [{ code: 'A', rateBasisPoints: 400, baseCents: 115, taxCents: 5, grossCents: 120 }] })
for (const name of ['torrelavega-400px']) {
  add(`casos-14-${name}`, 'mergePages del OCR real (sin solape)', 'mergePages', { pages: [fixture(`fixtures/tickets/ocr-real/${name}.json`).lines] })
}

// Líneas tal como se guardarían (asSaved de ticketCases.test.ts): canApplyLine y lineReviewStatus.
const savedFrom: [string, string, OcrLine[][], boolean][] = [
  ['peso-intercambiado', 'importe de peso corregido sin confirmar', lidlPages('LOMO ADOBADO 3,76 B', '0,544 kg x 6,75 EUR/kg', 'TOTAL 3,67'), false],
  ['cifra-de-mas', '92,90 propuesto como 9,90 sin confirmar', lidlPages('PATATA NUEVA 5 KG   4,95X   2   92,90 A', 'TOTAL 9,90'), false],
  ['cifra-de-mas-confirmada', '92,90 propuesto como 9,90 y confirmado', lidlPages('PATATA NUEVA 5 KG   4,95X   2   92,90 A', 'TOTAL 9,90'), true],
  ['deducido', 'importe deducido sin confirmar', lidlPages('PATATA NUEVA 5 KG 4,95X 2 9,?0 A', 'TOTAL 9,90'), false],
  ['devolucion-confirmada', 'una devolución confirmada nunca suma', lidlPages('LECHE ENTERA -0,89 A', 'TOTAL -0,89'), true],
  ['limpia', 'una línea limpia', lidlPages('PAN 1,00 A', 'TOTAL 1,00'), false],
]
for (const [id, description, pages, confirmed] of savedFrom) {
  const saved = asSaved(firstLine(pages), confirmed)
  add(`guardada-${id}`, `canApplyLine: ${description}`, 'canApplyLine', { line: saved })
  add(`estado-${id}`, `lineReviewStatus: ${description}`, 'lineReviewStatus', { line: saved })
}

// ticketSafety.test.ts
const safety: [string, string, OcrLine[][]][] = [
  ['no-cuadra', 'no cambia una cifra para cuadrar', safetyPages('RULO DE CABRA 2,23 A', 'DATIL SIN HUESO 1,25 A', 'TOTAL 3,54')],
  ['ilegible', 'no inventa el único ilegible', safetyPages('ARROZ 1,09 A', 'COOKIES ???', 'TOTAL 2,38')],
  ['pago-sin-total', 'cierra productos al llegar al pago', safetyPages('PAN 1,00 A', 'Lidl Pay 1,00', 'FECHA: 28/10/26', 'HORA: 19:24:38', 'IVA BASE CUOTA', 'A 4% 0,96 0,04', 'Ofertas Lidl Plus', 'CHOCOLATE 2,99 B', 'Puntos Lidl 250')],
  ['cupon', 'conserva un cupón general', safetyPages('PAN 1,00 A', 'LECHE 1,00 A', 'CUPON COMPRA -0,50', 'TOTAL 1,50')],
  ['total-cero', 'admite total cero', safetyPages('LECHE 0,00 A', 'TOTAL 0,00')],
  ['total-devolucion', 'admite devolución', safetyPages('LECHE -0,89 A', 'TOTAL -0,89')],
  ['compensados', 'conserva las dudas aunque se compensen', [[...linesFromText('LIDL\nEUR'), { text: 'PAN 1,00 A', reread: '1,10 A' }, { text: 'SAL 1,00 A', reread: '0,90 A' }, ...linesFromText('TOTAL 2,00')]]],
]
for (const [id, description, pages] of safety) add(`seguridad-${id}`, `parseTicket (ticketSafety): ${description}`, 'parseTicket', { pages })
add('seguridad-solape-ambiguo', 'mergePages (ticketSafety): no elimina dos artículos repetidos', 'mergePages', { pages: [['EUR', 'LECHE 1,00 A', 'LECHE 1,00 A'], ['LECHE 1,00 A', 'LECHE 1,00 A', 'TOTAL 4,00']].map(p => linesFromText(p.join('\n'))) })
add('seguridad-solape-ambiguo-ticket', 'parseTicket: el solape ambiguo se avisa', 'parseTicket', { pages: [['LIDL', 'EUR', 'LECHE 1,00 A', 'LECHE 1,00 A'], ['LECHE 1,00 A', 'LECHE 1,00 A', 'TOTAL 4,00']].map(p => linesFromText(p.join('\n'))) })

// ticketFixtures.test.ts
for (const value of ['3,95x 2', '3,95 x 2', '3,95 × 2']) {
  add(`multiplicacion-${value.replace(/\W+/g, '-')}`, `parseTicket (ticketFixtures): multiplicación ${value}`, 'parseTicket', { pages: [linesFromText(`LIDL\nEUR\nBURGER ${value} 7,90 B\nTOTAL 7,90`)] })
}

// Trampas de JS a C#, una por caso
const traps: [string, string, OcrLine[][]][] = [
  ['cifras-unicode', '\\d de JS solo es ASCII: cifras árabes y anchas no son importes', [lidl('PAN ٣,٩٥ A', 'LECHE １,００ A', 'SAL 0,40 A', 'TOTAL ٠,٤٠')]],
  ['limite-palabra', '\\b de JS es ASCII: Á, É y Ñ no son letras de palabra', [ocr('ÁLIDLÉ SUPERMERCADOS', 'EUR', 'PAN 1,00 A', 'Descñ -0,10', 'TOTAL 0,90', 'HORAÑ19:24')]],
  ['limite-palabra-otra', '\\b en otra tienda: «S.L.» detrás de Ñ y una fecha detrás de Ñ', [ocr('ALMACENES ÑS.L.', 'Ñ28/10/2026 19:24', 'PAN 1,00', 'TOTAL 1,00')]],
  ['espacios', '\\s de JS incluye U+FEFF y no U+0085', [ocr('LIDL', 'EUR', 'PAN﻿1,00﻿A', 'SAL\u00850,40 A', '﻿', ' \u0085 ', 'TOTAL﻿1,40')]],
  ['punto-fin-de-linea', '«.» de JS no pasa por \\r ni U+2028', [ocr('LIDL', 'EUR', 'LOMO 3,67 B', '0,544 kg x 6,75 EUR/kg', 'FILETE 4,15 B', '0,547 kg\rx 7,58 EUR/kg', 'TOTAL 7,82')]],
  ['kelvin', 'la i de JS sin u no iguala k con el signo Kelvin', [ocr('LIDL', 'EUR', 'LOMO 3,67 B', '0,544 Kg x 6,75 EUR/kg', 'TOTAL 3,67')]],
  ['letras-astrales', '\\p{L} con u: una letra fuera del BMP es una letra', [ocr('LIDL SUPERMERCADOS', '39001𝐀Santander', 'EUR', '𝐀𝐁 1,00 A', 'PAN 𝐀1,O9 A', 'PATATA 4,95X 2 9,𝐀0 A', 'SAL 1𝐀', 'TOTAL 1,00')]],
  ['iva-simbolos', 'las letras del IVA leídas como €, ¢ o (', [lidl('CAFE 1,29 €', 'TE 1,29 ¢', 'PAN 1,29 (', 'SAL 1,29€', 'AGUA 1,15-', 'TOTAL 6,45')]],
  ['otra-tienda-mayusculas', 'el nombre de otra tienda en minúsculas de es (sigma final, İ, ß)', [ocr('ΚΑΦΕΣ ΟΔΟΣ S.A.', 'PAN 1,00', 'TOTAL 1,00')]],
  ['otra-tienda-eszett', 'ß en el nombre de otra tienda', [ocr('ßTRAßE MARKT S.L.U.', '28.10.26', 'PAN 1,00', 'TOTAL 1,00')]],
  ['confianza-palabras', 'confianza por palabra (Tesseract) y mitades de Math.round', [[...linesFromText('LIDL\nEUR'), {
    text: 'HUEVOS 2,84X 2 5,08 A', reread: null, confidence: 80,
    words: [{ text: 'HUEVOS', confidence: 96, box: { x0: 0, y0: 0, x1: 10, y1: 10 } }, { text: '2,84X', confidence: 99.5, box: { x0: 20, y0: 0, x1: 30, y1: 10 } },
      { text: '2', confidence: 99.5, box: { x0: 40, y0: 0, x1: 50, y1: 10 } }, { text: '5,08', confidence: 84.5, box: { x0: 60, y0: 0, x1: 70, y1: 10 } },
      { text: 'A', confidence: 90, box: { x0: 80, y0: 0, x1: 90, y1: 10 } }],
  }, {
    text: 'LOMO 3,76 B', reread: null, confidence: 70,
    words: [{ text: 'LOMO', confidence: 90, box: { x0: 0, y0: 20, x1: 10, y1: 30 } }, { text: '3,76', confidence: 98.5, box: { x0: 20, y0: 20, x1: 30, y1: 30 } }],
  }, {
    text: '0,544 kg x 6,75 EUR/kg', reread: '0,544 kg x 6,75 EUR/kg',
    words: [{ text: '0,544', confidence: 62.5, box: { x0: 0, y0: 40, x1: 10, y1: 50 } }, { text: 'kg', confidence: 50, box: { x0: 20, y0: 40, x1: 30, y1: 50 } },
      { text: '6,75', confidence: 70, box: { x0: 40, y0: 40, x1: 50, y1: 50 } }],
  }, {
    text: 'SAL 3,95 x 2 7,20 B', reread: '3,95 x 2 7,90 B', confidence: 88,
    words: [{ text: 'SAL', confidence: 91, box: { x0: 0, y0: 60, x1: 10, y1: 70 } }, { text: '3,95', confidence: 95, box: { x0: 20, y0: 60, x1: 30, y1: 70 } },
      { text: 'x', confidence: 93, box: { x0: 40, y0: 60, x1: 50, y1: 70 } }, { text: '2', confidence: 92, box: { x0: 60, y0: 60, x1: 70, y1: 70 } },
      { text: '7,20', confidence: 40, box: { x0: 80, y0: 60, x1: 90, y1: 70 } }],
  }, ...linesFromText('TOTAL 20,00\nFECHA: 31/12/26\nHORA: 23:59')]]],
  ['fechas', 'fechas del pie: inexistentes, de dos y cuatro cifras, y hora fuera de rango', [ocr('LIDL', 'EUR', 'PAN 1,00 A', 'TOTAL 1,00', 'FECHA: 31/02/26', 'HORA: 24:10', '4017 564330/01 29.02.24 25:61', '30-04-2026 07:05')]],
  ['pie-pago', 'medio de pago y totales que no coinciden', [ocr('LIDL', 'EUR', 'PAN 1,00 A', 'TOTAL 1,00', 'IMPORTE: 1,10', 'TARJETA VISA ****1234', 'Efectivo entregado')]],
  ['sin-cabecera-eur', 'sin «EUR»: el primer producto es la primera línea con importe, también si solo lo da la relectura', [[{ text: 'LIDL', reread: null }, { text: 'Calle X 1', reread: null }, { text: 'PAN DE MOLDE 1,7298', reread: '1,72 B' }, { text: 'SAL 0,40 A', reread: null }, { text: 'TOTAL 2,12', reread: null }]]],
  ['peso-sin-producto', 'una línea de peso sin producto y una de peso repetida', [lidl('0,544 kg x 6,75 EUR/kg', 'LOMO 3,67 B', '0,544 kg x 6,75 EUR/kg', '0,100 kg x 1,00 EUR/kg', 'TOTAL 3,67')]],
  ['total-del-pago', 'sin TOTAL: el total sale del pago', [lidl('PAN 1,00 A', 'Lidl Pay 1,00', 'Suma 1,00')]],
  ['continuacion', 'una línea sin nombre con el importe del producto anterior', [lidl('PAN DE MOLDE INTEGRAL', '1,29 A', 'SAL 0,40 A', 'TOTAL 1,69')]],
  ['descuento-ilegible', 'descuento ilegible, y ajustes de ahorro y resumen', [lidl('PAN 1,00 A', 'Desc. -0,?0', 'LECHE 1,00 A', 'Dto. -0,10', ['Dto. -0,20', '-0,30'], 'Ahorro Lidl Plus -0,50', 'Descuento especial', 'TOTAL 1,70')]],
  ['separadores', 'separadores, cabeceras y rayas', [lidl('-----', '* * *', 'Descripción Importe', 'PAN—1,00 A', 'LECHE_0,89|A', 'SAL 0 , 40 A', 'ARROZ 1 ,09 A', 'AZUCAR 0,95x2 1,90 A', 'TOTAL 5,28')]],
  ['menos-tipografico', 'el menos tipográfico y la raya delante de cifras', [lidl('LECHE −0,89 A', 'PAN –1,00 A', 'SAL 0,40 A', 'TOTAL −1,49')]],
]
for (const [id, description, pages] of traps) add(`trampa-${id}`, `parseTicket: ${description}`, 'parseTicket', { pages })
for (const [id, text] of [
  ['pago', 'Lidl Pay 12,00'], ['tarjeta', 'tarjeta bancaria'], ['iva', 'IVA 21%'], ['base', 'BASE IMP. 10,00'], ['grupo', 'B 10% 1,00 0,10'],
  ['ofertas', 'Ofertas de la semana'], ['www', 'www.lidl.es'], ['producto', 'PAN 1,00 A'], ['metodo', 'Método de pago'], ['metodo-sin-tilde', 'METODO DE PAGO'],
  ['total-ahorro', 'TOTAL AHORRO'], ['limite', 'pagoñ'], ['tilde-may', 'PRÓXIMA COMPRA'],
] as const) add(`fin-productos-${id}`, 'endsProducts: pago, impuestos o publicidad', 'endsProducts', { text })
add('texto-saltos', 'linesFromText con \\r\\n, \\n, \\r suelto y línea final vacía', 'linesFromText', { text: 'LIDL\r\nEUR\nPAN 1,00 A\rSAL\n\n' })
add('texto-vacio', 'linesFromText de un texto vacío', 'linesFromText', { text: '' })

// ---------------------------------------------------------------------------
// shared/tickets/ticketMatch.ts: un catálogo y unas equivalencias de ensayo

const key = (rawName: string) => ({ rawName, key: nameKey(rawName) })
const testItems = [{ id: 'leche', name: 'Leche' }, { id: 'pechuga', name: 'Filete de pechuga' }, { id: 'pizza', name: 'Pizza barbacoa' }]
add('emparejar-recordado', 'suggestForTicket (ticketMatch): lo recordado, también con errores del OCR', 'suggestForTicket', {
  lines: [key('LECHE SEMIDESNATADA'), key('BOLSA PLÁSTICO'), key('PTZZA BARBACOA')],
  aliases: [{ key: 'LECHE SEMIDESNATADA', itemId: 'leche' }, { key: 'BOLSA PLASTICO', itemId: null }, { key: 'PIZZA BARBACOA', itemId: 'pizza' }], items: testItems })
add('emparejar-nombre', 'suggestForTicket (ticketMatch): por el nombre y nuevos con nombre legible', 'suggestForTicket', { lines: [key('FILETE DE PECHUGA'), key('PAPEL HIGIÉNICO 12R')], aliases: [], items: testItems })
add('emparejar-variantes', 'suggestForTicket (ticketMatch): variantes nuevas separadas', 'suggestForTicket', { lines: [key('FILETE DE PAVO'), key('FTLETE DE PAVO'), key('FILETE DE PAVO'), key('NOCILLA')], aliases: [], items: [] })
add('emparejar-borrado', 'suggestForTicket (ticketMatch): equivalencias de productos borrados', 'suggestForTicket', { lines: [key('YOGUR GRIEGO')], aliases: [{ key: 'YOGUR GRIEGO', itemId: 'borrado' }], items: testItems })
add('emparejar-porcentajes', 'suggestForTicket (ticketSafety): no fusiona variantes por parecido', 'suggestForTicket', { lines: [key('YOGUR NATURAL 0%'), key('YOGUR NATURAL 2%')], aliases: [], items: [] })
const catalog = [
  { id: 'leche', name: 'Leche' }, { id: 'leche-sin', name: 'Leche sin lactosa' }, { id: 'pechuga', name: 'Filete de pechuga' },
  { id: 'pizza', name: 'Pizza barbacoa' }, { id: 'yogur-0', name: 'Yogur natural 0%' }, { id: 'yogur-2', name: 'Yogur natural 2%' },
  { id: 'molde-1', name: 'Pan de molde' }, { id: 'molde-2', name: 'Pan de molde' }, { id: 'cafe', name: 'Café molido' },
  { id: 'calle', name: 'Straße' }, { id: 'huevos', name: 'Huevos camperos L' }, { id: 'arroz', name: 'Arroz redondo' },
]
const aliases = [
  { key: 'LECHE SEMIDESNATADA', itemId: 'leche' }, { key: 'BOLSA PLASTICO', itemId: null }, { key: 'PIZZA BARBACOA', itemId: 'pizza' },
  { key: 'YOGUR GRIEGO', itemId: 'borrado' }, { key: 'CAFE MOLIDO NATURAL', itemId: 'cafe' }, { key: 'LECHE SEMIDESNATADA', itemId: 'leche-sin' },
  { key: 'LECHE ENTERA 1L', itemId: 'leche' }, { key: 'HUEVOS CAMPEROS L', itemId: 'huevos' }, { key: 'HUEVOS CAMPEROS M', itemId: 'huevos' },
  { key: 'PAN DE MOLDE INTEGRA', itemId: null }, { key: 'ARROZ REDONDO', itemId: 'arroz' }, { key: 'ARROZ REDONDA', itemId: 'leche' },
]
add('emparejar-catalogo', 'suggestForTicket con un catálogo y equivalencias de ensayo: repetidas, parecidas, empates, cifras y borradas', 'suggestForTicket', {
  lines: ['LECHE SEMIDESNATADA', 'BOLSA PLÁSTICO', 'PTZZA BARBACOA', 'YOGUR NATURAL 0%', 'YOGUR NATURAL 2%', 'YOGUR NATURAL 1%', 'PAN DE MOLDE',
    'CAFE MOLIDO NATURA', 'LECHE ENTERA 1L', 'LECHE ENTERA 2L', 'STRAßE', 'YOGUR GRIEGO', 'LECHE SEMIDESNATADA', 'FILETE DE PECHUGA', 'HUEVOS CAMPEROS X',
    'ARROZ REDONDO', 'ARROZ REDONDE', 'GEL DUCHA', 'Ǆ'].map(key),
  aliases, items: catalog })
add('emparejar-ticket-ejemplo', 'suggestForTicket con las líneas del ticket de ejemplo leído por el OCR', 'suggestForTicket', {
  lines: parseTicket([fixture('fixtures/tickets/ticket-lidl-ejemplo.ocr.json')]).lines.map(l => ({ key: l.key, rawName: l.rawName })), aliases, items: catalog })
add('emparejar-vacio', 'suggestForTicket sin líneas', 'suggestForTicket', { lines: [], aliases, items: catalog })

// ---------------------------------------------------------------------------
// shared/tickets/ticketValidation.ts: cuerpos válidos e inválidos

const saveLine = (overrides: Record<string, unknown> = {}) => ({
  rawName: 'PAN', quantity: 1, unitPriceCents: null, amountCents: 100, discountCents: 0, weightKg: null, pricePerKgCents: null, taxCode: 'A', occasional: false, ...overrides,
})
const body = (overrides: Record<string, unknown> = {}) => ({
  store: 'lidl', storeName: 'Lidl', address: '', date: '2026-10-28', time: '19:24', totalCents: 100, lines: [saveLine()], decisions: { PAN: { kind: 'ignore' } }, ...overrides,
})
const evidence = (overrides: Record<string, unknown> = {}) => ({ text: 'PAN 1,00 A', reread: null, recognizedCents: 100, calculatedCents: null, selectedBy: 'read', issues: [], ...overrides })
const GOLDEN_BODY = {
  store: 'lidl', storeName: 'Lidl', address: '', date: '2026-10-28', time: '19:24', totalCents: 100, acknowledged: true,
  lines: [{ rawName: 'PAN', quantity: 1, unitPriceCents: null, amountCents: 100, discountCents: 0, weightKg: null, pricePerKgCents: null, taxCode: 'A', occasional: false }],
  adjustments: [{ id: 'a1', label: 'Cupón', kind: 'coupon', amountCents: -10, needsReview: false }],
  decisions: { PAN: { kind: 'ignore' } },
  sourceFingerprint: 'a8737b2f4204b7b1b9c9b81440ae55228438a252a379693401a3cdfdc19a71e4',
}
const validBodies: [string, string, unknown][] = [
  ['minimo', 'un ticket que cuadra, sin advertencias', body()],
  ['huella-golden', 'el cuerpo de la huella golden de tickets.test.ts', GOLDEN_BODY],
  ['completo', 'todo: evidencia con discrepancia y opciones, ajustes, decisiones, identificadores y compra distinta', body({
    store: 'otra', storeName: '  Frutería Ñandú  ', address: '  Calle del Ejemplo, 12 '.padEnd(130, 'x'), time: null, totalCents: 1100, acknowledged: true,
    importId: 'a1b2c3d4-e5f6-4789-abcd-ef0123456789', sourceFingerprint: 'f'.repeat(64), distinctPurchase: true, issues: ['Total obtenido del pago'],
    lines: [
      saveLine({ rawName: '  Plátano   de\tCanarias ', quantity: 2, unitPriceCents: 250, amountCents: 500, discountCents: 50, taxCode: null, occasional: true, confirmed: true,
        evidence: evidence({ text: 'PLATANO 2,50x 2 5,00'.padEnd(1100, ' '), reread: '2,50x 2 5,00', normalized: 'PLATANO 2,50x 2 5,00', recognizedCents: 500, calculatedCents: 500,
          selectedBy: 'calculation', issues: ['Se han interpretado letras como cifras'], source: { imageIndex: 0, segmentIndex: 0, width: 10, height: 10, box: { x0: 0, y0: 0, x1: 1, y1: 1 } },
          discrepancy: { kind: 'units', verdict: 'calculation', recognizedCents: 5000, calculatedCents: 500, explanation: 'x'.repeat(450), reasons: ['uno', 7, 'y'.repeat(401)] },
          options: [{ cents: 500, origin: 'calculation' }, { cents: 5000, origin: 'read' }] }) }),
      saveLine({ rawName: 'LOMO ADOBADO', quantity: 1, amountCents: 367, weightKg: 0.5444, pricePerKgCents: 675, taxCode: 'B' }),
      saveLine({ rawName: 'lomo adobado', amountCents: 233, taxCode: 'C', reviewStatus: 'pending' }),
    ],
    adjustments: [{ id: 'cupon', label: '  Cupón  ', kind: 'coupon', amountCents: -50, needsReview: false, originalText: 'CUPON -0,50'.padEnd(1100, '.') },
      { id: 'otro', label: 'Otro', kind: 'other', amountCents: null }],
    decisions: { 'PLATANO DE CANARIAS': { kind: 'new', name: '  Plátano  ', ownerId: 'persona-1', frequency: 'semanal' }, 'LOMO ADOBADO': { kind: 'item', itemId: 'lomo' }, EXTRA: { kind: 'ignore' } },
  })],
  ['pendiente-reconocido', 'una línea que no cuadra queda pendiente y se guarda con acknowledged', body({ acknowledged: true, lines: [saveLine({ quantity: 2, unitPriceCents: 495, amountCents: 9290 })], totalCents: 9290 })],
  ['evidencia-con-incidencias', 'evidencia con incidencias sin confirmar: pendiente', body({ acknowledged: true, lines: [saveLine({ evidence: evidence({ issues: ['Lectura de baja confianza'] }) })] })],
  ['evidencia-confirmada', 'evidencia con incidencias confirmada: verificada', body({ lines: [saveLine({ confirmed: true, evidence: evidence({ issues: ['Lectura de baja confianza'] }) })] })],
  ['opciones-vacias', 'opciones vacías se conservan', body({ lines: [saveLine({ evidence: evidence({ options: [], discrepancy: null }) })] })],
  ['nombre-80', 'nombre de 80 caracteres y tienda de 60', body({ storeName: 'L'.repeat(60), lines: [saveLine({ rawName: 'P'.repeat(80) })], decisions: { ['P'.repeat(80)]: { kind: 'ignore' } } })],
  ['limites', 'precio y precio por kilo en el máximo, importe en el mínimo y descuento nulo', body({ acknowledged: true, totalCents: -10000000,
    lines: [saveLine({ unitPriceCents: 10000000, amountCents: -10000000, discountCents: null, pricePerKgCents: 10000000, quantity: 999 })] })],
  ['pesos-redondeados', 'pesos redondeados a milésimas como Math.round (0,0005 → 0,001; 1,0005 → 1)', body({ acknowledged: true, totalCents: null,
    lines: [saveLine({ weightKg: 0.0005 }), saveLine({ rawName: 'SAL', weightKg: 1.0005 }), saveLine({ rawName: 'AZUCAR', weightKg: 0.0004 }), saveLine({ rawName: 'ARROZ', weightKg: 1000 })],
    decisions: { PAN: { kind: 'ignore' }, SAL: { kind: 'ignore' }, AZUCAR: { kind: 'ignore' }, ARROZ: { kind: 'ignore' } } })],
  ['espacios-js', 'trim de JS: quita U+FEFF y no U+0085', body({ storeName: '﻿Lidl\u0085', lines: [saveLine({ rawName: '﻿PAN\u0085' })], decisions: { PAN: { kind: 'ignore' } } })],
  ['eszett', 'la clave de la decisión con ß', body({ lines: [saveLine({ rawName: 'STRAßE' })], decisions: { STRASSE: { kind: 'ignore' } } })],
  ['propiedades-extra', 'propiedades desconocidas se ignoran', body({ extra: 1, lines: [saveLine({ extra: true, id: 'x', itemId: 'y' })] })],
]
for (const [id, description, input] of validBodies) add(`guardar-${id}`, `validateTicketSave: ${description}`, 'validateTicketSave', { body: input })

const invalidBodies: [string, unknown][] = [
  ['sin-cuerpo', undefined], ['nulo', null], ['lista', [body()]], ['texto', 'hola'], ['numero', 5],
  ['tienda', body({ store: 'LIDL' })], ['tienda-ausente', body({ store: undefined })],
  ['nombre-tienda-vacio', body({ storeName: '   ' })], ['nombre-tienda-61', body({ storeName: 'L'.repeat(61) })], ['nombre-tienda-numero', body({ storeName: 5 })],
  ['fecha-inexistente', body({ date: '2026-02-30' })], ['fecha-salto', body({ date: '2026-10-28\n' })], ['fecha-ausente', body({ date: undefined })],
  ['hora-24', body({ time: '24:00' })], ['hora-corta', body({ time: '9:05' })], ['hora-salto', body({ time: '19:24\n' })], ['hora-numero', body({ time: 1924 })],
  ['total-decimal', body({ totalCents: 1.5 })], ['total-texto', body({ totalCents: '100' })], ['total-grande', body({ totalCents: 10000001 })],
  ['sin-lineas', body({ lines: [] })], ['lineas-ausentes', body({ lines: undefined })], ['lineas-objeto', body({ lines: {} })],
  ['301-lineas', body({ lines: Array.from({ length: 301 }, () => saveLine()) })],
  ['linea-nula', body({ lines: [null] })], ['linea-lista', body({ lines: [saveLine(), []] })],
  ['nombre-vacio', body({ lines: [saveLine({ rawName: '  ' })] })], ['nombre-signos', body({ lines: [saveLine({ rawName: '¡¿!?' })] })],
  ['nombre-81', body({ lines: [saveLine({ rawName: 'P'.repeat(81) })] })], ['nombre-numero', body({ lines: [saveLine({ rawName: 5 })] })],
  ['peso-cero', body({ lines: [saveLine({ weightKg: 0 })] })], ['peso-negativo', body({ lines: [saveLine({ weightKg: -1 })] })],
  ['peso-grande', body({ lines: [saveLine({ weightKg: 1000.0001 })] })], ['peso-texto', body({ lines: [saveLine({ weightKg: '1' })] })],
  ['iva-d', body({ lines: [saveLine({ taxCode: 'D' })] })], ['iva-minuscula', body({ lines: [saveLine({ taxCode: 'a' })] })], ['iva-numero', body({ lines: [saveLine({ taxCode: 1 })] })],
  ['evidencia-lista', body({ lines: [saveLine({ evidence: [] })] })], ['evidencia-texto', body({ lines: [saveLine({ evidence: 'x' })] })],
  ['evidencia-origen', body({ lines: [saveLine({ evidence: evidence({ selectedBy: 'ocr' }) })] })], ['evidencia-sin-origen', body({ lines: [saveLine({ evidence: evidence({ selectedBy: undefined }) })] })],
  ['evidencia-sin-incidencias', body({ lines: [saveLine({ evidence: evidence({ issues: undefined }) })] })],
  ['evidencia-21-incidencias', body({ lines: [saveLine({ evidence: evidence({ issues: Array.from({ length: 21 }, () => 'x') }) })] })],
  ['evidencia-incidencia-larga', body({ lines: [saveLine({ evidence: evidence({ issues: ['x'.repeat(401)] }) })] })],
  ['evidencia-incidencia-numero', body({ lines: [saveLine({ evidence: evidence({ issues: [1] }) })] })],
  ['evidencia-reconocido', body({ lines: [saveLine({ evidence: evidence({ recognizedCents: 1.5 }) })] })],
  ['evidencia-calculado', body({ lines: [saveLine({ evidence: evidence({ calculatedCents: 10000001 }) })] })],
  ['discrepancia-tipo', body({ lines: [saveLine({ evidence: evidence({ discrepancy: { kind: 'x', verdict: 'read', recognizedCents: 1, calculatedCents: 2, reasons: [] } }) })] })],
  ['discrepancia-veredicto', body({ lines: [saveLine({ evidence: evidence({ discrepancy: { kind: 'units', verdict: 'x', recognizedCents: 1, calculatedCents: 2, reasons: [] } }) })] })],
  ['discrepancia-11-razones', body({ lines: [saveLine({ evidence: evidence({ discrepancy: { kind: 'units', verdict: 'read', recognizedCents: 1, calculatedCents: 2, reasons: Array.from({ length: 11 }, () => 'r') } }) })] })],
  ['discrepancia-lista', body({ lines: [saveLine({ evidence: evidence({ discrepancy: [] }) })] })],
  ['discrepancia-leido-nulo', body({ lines: [saveLine({ evidence: evidence({ discrepancy: { kind: 'units', verdict: 'read', recognizedCents: null, calculatedCents: 2, reasons: [] } }) })] })],
  ['discrepancia-calculado', body({ lines: [saveLine({ evidence: evidence({ discrepancy: { kind: 'weight', verdict: 'ambiguous', recognizedCents: 1, reasons: [] } }) })] })],
  ['opciones-5', body({ lines: [saveLine({ evidence: evidence({ options: Array.from({ length: 5 }, () => ({ cents: 1, origin: 'read' })) }) })] })],
  ['opciones-nulas', body({ lines: [saveLine({ evidence: evidence({ options: null }) })] })],
  ['opcion-manual', body({ lines: [saveLine({ evidence: evidence({ options: [{ cents: 1, origin: 'manual' }] }) })] })],
  ['opcion-importe', body({ lines: [saveLine({ evidence: evidence({ options: [{ cents: null, origin: 'read' }] }) })] })],
  ['cantidad-cero', body({ lines: [saveLine({ quantity: 0 })] })], ['cantidad-1000', body({ lines: [saveLine({ quantity: 1000 })] })],
  ['cantidad-decimal', body({ lines: [saveLine({ quantity: 1.5 })] })], ['cantidad-texto', body({ lines: [saveLine({ quantity: '2' })] })],
  ['cantidad-ausente', body({ lines: [saveLine({ quantity: undefined })] })],
  ['precio-negativo', body({ lines: [saveLine({ unitPriceCents: -1 })] })], ['precio-grande', body({ lines: [saveLine({ unitPriceCents: 10000001 })] })],
  ['importe-grande', body({ lines: [saveLine({ amountCents: -10000001 })] })], ['importe-texto', body({ lines: [saveLine({ amountCents: '1' })] })],
  ['descuento-negativo', body({ lines: [saveLine({ discountCents: -1 })] })], ['precio-kilo-decimal', body({ lines: [saveLine({ pricePerKgCents: 1.25 })] })],
  ['segunda-linea', body({ lines: [saveLine(), saveLine({ rawName: '' })] })],
  ['ajustes-nulos', body({ adjustments: null })], ['ajustes-objeto', body({ adjustments: {} })],
  ['ajustes-101', body({ adjustments: Array.from({ length: 101 }, (_, i) => ({ id: `a${i}`, label: 'x', kind: 'other', amountCents: 0 })) })],
  ['ajuste-sin-id', body({ adjustments: [{ label: 'x', kind: 'other', amountCents: 0 }] })], ['ajuste-id-vacio', body({ adjustments: [{ id: '', label: 'x', kind: 'other', amountCents: 0 }] })],
  ['ajuste-id-largo', body({ adjustments: [{ id: 'i'.repeat(101), label: 'x', kind: 'other', amountCents: 0 }] })],
  ['ajuste-id-repetido', body({ adjustments: [{ id: 'a', label: 'x', kind: 'other', amountCents: 0 }, { id: 'a', label: 'y', kind: 'other', amountCents: 0 }] })],
  ['ajuste-concepto', body({ adjustments: [{ id: 'a', label: '  ', kind: 'other', amountCents: 0 }] })],
  ['ajuste-concepto-largo', body({ adjustments: [{ id: 'a', label: 'x'.repeat(121), kind: 'other', amountCents: 0 }] })],
  ['ajuste-tipo', body({ adjustments: [{ id: 'a', label: 'x', kind: 'regalo', amountCents: 0 }] })],
  ['ajuste-importe', body({ adjustments: [{ id: 'a', label: 'x', kind: 'other', amountCents: 0.5 }] })],
  ['incidencias-nulas', body({ issues: null })], ['incidencias-31', body({ issues: Array.from({ length: 31 }, () => 'x'), acknowledged: true })],
  ['incidencia-larga', body({ issues: ['x'.repeat(401)] })], ['incidencia-numero', body({ issues: [1] })],
  ['sin-confirmar-total', body({ totalCents: 101 })], ['sin-confirmar-pendiente', body({ lines: [saveLine({ reviewStatus: 'pending' })] })],
  ['sin-confirmar-ajuste', body({ adjustments: [{ id: 'a', label: 'Cupón', kind: 'coupon', amountCents: 0 }] })],
  ['sin-confirmar-ajuste-sin-importe', body({ adjustments: [{ id: 'a', label: 'Cupón', kind: 'coupon', amountCents: null, needsReview: false }] })],
  ['sin-confirmar-incidencias', body({ issues: ['Revisar'] })], ['confirmado-no-es-true', body({ totalCents: 101, acknowledged: 'true' })],
  ['sin-decisiones', body({ decisions: undefined })], ['decisiones-lista', body({ decisions: [] })],
  ['decision-ausente', body({ decisions: {} })], ['decision-producto', body({ decisions: { PAN: { kind: 'item', itemId: '' } } })],
  ['decision-nombre', body({ decisions: { PAN: { kind: 'new', name: '  ', ownerId: null, frequency: 'semanal' } } })],
  ['decision-nombre-81', body({ decisions: { PAN: { kind: 'new', name: 'n'.repeat(81), frequency: 'semanal' } } })],
  ['decision-persona', body({ decisions: { PAN: { kind: 'new', name: 'Pan', ownerId: '', frequency: 'semanal' } } })],
  ['decision-persona-numero', body({ decisions: { PAN: { kind: 'new', name: 'Pan', ownerId: 3, frequency: 'semanal' } } })],
  ['decision-frecuencia', body({ decisions: { PAN: { kind: 'new', name: 'Pan', frequency: 'diaria' } } })],
  ['decision-tipo', body({ decisions: { PAN: { kind: 'otro' } } })], ['decision-nula', body({ decisions: { PAN: null } })],
  ['importacion-corta', body({ importId: 'a'.repeat(15) })], ['importacion-larga', body({ importId: 'a'.repeat(129) })],
  ['importacion-guion-bajo', body({ importId: 'a'.repeat(15) + '_' })], ['importacion-salto', body({ importId: 'a'.repeat(16) + '\n' })],
  ['importacion-nula', body({ importId: null })], ['huella-origen', body({ sourceFingerprint: 'ñ'.repeat(20) })],
]
for (const [id, input] of invalidBodies) add(`guardar-mal-${id}`, 'validateTicketSave: un cuerpo inválido y su mensaje', 'validateTicketSave', input === undefined ? {} : { body: input })

// Cuerpos como texto JSON: lo que JSON.stringify no puede escribir (Infinity, -0, claves repetidas, sustitutos sueltos).
for (const [id, description, bodyJson] of [
  ['infinito', 'un número que desborda el doble es Infinity', '{"store":"lidl","storeName":"Lidl","date":"2026-10-28","totalCents":1e400,"lines":[]}'],
  ['peso-infinito', 'un peso infinito no es válido', '{"store":"lidl","storeName":"Lidl","date":"2026-10-28","lines":[{"rawName":"PAN","quantity":1,"amountCents":100,"weightKg":1e400}],"decisions":{"PAN":{"kind":"ignore"}}}'],
  ['menos-cero', '-0 es un entero seguro: vale de descuento y no de cantidad', '{"store":"lidl","storeName":"Lidl","date":"2026-10-28","totalCents":100,"lines":[{"rawName":"PAN","quantity":1,"amountCents":100,"discountCents":-0}],"decisions":{"PAN":{"kind":"ignore"}}}'],
  ['menos-cero-cantidad', '-0 como cantidad', '{"store":"lidl","storeName":"Lidl","date":"2026-10-28","totalCents":100,"lines":[{"rawName":"PAN","quantity":-0,"amountCents":100}],"decisions":{"PAN":{"kind":"ignore"}}}'],
  ['enteros-escritos', '1.0, 1e0 y 1E2 son enteros', '{"store":"lidl","storeName":"Lidl","date":"2026-10-28","totalCents":1E2,"lines":[{"rawName":"PAN","quantity":1.0,"amountCents":1e2,"discountCents":0e5}],"decisions":{"PAN":{"kind":"ignore"}}}'],
  ['entero-no-seguro', '9007199254740993 se lee como 2^53 y no es seguro', '{"store":"lidl","storeName":"Lidl","date":"2026-10-28","totalCents":9007199254740993,"lines":[]}'],
  ['claves-repetidas', 'con claves repetidas vale la última', '{"store":"otra","store":"lidl","storeName":"X","storeName":"Lidl","date":"2026-10-28","totalCents":100,"lines":[{"rawName":"PAN","quantity":1,"amountCents":100}],"decisions":{"PAN":{"kind":"new"},"PAN":{"kind":"ignore"}}}'],
  ['sustituto-suelto', 'un sustituto suelto en un nombre se conserva', '{"store":"lidl","storeName":"Lidl\\ud800","date":"2026-10-28","totalCents":100,"lines":[{"rawName":"PAN\\udc00","quantity":1,"amountCents":100}],"decisions":{"PAN":{"kind":"ignore"}}}'],
  ['proto', '«__proto__» es una clave más', '{"__proto__":{"store":"lidl"},"store":"lidl","storeName":"Lidl","date":"2026-10-28","totalCents":100,"lines":[{"rawName":"PAN","quantity":1,"amountCents":100}],"decisions":{"__proto__":{"kind":"ignore"},"PAN":{"kind":"ignore"}}}'],
] as const) add(`guardar-json-${id}`, `validateTicketSave: ${description}`, 'validateTicketSave', { bodyJson })

for (const [id, input] of [
  ['producto', { itemId: 'leche' }], ['nulo', { itemId: null }], ['vacio', { itemId: '' }], ['numero', { itemId: 5 }],
  ['sin-campo', {}], ['cuerpo-nulo', null], ['lista', [{ itemId: 'x' }]], ['texto', 'leche'], ['extra', { itemId: 'x', otro: 1 }],
] as const) add(`linea-${id}`, 'validateLineUpdate: { itemId } o { itemId: null }', 'validateLineUpdate', { body: input })
add('linea-sin-cuerpo', 'validateLineUpdate sin cuerpo', 'validateLineUpdate', {})
add('linea-json-undefined', 'validateLineUpdate: itemId ausente frente a null', 'validateLineUpdate', { bodyJson: '{"itemId":null,"itemId":"x"}' })

// ---------------------------------------------------------------------------
// server/modules/tickets/domain

const purchaseLine = (overrides: Partial<TicketSaveLine> = {}): TicketSaveLine => ({ ...line({ rawName: 'PAN', reviewStatus: 'verified', confirmed: false }), ...overrides })
for (const [id, unit, lines] of [
  ['ud', 'ud', [purchaseLine({ quantity: 2, unitPriceCents: 495, amountCents: 990 })]],
  ['mitad', 'ud', [purchaseLine({ quantity: 2, unitPriceCents: null, amountCents: 101 })]],
  ['descuento', 'paquete', [purchaseLine({ amountCents: 300, discountCents: 50 })]],
  ['ultima-fiable', 'botella', [purchaseLine({ amountCents: 100 }), purchaseLine({ amountCents: 200 }), purchaseLine({ amountCents: 300, reviewStatus: 'pending' })]],
  ['kg', 'kg', [purchaseLine({ weightKg: 0.544, pricePerKgCents: 675, amountCents: 367 })]],
  ['g', 'g', [purchaseLine({ weightKg: 0.5625, pricePerKgCents: 1000, amountCents: 563 })]],
  ['peso-en-ud', 'ud', [purchaseLine({ weightKg: 0.544, pricePerKgCents: 675, amountCents: 367 })]],
  ['ud-en-kg', 'kg', [purchaseLine({ amountCents: 100 })]],
  ['litros', 'l', [purchaseLine({ amountCents: 100 })]],
  ['ninguna', 'ud', [purchaseLine({ amountCents: -100 })]],
  ['vacio', 'ud', []],
  ['demasiado', 'kg', [purchaseLine({ weightKg: 0.5, pricePerKgCents: 20000000, amountCents: 10000000 })]],
  ['cero', 'lata', [purchaseLine({ amountCents: 0 })]],
] as const) add(`precio-${id}`, 'priceFromLines: el precio de la última línea fiable, si la unidad lo permite', 'priceFromLines', { lines, unit })
for (const [id, unit, lines] of [
  ['kg', 'kg', [purchaseLine({ weightKg: 0.544, pricePerKgCents: 675, amountCents: 367 }), purchaseLine({ weightKg: 0.0025, pricePerKgCents: 1000, amountCents: 3 })]],
  ['g', 'g', [purchaseLine({ weightKg: 0.5625, pricePerKgCents: 1000, amountCents: 563 })]],
  ['peso-en-ud', 'ud', [purchaseLine({ weightKg: 0.544, pricePerKgCents: 675, amountCents: 367 })]],
  ['ud', 'ud', [purchaseLine({ quantity: 2, unitPriceCents: 50, amountCents: 100 }), purchaseLine({ quantity: 3, unitPriceCents: 50, amountCents: 150 })]],
  ['mezcla', 'kg', [purchaseLine({ weightKg: 0.5, pricePerKgCents: 200, amountCents: 100 }), purchaseLine({ amountCents: 100 })]],
  ['litros', 'l', [purchaseLine({ amountCents: 100 })]],
  ['ninguna', 'ud', [purchaseLine({ amountCents: null })]],
] as const) add(`cantidad-${id}`, 'quantityFromLines: cuánto se compró en la unidad del producto', 'quantityFromLines', { lines, unit })
add('unidad-kg', 'newItemUnit: kg si todas se pesan', 'newItemUnit', { lines: [purchaseLine({ weightKg: 0.5, pricePerKgCents: 200 })] })
add('unidad-ud', 'newItemUnit: ud si alguna no se pesa', 'newItemUnit', { lines: [purchaseLine({ weightKg: 0.5, pricePerKgCents: 200 }), purchaseLine()] })
add('unidad-vacia', 'newItemUnit: sin líneas fiables, kg (every de una lista vacía)', 'newItemUnit', { lines: [] })
for (const [id, l] of [
  ['fiable', purchaseLine()], ['pendiente', purchaseLine({ reviewStatus: 'pending' })], ['devolucion', purchaseLine({ amountCents: -100 })],
  ['devolucion-pendiente', purchaseLine({ amountCents: -100, reviewStatus: 'pending' })], ['sin-importe', purchaseLine({ amountCents: null })],
] as const) add(`revision-${id}`, 'lineReviewStatus: verificada si es fiable o una devolución confirmada', 'lineReviewStatus', { line: l })

for (const [id, store, storeName] of [['lidl', 'lidl', 'Lidl Torrelavega'], ['otra', 'otra', 'Frutería Ñandú'], ['otra-eszett', 'otra', 'Straße'], ['otra-vacia', 'otra', '']] as const) {
  add(`tienda-${id}`, 'aliasStoreOf: Lidl o el nombre normalizado de otra tienda', 'aliasStoreOf', { store, storeName })
}

// Las tres huellas golden de server/modules/tickets/tickets.test.ts («las huellas no cambian…»)
const GOLDEN = {
  pasted: 'a8737b2f4204b7b1b9c9b81440ae55228438a252a379693401a3cdfdc19a71e4',
  images: '74707bc9bd62595e3ac455802d512b5aa806bf0bc49a863157e635ad2b397a5e',
  ticket: '4ee26779153a9a0ba92b3af35f8f543155cfe656884bd3d4d5693140d5baeb30',
}
add('huella-golden-texto', 'pastedTextSource: la huella golden del texto pegado', 'pastedTextSource', { text: '  LIDL\nEUR\nPAN   1,00 A\nTOTAL 1,00\nFECHA: 28/10/26 ' })
add('huella-golden-imagenes', 'imagesSource: la huella golden de la imagen de ticket-lidl-ejemplo.png', 'imagesSource', { files: ['fixtures/tickets/ticket-lidl-ejemplo.png'] })
const goldenSave = validateTicketSave(GOLDEN_BODY)
if (!goldenSave.ok) throw new Error(goldenSave.error)
add('huella-golden-ticket', 'fingerprintSource: la huella golden del ticket guardado (el cuerpo validado)', 'fingerprintSource', { input: goldenSave.value })
for (const [id, golden] of [['huella-golden-texto', GOLDEN.pasted], ['huella-golden-imagenes', GOLDEN.images], ['huella-golden-ticket', GOLDEN.ticket]] as const) {
  const found = cases.find((c) => c.id === id)!.expected as { sha256: string }
  if (found.sha256 !== golden) throw new Error(`${id}: ${found.sha256} no es la huella golden ${golden}`)
}
add('huella-texto-espacios', 'pastedTextSource: NFC y espacios de JS (U+FEFF sí, U+0085 no)', 'pastedTextSource', { text: '﻿ Jamón  serrano\u0085 \t' })
add('huella-texto-sustituto', 'pastedTextSource: un sustituto suelto no rompe la normalización', 'pastedTextSource', { text: 'Pán \uD800 é \uDC00́' })
add('huella-imagenes-varias', 'imagesSource: varias imágenes, cada una con su tamaño delante', 'imagesSource', { images: ['AAEC', '', '/w=='] })
add('huella-imagenes-ninguna', 'imagesSource sin imágenes', 'imagesSource', { images: [] })
const fpLine = (rawName: string, overrides: Record<string, unknown> = {}) => ({ rawName, quantity: 1, unitPriceCents: null, amountCents: 100, discountCents: 0, weightKg: null, pricePerKgCents: null, ...overrides })
for (const [id, description, input] of [
  ['orden', 'el orden de líneas y ajustes no importa: .sort() por unidades UTF-16', { store: 'lidl', storeName: 'Lidl', date: '2026-10-28', time: null, totalCents: null,
    lines: [fpLine('PAN 2'), fpLine('PAN'), fpLine('PAN2'), fpLine('pan', { quantity: 10 }), fpLine('PAN', { quantity: 9, amountCents: -5 }), fpLine('PAN', { unitPriceCents: 100 }), fpLine('Ñ'), fpLine('ÁRBOL')],
    adjustments: [{ kind: 'other', amountCents: null }, { kind: 'Other', amountCents: -1 }, { kind: 'coupon', amountCents: -10 }, { kind: 'coupon', amountCents: -5 }, { kind: 'Coupon', amountCents: 5 }, { kind: 'discount', amountCents: 0 }] }],
  ['pesos', 'los pesos en gramos como Math.round, con mitades', { store: 'otra', storeName: 'Frutería Ñandú', date: '2026-10-28', time: '09:05', totalCents: -10,
    lines: [fpLine('A', { weightKg: 0.5625 }), fpLine('B', { weightKg: 0.0025 }), fpLine('C', { weightKg: -0.0035 }), fpLine('D', { weightKg: -0.0025 }), fpLine('E', { weightKg: 1.0005 }), fpLine('F', { weightKg: 1e18 }), fpLine('G', { weightKg: 123456789.123 })] }],
  ['escapes', 'JSON.stringify de JS: comillas, barras, controles, U+2028, sustitutos sueltos y no ASCII', { store: 'otra', storeName: 'STRAßE "Ñ" <&>', date: '2026-10-28"\\\u0001\b\f\n\r\t\u001f\u007f', time: '  𐀀😀</>&\'+é',
    totalCents: 0, lines: [fpLine('"PAN"\\')], adjustments: [{ kind: '"\\\u0000', amountCents: 1 }] }],
] as const) add(`huella-${id}`, `fingerprintSource: ${description}`, 'fingerprintSource', { input })

const purchase = (overrides: Record<string, unknown>) => ({ ticketId: 't1', itemId: 'leche', quantity: 1, amountCents: 100, discountCents: 0, weightKg: null, date: '2026-10-28', store: 'Lidl', recordedAt: '2026-10-28T19:24:00.000Z', ...overrides })
add('compras-agrupadas', 'purchasesFromLines: una compra por ticket y producto, sin devoluciones, en orden de aparición', 'purchasesFromLines', { lines: [
  purchase({}), purchase({ itemId: 'pan', quantity: 2, amountCents: 200, discountCents: 20 }), purchase({ quantity: 3, amountCents: 300 }),
  purchase({ ticketId: 't2', amountCents: -100 }), purchase({ ticketId: 't2', itemId: 'pan', amountCents: null, date: '2026-10-29', recordedAt: '2026-10-29T10:00:00.000Z' }),
  purchase({ ticketId: 't0', itemId: 'leche', date: '2026-10-01' }),
] })
add('compras-peso', 'purchasesFromLines: kilos sumados y redondeados a milésimas como Math.round, y mezclas sin cantidad', 'purchasesFromLines', { lines: [
  purchase({ itemId: 'lomo', weightKg: 0.1 }), purchase({ itemId: 'lomo', weightKg: 0.2 }), purchase({ itemId: 'lomo', weightKg: 0.0005 }),
  purchase({ itemId: 'sal', weightKg: 1.0005 }), purchase({ itemId: 'mezcla', weightKg: 0.5 }), purchase({ itemId: 'mezcla', weightKg: null, quantity: 2 }),
  purchase({ itemId: 'mitad', weightKg: 0.0025 }),
] })
add('compras-ninguna', 'purchasesFromLines sin líneas', 'purchasesFromLines', { lines: [] })

// ---------------------------------------------------------------------------

const operations = [...new Set(cases.map((c) => c.operation))].sort()
const missing = TICKET_OPERATIONS.filter((op) => !operations.includes(op))
if (missing.length) throw new Error(`Operaciones sin casos: ${missing.join(', ')}`)

const corpus = {
  format: 'cuentas-claras-ticket-rules-v1',
  provenance: 'Generado una vez desde TypeScript con tests/generateTicketRules.ts y revisado. Entradas: fixtures/tickets/ (tickets inventados, imágenes sintéticas y la transcripción parcial de un ticket real que aportó el dueño de la app, ver docs/pruebas.md), los casos de los tests de shared/tickets y casos inventados para TIC-01. Sin datos de la instalación.',
  operations,
  cases,
}

/** JSON con sangría, pero con cada lista u objeto en una línea si cabe en 120 caracteres. */
function format(value: unknown, indent = ''): string {
  const compact = JSON.stringify(value)
  if (value === null || typeof value !== 'object' || compact.length + indent.length <= 120) return compact
  const inner = `${indent}  `
  if (Array.isArray(value)) return value.length === 0 ? '[]' : `[\n${value.map((item) => inner + format(item, inner)).join(',\n')}\n${indent}]`
  const entries = Object.entries(value)
  return entries.length === 0 ? '{}' : `{\n${entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${format(v, inner)}`).join(',\n')}\n${indent}}`
}
const text = `${format(corpus)}\n`

if (process.argv.includes('--escribir')) {
  writeFileSync(FILE, text)
  console.log(`Escrito ${FILE.pathname}: ${cases.length} casos de ${operations.length} operaciones.`)
} else {
  let saved: { cases: Case[] } | null = null
  try { saved = JSON.parse(readFileSync(FILE, 'utf8')) } catch { saved = null }
  if (!saved) console.log(`No hay corpus guardado: ${cases.length} casos nuevos. Usa --escribir para guardarlo.`)
  else {
    const before = new Map(saved.cases.map((c) => [c.id, JSON.stringify(c)]))
    const changed = cases.filter((c) => before.has(c.id) && before.get(c.id) !== JSON.stringify(c)).map((c) => c.id)
    const added = cases.filter((c) => !before.has(c.id)).map((c) => c.id)
    const removed = [...before.keys()].filter((id) => !cases.some((c) => c.id === id))
    console.log(JSON.stringify({ cambiados: changed, nuevos: added, quitados: removed }, null, 2))
  }
}
