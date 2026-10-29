import { formatEuros } from '#shared/common/money.ts'
import { describeQuantity, excessQuantity, missingQuantity, priceUnitLabel, quantityStep } from '#shared/pantry/pantry.ts'
import type { ItemRhythm } from '#shared/pantry/pantryRhythm.ts'
import type { PantryEventKind, PantryItem } from '#shared/pantry/types.ts'
import { Icon } from '../../../ui/Icon.tsx'
import { purchaseText, showsRhythmStatus } from './rhythmText.ts'
import { RhythmStatus } from './RhythmStatus.tsx'

/**
 * Un producto de la lista de la Despensa: nombre (abre el editor), última compra
 * o cantidad, precio, dueño (en «Todo») y su estado. Los que se cuentan llevan
 * − y +; los que van por compras, «Se acabó» o, si ya está en la lista de la
 * compra, «Lo he comprado».
 */

const priceText = (item: PantryItem) =>
  item.priceCents === null ? null : `${formatEuros(item.priceCents)}${priceUnitLabel(item.unit).slice(1)}`

function StockStatus({ item }: { item: PantryItem }) {
  const missing = missingQuantity(item)
  if (missing > 0) {
    return (
      <span className="chip chip--late">
        <Icon name="alert" size={14} />
        Falta {describeQuantity(missing, item.unit)}
      </span>
    )
  }
  const excess = excessQuantity(item)
  return (
    <span className="chip chip--done">
      <Icon name="check" size={14} />
      {excess > 0 ? `Completo, sobra ${describeQuantity(excess, item.unit)}` : 'Completo'}
    </span>
  )
}

export function PantryRow({
  item,
  rhythm,
  ownerLabel,
  busy,
  onEdit,
  onStep,
  onMark,
}: {
  item: PantryItem
  rhythm: ItemRhythm | undefined
  /** Dueño, solo en la vista «Todo». */
  ownerLabel: string | null
  busy: boolean
  onEdit: () => void
  onStep: (delta: number) => void
  onMark: (kind: PantryEventKind) => void
}) {
  const price = priceText(item)
  const counted = item.tracking === 'cantidad'
  const step = quantityStep(item.unit)
  const stepText = describeQuantity(step, item.unit)
  // En la lista de la compra: el botón pasa a ser «Lo he comprado».
  const out = rhythm?.status === 'se_acabo' || rhythm?.status === 'queda_poco' || rhythm?.status === 'probablemente_acabado'
  return (
    <li className="pantry-item">
      <div className="pantry-item__main">
        <button type="button" className="pantry-item__name" onClick={onEdit}>
          <span className="sr-only">Editar </span>
          {item.name}
        </button>
        <span className="pantry-item__meta">
          {counted ? (
            <span>
              Hay {describeQuantity(item.quantity, item.unit)} de {describeQuantity(item.target, item.unit)}
            </span>
          ) : (
            <span>{purchaseText(rhythm)}</span>
          )}
          {price && <span>{price}</span>}
          {ownerLabel && <span>{ownerLabel}</span>}
        </span>
        {counted ? <StockStatus item={item} /> : showsRhythmStatus(rhythm) && <RhythmStatus rhythm={rhythm} />}
        {item.notes && <span className="pantry-item__notes">{item.notes}</span>}
      </div>
      {counted ? (
        <div className="stepper" role="group" aria-label={`Cantidad de ${item.name}`} aria-busy={busy || undefined}>
          <button
            type="button"
            className="stepper__btn"
            aria-label={`Quitar ${stepText} de ${item.name}`}
            disabled={busy || item.quantity === 0}
            onClick={() => onStep(-step)}
          >
            <Icon name="minus" />
          </button>
          <span className="stepper__value" aria-live="polite">
            {describeQuantity(item.quantity, item.unit)}
          </span>
          <button type="button" className="stepper__btn" aria-label={`Añadir ${stepText} a ${item.name}`} disabled={busy} onClick={() => onStep(step)}>
            <Icon name="plus" />
          </button>
        </div>
      ) : (
        <div className="pantry-item__actions">
          {out ? (
            <button type="button" className="btn btn--small" disabled={busy} onClick={() => onMark('comprado')}>
              <Icon name="check" size={16} />
              Lo he comprado<span className="sr-only"> {item.name}</span>
            </button>
          ) : (
            <button type="button" className="btn btn--small" disabled={busy} onClick={() => onMark('se_acabo')}>
              Se acabó<span className="sr-only"> {item.name}</span>
            </button>
          )}
        </div>
      )}
    </li>
  )
}
