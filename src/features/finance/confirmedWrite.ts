/**
 * Una escritura en el servidor seguida de la relectura de los datos (FIN-02). Distingue los dos fallos posibles:
 *
 * - Si falla la escritura, no se guardó nada: el error llega a quien la pidió (el diálogo sigue abierto y se puede
 *   reintentar con el mismo id, sin duplicar).
 * - Si la escritura se confirmó y lo que falla es la relectura, lo guardado ya está en el servidor: no se rechaza (así
 *   nadie repite un alta que sí se guardó) y se avisa con `onReloadFailed`.
 */
export async function writeThenReload<T>(
  write: () => Promise<T>,
  reload: () => Promise<void>,
  onReloadFailed: (error: unknown) => void,
): Promise<T> {
  const result = await write()
  try {
    await reload()
  } catch (error) {
    onReloadFailed(error)
  }
  return result
}
