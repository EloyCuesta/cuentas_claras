/**
 * Aviso entre pestañas: si la app está abierta en dos pestañas y una cambia
 * datos, la otra recarga. Se usa un único BroadcastChannel por pestaña, así
 * que una pestaña no recibe sus propios avisos.
 */
const CHANNEL_NAME = 'cuentas-claras'
let channel: BroadcastChannel | null = null

function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null
  channel ??= new BroadcastChannel(CHANNEL_NAME)
  return channel
}

export function notifyOtherTabs(): void {
  getChannel()?.postMessage('changed')
}

/** Escucha los avisos de otras pestañas. Devuelve la función para dejar de escuchar. */
export function onOtherTabChange(listener: () => void): () => void {
  const current = getChannel()
  if (!current) return () => undefined
  current.addEventListener('message', listener)
  return () => current.removeEventListener('message', listener)
}
