import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer, type Server, type Socket } from 'node:net'
import type { AddressInfo } from 'node:net'
import { fileURLToPath, pathToFileURL } from 'node:url'

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
   * y le pide que se cierre como con Ctrl+C: si se cierra bien, status es 0.
   * Sin esto, arrancar es fallar y el proceso se para a los `timeoutMs`.
   */
  whenListening?: { pattern: RegExp; check: () => Promise<void> }
}

/**
 * En Windows, child.kill() termina el proceso sin pasar por su cierre (status
 * null): allí la señal viaja por IPC y la emite signalOverIpc.ts dentro del
 * servidor. En el resto, SIGTERM de verdad.
 */
const WINDOWS = process.platform === 'win32'
const SIGNAL_OVER_IPC = pathToFileURL(fileURLToPath(new URL('./signalOverIpc.ts', import.meta.url))).href

/** Ejecuta el servidor hasta que termina (o hasta `whenListening`). */
export async function runServer(env: Record<string, string | undefined>, { timeoutMs = 20_000, whenListening }: RunOptions = {}): Promise<ServerRun> {
  const child = spawn(process.execPath, ['--import', 'tsx', ...(WINDOWS ? ['--import', SIGNAL_OVER_IPC] : []), 'server/index.ts'], {
    env: { ...baseEnv(), CUENTAS_PORT: '0', ...env },
    stdio: WINDOWS ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'],
  })
  const askToClose = () => {
    if (!WINDOWS) child.kill('SIGTERM')
    else if (child.connected) child.send('SIGINT')
  }
  // Con el canal IPC el tipo de stdio no es una tupla fija: las dos salidas son tuberías por la opción de arriba.
  if (!child.stdout || !child.stderr) throw new Error('runServer necesita la salida del servidor en tuberías.')
  let stdout = ''
  let stderr = ''
  let checking: Promise<void> | null = null
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    stdout += chunk
    if (whenListening && !checking && whenListening.pattern.test(stdout)) {
      checking = whenListening.check().finally(askToClose)
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
