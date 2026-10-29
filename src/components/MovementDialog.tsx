import { useMemo, useState, type FormEvent } from 'react'
import { categoryOptions } from '#shared/finance/categories.ts'
import { formatDate } from '#shared/common/dates.ts'
import { newId, nowISO } from '#shared/common/ids.ts'
import { centsToInput, formatEuros } from '#shared/common/money.ts'
import { categoryForConcept, conceptSuggestions } from '#shared/finance/suggestions.ts'
import type { Movement, MovementStatus, MovementType } from '#shared/finance/types.ts'
import type { FieldErrors } from '#shared/common/validation.ts'
import {
  buildMovement,
  MAX_CONCEPT_LENGTH,
  MAX_NOTES_LENGTH,
  validateMovementDraft,
  type MovementDraft,
} from '#shared/finance/validation.ts'
import { useFinance } from '../state/financeContext.ts'
import { describeStorageError } from '../api/storageErrors.ts'
import { useToast } from '../ui/toastContext.ts'
import { focusFirstError } from '../ui/helpers.ts'
import { ConfirmDialog, Dialog, DialogError } from '../ui/Dialog.tsx'
import { AmountInput, DateInput, Field, Segmented } from '../ui/forms.tsx'
import { Icon } from '../ui/Icon.tsx'

const FIELD_IDS: [keyof MovementDraft, string][] = [
  ['amount', 'mov-amount'],
  ['concept', 'mov-concept'],
  ['categoryId', 'mov-category'],
  ['paidDate', 'mov-paid-date'],
  ['dueDate', 'mov-due-date'],
  ['notes', 'mov-notes'],
]

function toDraft(movement: Movement): MovementDraft {
  return {
    type: movement.type,
    amount: centsToInput(movement.amountCents),
    concept: movement.concept,
    categoryId: movement.categoryId,
    status: movement.status,
    paidDate: movement.paidDate ?? '',
    dueDate: movement.dueDate ?? '',
    notes: movement.notes,
  }
}

/** Formulario para añadir o editar un movimiento. Pensado para apuntar un gasto en pocos pasos. */
export function MovementDialog({
  movement,
  initialType = 'gasto',
  onClose,
}: {
  movement: Movement | null
  initialType?: MovementType
  onClose: () => void
}) {
  const { data, today, actions } = useFinance()
  const { notify } = useToast()
  const [draft, setDraft] = useState<MovementDraft>(() =>
    movement
      ? toDraft(movement)
      : { type: initialType, amount: '', concept: '', categoryId: '', status: 'realizado', paidDate: today, dueDate: '', notes: '' },
  )
  const [errors, setErrors] = useState<FieldErrors<MovementDraft>>({})
  // Mientras el usuario no elija categoría a mano, se sugiere la usada antes con el mismo concepto.
  const [categoryTouched, setCategoryTouched] = useState(movement !== null)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const isNew = movement === null
  const isExpense = draft.type === 'gasto'
  const options = useMemo(() => categoryOptions(data.categories, draft.type), [data.categories, draft.type])
  const suggestions = useMemo(() => conceptSuggestions(data.movements, draft.type), [data.movements, draft.type])
  const rule = movement?.recurringId ? data.recurring.find((r) => r.id === movement.recurringId) : undefined

  const suggestCategory = (concept: string, type: MovementType): string | null => {
    const id = categoryForConcept(data.movements, concept, type)
    return id && data.categories.some((c) => c.id === id && c.type === type) ? id : null
  }

  const set = <K extends keyof MovementDraft>(key: K, value: MovementDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }))
    setErrors((current) => (current[key] ? { ...current, [key]: undefined } : current))
  }

  const changeType = (type: MovementType) => {
    setDraft((current) => {
      const category = data.categories.find((c) => c.id === current.categoryId)
      const categoryId = category?.type === type ? current.categoryId : (suggestCategory(current.concept, type) ?? '')
      return { ...current, type, categoryId }
    })
    setCategoryTouched(false)
    setErrors((current) => ({ ...current, categoryId: undefined }))
  }

  const changeStatus = (status: MovementStatus) => {
    setDraft((current) => ({
      ...current,
      status,
      paidDate: status === 'realizado' && !current.paidDate ? today : current.paidDate,
      dueDate: status === 'pendiente' && !current.dueDate ? current.paidDate || today : current.dueDate,
    }))
    setErrors((current) => ({ ...current, paidDate: undefined, dueDate: undefined }))
  }

  const changeConcept = (concept: string) => {
    setDraft((current) => {
      const suggested = categoryTouched ? null : suggestCategory(concept, current.type)
      return { ...current, concept, categoryId: suggested ?? current.categoryId }
    })
    setErrors((current) => (current.concept ? { ...current, concept: undefined } : current))
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaveError(null)
    const result = validateMovementDraft(draft, data.categories)
    if (!result.ok) {
      setErrors(result.errors)
      focusFirstError(result.errors, FIELD_IDS)
      return
    }
    setBusy(true)
    try {
      const saved = buildMovement(result.value, movement, nowISO(), newId)
      await actions.saveMovement(saved)
      notify(isNew ? (saved.type === 'gasto' ? 'Gasto guardado' : 'Ingreso guardado') : 'Cambios guardados')
      onClose()
    } catch (error) {
      setSaveError(describeStorageError(error))
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!movement) return
    setBusy(true)
    try {
      await actions.deleteMovement(movement.id)
      notify('Movimiento eliminado')
      onClose()
    } catch (error) {
      setSaveError(describeStorageError(error))
      setBusy(false)
    }
  }

  if (confirmingDelete && movement) {
    return (
      <ConfirmDialog
        title="Eliminar movimiento"
        confirmLabel="Eliminar movimiento"
        danger
        busy={busy}
        error={saveError}
        onConfirm={() => void remove()}
        onClose={() => {
          setSaveError(null)
          setConfirmingDelete(false)
        }}
      >
        <p>
          Vas a eliminar «{movement.concept}» de {formatEuros(movement.amountCents)}. No se puede deshacer.
        </p>
        {rule && <p>Es un vencimiento del recurrente «{rule.concept}». Al eliminarlo no se volverá a crear.</p>}
      </ConfirmDialog>
    )
  }

  return (
    <Dialog title={isNew ? 'Nuevo movimiento' : 'Editar movimiento'} onClose={onClose}>
      <form className="dialog__form" onSubmit={(event) => void submit(event)} noValidate>
        <div className="dialog__body">
          <Segmented
            name="mov-type"
            legend="Tipo"
            value={draft.type}
            onChange={changeType}
            options={[
              { value: 'gasto', label: 'Gasto' },
              { value: 'ingreso', label: 'Ingreso' },
            ]}
          />
          <Field id="mov-amount" label="Importe" error={errors.amount}>
            {(control) => <AmountInput control={control} value={draft.amount} onChange={(v) => set('amount', v)} autoFocus />}
          </Field>
          <Field id="mov-concept" label="Concepto" error={errors.concept}>
            {(control) => (
              <>
                <input
                  {...control}
                  className="input"
                  list="mov-concepts"
                  maxLength={MAX_CONCEPT_LENGTH}
                  autoComplete="off"
                  placeholder={isExpense ? 'Por ejemplo, Supermercado' : 'Por ejemplo, Nómina'}
                  value={draft.concept}
                  onChange={(event) => changeConcept(event.target.value)}
                />
                <datalist id="mov-concepts">
                  {suggestions.map((concept) => (
                    <option key={concept} value={concept} />
                  ))}
                </datalist>
              </>
            )}
          </Field>
          <Field id="mov-category" label="Categoría" error={errors.categoryId}>
            {(control) => (
              <select
                {...control}
                className="select"
                value={draft.categoryId}
                onChange={(event) => {
                  setCategoryTouched(true)
                  set('categoryId', event.target.value)
                }}
              >
                <option value="">Elige una categoría</option>
                {options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Segmented
            name="mov-status"
            legend="Estado"
            value={draft.status}
            onChange={changeStatus}
            options={[
              { value: 'realizado', label: isExpense ? 'Pagado' : 'Cobrado' },
              { value: 'pendiente', label: 'Pendiente' },
            ]}
          />
          {draft.status === 'realizado' ? (
            <Field
              id="mov-paid-date"
              label={isExpense ? 'Fecha de pago' : 'Fecha de cobro'}
              error={errors.paidDate}
              hint={draft.dueDate ? `Vencimiento previsto: ${formatDate(draft.dueDate)}.` : undefined}
            >
              {(control) => <DateInput control={control} value={draft.paidDate} onChange={(v) => set('paidDate', v)} today={today} />}
            </Field>
          ) : (
            <Field
              id="mov-due-date"
              label="Fecha prevista o de vencimiento"
              error={errors.dueDate}
              hint={
                isExpense
                  ? 'Cuenta como pago pendiente hasta que lo marques como pagado.'
                  : 'Cuenta como cobro pendiente hasta que lo marques como cobrado.'
              }
            >
              {(control) => <DateInput control={control} value={draft.dueDate} onChange={(v) => set('dueDate', v)} today={today} />}
            </Field>
          )}
          <Field id="mov-notes" label="Notas" optional error={errors.notes}>
            {(control) => (
              <textarea
                {...control}
                className="textarea"
                rows={2}
                maxLength={MAX_NOTES_LENGTH}
                value={draft.notes}
                onChange={(event) => set('notes', event.target.value)}
              />
            )}
          </Field>
          {rule && (
            <p className="notice">
              <Icon name="repeat" />
              <span>
                Vencimiento del recurrente «{rule.concept}»
                {movement?.installmentNumber && rule.installments
                  ? `, cuota ${movement.installmentNumber} de ${rule.installments}`
                  : ''}
                .
              </span>
            </p>
          )}
          <DialogError message={saveError} />
        </div>
        <div className="dialog__footer">
          {!isNew && (
            <button type="button" className="btn btn--danger dialog__footer-start" onClick={() => setConfirmingDelete(true)}>
              <Icon name="trash" />
              Eliminar
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {isNew ? (isExpense ? 'Guardar gasto' : 'Guardar ingreso') : 'Guardar cambios'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
