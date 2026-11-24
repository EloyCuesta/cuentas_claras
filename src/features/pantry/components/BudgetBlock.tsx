import { useState } from 'react'
import { formatEuros } from '#shared/common/money.ts'
import { monthlyEstimate, type Rhythms } from '#shared/pantry/pantry.ts'
import type { PantryItem } from '#shared/pantry/types.ts'
import { describeStorageError } from '../../../api/storageErrors.ts'
import { BudgetMeter } from '../../../ui/BudgetMeter.tsx'
import { ConfirmDialog } from '../../../ui/Dialog.tsx'
import { useToast } from '../../../ui/toastContext.ts'
import type { PantryActions } from '../pantryContext.ts'

/**
 * La estimación mensual de toda la casa y el presupuesto de la despensa, con
 * «Fijar presupuesto», «Cambiar presupuesto» y «Quitar presupuesto». Es solo
 * una estimación: no aparece en las cuentas.
 */

export function BudgetBlock({
  items,
  rhythms,
  budgetCents,
  actions,
  onEdit,
}: {
  items: readonly PantryItem[]
  rhythms: Rhythms
  budgetCents: number | null
  actions: PantryActions
  onEdit: () => void
}) {
  const { notify } = useToast()
  const estimate = monthlyEstimate(items, rhythms)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const removeBudget = async () => {
    setBusy(true)
    setError(null)
    try {
      await actions.setBudget(null)
      setConfirming(false)
      notify('Presupuesto de la despensa quitado')
    } catch (failure) {
      setError(describeStorageError(failure))
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
          <button type="button" className="btn btn--small btn--ghost" onClick={() => setConfirming(true)} disabled={busy}>
            Quitar presupuesto
          </button>
        )}
      </div>
      {confirming && budgetCents !== null && (
        <ConfirmDialog
          title="Quitar el presupuesto"
          confirmLabel="Quitar presupuesto"
          danger
          busy={busy}
          error={error}
          onConfirm={() => void removeBudget()}
          onClose={() => {
            setError(null)
            setConfirming(false)
          }}
        >
          <p>Vas a quitar el presupuesto de la despensa ({formatEuros(budgetCents)} al mes). Podrás fijarlo otra vez cuando quieras.</p>
        </ConfirmDialog>
      )}
    </div>
  )
}
