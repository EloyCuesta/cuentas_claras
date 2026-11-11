import { createInterface } from 'node:readline'
import type { TicketSegment } from '#shared/tickets/types.ts'
import { createTesseractReader } from './TesseractTicketReader.ts'

/**
 * El OCR de los tickets para el backend .NET (TIC-02): el mismo lector que usa Express (TesseractTicketReader, con el
 * modelo de español de node_modules), en un proceso aparte que solo reconoce imágenes. No abre la base de datos ni la red.
 *
 * Protocolo: una petición por línea en stdin y una respuesta por línea en stdout, en JSON y UTF-8 (NDJSON).
 * - Petición: { "id": 1, "images": ["<base64>", …], "segments": [{ imageIndex, segmentIndex, offsetY, fullHeight }, …] | null }
 * - Respuesta: { "id": 1, "pages": OcrLine[][] } o { "id": 1, "error": "mensaje" }
 * Las peticiones se atienden de una en una, en orden. stdout es solo para el protocolo: la consola va a stderr. Al cerrarse
 * stdin, cierra el lector y termina.
 *
 * Lo lanza backend/src/CuentasClaras.Infrastructure/Tickets/NodeTicketReader.cs con `node --import tsx` (ver backend/AGENTS.md).
 */

interface ReadRequest {
  id: number
  images: string[]
  segments: Omit<TicketSegment, 'image'>[] | null
}

for (const method of ['log', 'info', 'warn', 'debug'] as const) console[method] = console.error

const reader = createTesseractReader()
let queue: Promise<void> = Promise.resolve()

const reply = (message: unknown) =>
  new Promise<void>((resolve) => {
    if (!process.stdout.write(`${JSON.stringify(message)}\n`)) process.stdout.once('drain', resolve)
    else resolve()
  })

async function handle(line: string): Promise<void> {
  if (line.trim() === '') return
  let id: number | null = null
  try {
    const request = JSON.parse(line) as ReadRequest
    id = request.id
    const pages = await reader.read(
      request.images.map((image) => Buffer.from(image, 'base64')),
      request.segments ?? undefined,
    )
    await reply({ id, pages })
  } catch (error) {
    console.error('[ocr] No se ha podido leer el ticket:', error)
    await reply({ id, error: error instanceof Error ? error.message : String(error) })
  }
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity })
input.on('line', (line) => {
  queue = queue.then(() => handle(line))
})
input.on('close', () => {
  void queue
    .then(() => reader.close())
    .finally(() => process.exit(0))
})
