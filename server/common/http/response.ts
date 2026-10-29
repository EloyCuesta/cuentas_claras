import Database from 'better-sqlite3'
import type { ErrorRequestHandler, RequestHandler, Response } from 'express'
import { AppError, type ErrorCode } from '../errors.ts'

/**
 * Formato de todas las respuestas de la API:
 *   { "ok": true,  "data": … }
 *   { "ok": false, "error": { "code": "VALIDATION", "message": "…" } }
 * y la gestión centralizada de errores, que deja cualquier error en ese formato.
 */
export type ApiErrorCode = ErrorCode | 'INTERNAL'
export type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: { code: ApiErrorCode; message: string } }

const STATUS: Record<ErrorCode, number> = {
  VALIDATION: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  CONFLICT: 409,
  TOO_MANY_ATTEMPTS: 429,
}

export function sendData<T>(res: Response, data: T, status = 200): void {
  res.status(status).json({ ok: true, data } satisfies ApiResponse<T>)
}

function sendError(res: Response, status: number, code: ApiErrorCode, message: string): void {
  res.status(status).json({ ok: false, error: { code, message } } satisfies ApiResponse<never>)
}

/** Rutas de la API que no existen. */
export const notFoundHandler: RequestHandler = (req, res) => {
  sendError(res, 404, 'NOT_FOUND', `No existe ${req.method} ${req.originalUrl}.`)
}

/** Errores del lector de JSON de Express (cuerpo mal formado o demasiado grande). */
function bodyParserErrorType(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('type' in error)) return null
  return typeof error.type === 'string' && error.type.startsWith('entity.') ? error.type : null
}

/** Gestión centralizada de errores: todos acaban en una respuesta JSON con el mismo formato. */
export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof AppError) {
    if (error.retryAfterSeconds !== null) res.set('Retry-After', String(error.retryAfterSeconds))
    sendError(res, STATUS[error.code], error.code, error.message)
    return
  }
  const bodyError = bodyParserErrorType(error)
  if (bodyError === 'entity.too.large') {
    sendError(res, 413, 'VALIDATION', 'Los datos enviados son demasiado grandes.')
    return
  }
  if (bodyError) {
    sendError(res, 400, 'VALIDATION', 'El cuerpo de la petición no es JSON válido.')
    return
  }
  if (error instanceof Database.SqliteError && error.code.startsWith('SQLITE_CONSTRAINT')) {
    sendError(res, 409, 'CONFLICT', 'Los datos no encajan con los que ya están guardados, así que no se ha cambiado nada.')
    return
  }
  console.error('[api] Error inesperado:', error)
  sendError(res, 500, 'INTERNAL', 'Error interno del servidor. Revisa la consola donde se ejecuta npm run dev.')
}
