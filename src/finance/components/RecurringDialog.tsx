import { useMemo, useState, type FormEvent } from 'react'
import { addMonthsClamped, formatDate, isValidISODate } from '../../../shared/core/dates.ts'
import { newId, nowISO } from '../../../shared/core/ids.ts'
import { centsToInput } from '../../../shared/core/money.ts'
import type { ISODate } from '../../../shared/core/types.ts'
import { type FieldErrors } from '../../../shared/core/validation.ts'
import { categoryOptions } from '../../../shared/finance/categories.ts'
import { FREQUENCY_LABELS, generationHorizon, pastDates, scheduleDates } from '../../../shared/finance/recurring.ts'
import type { Frequency, MovementType, RecurringRule } from '../../../shared/finance/types.ts'
import {
  buildRecurringRule,
  MAX_CONCEPT_LENGTH,
  MAX_NOTES_LENGTH,
  validateRecurringDraft,
  type RecurringDraft,
} from '../../../shared/finance/validation.ts'
import { describeStorageError } from '../../api/storageErrors.ts'
import { ConfirmDialog, Dialog, DialogError } from '../../ui/Dialog.tsx'
import { AmountInput, DateInput, Field, Segmented } from '../../ui/forms.tsx'
import { focusFirstError } from '../../ui/helpers.ts'
import { Icon } from '../../ui/Icon.tsx'
import { useToast } from '../../ui/toastContext.ts'
import { useFinance } from '../financeContext.ts'

const FIELD_IDS: [keyof RecurringDraft, string][] = [
  ['concept', 'rec-concept'],
  ['amount', 'rec-amount'],
  ['categoryId', 'rec-category'],
  ['frequency', 'rec-frequency'],
  ['startDate', 'rec-start'],
  ['endDate', 'rec-end'],
  ['installments', 'rec-installments'],
  ['notes', 'rec-notes'],
]

function toDraft(rule: RecurringRule): RecurringDraft {
  return {
    type: rule.type,
    concept: rule.concept,
    amount: centsToInput(rule.amountCents),
    categoryId: rule.categoryId,
    frequency: rule.frequency,
    startDate: rule.startDate,
    endDate: rule.endDate ?? '',
    installments: rule.installments === null ? '' : String(rule.installments),
    notes: rule.notes,
  }
}

/** Vista previa del calendario con los datos del formulario (aunque aún no sean válidos del todo). */
function schedulePreview(draft: RecurringDraft, today: ISODate) {
  if (!isValidISODate(draft.startDate)) return null
  const endDate = isValidISODate(draft.endDate) && draft.endDate >= draft.startDate ? draft.endDate : null
  const installments = /^\d+$/.test(draft.installments.trim()) ? Number(draft.installments) || null : null
  const shape = { startDate: draft.startDate, endDate, installments, frequency: draft.frequency }
  const horizon = generationHorizon(today)
  return {
    next: scheduleDates(shape, addMonthsClamped(horizon, 60))
      .filter((date) => date >= today)
      .slice(0, 3),
    createdNow: scheduleDates(shape, horizon).length,
    past: pastDates(shape, today).length,
    horizon,
  }
}

/** Formulario para crear o editar un pago (o cobro) recurrente. */
export function RecurringDialog({ rule, onClose }: { rule: RecurringRule | null; onClose: () => void }) {
  const { data, today, actions } = useFinance()
  const { notify } = useToast()
  const [draft, setDraft] = useState<RecurringDraft>(() =>
    rule
      ? toDraft(rule)
      : {
          type: 'gasto',
          concept: '',
          amount: '',
          categoryId: '',
          frequency: 'mensual',
          startDate: today,
          endDate: '',
          installments: '',
          notes: '',
        },
  )
  const [errors, setErrors] = useState<FieldErrors<RecurringDraft>>({})
  const [markPast, setMarkPast] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const isNew = rule === null
  const options = useMemo(() => categoryOptions(data.categories, draft.type), [data.categories, draft.type])
  const preview = schedulePreview(draft, today)
  const pendingCount = rule ? data.movements.filter((m) => m.recurringId === rule.id && m.status === 'pendiente').length : 0

  const set = <K extends keyof RecurringDraft>(key: K, value: RecurringDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }))
    setErrors((current) => (current[key] ? { ...current, [key]: undefined } : current))
  }

  const changeType = (type: MovementType) => {
    setDraft((current) => {
      const category = data.categories.find((c) => c.id === current.categoryId)
      return { ...current, type, categoryId: category?.type === type ? current.categoryId : '' }
    })
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaveError(null)
    const result = validateRecurringDraft(draft, data.categories)
    if (!result.ok) {
      setErrors(result.errors)
      focusFirstError(result.errors, FIELD_IDS)
      return
    }
    setBusy(true)
    try {
      const saved = buildRecurringRule(result.value, rule, nowISO(), newId)
      const created = await actions.saveRecurring(saved, { markPastAsPaid: isNew && markPast })
      notify(isNew ? `Recurrente guardado: ${created} ${created === 1 ? 'vencimiento creado' : 'vencimientos creados'}` : 'Recurrente actualizado')
      onClose()
    } catch (error) {
      setSaveError(describeStorageError(error))
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!rule) return
    setBusy(true)
    try {
      await actions.deleteRecurring(rule.id)
      notify('Recurrente eliminado')
      onClose()
    } catch (error) {
      setSaveError(describeStorageError(error))
      setBusy(false)
    }
  }

  if (confirmingDelete && rule) {
    return (
      <ConfirmDialog
        title="Eliminar recurrente"
        confirmLabel="Eliminar recurrente"
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
          Se eliminará «{rule.concept}»
          {pendingCount > 0 ? ` y sus ${pendingCount} ${pendingCount === 1 ? 'vencimiento pendiente' : 'vencimientos pendientes'}` : ''}.
          Los pagos ya confirmados se conservan en Movimientos.
        </p>
      </ConfirmDialog>
    )
  }

  const frequencies = Object.keys(FREQUENCY_LABELS) as Frequency[]

  return (
    <Dialog title={isNew ? 'Nuevo recurrente' : 'Editar recurrente'} onClose={onClose}>
      <form className="dialog__form" onSubmit={(event) => void submit(event)} noValidate>
        <div className="dialog__body">
          <Segmented
            name="rec-type"
            legend="Tipo"
            value={draft.type}
            onChange={changeType}
            options={[
              { value: 'gasto', label: 'Pago' },
              { value: 'ingreso', label: 'Cobro' },
            ]}
          />
          <Field id="rec-concept" label="Concepto" error={errors.concept}>
            {(control) => (
              <input
                {...control}
                className="input"
                maxLength={MAX_CONCEPT_LENGTH}
                autoComplete="off"
                placeholder={draft.type === 'gasto' ? 'Por ejemplo, Alquiler o Préstamo del coche' : 'Por ejemplo, Nómina'}
                value={draft.concept}
                onChange={(event) => set('concept', event.target.value)}
                data-autofocus
              />
            )}
          </Field>
          <div className="field-row">
            <Field id="rec-amount" label="Importe de cada vencimiento" error={errors.amount}>
              {(control) => <AmountInput control={control} value={draft.amount} onChange={(v) => set('amount', v)} />}
            </Field>
            <Field id="rec-frequency" label="Frecuencia" error={errors.frequency}>
              {(control) => (
                <select
                  {...control}
                  className="select"
                  value={draft.frequency}
                  onChange={(event) => set('frequency', event.target.value as Frequency)}
                >
                  {frequencies.map((frequency) => (
                    <option key={frequency} value={frequency}>
                      {FREQUENCY_LABELS[frequency]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
          <Field id="rec-category" label="Categoría" error={errors.categoryId}>
            {(control) => (
              <select {...control} className="select" value={draft.categoryId} onChange={(event) => set('categoryId', event.target.value)}>
                <option value="">Elige una categoría</option>
                {options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <div className="field-row">
            <Field
              id="rec-start"
              label="Primer vencimiento"
              error={errors.startDate}
              hint="Los siguientes caen el mismo día. Si un mes no tiene ese día, se usa el último del mes."
            >
              {(control) => <DateInput control={control} value={draft.startDate} onChange={(v) => set('startDate', v)} today={today} />}
            </Field>
            <Field id="rec-end" label="Fecha de fin" optional error={errors.endDate}>
              {(control) => <DateInput control={control} value={draft.endDate} onChange={(v) => set('endDate', v)} today={today} />}
            </Field>
          </div>
          <Field
            id="rec-installments"
            label="Número de cuotas"
            optional
            error={errors.installments}
            hint="Para préstamos o letras: el total de cuotas. La aplicación te dirá cuántas quedan."
          >
            {(control) => (
              <input
                {...control}
                className="input input--short"
                inputMode="numeric"
                autoComplete="off"
                value={draft.installments}
                onChange={(event) => set('installments', event.target.value)}
              />
            )}
          </Field>
          <Field id="rec-notes" label="Notas" optional error={errors.notes}>
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

          {preview && (
            <div className="preview" aria-live="polite">
              <p className="preview__title">
                <Icon name="repeat" size={18} />
                {preview.next.length > 0 ? 'Próximos vencimientos' : 'No quedan vencimientos a partir de hoy'}
              </p>
              {preview.next.length > 0 && (
                <ul className="preview__dates">
                  {preview.next.map((date) => (
                    <li key={date}>{formatDate(date)}</li>
                  ))}
                </ul>
              )}
              <p className="preview__note">
                {isNew
                  ? `Al guardar se crearán ${preview.createdNow} ${preview.createdNow === 1 ? 'vencimiento' : 'vencimientos'} hasta el ${formatDate(preview.horizon)}. Cada uno queda pendiente hasta que confirmes el pago.`
                  : 'Al guardar se rehacen los vencimientos pendientes con estos datos. Los que ya están pagados no cambian.'}
              </p>
              {isNew && preview.past > 0 && (
                <label className="checkbox">
                  <input type="checkbox" checked={markPast} onChange={(event) => setMarkPast(event.target.checked)} />
                  <span>
                    Marcar como {draft.type === 'gasto' ? 'pagados' : 'cobrados'} los {preview.past}{' '}
                    {preview.past === 1 ? 'vencimiento anterior' : 'vencimientos anteriores'} a hoy
                  </span>
                </label>
              )}
            </div>
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
            {isNew ? 'Guardar recurrente' : 'Guardar cambios'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
