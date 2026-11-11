import { imageInfo } from '../server/common/imageInfo.ts'
import { readTicketRequest } from '../server/modules/tickets/adapters/http/readTicketRequest.ts'
import { corpusJson } from './ticketRules.ts'

/**
 * Ejecutor del corpus de la lectura de tickets (fixtures/migration/rules-ticket-read.json, TIC-02), común al generador
 * (tests/generateTicketReadRules.ts) y a la prueba (tests/migrationTicketReadRules.test.ts). Fija lo que hace Express con el
 * cuerpo de POST /api/despensa/tickets/leer antes de leer nada: decodificar el base64 como Node, reconocer PNG y JPEG por su
 * cabecera, los límites y las franjas. Los bytes salen como { length, sha256 } (corpusJson), así que las huellas de las
 * imágenes de .NET se calculan sobre los mismos bytes. C# lo reproduce en backend/tests/CuentasClaras.Tests/TicketReadCorpusTests.cs.
 */

// oxlint-disable-next-line no-explicit-any
type Input = any

const bodyOf = (input: Input): unknown => (typeof input.bodyJson === 'string' ? JSON.parse(input.bodyJson) : input.body)

const OPERATIONS: Record<string, (input: Input) => unknown> = {
  // Buffer.from(texto, 'base64'): los bytes en hexadecimal.
  decodeBase64: (i) => Buffer.from(i.text as string, 'base64').toString('hex'),
  // server/common/imageInfo.ts con unos bytes en hexadecimal.
  imageInfo: (i) => imageInfo(Buffer.from(i.hex as string, 'hex')),
  // server/modules/tickets/adapters/http/readTicketRequest.ts después de readBody (un objeto). Cada Buffer pasa a
  // Uint8Array (sin copiar), para que corpusJson lo guarde como { length, sha256 } y no con su toJSON.
  readTicketRequest: (i) => {
    const { source, today } = readTicketRequest(bodyOf(i) as Record<string, unknown>)
    if (source.kind === 'texto') return { source, today }
    const images = source.images.map((image) => new Uint8Array(image.buffer, image.byteOffset, image.byteLength))
    return { source: { ...source, images }, today }
  },
}

export const TICKET_READ_OPERATIONS = Object.keys(OPERATIONS).sort()

/** El resultado de TypeScript tal como lo guarda el corpus (ver corpusJson), o `{ throws: mensaje }`. */
export function runTicketReadRule(operation: string, input: unknown): unknown {
  const run = OPERATIONS[operation]
  if (!run) throw new Error(`Operación desconocida en el corpus de la lectura de tickets: ${operation}`)
  let result: unknown
  try {
    result = run(input)
  } catch (error) {
    return { throws: (error as Error).message }
  }
  return corpusJson(result)
}
