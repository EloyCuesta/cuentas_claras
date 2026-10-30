import type { PantryItem } from './types.ts'

/**
 * Las dos formas de seguir un producto de la despensa:
 * - `cantidad`: se cuenta lo que hay y lo que se quiere tener (botones − y +).
 * - `compras`: se apunta cuándo se compra y la app aprende cuánto dura (ritmo).
 *
 * Para saber si un producto se cuenta, se pregunta aquí y no comparando el
 * texto del modo. Lo que cambia con cada modo (lista, costes, estimación) está
 * en TRACKING_MODES (pantry.ts).
 */
export const isCounted = (item: Pick<PantryItem, 'tracking'>): boolean => item.tracking === 'cantidad'
