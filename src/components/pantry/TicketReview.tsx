import { useId, useMemo, useState, type ReactNode } from 'react'
import { formatDate } from '../../domain/dates.ts'
import { formatEuros } from '../../domain/money.ts'
import { FREQUENCY_LABELS, formatQuantity, PANTRY_FREQUENCIES, PANTRY_NAME_MAX } from '../../domain/pantry.ts'
import type { TicketDraft, TicketSuggestion } from '../../domain/ticketMatch.ts'
import { checkTicket, type TicketLineFlag } from '../../domain/ticketParse.ts'
import { nameKey } from '../../domain/ticketText.ts'
import type { PantryFrequency, PantryItem, PantryPerson } from '../../domain/types.ts'
import { DateInput, Field } from '../forms.tsx'
import { Icon } from '../Icon.tsx'
import { lineAmount, readAmount, WARNING_FLAGS, type Choice, type ReviewLine, type ReviewState, type SectionId } from './ticketReviewState.ts'

interface Group {
  key: string
  lines: ReviewLine[]
  suggestion: TicketSuggestion | undefined
}

const FLAG_TEXT: Record<TicketLineFlag, string> = {
  ilegible: 'No se lee el importe',
  deducido: 'Importe calculado con el total',
  corregido: 'Corregido con el total',
  dudoso: 'Importe dudoso',
}

/**
 * Revisión de un ticket leído, antes de guardarlo. Se muestran los productos
 * (las líneas iguales juntas), primero lo que conviene mirar. Cada uno se
 * puede asociar a un producto de la despensa, crear como nuevo o no seguirlo,
 * y corregir sus importes. La suma se compara en vivo con el total.
 */

/** «6 × 0,95 €», «0,812 kg × 2,85 €/kg». */
function lineDetail(line: ReviewLine): string {
  if (line.weightKg !== null) {
    return `${formatQuantity(line.weightKg)} kg${line.pricePerKgCents !== null ? ` × ${formatEuros(line.pricePerKgCents)}/kg` : ''}`
  }
  if (line.quantity > 1) return `${line.quantity} × ${line.unitPriceCents !== null ? formatEuros(line.unitPriceCents) : '?'}`
  return ''
}

function CheckBanner({ review, duplicate }: { review: ReviewState; duplicate: TicketDraft['duplicate'] }) {
  const total = readAmount(review.totalText)
  const totalCents = total.ok ? total.cents : null
  const check = checkTicket(
    review.lines.map((line) => ({ amountCents: lineAmount(line), discountCents: line.discountCents })),
    totalCents,
  )
  const warned = review.lines.filter((line) => line.flags.some((f) => WARNING_FLAGS.includes(f))).length
  return (
    <div className="stack stack--tight" aria-live="polite">
      {duplicate && (
        <p className="notice notice--error" role="alert">
          <Icon name="alert" />
          <span>
            Este ticket ya está guardado ({duplicate.storeName}, {formatDate(duplicate.date)}
            {duplicate.totalCents !== null ? `, ${formatEuros(duplicate.totalCents)}` : ''}). No se puede guardar dos veces.
          </span>
        </p>
      )}
      {check.status === 'cuadra' ? (
        <p className="notice ticket-check ticket-check--ok">
          <Icon name="check" />
          <span>
            <strong>Cuadra con el total:</strong> {review.lines.length} {review.lines.length === 1 ? 'línea suma' : 'líneas suman'}{' '}
            {formatEuros(check.linesTotalCents)}.
            {warned > 0 && ` Revisa ${warned === 1 ? 'la línea marcada' : `las ${warned} líneas marcadas`}, por si acaso.`}
          </span>
        </p>
      ) : check.status === 'no_cuadra' ? (
        <p className="notice notice--warning ticket-check">
          <Icon name="alert" />
          <span>
            <strong>No cuadra:</strong> las líneas suman {formatEuros(check.linesTotalCents)} y el total es{' '}
            {formatEuros(totalCents ?? 0)}
            {check.differenceCents !== null && check.differenceCents !== 0 && ` (diferencia de ${formatEuros(Math.abs(check.differenceCents))})`}.
            {check.unreadable > 0 && ` Falta el importe de ${check.unreadable === 1 ? '1 línea' : `${check.unreadable} líneas`}.`} Corrige
            los importes marcados comparándolos con el ticket.
          </span>
        </p>
      ) : (
        <p className="notice notice--warning ticket-check">
          <Icon name="alert" />
          <span>No se ha encontrado el total del ticket: escríbelo para comprobar que no falta nada.</span>
        </p>
      )}
    </div>
  )
}

function GroupEditor({
  group,
  choice,
  items,
  people,
  onChoice,
  onLine,
  onDone,
}: {
  group: Group
  choice: Choice
  items: readonly PantryItem[]
  people: readonly PantryPerson[]
  onChoice: (choice: Choice) => void
  onLine: (position: number, change: Partial<ReviewLine>) => void
  onDone: () => void
}) {
  const id = useId()
  const sortedItems = useMemo(() => [...items].sort((a, b) => a.name.localeCompare(b.name, 'es')), [items])
  const selectValue = choice.kind === 'item' ? choice.itemId : choice.kind === 'ignore' ? '__ignorar' : '__nuevo'
  return (
    <div className="ticket-editor">
      <Field id={`${id}-product`} label="Es el producto">
        {(control) => (
          <select
            {...control}
            className="select"
            value={selectValue}
            onChange={(event) => {
              const value = event.target.value
              if (value === '__ignorar') onChoice({ kind: 'ignore' })
              else if (value === '__nuevo')
                onChoice({ kind: 'new', name: choice.kind === 'new' ? choice.name : group.lines[0].rawName, ownerId: '', frequency: 'semanal' })
              else onChoice({ kind: 'item', itemId: value })
            }}
          >
            <option value="__nuevo">Un producto nuevo</option>
            <option value="__ignorar">No seguir esta línea (bolsas, envases…)</option>
            {sortedItems.length > 0 && (
              <optgroup label="Tus productos">
                {sortedItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        )}
      </Field>
      {choice.kind === 'new' && (
        <>
          <Field id={`${id}-name`} label="Nombre del producto nuevo">
            {(control) => (
              <input
                {...control}
                className="input"
                maxLength={PANTRY_NAME_MAX}
                autoComplete="off"
                value={choice.name}
                onChange={(event) => onChoice({ ...choice, name: event.target.value })}
              />
            )}
          </Field>
          <div className="field-row">
            <Field id={`${id}-owner`} label="De quién es">
              {(control) => (
                <select {...control} className="select" value={choice.ownerId} onChange={(event) => onChoice({ ...choice, ownerId: event.target.value })}>
                  <option value="">Compartido</option>
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field id={`${id}-frequency`} label="Se compra">
              {(control) => (
                <select
                  {...control}
                  className="select"
                  value={choice.frequency}
                  onChange={(event) => onChoice({ ...choice, frequency: event.target.value as PantryFrequency })}
                >
                  {PANTRY_FREQUENCIES.map((frequency) => (
                    <option key={frequency} value={frequency}>
                      {FREQUENCY_LABELS[frequency]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
        </>
      )}
      {group.lines.map((line, i) => {
        const invalid = !readAmount(line.amountText).ok
        const detail = lineDetail(line)
        return (
          <Field
            key={line.position}
            id={`${id}-amount-${i}`}
            label={group.lines.length > 1 ? `Importe (${i + 1}.ª línea)` : 'Importe'}
            error={invalid ? 'Escribe un importe como 1,95 (con un menos delante si es una devolución).' : undefined}
            hint={[detail, line.discountCents > 0 ? `Descuento: ${formatEuros(line.discountCents)}` : ''].filter(Boolean).join(' · ') || undefined}
          >
            {(control) => (
              <div className="input-affix input-affix--short">
                <input
                  {...control}
                  required={undefined}
                  className="input input--amount"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0,00"
                  value={line.amountText}
                  onChange={(event) => onLine(line.position, { amountText: event.target.value, flags: line.flags.filter((f) => f === 'corregido') })}
                />
                <span className="input-affix__suffix" aria-hidden="true">
                  €
                </span>
              </div>
            )}
          </Field>
        )
      })}
      <label className="checkbox">
        <input
          type="checkbox"
          checked={group.lines.every((line) => line.occasional)}
          onChange={(event) => group.lines.forEach((line) => onLine(line.position, { occasional: event.target.checked }))}
        />
        <span>Compra para una ocasión: no cuenta para saber cada cuánto se compra.</span>
      </label>
      <div>
        <button type="button" className="btn btn--small" onClick={onDone}>
          Listo
        </button>
      </div>
    </div>
  )
}

function GroupRow({
  group,
  choice,
  itemName,
  inNewSection,
  expanded,
  onToggle,
  children,
}: {
  group: Group
  choice: Choice
  itemName: string | null
  /** En «Productos nuevos» no hace falta la etiqueta «Nuevo». */
  inNewSection: boolean
  expanded: boolean
  onToggle: () => void
  children: ReactNode
}) {
  const id = useId()
  const flags = [...new Set(group.lines.flatMap((line) => line.flags))]
  const amounts = group.lines.map(lineAmount)
  const known = amounts.every((cents) => cents !== null)
  const total = group.lines.reduce((sum, line) => sum + (lineAmount(line) ?? 0) - line.discountCents, 0)
  const rawName = group.lines[0].rawName
  const title = choice.kind === 'item' ? (itemName ?? 'Producto') : choice.kind === 'new' ? choice.name || 'Producto nuevo' : rawName
  const occasional = group.lines.every((line) => line.occasional)
  return (
    <li className={`ticket-group${choice.kind === 'ignore' ? ' ticket-group--ignored' : ''}`}>
      <button type="button" className="ticket-group__main" aria-expanded={expanded} aria-controls={`${id}-editor`} onClick={onToggle}>
        <span className="ticket-group__text">
          <span className="ticket-group__title">{title}</span>
          <span className="ticket-group__meta">
            {/* Lo que pone el ticket, si no es lo mismo que el título. */}
            {nameKey(rawName) !== nameKey(title) && <span>En el ticket: {rawName}</span>}
            {group.lines.length > 1 && <span>{group.lines.length} líneas</span>}
            {group.lines.length === 1 && lineDetail(group.lines[0]) && <span>{lineDetail(group.lines[0])}</span>}
            {choice.kind === 'new' && !inNewSection && <span className="tag tag--forecast">Nuevo</span>}
            {choice.kind === 'ignore' && <span>No se sigue</span>}
            {occasional && <span>Para una ocasión</span>}
          </span>
          {flags.length > 0 && (
            <span className="ticket-group__flags">
              {flags.map((flag) => (
                <span key={flag} className={`chip ${WARNING_FLAGS.includes(flag) ? 'chip--late' : 'chip--info'}`}>
                  <Icon name={WARNING_FLAGS.includes(flag) ? 'alert' : 'info'} size={14} />
                  {FLAG_TEXT[flag]}
                </span>
              ))}
            </span>
          )}
        </span>
        <span className="ticket-group__amount">{known ? formatEuros(total) : '¿?'}</span>
      </button>
      {expanded && <div id={`${id}-editor`}>{children}</div>}
    </li>
  )
}

export function TicketReview({
  draft,
  review,
  onChange,
  items,
  people,
  previews,
  onRestart,
}: {
  draft: TicketDraft
  review: ReviewState
  onChange: (review: ReviewState) => void
  items: readonly PantryItem[]
  people: readonly PantryPerson[]
  /** Imágenes elegidas (URL locales), para comparar. */
  previews: readonly string[]
  /** Volver a elegir la imagen (o el texto) del ticket. */
  onRestart: () => void
}) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showKnown, setShowKnown] = useState(false)
  const [showImage, setShowImage] = useState(false)
  const itemNames = useMemo(() => new Map(items.map((item) => [item.id, item.name])), [items])

  const groups = useMemo(() => {
    const result: Group[] = []
    for (const line of review.lines) {
      const group = result.find((g) => g.key === line.key)
      if (group) group.lines.push(line)
      else result.push({ key: line.key, lines: [line], suggestion: draft.suggestions[line.key] })
    }
    return result
  }, [review.lines, draft.suggestions])

  const inSection = (id: SectionId) => groups.filter((group) => review.sections[group.key] === id)
  const sections: { id: SectionId; title: string; groups: Group[]; collapsible?: boolean }[] = [
    { id: 'revisar', title: 'Para revisar', groups: inSection('revisar') },
    { id: 'nuevos', title: 'Productos nuevos', groups: inSection('nuevos') },
    { id: 'conocidos', title: 'Ya conocidos', groups: inSection('conocidos'), collapsible: true },
    { id: 'ignorados', title: 'No se siguen', groups: inSection('ignorados'), collapsible: true },
  ]

  const setChoice = (key: string, choice: Choice) => onChange({ ...review, choices: { ...review.choices, [key]: choice } })
  const setLine = (position: number, change: Partial<ReviewLine>) =>
    onChange({ ...review, lines: review.lines.map((line) => (line.position === position ? { ...line, ...change } : line)) })

  const renderGroup = (group: Group, section: SectionId) => {
    const choice = review.choices[group.key]
    return (
      <GroupRow
        key={group.key}
        group={group}
        choice={choice}
        itemName={choice.kind === 'item' ? (itemNames.get(choice.itemId) ?? null) : null}
        inNewSection={section === 'nuevos'}
        expanded={expanded === group.key}
        onToggle={() => setExpanded((current) => (current === group.key ? null : group.key))}
      >
        <GroupEditor
          group={group}
          choice={choice}
          items={items}
          people={people}
          onChoice={(next) => setChoice(group.key, next)}
          onLine={setLine}
          onDone={() => setExpanded(null)}
        />
      </GroupRow>
    )
  }

  return (
    <div className="ticket-review">
      <div className="ticket-review__head">
        <div className="field-row">
          <Field id="ticket-store" label="Tienda">
            {(control) => (
              <input
                {...control}
                className="input"
                maxLength={60}
                autoComplete="off"
                value={review.storeName}
                onChange={(event) => onChange({ ...review, storeName: event.target.value })}
              />
            )}
          </Field>
          <Field id="ticket-date" label="Fecha de la compra">
            {(control) => <DateInput control={control} value={review.date} onChange={(date) => onChange({ ...review, date })} />}
          </Field>
          <Field id="ticket-total" label="Total del ticket">
            {(control) => (
              <div className="input-affix">
                <input
                  {...control}
                  required={undefined}
                  className="input input--amount"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0,00"
                  value={review.totalText}
                  onChange={(event) => onChange({ ...review, totalText: event.target.value })}
                />
                <span className="input-affix__suffix" aria-hidden="true">
                  €
                </span>
              </div>
            )}
          </Field>
        </div>
        <CheckBanner review={review} duplicate={draft.duplicate} />
        <div className="ticket-review__links">
          {previews.length > 0 && (
            <button type="button" className="link-btn" aria-expanded={showImage} onClick={() => setShowImage((v) => !v)}>
              {showImage ? 'Ocultar la imagen' : 'Ver la imagen para comparar'}
            </button>
          )}
          <button type="button" className="link-btn" onClick={onRestart}>
            {previews.length > 0 ? 'Elegir otra imagen' : 'Volver a empezar'}
          </button>
        </div>
        {showImage && previews.length > 0 && (
          // Se desplaza por dentro: con tabIndex también se puede mover con el teclado.
          <div className="ticket-preview" role="region" aria-label="Imagen del ticket" tabIndex={0}>
            {previews.map((src, i) => (
              <img key={src} src={src} alt={`Imagen ${i + 1} del ticket`} />
            ))}
          </div>
        )}
      </div>

      {sections.map((section) => {
        if (section.groups.length === 0) return null
        const hidden = section.collapsible && !showKnown
        return (
          <section key={section.id} className="ticket-section" aria-labelledby={`ticket-${section.id}`}>
            <h3 id={`ticket-${section.id}`} className="subsection-title">
              {section.title} ({section.groups.length})
            </h3>
            {section.id === 'revisar' && (
              <p className="muted small">Pulsa cada uno para corregir el importe o elegir el producto.</p>
            )}
            {section.id === 'nuevos' && (
              <p className="muted small">Se crearán con este nombre; pulsa uno para cambiarlo o asociarlo a un producto que ya tengas.</p>
            )}
            {hidden ? (
              <button type="button" className="link-btn" onClick={() => setShowKnown(true)}>
                Ver {section.groups.length === 1 ? 'el producto' : `los ${section.groups.length} productos`}
              </button>
            ) : (
              <ul className="ticket-groups">{section.groups.map((group) => renderGroup(group, section.id))}</ul>
            )}
          </section>
        )
      })}
    </div>
  )
}
