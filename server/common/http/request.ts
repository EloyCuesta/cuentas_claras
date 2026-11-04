import { isValidISODate } from '#shared/common/dates.ts'
import type { ISODate } from '#shared/common/types.ts'
import type { ValidationResult } from '#shared/common/validation.ts'
import { AppError } from '../errors.ts'

/**
 * Lectura y validación de peticiones. Los routers comprueban con esto lo que
 * llega antes de llamar a un caso de uso; si algo no vale, lanzan
 * AppError('VALIDATION') con un mensaje en español y el cliente recibe un 400.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Devuelve el valor validado o responde 400 con el mensaje del validador. */
export function valid<T>(result: ValidationResult<T>): T {
  if (!result.ok) throw new AppError('VALIDATION', result.error)
  return result.value
}

/** El id de la URL y el del cuerpo deben coincidir (PUT /movements/:id …). */
export function sameId<T extends { id: string }>(record: T, id: string): T {
  if (record.id !== id) throw new AppError('VALIDATION', 'El id de la dirección no coincide con el de los datos.')
  return record
}

export function readBody(body: unknown): Record<string, unknown> {
  if (!isRecord(body)) throw new AppError('VALIDATION', 'Falta el cuerpo de la petición en JSON.')
  return body
}

export function readDate(value: unknown, field: string): ISODate {
  if (!isValidISODate(value)) throw new AppError('VALIDATION', `El campo «${field}» debe ser una fecha AAAA-MM-DD.`)
  return value
}

export function readOptionalDate(value: unknown, field: string): ISODate | null {
  return value === null || value === undefined ? null : readDate(value, field)
}
