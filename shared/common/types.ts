/**
 * Tipos comunes del dominio. Son objetos planos (sin clases) para poder
 * guardarlos tal cual, exportarlos a JSON o enviarlos por la API.
 *
 * Reglas generales:
 * - Los importes son SIEMPRE céntimos enteros y positivos (1234 = 12,34 €).
 *   El signo lo da el tipo (ingreso o gasto).
 * - Las fechas de calendario son cadenas ISO "AAAA-MM-DD", sin hora ni zona
 *   horaria, para evitar desfases al cambiar de zona horaria.
 *
 * Los tipos de cada área están en shared/finance/types.ts,
 * shared/pantry/types.ts y shared/tickets/types.ts.
 */

/** Fecha de calendario en formato "AAAA-MM-DD". */
export type ISODate = string
