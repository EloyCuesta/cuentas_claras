import type { ReactNode } from 'react'
import { capitalize, parseISODate } from '../domain/dates.ts'
import { Icon } from './Icon.tsx'

/** Atributos de accesibilidad que el campo pasa a su control. */
export interface ControlProps {
  id: string
  required?: true
  'aria-describedby'?: string
  'aria-invalid'?: true
}

interface FieldProps {
  id: string
  label: string
  /** Muestra "(opcional)" junto a la etiqueta. Si no, el campo es obligatorio. */
  optional?: boolean
  hint?: ReactNode
  error?: string
  /** Render prop: recibe id y atributos ARIA para el input/select/textarea. */
  children: (control: ControlProps) => ReactNode
}

/**
 * Etiqueta + control + ayuda + error, enlazados con aria-describedby para que
 * los lectores de pantalla lean la ayuda y el error al llegar al campo.
 */
export function Field({ id, label, optional = false, hint, error, children }: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
        {optional && <span className="field__optional"> (opcional)</span>}
      </label>
      {children({
        id,
        required: optional ? undefined : true,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
      })}
      {error && (
        <p className="field__error" id={errorId}>
          <Icon name="alert" size={16} />
          <span>{error}</span>
        </p>
      )}
      {hint && (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      )}
    </div>
  )
}

interface SegmentedOption<T extends string> {
  value: T
  label: string
}

/** Grupo de botones de opción (radio nativos) con aspecto de interruptor. */
export function Segmented<T extends string>({
  name,
  legend,
  value,
  options,
  onChange,
}: {
  name: string
  legend: string
  value: T
  options: SegmentedOption<T>[]
  onChange: (value: T) => void
}) {
  return (
    <fieldset className="segmented">
      <legend className="segmented__legend">{legend}</legend>
      <div className="segmented__options">
        {options.map((option) => (
          <label key={option.value} className="segmented__option">
            <input
              type="radio"
              name={name}
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

const LONG_DATE = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

/**
 * Selector de fecha nativo (calendario del sistema en el móvil). Como el
 * navegador lo muestra en su propio idioma, debajo se repite la fecha en
 * español: «Hoy, miércoles, 28 de octubre de 2026».
 */
export function DateInput({
  control,
  value,
  onChange,
  today,
}: {
  control: ControlProps
  value: string
  onChange: (value: string) => void
  today?: string
}) {
  const parts = parseISODate(value)
  const long = parts ? LONG_DATE.format(new Date(parts.year, parts.month - 1, parts.day)) : ''
  return (
    <>
      <input {...control} type="date" className="input" value={value} onChange={(event) => onChange(event.target.value)} />
      {parts && <span className="date-echo">{value === today ? `Hoy, ${long}` : capitalize(long)}</span>}
    </>
  )
}

/** Campo de importe con el símbolo € al final. */
export function AmountInput({
  control,
  value,
  onChange,
  autoFocus = false,
}: {
  control: ControlProps
  value: string
  onChange: (value: string) => void
  autoFocus?: boolean
}) {
  return (
    <div className="input-affix">
      <input
        {...control}
        className="input input--amount"
        inputMode="decimal"
        autoComplete="off"
        placeholder="0,00"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        data-autofocus={autoFocus ? '' : undefined}
      />
      <span className="input-affix__suffix" aria-hidden="true">
        €
      </span>
    </div>
  )
}
