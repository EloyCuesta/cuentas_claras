import { Router, type Request, type RequestHandler, type Response } from 'express'
import { AppError } from '../../../../common/errors.ts'
import { readBody } from '../../../../common/http/request.ts'
import { sendData } from '../../../../common/http/response.ts'
import type { CheckSession } from '../../application/CheckSession.ts'
import type { Login } from '../../application/Login.ts'
import type { Logout } from '../../application/Logout.ts'
import { MAX_CODE_LENGTH } from '../../domain/accessCode.ts'
import { SESSION_MS, type Role } from '../../domain/accessPolicy.ts'

/**
 * Acceso por HTTP: las rutas /api/auth, la cookie de sesión y requireAdmin.
 *
 * - El token de la sesión viaja en la cookie HttpOnly `cc_sesion` (el
 *   JavaScript de la página no la puede leer), solo hacia /api.
 * - La IP de cada dispositivo la da Express: con trust proxy solo para
 *   loopback (app.ts), únicamente se fía del proxy de Vite del propio equipo.
 */

export const SESSION_COOKIE = 'cc_sesion'

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
export function authRoutes({ login, logout, checkSession }: { login: Login; logout: Logout; checkSession: CheckSession }): Router {
  const router = Router()

  router.post('/auth/login', (req, res) => {
    const { codigo } = readBody(req.body)
    if (typeof codigo !== 'string' || codigo === '' || codigo.length > MAX_CODE_LENGTH) {
      throw new AppError('VALIDATION', 'Escribe el código de acceso.')
    }
    const token = login.execute(codigo, clientIp(req))
    // Una sesión anterior de este navegador deja de valer.
    logout.execute(readSessionToken(req))
    setSessionCookie(res, token)
    sendData(res, { rol: 'admin' satisfies Role })
  })

  router.post('/auth/logout', (req, res) => {
    logout.execute(readSessionToken(req))
    clearSessionCookie(res)
    sendData(res, null)
  })

  router.get('/auth/me', (req, res) => {
    const rol: Role = checkSession.execute(readSessionToken(req)) ? 'admin' : 'invitado'
    sendData(res, { rol })
  })

  return router
}

/** Deja pasar solo las peticiones con una sesión válida; si no, 401. */
export function requireAdmin(checkSession: CheckSession): RequestHandler {
  return (req, _res, next) => {
    if (!checkSession.execute(readSessionToken(req))) {
      throw new AppError('UNAUTHORIZED', 'Hace falta el código de acceso para ver esta sección.')
    }
    next()
  }
}
