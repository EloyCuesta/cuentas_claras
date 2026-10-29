/**
 * Tipos genéricos de validación, comunes a todas las áreas.
 *
 * - ValidationResult: lo que devuelve la validación de un dato que llega a la
 *   API o de una copia de seguridad. Si falla, un solo mensaje en español para
 *   la persona que usa la app (el servidor lo envía tal cual con un 400).
 * - FieldErrors: errores por campo de un formulario, para mostrarlos junto a
 *   cada campo.
 */

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string }

export type FieldErrors<T> = Partial<Record<keyof T, string>>
