import { useState, type FormEvent } from 'react'
import { centsToInput, formatEuros } from '#shared/common/money.ts'
import { parsePantryCentsInput } from '#shared/pantry/pantryValidation.ts'
import { describeStorageError } from '../../../api/storageErrors.ts'
import { ConfirmDialog, Dialog, DialogError } from '../../../ui/Dialog.tsx'
import { AmountInput, Field } from '../../../ui/forms.tsx'

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
  const [confirmingRemove, setConfirmingRemove] = useState(false)

  const save = async (cents: number | null) => {
    setBusy(true)
    setError(null)
    try {
      await onSave(cents)
      onClose()
    } catch (failure) {
      setError(describeStorageError(failure))
      setBusy(false)
    }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    const parsed = parsePantryCentsInput(value)
    if (!parsed.ok) {
      setFieldError(parsed.error)
      document.getElementById('pantry-budget')?.focus()
      return
    }
    // Vaciar el campo quita el presupuesto: si había uno, se pregunta antes.
    if (parsed.value === null && budgetCents !== null) {
      setConfirmingRemove(true)
      return
    }
    await save(parsed.value)
  }

  if (confirmingRemove && budgetCents !== null) {
    return (
      <ConfirmDialog
        title="Quitar el presupuesto"
        confirmLabel="Quitar presupuesto"
        danger
        busy={busy}
        error={error}
        onConfirm={() => void save(null)}
        onClose={() => {
          setError(null)
          setConfirmingRemove(false)
        }}
      >
        <p>Vas a quitar el presupuesto de la despensa ({formatEuros(budgetCents)} al mes). Podrás fijarlo otra vez cuando quieras.</p>
      </ConfirmDialog>
    )
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
