import { once } from 'node:events'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createApp } from '../../app.ts'
import type { TicketReader } from '../../modules/tickets/index.ts'
import type { Clock, IdGenerator } from '../ports.ts'
import { openDatabase, type OpenedDatabase } from '../sqlite/openDatabase.ts'
import { systemClock } from '../system.ts'
import { tempDbPath } from './tempDb.ts'

/**
 * Servidor de la API real en un puerto libre, con una base de datos temporal,
 * para las pruebas por HTTP. Guarda la cookie de sesión como un navegador.
 */

export const TEST_CODE = 'codigo-de-prueba'

export interface ApiBody {
  ok: boolean
  data?: unknown
  error?: { code: string; message: string }
}

export interface CallOptions {
  /** Cuerpo tal cual (para probar JSON mal formado). */
  raw?: string
  headers?: Record<string, string>
  /** null = sin cookie (invitado). Por defecto, la de la última sesión iniciada. */
  cookie?: string | null
}

export interface CallResult {
  status: number
  body: ApiBody
  headers: Headers
}

const running: { server: Server; database: OpenedDatabase }[] = []

const closeDatabase = (database: OpenedDatabase) => {
  if (database.db.open) database.db.close()
}

/** Lector de tickets para las pruebas que no leen imágenes: no arranca Tesseract. */
const unusedReader: TicketReader = {
  read: () => Promise.reject(new Error('Este test no lee imágenes')),
  close: () => Promise.resolve(),
}

export async function startApi({
  path = tempDbPath(),
  testMode = false,
  clock,
  ids,
  login = true,
  ticketReader = unusedReader,
}: {
  path?: string
  testMode?: boolean
  /** Partes del reloj que se sustituyen (por ejemplo, solo nowMs); el resto es el de verdad. */
  clock?: Partial<Clock>
  ids?: IdGenerator
  login?: boolean
  ticketReader?: TicketReader
} = {}) {
  const database = openDatabase(path)
  const app = createApp({
    database,
    accessCode: TEST_CODE,
    testMode,
    clock: { ...systemClock, ...clock },
    ids,
    ticketReader,
  })
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  running.push({ server, database })
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`
  let session: string | null = null

  async function call(method: string, route: string, body?: unknown, options: CallOptions = {}): Promise<CallResult> {
    const cookie = options.cookie === undefined ? session : options.cookie
    const headers: Record<string, string> = { ...options.headers }
    if (body !== undefined || options.raw !== undefined) headers['Content-Type'] = 'application/json'
    if (cookie) headers.Cookie = cookie
    const response = await fetch(`${base}${route}`, {
      method,
      headers,
      body: options.raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    })
    return { status: response.status, body: (await response.json()) as ApiBody, headers: response.headers }
  }

  /** Inicia sesión y guarda la cookie para las siguientes llamadas. */
  async function signIn(code = TEST_CODE, headers?: Record<string, string>): Promise<CallResult> {
    const result = await call('POST', '/auth/login', { codigo: code }, { headers, cookie: null })
    const setCookie = result.headers.get('set-cookie')
    if (result.status === 200 && setCookie) session = setCookie.split(';')[0]
    return result
  }

  const stop = async () => {
    server.close()
    await once(server, 'close')
    closeDatabase(database)
  }

  if (login) {
    const result = await signIn()
    if (result.status !== 200) throw new Error(`No se ha podido iniciar sesión en el servidor de pruebas: ${result.status}`)
  }

  return {
    base,
    path,
    call,
    signIn,
    stop,
    get cookie() {
      return session
    },
    set cookie(value: string | null) {
      session = value
    },
  }
}

export type TestApi = Awaited<ReturnType<typeof startApi>>

/** Para afterEach: cierra los servidores que sigan abiertos. */
export async function stopApis(): Promise<void> {
  for (const { server, database } of running.splice(0)) {
    if (server.listening) {
      server.close()
      await once(server, 'close')
    }
    closeDatabase(database)
  }
}
