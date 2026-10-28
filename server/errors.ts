/**
 * Errores previstos del servidor. El código decide el estado HTTP (ver http.ts)
 * y el mensaje, en español, llega tal cual a la interfaz.
 */
export type ErrorCode = 'VALIDATION' | 'NOT_FOUND' | 'CONFLICT'

export class AppError extends Error {
  readonly code: ErrorCode

  constructor(code: ErrorCode, message: string) {
    super(message)
    this.name = 'AppError'
    this.code = code
  }
}
