import { useState, type FormEvent } from 'react'
import { centsToInput } from '#shared/common/money.ts'
import {
  DECIMAL_UNITS,
  FREQUENCY_LABELS,
  PANTRY_FREQUENCIES,
  PANTRY_NAME_MAX,
  PANTRY_NOTES_MAX,
  PANTRY_UNITS,
  priceUnitLabel,
  unitName,
} from '#shared/pantry/pantry.ts'
import { agoText, durationText, RHYTHM_LABELS, type ItemRhythm } from '#shared/pantry/pantryRhythm.ts'
import { quantityToInput, validateItemDraft, type PantryItemDraft } from '#shared/pantry/pantryValidation.ts'
import type {
  PantryItem,
  PantryItemInput,
  PantryPerson,
  PantryTracking,
  PantryUnit,
} from '#shared/pantry/types.ts'
import type { FieldErrors } from '#shared/common/validation.ts'
import { describeStorageError } from '../../state/storageErrors.ts'
import { focusFirstError } from '../../ui/helpers.ts'
import { ConfirmDialog, Dialog, DialogError } from '../Dialog.tsx'
import { Field, Segmented } from '../forms.tsx'
import { Icon } from '../Icon.tsx'

const FIELD_IDS: [keyof PantryItemDraft, string][] = [
  ['name', 'pantry-name'],
  ['ownerId', 'pantry-owner'],
  ['quantity', 'pantry-quantity'],
  ['target', 'pantry-target'],
  ['price', 'pantry-price'],
  ['notes', 'pantry-notes'],
]

const toDraft = (item: PantryItem): PantryItemDraft => ({
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

/** Última compra y ritmo, en palabras. */
function RhythmNotice({ rhythm }: { rhythm: ItemRhythm }) {
  const last = rhythm.lastPurchase
  return (
    <p className="notice">
      <Icon name="repeat" />
      <span>
        {last && rhythm.sinceDays !== null
          ? `Última compra: ${agoText(rhythm.sinceDays)}${last.store ? ` en ${last.store}` : ''}. `
          : 'Todavía no hay compras apuntadas. '}
        {rhythm.learned
          ? `Suele durar ${durationText(rhythm.expectedDays)}.`
          : `Mientras no haya más compras, se calcula con la frecuencia (${durationText(rhythm.expectedDays)}).`}{' '}
        Estado: {RHYTHM_LABELS[rhythm.status].toLowerCase()}.
      </span>
    </p>
  )
}

/** Crear o editar un producto de la despensa. Si falla al guardar, el formulario conserva lo escrito. */
export function PantryItemDialog({
  item,
  people,
  defaultOwnerId,
  rhythm,
  onSave,
  onDelete,
  onClose,
}: {
  item: PantryItem | null
  people: readonly PantryPerson[]
  defaultOwnerId: string | null
  /** Ritmo de compra (si se sigue por compras). */
  rhythm?: ItemRhythm
  onSave: (input: PantryItemInput) => Promise<void>
  onDelete: () => Promise<void>
  onClose: () => void
}) {
  const [draft, setDraft] = useState<PantryItemDraft>(() =>
    item
      ? toDraft(item)
      : {
          name: '',
          ownerId: defaultOwnerId ?? '',
          unit: 'ud',
          tracking: 'compras',
          quantity: '0',
          target: '1',
          frequency: 'semanal',
          price: '',
          notes: '',
        },
  )
  const [errors, setErrors] = useState<FieldErrors<PantryItemDraft>>({})
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const isNew = item === null

  const set = <K extends keyof PantryItemDraft>(key: K, value: PantryItemDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }))
    setErrors((current) => (current[key] ? { ...current, [key]: undefined } : current))
  }

  const changeTracking = (tracking: PantryTracking) => {
    setDraft((current) => ({
      ...current,
      tracking,
      // Al empezar a contar un producto que se seguía por compras, se parte de «hay 0, quiero 1».
      ...(tracking === 'cantidad' && current.quantity === '0' && current.target === '0' ? { target: '1' } : {}),
    }))
    setErrors((current) => ({ ...current, quantity: undefined, target: undefined }))
  }

  const changeUnit = (unit: PantryUnit) => {
    // Al cambiar la unidad se vuelven a comprobar las dos cantidades (sin redondearlas).
    const next = { ...draft, unit }
    setDraft(next)
    const result = validateItemDraft(next, people)
    setErrors((current) => ({
      ...current,
      quantity: result.ok ? undefined : result.errors.quantity,
      target: result.ok ? undefined : result.errors.target,
    }))
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setSaveError(null)
    const result = validateItemDraft(draft, people)
    if (!result.ok) {
      setErrors(result.errors)
      focusFirstError(result.errors, FIELD_IDS)
      return
    }
    setBusy(true)
    try {
      await onSave(result.value)
      onClose()
    } catch (error) {
      setSaveError(describeStorageError(error))
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    try {
      await onDelete()
      onClose()
    } catch (error) {
      setSaveError(describeStorageError(error))
      setBusy(false)
    }
  }

  if (confirmingDelete && item) {
    return (
      <ConfirmDialog
        title="Eliminar producto"
        confirmLabel="Eliminar producto"
        danger
        busy={busy}
        error={saveError}
        onConfirm={() => void remove()}
        onClose={() => {
          setSaveError(null)
          setConfirmingDelete(false)
        }}
      >
        <p>Vas a eliminar «{item.name}» de la despensa. No se puede deshacer.</p>
      </ConfirmDialog>
    )
  }

  const decimals = DECIMAL_UNITS.has(draft.unit)
  const quantityHint = decimals ? 'Admite decimales, por ejemplo 1,5.' : 'En esta unidad se cuenta en números enteros.'

  return (
    <Dialog title={isNew ? 'Nuevo producto' : 'Editar producto'} onClose={onClose}>
      <form className="dialog__form" onSubmit={(event) => void submit(event)} noValidate>
        <div className="dialog__body">
          <Field id="pantry-name" label="Nombre" error={errors.name}>
            {(control) => (
              <input
                {...control}
                className="input"
                maxLength={PANTRY_NAME_MAX}
                autoComplete="off"
                placeholder="Por ejemplo, Leche"
                value={draft.name}
                onChange={(event) => set('name', event.target.value)}
                data-autofocus
              />
            )}
          </Field>
          <Field id="pantry-owner" label="De quién es" error={errors.ownerId}>
            {(control) => (
              <select {...control} className="select" value={draft.ownerId} onChange={(event) => set('ownerId', event.target.value)}>
                <option value="">Compartido</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field id="pantry-unit" label="Unidad">
            {(control) => (
              <select
                {...control}
                className="select"
                value={draft.unit}
                onChange={(event) => changeUnit(event.target.value as PantryUnit)}
              >
                {PANTRY_UNITS.map((unit) => (
                  <option key={unit} value={unit}>
                    {unitName(unit)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Segmented
            name="pantry-tracking"
            legend="Cómo lo sigues"
            value={draft.tracking}
            onChange={changeTracking}
            options={[
              { value: 'compras', label: 'Por compras' },
              { value: 'cantidad', label: 'Contando' },
            ]}
          />
          <p className="field__hint pantry-tracking-hint">
            {draft.tracking === 'compras'
              ? 'Recomendado: la app apunta cuándo lo compras (con los tickets) y te avisa cuando probablemente se esté acabando.'
              : 'Tú indicas cuánto hay con los botones − y +, y falta cuando hay menos de lo que quieres tener.'}
          </p>
          {draft.tracking === 'compras' && rhythm && !isNew && <RhythmNotice rhythm={rhythm} />}
          {draft.tracking === 'cantidad' && (
          <div className="field-row">
            <Field id="pantry-quantity" label="Hay ahora" error={errors.quantity} hint={quantityHint}>
              {(control) => (
                <div className="input-affix input-affix--text">
                  <input
                    {...control}
                    className="input"
                    inputMode={decimals ? 'decimal' : 'numeric'}
                    autoComplete="off"
                    value={draft.quantity}
                    onChange={(event) => set('quantity', event.target.value)}
                  />
                  <span className="input-affix__suffix" aria-hidden="true">
                    {unitName(draft.unit)}
                  </span>
                </div>
              )}
            </Field>
            <Field id="pantry-target" label="Quiero tener" error={errors.target} hint="Por debajo de esto, falta.">
              {(control) => (
                <div className="input-affix input-affix--text">
                  <input
                    {...control}
                    className="input"
                    inputMode={decimals ? 'decimal' : 'numeric'}
                    autoComplete="off"
                    value={draft.target}
                    onChange={(event) => set('target', event.target.value)}
                  />
                  <span className="input-affix__suffix" aria-hidden="true">
                    {unitName(draft.unit)}
                  </span>
                </div>
              )}
            </Field>
          </div>
          )}
          <Field
            id="pantry-frequency"
            label="Cada cuánto se compra"
            hint={draft.tracking === 'compras' ? 'Solo hasta que haya compras suficientes para saberlo.' : undefined}
          >
            {(control) => (
              <select
                {...control}
                className="select"
                value={draft.frequency}
                onChange={(event) => set('frequency', event.target.value as PantryItemDraft['frequency'])}
              >
                {PANTRY_FREQUENCIES.map((frequency) => (
                  <option key={frequency} value={frequency}>
                    {FREQUENCY_LABELS[frequency]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field
            id="pantry-price"
            label={`Precio estimado (${priceUnitLabel(draft.unit)})`}
            optional
            error={errors.price}
            hint={
              draft.unit === 'g' || draft.unit === 'ml'
                ? `Precio por ${draft.unit === 'g' ? 'kilo' : 'litro'}. Déjalo vacío si no lo sabes; 0 cuenta como gratis.`
                : 'Déjalo vacío si no lo sabes; 0 cuenta como gratis.'
            }
          >
            {(control) => (
              <div className="input-affix input-affix--text">
                <input
                  {...control}
                  className="input input--amount"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0,00"
                  value={draft.price}
                  onChange={(event) => set('price', event.target.value)}
                />
                <span className="input-affix__suffix" aria-hidden="true">
                  {priceUnitLabel(draft.unit)}
                </span>
              </div>
            )}
          </Field>
          <Field id="pantry-notes" label="Notas" optional error={errors.notes}>
            {(control) => (
              <textarea
                {...control}
                className="textarea"
                rows={2}
                maxLength={PANTRY_NOTES_MAX}
                placeholder="Marca, tienda…"
                value={draft.notes}
                onChange={(event) => set('notes', event.target.value)}
              />
            )}
          </Field>
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
            {isNew ? 'Guardar producto' : 'Guardar cambios'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
