import { useMemo, useRef, useState, type FormEvent } from 'react'
import { categoryOptions } from '#shared/finance/categories.ts'
import { addDays, formatDate, isValidISODate } from '#shared/common/dates.ts'
import { newId, nowISO } from '#shared/common/ids.ts'
import { centsToInput, formatEuros } from '#shared/common/money.ts'
import { categoryForConcept, conceptSuggestions, frequentCategories } from '#shared/finance/suggestions.ts'
import type { Movement, MovementStatus, MovementType } from '#shared/finance/types.ts'
import type { FieldErrors } from '#shared/common/validation.ts'
import {
  buildMovement,
  MAX_CONCEPT_LENGTH,
  MAX_NOTES_LENGTH,
  validateMovementDraft,
  type MovementDraft,
} from '#shared/finance/validation.ts'
import { useFinance } from '../financeContext.ts'
import { describeStorageError } from '../../../api/storageErrors.ts'
import { useToast } from '../../../ui/toastContext.ts'
import { focusFirstError } from '../../../ui/helpers.ts'
import { ConfirmDialog, Dialog, DialogError } from '../../../ui/Dialog.tsx'
import { AmountInput, DateInput, Field, Segmented } from '../../../ui/forms.tsx'
import { Icon } from '../../../ui/Icon.tsx'

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

/** El nombre corto de una categoría en un botón: la subcategoría sola («Supermercado» de «Alimentación › Supermercado»). */
const shortLabel = (label: string) => label.split(' › ').at(-1) ?? label

/** Pone el foco en un campo del diálogo (después de pintarlo). */
const focusField = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.focus())

/**
 * Formulario para añadir o editar un movimiento, pensado para apuntar un gasto en pocos toques (UX-03):
 * - el importe recibe el foco; «Gasto | Ingreso» va a su lado y cambiarlo con el ratón o el dedo no le quita el foco;
 * - Intro en el importe pasa al concepto, y el concepto sugiere la categoría (igual o por el principio);
 * - las categorías más usadas de ese tipo, en botones de un toque, encima de la lista completa;
 * - «Hoy» y «Ayer» junto a la fecha; el estado y las notas, plegados en «Más opciones» salvo que hagan falta (una
 *   fecha futura propone «Pendiente»);
 * - en un alta, «Guardar y añadir otro» deja el diálogo abierto y vacío, con el mismo tipo y la misma fecha.
 */
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
  // «Más opciones» (estado y notas) abierto si ya hacía falta: un pendiente o con notas.
  const [moreOpen, setMoreOpen] = useState(() => movement !== null && (movement.status === 'pendiente' || movement.notes !== ''))
  // Si el importe tenía el foco al pulsar «Gasto | Ingreso», vuelve a él.
  const amountHadFocus = useRef(false)
  // Mientras el usuario no elija categoría a mano, se sugiere la usada antes con el mismo concepto.
  const [categoryTouched, setCategoryTouched] = useState(movement !== null)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  // El id de un alta se decide al abrir: si se reintenta tras un fallo, es el mismo movimiento y no se duplica.
  // «Guardar y añadir otro» empieza otro alta con otro id.
  const [newMovementId, setNewMovementId] = useState(newId)

  const isNew = movement === null
  const isExpense = draft.type === 'gasto'
  const options = useMemo(() => categoryOptions(data.categories, draft.type), [data.categories, draft.type])
  const suggestions = useMemo(() => conceptSuggestions(data.movements, draft.type), [data.movements, draft.type])
  const frequent = useMemo(() => {
    const labels = new Map(options.map((option) => [option.id, option.label]))
    return frequentCategories(data.movements, draft.type, new Set(labels.keys())).map((id) => ({ id, label: labels.get(id)! }))
  }, [data.movements, draft.type, options])
  const futureDate = draft.status === 'realizado' && isValidISODate(draft.paidDate) && draft.paidDate > today
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
    if (amountHadFocus.current) focusField('mov-amount')
    amountHadFocus.current = false
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

  /** Guarda; con `another`, deja el diálogo abierto para el siguiente alta (mismo tipo y fecha). */
  const save = async (another: boolean) => {
    setSaveError(null)
    const result = validateMovementDraft(draft, data.categories)
    if (!result.ok) {
      setErrors(result.errors)
      if (result.errors.paidDate || result.errors.dueDate || result.errors.notes) setMoreOpen(true)
      focusFirstError(result.errors, FIELD_IDS)
      return
    }
    setBusy(true)
    try {
      const saved = buildMovement(result.value, movement, nowISO(), () => newMovementId)
      await actions.saveMovement(saved)
      notify(isNew ? (saved.type === 'gasto' ? 'Gasto guardado' : 'Ingreso guardado') : 'Cambios guardados')
      if (!another) {
        onClose()
        return
      }
      setDraft((current) => ({ ...current, amount: '', concept: '', categoryId: '', status: 'realizado', dueDate: '', notes: '' }))
      setCategoryTouched(false)
      setErrors({})
      setNewMovementId(newId())
      setBusy(false)
      focusField('mov-amount')
    } catch (error) {
      setSaveError(describeStorageError(error))
      setBusy(false)
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void save(false)
  }

  /** «Hoy» y «Ayer» junto a la fecha. */
  const quickDates = (key: 'paidDate' | 'dueDate') => (
    <div className="date-quick" role="group" aria-label="Fechas rápidas">
      <button type="button" className="btn" aria-pressed={draft[key] === today} onClick={() => set(key, today)}>Hoy</button>
      <button type="button" className="btn" aria-pressed={draft[key] === addDays(today, -1)} onClick={() => set(key, addDays(today, -1))}>Ayer</button>
    </div>
  )

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
      <form className="dialog__form" onSubmit={submit} noValidate>
        <div className="dialog__body">
          <div className="movement-head">
            <Field id="mov-amount" label="Importe" error={errors.amount}>
              {(control) => (
                <AmountInput control={control} value={draft.amount} onChange={(v) => set('amount', v)} autoFocus onEnter={() => focusField('mov-concept')} />
              )}
            </Field>
            {/* Con el ratón o el dedo, el foco se queda en el importe: changeType lo devuelve. */}
            <div onPointerDown={() => { amountHadFocus.current = document.activeElement?.id === 'mov-amount' }}>
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
            </div>
          </div>
          <Field id="mov-concept" label="Concepto" error={errors.concept}>
            {(control) => (
              <>
                <input
                  {...control}
                  className="input"
                  list="mov-concepts"
                  enterKeyHint="done"
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
          {frequent.length > 0 && (
            <div className="quick-chips" role="group" aria-label="Más usadas">
              {frequent.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className="quick-chip"
                  aria-pressed={draft.categoryId === option.id}
                  title={option.label}
                  onClick={() => {
                    setCategoryTouched(true)
                    set('categoryId', option.id)
                  }}
                >
                  {shortLabel(option.label)}
                </button>
              ))}
            </div>
          )}
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
          {draft.status === 'realizado' ? (
            <Field
              id="mov-paid-date"
              label={isExpense ? 'Fecha de pago' : 'Fecha de cobro'}
              error={errors.paidDate}
              hint={isValidISODate(draft.dueDate) ? `Vencimiento previsto: ${formatDate(draft.dueDate)}.` : undefined}
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
          {quickDates(draft.status === 'realizado' ? 'paidDate' : 'dueDate')}
          {futureDate && (
            <p className="notice movement-future">
              <span>Es una fecha futura: si aún no se ha {isExpense ? 'pagado' : 'cobrado'}, apúntalo como pendiente.</span>
              <button type="button" className="btn" onClick={() => { changeStatus('pendiente'); setMoreOpen(true) }}>Marcar como pendiente</button>
            </p>
          )}
          <details className="more-options" open={moreOpen} onToggle={(event) => setMoreOpen(event.currentTarget.open)}>
            <summary>Más opciones</summary>
            <div className="stack">
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
            </div>
          </details>
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
          {isNew && (
            <button type="button" className="btn" disabled={busy} onClick={() => void save(true)}>
              Guardar y añadir otro
            </button>
          )}
          {/* Mientras guarda, el botón lo dice (aria-busy) sin cambiar su nombre: se vuelve a pulsar igual si falla. */}
          <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy || undefined}>
            {isNew ? (isExpense ? 'Guardar gasto' : 'Guardar ingreso') : 'Guardar cambios'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
