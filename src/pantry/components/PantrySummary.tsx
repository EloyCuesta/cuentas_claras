import { useState } from 'react'
import { formatEuros } from '../../../shared/core/money.ts'
import { monthlyEstimate, type OwnerFilter, pantrySummary, type Rhythms } from '../../../shared/pantry/pantry.ts'
import type { PantryItem, PantryPerson } from '../../../shared/pantry/types.ts'
import { describeStorageError } from '../../api/storageErrors.ts'
import { BudgetMeter } from '../../ui/BudgetMeter.tsx'
import { Icon } from '../../ui/Icon.tsx'
import { useToast } from '../../ui/toastContext.ts'
import { usePantryActions } from '../pantryContext.ts'
import { ownerName } from './ownerFilter.ts'

/** Estimación mensual de toda la casa, con su presupuesto. */
export function BudgetBlock({
  items,
  rhythms,
  budgetCents,
  onEdit,
}: {
  items: readonly PantryItem[]
  rhythms: Rhythms
  budgetCents: number | null
  onEdit: () => void
}) {
  const actions = usePantryActions()
  const { notify } = useToast()
  const estimate = monthlyEstimate(items, rhythms)
  const [busy, setBusy] = useState(false)
  const removeBudget = async () => {
    setBusy(true)
    try {
      await actions.setBudget(null)
      notify('Presupuesto de la despensa quitado')
    } catch (error) {
      notify(describeStorageError(error), 'error')
    } finally {
      setBusy(false)
    }
  }
  const partial =
    estimate.withoutPrice > 0
      ? `${estimate.withoutPrice === 1 ? 'Un producto no tiene' : `${estimate.withoutPrice} productos no tienen`} precio y no ${estimate.withoutPrice === 1 ? 'cuenta' : 'cuentan'} en la estimación.`
      : null

  return (
    <div className="pantry-budget">
      <h3 className="subsection-title">Estimación mensual de toda la casa</h3>
      <p className="muted small">
        Lo que se gasta al mes en la despensa (todas las personas y lo compartido), calculado con lo que costó cada producto la última
        vez y cada cuánto se compra. Es una estimación: no aparece en tus cuentas.
      </p>
      {budgetCents === null ? (
        <p>
          <strong>{formatEuros(estimate.cents)}</strong> al mes{partial ? ' (parcial)' : ''}.
        </p>
      ) : (
        <BudgetMeter kind="estimate" line={{ budgetCents, spentCents: estimate.cents, pendingCents: 0, leftCents: budgetCents - estimate.cents }} />
      )}
      {partial && <p className="muted small">{partial}</p>}
      <div className="button-row">
        <button type="button" className="btn btn--small" onClick={onEdit}>
          {budgetCents === null ? 'Fijar presupuesto' : 'Cambiar presupuesto'}
        </button>
        {budgetCents !== null && (
          <button type="button" className="btn btn--small btn--ghost" onClick={() => void removeBudget()} disabled={busy}>
            Quitar presupuesto
          </button>
        )}
      </div>
    </div>
  )
}

/** Lo que falta en la vista elegida y lo que costará. */
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
