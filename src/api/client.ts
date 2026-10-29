/**
 * Cliente de la API del servidor (server/index.ts). En desarrollo, Vite envía
 * /api al servidor de Express, así que no hay problemas de CORS.
 *
 * Todas las respuestas tienen el formato { ok: true, data } o
 * { ok: false, error: { code, message } }; aquí se desempaqueta y los errores
 * se convierten en excepciones con el mensaje del servidor.
 */

const API_BASE = '/api'

/** El servidor respondió con un error (validación, conflicto…). El mensaje ya está en español. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(message: string, status: number, code: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

/** No se pudo hablar con el servidor (no está en marcha o no responde). */
export class ServerUnavailableError extends Error {
  constructor() {
    super('No se puede conectar con el servidor de Cuentas claras.')
    this.name = 'ServerUnavailableError'
  }
}

/**
 * Pérdida de sesión: cualquier 401 de la API (salvo el del propio formulario de
 * acceso) avisa a quien escuche, para volver al modo invitado en un solo sitio.
 */
type UnauthorizedListener = () => void
const unauthorizedListeners = new Set<UnauthorizedListener>()

export function onUnauthorized(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener)
  return () => unauthorizedListeners.delete(listener)
}

type Envelope = { ok: true; data: unknown } | { ok: false; error: { code: string; message: string } }

function isEnvelope(value: unknown): value is Envelope {
  return typeof value === 'object' && value !== null && 'ok' in value && typeof value.ok === 'boolean'
}

export async function apiRequest<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      // La cookie de sesión (HttpOnly) va sola en las peticiones al mismo origen; nada se guarda en el navegador.
      credentials: 'same-origin',
      cache: 'no-store',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ServerUnavailableError()
  }

  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    // Sin JSON: suele ser el proxy de Vite diciendo que el servidor no responde.
  }
  if (isEnvelope(payload)) {
    if (payload.ok) return payload.data as T
    if (response.status === 401 && !path.startsWith('/auth/')) for (const listener of unauthorizedListeners) listener()
    throw new ApiError(payload.error.message, response.status, payload.error.code)
  }
  if (response.status >= 500) throw new ServerUnavailableError()
  throw new ApiError(`Respuesta inesperada del servidor (${response.status}).`, response.status, 'INTERNAL')
}

/** Codifica un id para usarlo en la ruta (/movements/<id>). */
export const segment = (value: string) => encodeURIComponent(value)
