/** Traduce los errores del almacenamiento a mensajes que el usuario entienda. */
export function describeStorageError(error: unknown): string {
  if (typeof indexedDB === 'undefined') {
    return 'Este navegador no permite guardar datos (no tiene IndexedDB). Prueba con una versión actual de Chrome, Firefox, Edge o Safari.'
  }
  const name = error instanceof Error || error instanceof DOMException ? error.name : ''
  switch (name) {
    case 'QuotaExceededError':
      return 'El navegador no tiene espacio para guardar más datos. Libera espacio en el dispositivo y vuelve a intentarlo.'
    case 'ConstraintError':
      return 'Ese vencimiento ya existe, así que no se ha creado otro.'
    case 'VersionError':
      return 'Hay una versión más nueva de la aplicación abierta en otra pestaña. Recarga esta página.'
    case 'ReferenceError':
    case 'SecurityError':
    case 'InvalidStateError':
    case 'UnknownError':
      return 'Este navegador no permite guardar datos. Puede pasar en modo privado o si has bloqueado los datos de los sitios web.'
  }
  if (error instanceof Error && error.message) return error.message
  return 'No se ha podido acceder a los datos guardados en este navegador.'
}
