import { fileURLToPath } from 'node:url'

/** Carpetas del banco: las imágenes generadas y los resultados van fuera de git (.banco-tickets/). */
export const ROOT = fileURLToPath(new URL('../../', import.meta.url))
export const IMAGES_DIR = `${ROOT}.banco-tickets/imagenes/`
export const RESULTS_DIR = `${ROOT}.banco-tickets/resultados/`
export const FIXTURES_DIR = `${ROOT}fixtures/tickets/banco/`
/** Los tickets reales de la persona: nunca se copia nada de ahí al repositorio. */
export const PRIVATE_DIR = process.env.CUENTAS_TICKETS_PRIVADOS ?? 'C:\\tickets-privados'
