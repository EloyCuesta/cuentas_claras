import { ApiError, ServerUnavailableError } from './apiClient.ts'

/** Traduce los errores del almacenamiento a mensajes que el usuario entienda. */
export function describeStorageError(error: unknown): string {
  if (error instanceof ServerUnavailableError) {
    return 'No se puede conectar con el servidor de Cuentas claras. Comprueba que está en marcha (npm run dev) y vuelve a intentarlo.'
  }
  // Los errores del servidor ya llegan con un mensaje en español.
  if (error instanceof ApiError) return error.message
  if (error instanceof Error && error.message) return error.message
  return 'No se ha podido acceder a los datos.'
}
