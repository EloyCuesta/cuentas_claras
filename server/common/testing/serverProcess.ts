import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer, type Server, type Socket } from 'node:net'
import type { AddressInfo } from 'node:net'

/**
 * Arrancar `server/index.ts` de verdad, en otro proceso, para probar lo que
 * pasa antes de escuchar: el código de acceso, la configuración de MySQL y la
 * conexión. Sin el .env de nadie: solo las variables que pasa el test.
 */

export interface ServerRun {
  status: number | null
  stdout: string
  stderr: string
}

/** Las variables del entorno sin las del servidor (CUENTAS_*), para que el test decida todas. */
function baseEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('CUENTAS_')))
}

export interface RunOptions {
  timeoutMs?: number
  /**
   * Si la salida encaja con `pattern` (el servidor ya escucha), ejecuta `check`
   * y para el proceso con SIGTERM, como Ctrl+C: si se cierra bien, status es 0.
   * Sin esto, arrancar es fallar y el proceso se para a los `timeoutMs`.
   */
  whenListening?: { pattern: RegExp; check: () => Promise<void> }
}

/** Ejecuta el servidor hasta que termina (o hasta `whenListening`). */
export async function runServer(env: Record<string, string | undefined>, { timeoutMs = 20_000, whenListening }: RunOptions = {}): Promise<ServerRun> {
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    env: { ...baseEnv(), CUENTAS_PORT: '0', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  let checking: Promise<void> | null = null
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    stdout += chunk
    if (whenListening && !checking && whenListening.pattern.test(stdout)) {
      checking = whenListening.check().finally(() => child.kill())
    }
  })
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk))
  const timer = setTimeout(() => child.kill(), timeoutMs)
  const [code] = (await once(child, 'close')) as [number | null]
  clearTimeout(timer)
  // Un fallo de la comprobación hace fallar el test, con la salida del servidor para entenderlo.
  if (checking) await (checking as Promise<void>).catch((error: unknown) => {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n--- salida del servidor ---\n${stdout}${stderr}`)
  })
  return { status: code, stdout, stderr }
}

/**
 * Un puerto que acepta conexiones y las cuenta sin responder: si el servidor
 * llegara a conectar con «MySQL», aquí se vería.
 */
export async function countingListener(): Promise<{ port: number; connections: () => number; close: () => Promise<void> }> {
  let count = 0
  const sockets: Socket[] = []
  const server: Server = createServer((socket) => {
    count++
    sockets.push(socket)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return {
    port: (server.address() as AddressInfo).port,
    connections: () => count,
    close: async () => {
      for (const socket of sockets) socket.destroy()
      server.close()
      await once(server, 'close')
    },
  }
}

/** Un puerto libre en el que no escucha nadie (MySQL «apagado»). */
export async function closedPort(): Promise<number> {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address() as AddressInfo
  server.close()
  await once(server, 'close')
  return port
}
