import type { PantryPerson } from '#shared/pantry/types.ts'
import { ownerOptions } from './ownerFilter.ts'

/** Selector superior de la despensa: botones de opción que se desplazan en horizontal si no caben. */
export function OwnerTabs({
  people,
  value,
  onChange,
}: {
  people: readonly PantryPerson[]
  value: string
  onChange: (value: string) => void
}) {
  return (
    <fieldset className="segmented segmented--scroll">
      <legend className="sr-only">Ver productos de</legend>
      <div className="segmented__options">
        {ownerOptions(people).map((option) => (
          <label key={option.value} className="segmented__option">
            <input
              type="radio"
              name="pantry-owner-filter"
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

export function OwnerSelect({
  id,
  label,
  people,
  value,
  onChange,
}: {
  id: string
  label: string
  people: readonly PantryPerson[]
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <select id={id} className="select" value={value} onChange={(event) => onChange(event.target.value)}>
        {ownerOptions(people).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}
