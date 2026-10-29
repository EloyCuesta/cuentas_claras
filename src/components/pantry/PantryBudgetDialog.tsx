import { useState, type FormEvent } from 'react'
import { centsToInput } from '../../../shared/common/money.ts'
import { parsePantryCentsInput } from '../../../shared/pantry/pantryValidation.ts'
import { describeStorageError } from '../../state/storageErrors.ts'
import { Dialog, DialogError } from '../Dialog.tsx'
import { AmountInput, Field } from '../forms.tsx'

/** Presupuesto mensual estimado de la despensa (de toda la casa). No crea ningún presupuesto financiero. */
export function PantryBudgetDialog({
  budgetCents,
  onSave,
  onClose,
}: {
  budgetCents: number | null
  onSave: (cents: number | null) => Promise<void>
  onClose: () => void
}) {
  const [value, setValue] = useState(budgetCents === null ? '' : centsToInput(budgetCents))
  const [fieldError, setFieldError] = useState<string | undefined>()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    const parsed = parsePantryCentsInput(value)
    if (!parsed.ok) {
      setFieldError(parsed.error)
      document.getElementById('pantry-budget')?.focus()
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSave(parsed.value)
      onClose()
    } catch (failure) {
      setError(describeStorageError(failure))
      setBusy(false)
    }
  }

  return (
    <Dialog title="Presupuesto de la despensa" onClose={onClose} size="alert">
      <form className="dialog__form" onSubmit={(event) => void submit(event)} noValidate>
        <div className="dialog__body">
          <Field
            id="pantry-budget"
            label="Presupuesto al mes para toda la casa"
            error={fieldError}
            hint="Se compara con la estimación mensual de la despensa. Déjalo vacío para quitarlo. No afecta a tus cuentas."
          >
            {(control) => (
              <AmountInput
                control={{ ...control, required: undefined }}
                value={value}
                onChange={(next) => {
                  setValue(next)
                  setFieldError(undefined)
                }}
                autoFocus
              />
            )}
          </Field>
          <DialogError message={error} />
        </div>
        <div className="dialog__footer">
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            Guardar presupuesto
          </button>
        </div>
      </form>
    </Dialog>
  )
}
