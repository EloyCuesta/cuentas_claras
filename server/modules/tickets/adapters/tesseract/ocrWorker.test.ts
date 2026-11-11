import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createTesseractReader } from './TesseractTicketReader.ts'

/**
 * El worker del OCR para .NET (ocrWorker.ts, TIC-02), como lo lanza NodeTicketReader: `node --import tsx` desde la raíz,
 * una petición JSON por línea en stdin y una respuesta por línea en stdout. Usa el ticket INVENTADO de fixtures/tickets/.
 */

const ROOT = fileURLToPath(new URL('../../../../../', import.meta.url))
const WORKER = fileURLToPath(new URL('./ocrWorker.ts', import.meta.url))
const PNG = readFileSync(new URL('../../../../../fixtures/tickets/ticket-lidl-ejemplo.png', import.meta.url))

function startWorker() {
  const child = spawn(process.execPath, ['--import', 'tsx', WORKER], { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] })
  const replies: unknown[] = []
  const waiting: ((reply: unknown) => void)[] = []
  createInterface({ input: child.stdout }).on('line', (line) => {
    const reply: unknown = JSON.parse(line)
    const resolve = waiting.shift()
    if (resolve) resolve(reply)
    else replies.push(reply)
  })
  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8')
  })
  const exit = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)))
  const send = (line: string) =>
    new Promise<unknown>((resolve) => {
      child.stdin.write(`${line}\n`)
      if (replies.length > 0) resolve(replies.shift())
      else waiting.push(resolve)
    })
  return { child, send, exit, stderr: () => stderr }
}

describe('worker del OCR para .NET', () => {
  it('responde por stdin/stdout lo mismo que el lector de Express, explica los errores y termina al cerrar stdin', { timeout: 120_000 }, async () => {
    const worker = startWorker()
    const direct = createTesseractReader()
    try {
      // Una franja de una imagen larga: los recuadros llevan su desplazamiento.
      const segment = { imageIndex: 2, segmentIndex: 1, offsetY: 100, fullHeight: 5000 }
      const expected = await direct.read([PNG], [segment])
      const reply = await worker.send(JSON.stringify({ id: 1, images: [PNG.toString('base64')], segments: [segment] }))
      expect(reply).toEqual({ id: 1, pages: JSON.parse(JSON.stringify(expected)) })
      expect(expected[0].length).toBeGreaterThan(10)
      expect(expected[0][0].source).toMatchObject({ imageIndex: 2, segmentIndex: 1, height: 5000 })

      // Una línea que no es JSON y una imagen que no se puede leer: un error con su id, y el worker sigue.
      expect(await worker.send('esto no es JSON')).toMatchObject({ id: null, error: expect.any(String) })
      expect(await worker.send(JSON.stringify({ id: 2, images: [Buffer.from('hola').toString('base64')], segments: null }))).toEqual({
        id: 2,
        error: 'Imagen no válida',
      })
      expect(worker.stderr()).toContain('[ocr] No se ha podido leer el ticket')

      worker.child.stdin.end()
      expect(await worker.exit).toBe(0)
    } finally {
      await direct.close()
      worker.child.kill()
    }
  })
})
