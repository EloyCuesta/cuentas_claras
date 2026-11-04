/**
 * Identificadores únicos para los registros.
 *
 * crypto.randomUUID solo existe en contextos seguros (https o localhost). Si se
 * abre la app desde otra dirección (por ejemplo, el móvil en la red local), se
 * genera un UUID v4 equivalente con crypto.getRandomValues.
 */
export function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** Instante actual en ISO (para createdAt / updatedAt). */
export function nowISO(): string {
  return new Date().toISOString()
}
