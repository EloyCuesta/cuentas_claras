/**
 * Una escritura en el servidor, el cambio en la pantalla y la relectura de los datos en segundo plano (FIN-02, UX-01).
 * Distingue los dos fallos posibles:
 *
 * - Si falla la escritura, no se guardó nada: el error llega a quien la pidió (el diálogo sigue abierto y se puede
 *   reintentar con el mismo id, sin duplicar), y no se toca la pantalla ni se relee.
 * - Si la escritura se confirma, el cambio entra en la pantalla (`apply`) y la promesa se resuelve ya: el diálogo se
 *   cierra tras una sola petición. La relectura va después, sin esperarla; si falla, lo guardado ya está en el servidor
 *   y se avisa con `onReloadFailed` (nadie repite un alta que sí se guardó).
 */
export async function writeThenReload<T>(
  write: () => Promise<T>,
  reload: () => Promise<void>,
  onReloadFailed: (error: unknown) => void,
  apply: (result: T) => void = () => undefined,
): Promise<T> {
  const result = await write()
  apply(result)
  void reload().catch(onReloadFailed)
  return result
}
