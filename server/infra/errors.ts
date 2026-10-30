/**
 * Errores previstos del servidor. El código decide el estado HTTP (ver http.ts)
 * y el mensaje, en español, llega tal cual a la interfaz.
 */
export type ErrorCode = 'VALIDATION' | 'NOT_FOUND' | 'CONFLICT' | 'UNAUTHORIZED' | 'TOO_MANY_ATTEMPTS'

export interface AppErrorOptions {
  /** Segundos que hay que esperar antes de volver a intentarlo (cabecera Retry-After). */
  retryAfterSeconds?: number
}

export class AppError extends Error {
  readonly code: ErrorCode
  readonly retryAfterSeconds: number | null

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.retryAfterSeconds = options.retryAfterSeconds ?? null
  }
}
