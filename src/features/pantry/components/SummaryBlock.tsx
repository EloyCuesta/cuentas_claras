import { formatEuros } from '#shared/common/money.ts'
import { pantrySummary, type OwnerFilter, type Rhythms } from '#shared/pantry/pantry.ts'
import type { PantryItem, PantryPerson } from '#shared/pantry/types.ts'
import { Icon } from '../../../ui/Icon.tsx'
import { ownerName } from './ownerFilter.ts'

/** Cuántos productos faltan (en toda la casa, en lo compartido o de una persona) y lo que costaría comprarlos. */

export function SummaryBlock({
  items,
  rhythms,
  owner,
  people,
}: {
  items: readonly PantryItem[]
  rhythms: Rhythms
  owner: OwnerFilter
  people: readonly PantryPerson[]
}) {
  const summary = pantrySummary(items, owner, rhythms)
  const scope = owner === 'todo' ? 'en toda la casa' : owner === 'compartido' ? 'en lo compartido' : `de ${ownerName(owner, people)}`
  const { pendingCost } = summary
  return (
    <div className="pantry-summary__numbers">
      <p className="pantry-summary__big">
        {summary.missingCount === 0 ? (
          <>
            <Icon name="check" /> No falta nada {scope}.
          </>
        ) : (
          <>
            <Icon name="alert" /> {summary.missingCount === 1 ? 'Falta 1 producto' : `Faltan ${summary.missingCount} productos`} {scope}.
          </>
        )}
      </p>
      {summary.missingCount > 0 && (
        <p>
          {pendingCost.withoutPrice === summary.missingCount ? (
            'Sin precios, no se puede estimar lo que costará.'
          ) : (
            <>
              Compra pendiente estimada: <strong>{formatEuros(pendingCost.cents)}</strong>
              {pendingCost.withoutPrice > 0 &&
                ` (parcial: ${pendingCost.withoutPrice === 1 ? '1 producto sin precio' : `${pendingCost.withoutPrice} productos sin precio`})`}
              .
            </>
          )}
        </p>
      )}
    </div>
  )
}
