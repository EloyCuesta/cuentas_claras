import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { Router, type Request, type RequestHandler, type Response } from 'express'
import { AppError } from './common/errors.ts'
import { readBody } from './common/http/request.ts'
import { sendData } from './common/http/response.ts'

/**
 * Código de acceso a las funciones financieras.
 *
 * - El código lo pone el dueño con CUENTAS_CODIGO; nunca se guarda en la base
 *   de datos ni se envía al navegador.
 * - Al acertarlo se crea una sesión en memoria (12 h) identificada por un token
 *   aleatorio que viaja en la cookie HttpOnly `cc_sesion`. Reiniciar el
 *   servidor borra todas las sesiones.
 * - Cinco fallos seguidos desde la misma IP bloquean los intentos 15 minutos.
 *
 * Todo el estado vive en una instancia de AccessControl, una por aplicación:
 * las pruebas no se mezclan entre sí.
 */

export const SESSION_COOKIE = 'cc_sesion'
export const SESSION_MS = 12 * 60 * 60 * 1000
export const ATTEMPT_WINDOW_MS = 15 * 60 * 1000
export const LOCK_MS = 15 * 60 * 1000
export const MAX_FAILED_ATTEMPTS = 5
export const MIN_CODE_LENGTH = 4
/** Un código más largo no aporta nada y evitaría calcular hashes de textos enormes. */
const MAX_CODE_LENGTH = 200

export type Role = 'admin' | 'invitado'

export type AccessCodeCheck = { ok: true; code: string } | { ok: false; message: string }

/** Comprueba el código configurado (CUENTAS_CODIGO) antes de arrancar. */
export function checkAccessCode(value: unknown): AccessCodeCheck {
  if (typeof value !== 'string' || value === '') {
    return {
      ok: false,
      message:
        'Falta el código de acceso. Copia .env.example como .env y escribe tu código en CUENTAS_CODIGO (al menos 4 caracteres).',
    }
  }
  if (value.trim() === '') return { ok: false, message: 'El código de acceso (CUENTAS_CODIGO) no puede ser solo espacios.' }
  if ([...value].length < MIN_CODE_LENGTH) {
    return { ok: false, message: `El código de acceso (CUENTAS_CODIGO) debe tener al menos ${MIN_CODE_LENGTH} caracteres.` }
  }
  if (value.length > MAX_CODE_LENGTH) {
    return { ok: false, message: `El código de acceso (CUENTAS_CODIGO) puede tener como máximo ${MAX_CODE_LENGTH} caracteres.` }
  }
  return { ok: true, code: value }
}

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest()

interface Attempts {
  failures: number
  windowStart: number
  lockedUntil: number | null
}

const minutesLeft = (ms: number) => Math.max(1, Math.ceil(ms / 60_000))

export class AccessControl {
  private readonly codeHash: Buffer
  private readonly now: () => number
  private readonly sessions = new Map<string, number>()
  private readonly attempts = new Map<string, Attempts>()

  constructor(accessCode: string, now: () => number = Date.now) {
    const check = checkAccessCode(accessCode)
    // Sin un código válido no se crea nunca la aplicación: el acceso no puede quedar abierto.
    if (!check.ok) throw new Error(check.message)
    this.codeHash = sha256(check.code)
    this.now = now
  }

  /** Comprueba el código y devuelve un token de sesión nuevo. Lanza 401 o 429. */
  login(code: string, ip: string): string {
    const now = this.now()
    const entry = this.currentAttempts(ip, now)
    if (entry?.lockedUntil) {
      const waitMs = entry.lockedUntil - now
      throw new AppError(
        'TOO_MANY_ATTEMPTS',
        `Demasiados intentos con un código incorrecto. Vuelve a intentarlo dentro de ${minutesLeft(waitMs)} min.`,
        { retryAfterSeconds: Math.ceil(waitMs / 1000) },
      )
    }

    // Se comparan los hashes (siempre 32 bytes): el tiempo no depende del código recibido.
    if (!timingSafeEqual(sha256(code), this.codeHash)) {
      const failures = (entry?.failures ?? 0) + 1
      this.attempts.set(ip, {
        failures,
        windowStart: entry?.windowStart ?? now,
        lockedUntil: failures >= MAX_FAILED_ATTEMPTS ? now + LOCK_MS : null,
      })
      throw new AppError('UNAUTHORIZED', 'El código no es correcto.')
    }

    this.attempts.delete(ip)
    this.purgeSessions(now)
    const token = randomBytes(32).toString('hex')
    this.sessions.set(token, now + SESSION_MS)
    return token
  }

  /** Invalida el token (si existía). */
  logout(token: string | null): void {
    if (token) this.sessions.delete(token)
  }

  isValid(token: string | null): boolean {
    if (!token) return false
    const expiresAt = this.sessions.get(token)
    if (expiresAt === undefined) return false
    if (expiresAt <= this.now()) {
      this.sessions.delete(token)
      return false
    }
    return true
  }

  /** Intentos fallidos vigentes de una IP (los caducados se olvidan). */
  private currentAttempts(ip: string, now: number): Attempts | null {
    const entry = this.attempts.get(ip)
    if (!entry) return null
    const lockOver = entry.lockedUntil !== null && entry.lockedUntil <= now
    const windowOver = entry.lockedUntil === null && now - entry.windowStart >= ATTEMPT_WINDOW_MS
    if (lockOver || windowOver) {
      this.attempts.delete(ip)
      return null
    }
    return entry
  }

  private purgeSessions(now: number): void {
    for (const [token, expiresAt] of this.sessions) if (expiresAt <= now) this.sessions.delete(token)
  }
}

/** Lee la cookie de sesión. Tolera cabeceras ausentes o mal formadas. */
export function readSessionToken(req: Request): string | null {
  const header = req.headers.cookie
  if (typeof header !== 'string' || header === '') return null
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator === -1) continue
    if (part.slice(0, separator).trim() !== SESSION_COOKIE) continue
    const value = part.slice(separator + 1).trim()
    // Los tokens son 64 caracteres hexadecimales: cualquier otra cosa no es una sesión.
    return /^[0-9a-f]{64}$/.test(value) ? value : null
  }
  return null
}

// La cookie solo viaja a /api. Sin "Secure": la app se usa por HTTP en la red de casa.
const COOKIE_ATTRIBUTES = 'HttpOnly; SameSite=Strict; Path=/api'

function setSessionCookie(res: Response, token: string): void {
  res.append('Set-Cookie', `${SESSION_COOKIE}=${token}; ${COOKIE_ATTRIBUTES}; Max-Age=${SESSION_MS / 1000}`)
}

function clearSessionCookie(res: Response): void {
  res.append('Set-Cookie', `${SESSION_COOKIE}=; ${COOKIE_ATTRIBUTES}; Max-Age=0`)
}

/** IP del dispositivo según Express (con trust proxy solo se fía del proxy local de Vite). */
const clientIp = (req: Request) => req.ip ?? req.socket.remoteAddress ?? 'desconocida'

/**
 * - POST /api/auth/login   { codigo }  → { rol: 'admin' } y la cookie de sesión.
 * - POST /api/auth/logout              → borra la sesión y la cookie (siempre 200).
 * - GET  /api/auth/me                  → { rol: 'admin' | 'invitado' }.
 */
export function authRoutes(access: AccessControl): Router {
  const router = Router()

  router.post('/auth/login', (req, res) => {
    const { codigo } = readBody(req.body)
    if (typeof codigo !== 'string' || codigo === '' || codigo.length > MAX_CODE_LENGTH) {
      throw new AppError('VALIDATION', 'Escribe el código de acceso.')
    }
    const token = access.login(codigo, clientIp(req))
    // Una sesión anterior de este navegador deja de valer.
    access.logout(readSessionToken(req))
    setSessionCookie(res, token)
    sendData(res, { rol: 'admin' satisfies Role })
  })

  router.post('/auth/logout', (req, res) => {
    access.logout(readSessionToken(req))
    clearSessionCookie(res)
    sendData(res, null)
  })

  router.get('/auth/me', (req, res) => {
    const rol: Role = access.isValid(readSessionToken(req)) ? 'admin' : 'invitado'
    sendData(res, { rol })
  })

  return router
}

/** Deja pasar solo las peticiones con una sesión válida. */
export function requireAdmin(access: AccessControl): RequestHandler {
  return (req, _res, next) => {
    if (!access.isValid(readSessionToken(req))) {
      throw new AppError('UNAUTHORIZED', 'Hace falta el código de acceso para ver esta sección.')
    }
    next()
  }
}
