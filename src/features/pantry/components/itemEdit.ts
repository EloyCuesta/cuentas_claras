import { centsToInput } from '#shared/common/money.ts'
import { quantityToInput, type PantryItemDraft } from '#shared/pantry/pantryValidation.ts'
import type { PantryItem, PantryItemInput, PantryItemUpdate } from '#shared/pantry/types.ts'
import { ApiError } from '../../../api/client.ts'

/**
 * Editar un producto sin pisar lo que otro haya cambiado mientras tanto (PAN-01). El formulario guarda la versión del
 * producto con el que se abrió; el servidor solo acepta esa versión y, si ya es otra, responde 409 sin escribir nada.
 * Entonces el borrador se conserva y la persona decide si vuelve a cargar el producto: nunca se reintenta a escondidas
 * con una versión más nueva, porque eso pisaría el cambio del otro.
 */

/** El borrador de un producto que ya existe, tal como se muestra en el formulario. */
export const toDraft = (item: PantryItem): PantryItemDraft => ({
  name: item.name,
  ownerId: item.ownerId ?? '',
  unit: item.unit,
  tracking: item.tracking,
  quantity: quantityToInput(item.quantity),
  target: quantityToInput(item.target),
  frequency: item.frequency,
  price: item.priceCents === null ? '' : centsToInput(item.priceCents),
  notes: item.notes,
})

/** Lo que se envía al guardar: siempre la versión del producto con que se abrió (o se volvió a cargar) el formulario. */
export const itemUpdate = (opened: PantryItem, input: PantryItemInput): PantryItemUpdate => ({ ...input, expectedVersion: opened.version })

/** El producto cambió desde que se abrió el formulario: el servidor respondió 409. */
export const isStaleEdit = (error: unknown): boolean => error instanceof ApiError && error.status === 409

export const GONE_MESSAGE = 'Ese producto ya no existe. Vuelve a cargar la despensa.'

/** Tras «Volver a cargar el producto»: el producto como está ahora y su borrador, o por qué no se puede seguir editando. */
export function reloadedEdit(current: PantryItem | null): { ok: true; opened: PantryItem; draft: PantryItemDraft } | { ok: false; error: string } {
  return current ? { ok: true, opened: current, draft: toDraft(current) } : { ok: false, error: GONE_MESSAGE }
}
