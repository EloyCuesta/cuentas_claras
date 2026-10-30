/** Resultado de comprobar lo que llega a la API o a una copia: el valor, o el motivo en español. */
export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string }

/** Errores de un formulario, uno por campo, listos para mostrarse junto a cada campo. */
export type FieldErrors<T> = Partial<Record<keyof T, string>>
