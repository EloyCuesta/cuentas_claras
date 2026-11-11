import { readFileSync, writeFileSync } from 'node:fs'
import { corpusJson } from './ticketRules.ts'
import { runTicketReadRule, TICKET_READ_OPERATIONS } from './ticketReadRules.ts'

/**
 * Genera fixtures/migration/rules-ticket-read.json (TIC-02): cuerpos de POST /api/despensa/tickets/leer y lo que hace Express
 * con ellos antes de leer nada, más el decodificador base64 de Node y la cabecera de PNG y JPEG. Se ejecuta a mano y el
 * resultado se revisa:
 *
 *   npx tsx tests/generateTicketReadRules.ts             # compara con el corpus guardado y dice qué cambiaría
 *   npx tsx tests/generateTicketReadRules.ts --escribir  # lo reescribe
 *
 * Las pruebas (tests/migrationTicketReadRules.test.ts y la de C#) nunca lo regeneran. Los límites de 8 y 20 MB no caben en
 * un corpus: los prueba backend/tests/CuentasClaras.Tests/TicketReadHttpTests.cs con los mismos mensajes.
 */

const FILE = new URL('../fixtures/migration/rules-ticket-read.json', import.meta.url)

interface Case { id: string; description: string; operation: string; input: unknown; expected: unknown }
const cases: Case[] = []

function add(id: string, description: string, operation: string, input: unknown = {}) {
  if (cases.some((c) => c.id === id)) throw new Error(`Id repetido: ${id}`)
  const clean = corpusJson(input)
  cases.push({ id, description, operation, input: clean, expected: runTicketReadRule(operation, structuredClone(clean)) })
}

const body = (value: unknown) => ({ body: value })
const bodyJson = (text: string) => ({ bodyJson: text })

/** La cabecera de un PNG de ese tamaño (imageInfo solo lee la cabecera), con relleno. */
function png(width: number, height: number, chunk = 'IHDR', length = 32): Buffer {
  const buffer = Buffer.alloc(length)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).copy(buffer, 0)
  buffer.write(chunk, 12, 'latin1')
  if (length >= 24) {
    buffer.writeUInt32BE(width, 16)
    buffer.writeUInt32BE(height, 20)
  }
  return buffer
}

/** Un JPEG: SOI y los segmentos que se le pasen. */
const jpeg = (...segments: number[][]) => Buffer.from([0xff, 0xd8, ...segments.flat()])
const sof = (marker: number, width: number, height: number) => [0xff, marker, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, ...Array(12).fill(0)]
const app0 = [0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]
const b64 = (buffer: Buffer) => buffer.toString('base64')

// ---------------------------------------------------------------------------
// El decodificador de Node

for (const [id, text, description] of [
  ['limpio', 'QUJD', 'Base64 normal'],
  ['espacios', 'QU JD\nQU', 'Espacios y saltos de línea: se saltan'],
  ['relleno', 'QUJDRA==', 'Con relleno'],
  ['para-en-igual', 'QU=JD', 'Para en el primer «=»'],
  ['igual-delante', '=QUJD', 'Un «=» delante: nada'],
  ['incompleto-3', 'QUJ', 'Tres caracteres: dos bytes'],
  ['incompleto-2', 'QU', 'Dos caracteres: un byte'],
  ['suelto', 'Q', 'Un carácter suelto no da nada'],
  ['base64url', '-_-_', 'También acepta «-» y «_»'],
  ['simbolos', '+/+/', 'Y «+» y «/»'],
  ['invalidos', 'QU*JD!', 'Lo que no es del alfabeto se salta'],
  ['latin1', 'QUJDé', 'Un carácter latino de más se salta'],
  ['byte-bajo', 'ŁŁŁŁ', 'De cada carácter cuenta su byte bajo: Ł (U+0141) es «A»'],
  ['byte-bajo-cero', 'İİİİ', 'İ (U+0130) es «0»'],
  ['byte-bajo-nulo', 'ĀQUJD', 'Ā (U+0100) es el byte 0: se salta'],
  ['byte-bajo-igual', 'QUĽJD', 'Ľ (U+013D) es «=»: para'],
  ['emoji', 'QUJD😀QUJD', 'Un emoji (D83D DE00) lleva un «=» en su byte bajo: para'],
  ['sustituto-suelto', '\ud800QUJD', 'Un sustituto suelto (D800) es el byte 0'],
  ['nulo', 'QUJD\u0000', 'El carácter 0 se salta'],
  ['vacio', '', 'Vacío'],
  ['data-url', 'data:image/png;base64,QUJD', 'Sin quitar la cabecera, se decodifica entera (readTicketRequest la quita antes)'],
] as const) {
  add(`base64-${id}`, description, 'decodeBase64', { text })
}

// ---------------------------------------------------------------------------
// La cabecera de PNG y JPEG

const hex = (buffer: Buffer) => ({ hex: buffer.toString('hex') })
add('imagen-png', 'Un PNG de 100 × 50', 'imageInfo', hex(png(100, 50)))
add('imagen-png-grande', 'Ancho y alto de 32 bits', 'imageInfo', hex(png(0xffffffff, 1)))
add('imagen-png-sin-ihdr', 'El primer bloque no es IHDR', 'imageInfo', hex(png(100, 50, 'IDAT')))
add('imagen-png-corto', 'Menos de 24 bytes', 'imageInfo', hex(png(100, 50, 'IHDR', 23)))
add('imagen-png-cero', 'Ancho 0', 'imageInfo', hex(png(0, 50)))
add('imagen-jpeg', 'Un JPEG con APP0 y SOF0', 'imageInfo', hex(jpeg(app0, sof(0xc0, 640, 480))))
add('imagen-jpeg-progresivo', 'SOF2 (progresivo)', 'imageInfo', hex(jpeg(sof(0xc2, 32, 16))))
add('imagen-jpeg-dht', 'C4 (tabla Huffman) no es un SOF', 'imageInfo', hex(jpeg([0xff, 0xc4, 0x00, 0x04, 0, 0], sof(0xc1, 8, 8))))
add('imagen-jpeg-relleno', 'Bytes 0xFF de relleno', 'imageInfo', hex(jpeg([0xff, 0xff, 0xff], sof(0xc0, 20, 10))))
add('imagen-jpeg-rst', 'Marcadores sin longitud (RST, TEM)', 'imageInfo', hex(jpeg([0xff, 0xd0, 0xff, 0x01], sof(0xc0, 20, 10))))
add('imagen-jpeg-fin', 'EOI antes del tamaño', 'imageInfo', hex(jpeg([0xff, 0xd9, 0, 0], sof(0xc0, 20, 10))))
add('imagen-jpeg-longitud', 'Una longitud menor que 2', 'imageInfo', hex(jpeg([0xff, 0xe1, 0x00, 0x01, 0, 0])))
add('imagen-jpeg-cortado', 'El SOF no cabe', 'imageInfo', hex(Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00])))
add('imagen-jpeg-basura', 'Algo que no es un marcador', 'imageInfo', hex(jpeg([0x00, 0x01, 0x02, 0x03])))
add('imagen-jpeg-cero', 'Alto 0', 'imageInfo', hex(jpeg(sof(0xc0, 20, 0))))
add('imagen-texto', 'Texto', 'imageInfo', hex(Buffer.from('hola, esto no es una imagen')))
add('imagen-ejemplo', 'La cabecera del ticket de ejemplo', 'imageInfo', hex(readFileSync(new URL('../fixtures/tickets/ticket-lidl-ejemplo.png', import.meta.url)).subarray(0, 64)))
add('imagen-sintetico', 'La del ticket sintético', 'imageInfo', hex(readFileSync(new URL('../fixtures/tickets/ticket-torrelavega-sintetico.png', import.meta.url)).subarray(0, 64)))

// ---------------------------------------------------------------------------
// El cuerpo de la lectura

const small = b64(png(100, 50))
const franja = (image: Buffer | string | null, imageIndex: unknown, segmentIndex: unknown, offsetY: unknown, fullHeight: unknown) => ({
  image: typeof image === 'string' || image === null ? image : b64(image), imageIndex, segmentIndex, offsetY, fullHeight,
})

add('texto', 'Texto pegado, con la fecha del navegador', 'readTicketRequest', body({ texto: 'LIDL\nPAN 1,00 A', hoy: '2026-11-01' }))
add('texto-hoy-malo', 'Una fecha que no vale es null', 'readTicketRequest', body({ texto: 'PAN', hoy: '2026-02-30' }))
add('texto-hoy-numero', 'hoy que no es texto', 'readTicketRequest', body({ texto: 'PAN', hoy: 20261101 }))
add('texto-vacio', 'Texto vacío', 'readTicketRequest', body({ texto: '' }))
add('texto-espacios', 'Solo espacios (también los de no separación)', 'readTicketRequest', body({ texto: ' \n \t' }))
add('texto-limite', '20 000 caracteres', 'readTicketRequest', body({ texto: 'x'.repeat(20_000) }))
add('texto-largo', '20 001 caracteres', 'readTicketRequest', body({ texto: 'x'.repeat(20_001) }))
add('texto-numero', 'texto que no es texto: se miran las imágenes', 'readTicketRequest', body({ texto: 5 }))
add('texto-gana', 'Con texto, las imágenes no se miran', 'readTicketRequest', body({ texto: 'PAN', imagenes: 'x', franjas: [] }))
add('sin-nada', 'Sin texto ni imágenes', 'readTicketRequest', body({}))
add('imagenes-vacias', 'Lista vacía', 'readTicketRequest', body({ imagenes: [] }))
add('imagenes-no-lista', 'imagenes no es una lista', 'readTicketRequest', body({ imagenes: small }))
add('imagen-valida', 'Una imagen', 'readTicketRequest', body({ imagenes: [small], hoy: '2026-11-01' }))
add('imagenes-dos', 'Un PNG y un JPEG, con cabecera data: y caracteres de más', 'readTicketRequest', body({
  imagenes: [`data:image/png;base64,${small}`, `${b64(jpeg(app0, sof(0xc0, 640, 480))).slice(0, 8)}*\n${b64(jpeg(app0, sof(0xc0, 640, 480))).slice(8)}`],
}))
add('imagen-data-sin-coma', 'Una cabecera data sin coma no se quita', 'readTicketRequest', body({ imagenes: [`data:image/png;base64${small}`] }))
add('imagen-numero', 'Un elemento que no es texto', 'readTicketRequest', body({ imagenes: [small, 5] }))
add('imagen-cadena-vacia', 'Un elemento vacío', 'readTicketRequest', body({ imagenes: [''] }))
add('imagen-no-imagen', 'No es PNG ni JPEG', 'readTicketRequest', body({ imagenes: [b64(Buffer.from('hola'))] }))
add('imagenes-siete', 'Siete imágenes', 'readTicketRequest', body({ imagenes: Array(7).fill(small) }))
add('imagenes-seis', 'Seis imágenes valen', 'readTicketRequest', body({ imagenes: Array(6).fill(small) }))
add('imagen-ancha', 'Más de 8000 de ancho', 'readTicketRequest', body({ imagenes: [b64(png(8001, 10))] }))
add('imagen-alta', 'Más de 40 000 de alto', 'readTicketRequest', body({ imagenes: [b64(png(10, 40_001))] }))
add('imagen-pixeles', 'Más de 40 Mpx', 'readTicketRequest', body({ imagenes: [small, b64(png(8000, 5001))] }))
add('imagen-limite', '8000 × 5000 vale', 'readTicketRequest', body({ imagenes: [b64(png(8000, 5000))] }))

const top = png(100, 60)
const bottom = png(100, 40)
add('franjas', 'Dos franjas de una imagen y una de otra', 'readTicketRequest', body({
  franjas: [franja(top, 0, 0, 0, 100), franja(bottom, 0, 1, 60, 100), franja(png(80, 50), 1, 0, 0, 50)], hoy: '2026-11-01',
}))
add('franjas-intercaladas', 'Franjas de dos imágenes intercaladas', 'readTicketRequest', body({
  franjas: [franja(top, 0, 0, 0, 100), franja(png(80, 50), 1, 0, 0, 90), franja(bottom, 0, 1, 60, 100), franja(png(80, 40), 1, 1, 50, 90)],
}))
add('franjas-solapadas', 'Pueden solaparse: basta con que el desplazamiento crezca', 'readTicketRequest', body({ franjas: [franja(top, 0, 0, 0, 100), franja(bottom, 0, 1, 50, 100)] }))
add('franjas-gana', 'Con franjas, imagenes no se mira', 'readTicketRequest', body({ franjas: [franja(top, 0, 0, 0, 100)], imagenes: 'x' }))
add('franjas-vacias', 'Lista de franjas vacía', 'readTicketRequest', body({ franjas: [] }))
add('franja-primera-no-cero', 'La primera franja tiene que ser la 0', 'readTicketRequest', body({ franjas: [franja(bottom, 0, 1, 60, 100)] }))
add('franja-desplazada', 'La primera, desde arriba', 'readTicketRequest', body({ franjas: [franja(top, 0, 0, 10, 100)] }))
add('franja-salta', 'Sin saltarse ninguna', 'readTicketRequest', body({ franjas: [franja(top, 0, 0, 0, 100), franja(bottom, 0, 2, 60, 100)] }))
add('franja-no-crece', 'El desplazamiento tiene que crecer', 'readTicketRequest', body({ franjas: [franja(top, 0, 0, 0, 100), franja(bottom, 0, 1, 0, 100)] }))
add('franja-otro-ancho', 'Todas del mismo ancho', 'readTicketRequest', body({ franjas: [franja(top, 0, 0, 0, 100), franja(png(90, 40), 0, 1, 60, 100)] }))
add('franja-otro-alto', 'Y de la misma imagen entera', 'readTicketRequest', body({ franjas: [franja(top, 0, 0, 0, 100), franja(bottom, 0, 1, 60, 101)] }))
add('franja-no-cabe', 'La franja cabe en la imagen entera', 'readTicketRequest', body({ franjas: [franja(top, 0, 0, 0, 100), franja(bottom, 0, 1, 70, 100)] }))
add('franja-alta', 'Una franja de más de 4096', 'readTicketRequest', body({ franjas: [franja(png(100, 4097), 0, 0, 0, 5000)] }))
add('franja-imagen-6', 'imageIndex 6', 'readTicketRequest', body({ franjas: [franja(top, 6, 0, 0, 100)] }))
add('franja-segmento-24', 'segmentIndex 24', 'readTicketRequest', body({ franjas: [franja(top, 0, 24, 0, 100)] }))
add('franja-negativa', 'offsetY negativo', 'readTicketRequest', body({ franjas: [franja(top, 0, 0, -1, 100)] }))
add('franja-alto-total', 'fullHeight de más de 160 000', 'readTicketRequest', body({ franjas: [franja(top, 0, 0, 0, 160_001)] }))
add('franja-alto-cero', 'fullHeight 0', 'readTicketRequest', body({ franjas: [franja(top, 0, 0, 0, 0)] }))
add('franja-decimal', 'Coordenadas con decimales', 'readTicketRequest', body({ franjas: [franja(top, 0, 0, 0, 100.5)] }))
add('franja-texto', 'Coordenadas en texto', 'readTicketRequest', body({ franjas: [franja(top, '0', 0, 0, 100)] }))
add('franja-menos-cero', '-0 es 0', 'readTicketRequest', bodyJson(`{"franjas":[{"image":"${b64(top)}","imageIndex":-0,"segmentIndex":-0,"offsetY":-0,"fullHeight":100}]}`))
add('franja-sin-imagen', 'Sin imagen', 'readTicketRequest', body({ franjas: [{ imageIndex: 0, segmentIndex: 0, offsetY: 0, fullHeight: 100 }] }))
add('franja-null', 'Una franja null', 'readTicketRequest', body({ franjas: [null] }))
add('franja-lista', 'Una franja que es una lista', 'readTicketRequest', body({ franjas: [[b64(top)]] }))
add('franja-imagen-mala', 'Una franja que no es PNG ni JPEG', 'readTicketRequest', body({ franjas: [franja(Buffer.from('hola'), 0, 0, 0, 100)] }))
add('franjas-25', 'Veinticinco franjas', 'readTicketRequest', body({ franjas: Array.from({ length: 25 }, () => franja(top, 0, 0, 0, 100)) }))
add('franjas-orden-validacion', 'Todas las imágenes se validan antes que las coordenadas', 'readTicketRequest', body({
  franjas: [franja(top, 9, 0, 0, 100), franja(Buffer.from('hola'), 0, 0, 0, 100)],
}))

// ---------------------------------------------------------------------------

const corpus = {
  format: 'cuentas-claras-ticket-read-rules-v1',
  provenance: 'Datos inventados para la migración a .NET (TIC-02). Sin datos de la instalación: cabeceras de imágenes sintéticas y las dos imágenes de fixtures/tickets/; las salidas son las de Express.',
  operations: TICKET_READ_OPERATIONS,
  cases,
}
const text = `${JSON.stringify(corpus, null, 2)}\n`
const used = new Set(cases.map((c) => c.operation))
const unused = TICKET_READ_OPERATIONS.filter((operation) => !used.has(operation))
if (unused.length > 0) throw new Error(`Operaciones sin casos: ${unused.join(', ')}`)

if (process.argv.includes('--escribir')) {
  writeFileSync(FILE, text)
  console.log(`Escrito ${cases.length} casos en fixtures/migration/rules-ticket-read.json`)
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
