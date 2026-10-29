/**
 * El código de acceso a las finanzas (CUENTAS_CODIGO). Lo pone el dueño en el
 * .env; nunca se guarda en la base de datos ni se envía al navegador. Sin un
 * código válido el servidor no arranca y createApp no se crea.
 */

export const MIN_CODE_LENGTH = 4
/** Un código más largo no aporta nada y evitaría calcular hashes de textos enormes. */
export const MAX_CODE_LENGTH = 200

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
