import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { formatDate, isValidISODate } from '#shared/common/dates.ts'
import { centsToInput, formatEuros } from '#shared/common/money.ts'
import { FREQUENCY_LABELS, PANTRY_FREQUENCIES } from '#shared/pantry/pantry.ts'
import type { TicketDraft } from '#shared/tickets/ticketMatch.ts'
import { CHECK_LABELS } from '#shared/tickets/ticketParse.ts'
import { nameKey } from '#shared/tickets/ticketText.ts'
import type { PantryFrequency, PantryItem, PantryPerson } from '#shared/pantry/types.ts'
import type { TicketSource } from '#shared/tickets/types.ts'
import { DateInput, Field } from '../../ui/forms.tsx'
import { TicketLineCheck, type ShownSegment } from './TicketLineCheck.tsx'
import {
  currentCalculation, LINE_STATE_LABELS, lineAmount, lineState, lineToInput, needsLineCheck, readAmount, reviewCheck, reviewLine,
  type Choice, type HeaderField, type ReviewLine, type ReviewState,
} from './ticketReviewState.ts'

/**
 * Revisar un ticket leído antes de guardarlo, pensado primero para el móvil:
 * lo que hay que decidir arriba y lo que está bien, plegado.
 *
 * 1. Resumen: tienda (o «Falta la tienda»), fecha y hora, total, la
 *    comprobación del total (`data-testid="ticket-check"`, con `data-status`:
 *    cuadra, no cuadra, incompleto o pendiente de confirmar, también con el
 *    desglose de IVA), cuántas líneas faltan por revisar y cómo se pagó. Los
 *    avisos de ticket ya guardado o de posible compra duplicada (con su
 *    casilla). La cabecera se edita en «Editar datos del ticket», plegado; si al
 *    guardar falla uno de sus datos (`headerError`), se abre, el error se ve
 *    junto al campo y el foco va a él.
 * 2. «Para revisar»: una tarjeta por línea dudosa o emparejada solo por
 *    parecido (TicketLineCheck). Al resolver una, el foco pasa a la siguiente
 *    tarjeta o, si no queda ninguna, al resumen.
 * 3. «Productos»: una fila por producto (las líneas del mismo producto van
 *    juntas), plegada si todo está bien (nunca con un editor abierto); al
 *    tocarla se abre su editor.
 * 4. Los ajustes generales, con «Confirmar», y lo que no parece un producto,
 *    plegado, con «Añadir».
 *
 * Cualquier edición deja la línea sin confirmar y anota que el dato es manual.
 * No guarda nada: cada cambio llama a `onChange` con el estado nuevo.
 */

const fieldId = (label: string) => `ticket-edit-${label.replace(/\s/g, '-')}`

function TextField({ label, value, onChange, decimal = false, type = 'text', error }: {
  label: string; value: string; onChange: (v: string) => void; decimal?: boolean; type?: string; error?: string
}) {
  return <Field id={fieldId(label)} label={label} error={error}>{control => <input {...control} required={undefined} className="input" type={type}
    inputMode={decimal ? 'decimal' : undefined} value={value} onChange={e => onChange(e.target.value)} />}</Field>
}

/** Dónde está cada dato de la cabecera, para llevar el foco a él. */
const HEADER_FIELD_IDS: Record<HeaderField, string> = {
  store: fieldId('Tienda'), date: 'ticket-date', time: fieldId('Hora de la compra'), total: fieldId('Total del ticket'),
}
/** Si el dato de la cabecera sigue mal (el error se quita en cuanto se arregla). */
function headerFieldWrong(review: ReviewState, field: HeaderField): boolean {
  if (field === 'store') return !review.storeName.trim()
  if (field === 'date') return !isValidISODate(review.date)
  if (field === 'time') return review.time !== '' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(review.time)
  return !readAmount(review.totalText).ok
}

const KIND_LABELS = { new: 'Nuevo', item: 'Ya lo tienes', ignore: 'No se sigue' } as const

/** «2 × 0,95 €», «0,544 kg × 6,75 €/kg» o nada, y el descuento si lo hay. */
function lineDetail(line: ReviewLine): string {
  const { line: value } = lineToInput(line)
  const parts = [
    value.weightKg !== null && value.pricePerKgCents !== null ? `${line.weightText} kg × ${formatEuros(value.pricePerKgCents)}/kg`
      : value.unitPriceCents !== null && value.quantity > 1 ? `${value.quantity} × ${formatEuros(value.unitPriceCents)}` : null,
    value.discountCents > 0 ? `desc. ${formatEuros(value.discountCents)}` : null,
  ]
  return parts.filter(Boolean).join(', ')
}

export function TicketReview({ draft, review, onChange, items, people, previews, segments = [], headerError = null, onRestart }: {
  draft: TicketDraft; review: ReviewState; onChange: (r: ReviewState) => void;
  items: readonly PantryItem[]; people: readonly PantryPerson[]; previews: readonly string[];
  segments?: readonly ShownSegment[];
  /** El dato de la cabecera que ha impedido guardar (cada intento es un objeto nuevo, aunque sea el mismo campo). */
  headerError?: { field: HeaderField; message: string } | null
  onRestart: () => void
}) {
  /** El producto abierto en el editor, y dónde: bajo su tarjeta dudosa o en la lista. */
  const [expanded, setExpanded] = useState<{ key: string; place: 'card' | 'list' } | null>(null)
  const [showProducts, setShowProducts] = useState(false)
  const [editingAdjustment, setEditingAdjustment] = useState<string | null>(null)
  const [showImage, setShowImage] = useState(false)
  const [zoom, setZoom] = useState(false)
  const [source, setSource] = useState<TicketSource | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const summaryRef = useRef<HTMLElement>(null)
  const cardRefs = useRef(new Map<number, HTMLDivElement>())
  /** Tras una acción en una tarjeta: cuál era y en qué orden estaban, para llevar el foco a la siguiente si desaparece. */
  const pendingFocus = useRef<{ position: number; order: number[] } | null>(null)
  const groups = useMemo(() => {
    const map = new Map<string, ReviewLine[]>()
    for (const l of review.lines) map.set(l.key, [...(map.get(l.key) ?? []), l])
    return [...map.entries()]
  }, [review.lines])
  // Cualquier edición deja la línea sin confirmar y anota que el dato es manual; las acciones
  // («Usar 9,90 €», «Confirmar», «Dejar pendiente») dicen ellas mismas cómo queda.
  const setLine = (position: number, change: Partial<ReviewLine>) => onChange({ ...review,
    lines: review.lines.map(l => l.position === position ? { ...l, ...change,
      confirmed: change.confirmed ?? false,
      evidence: 'evidence' in change ? change.evidence
        : l.evidence && !('confirmed' in change) && !('heldPending' in change) ? { ...l.evidence, selectedBy: 'manual' } : l.evidence } : l) })
  const setChoice = (key: string, choice: Choice) => onChange({ ...review, choices: { ...review.choices, [key]: choice },
    lines: review.lines.map(l => l.key === key ? { ...l, associationConfirmed: true } : l) })
  const check = reviewCheck(review)
  const pending = review.lines.filter(l => lineToInput(l).line.reviewStatus === 'pending').length
  // Una tarjeta se queda mientras su editor está abierto (hasta «Listo»), aunque al confirmarla deje de ser dudosa.
  const doubtful = review.lines.filter(l => needsLineCheck(l) || (expanded?.place === 'card' && expanded.key === l.key))
  const toReview = doubtful.filter(l => lineState(l) !== 'confirmado').length
  /** Una acción sobre la tarjeta de `position`: si con ella desaparece, el foco irá a la siguiente (o al resumen). */
  const resolving = (position: number, apply: () => void) => {
    pendingFocus.current = { position, order: doubtful.map(l => l.position) }
    apply()
  }
  useLayoutEffect(() => {
    const pending = pendingFocus.current
    if (!pending) return
    pendingFocus.current = null
    const cardOf = (position: number) => cardRefs.current.get(position)?.querySelector<HTMLElement>('.ticket-line-check')
    // Las tarjetas que aún piden algo (una confirmada puede seguir a la vista si tenía una discrepancia).
    const open = doubtful.filter(l => lineState(l) !== 'confirmado').map(l => l.position)
    const card = cardOf(pending.position)
    if (card && open.includes(pending.position)) {
      // Sigue pendiente (por ejemplo, «Dejar pendiente»): si el botón pulsado ya no está, el foco se queda en la tarjeta.
      if (!card.contains(document.activeElement)) card.focus()
      return
    }
    // Resuelta: a la siguiente tarjeta por resolver o, si no queda ninguna, al resumen.
    const after = pending.order.slice(pending.order.indexOf(pending.position) + 1)
    const next = [...after, ...pending.order].find(p => open.includes(p))
    const target = next === undefined ? summaryRef.current : cardOf(next)
    target?.focus()
  })
  // Un dato de la cabecera impide guardar: se abre «Editar datos del ticket» y el foco va a ese campo.
  const [seenHeaderError, setSeenHeaderError] = useState(headerError)
  if (headerError !== seenHeaderError) {
    setSeenHeaderError(headerError)
    if (headerError) setEditOpen(true)
  }
  useLayoutEffect(() => {
    if (headerError && editOpen) document.getElementById(HEADER_FIELD_IDS[headerError.field])?.focus()
  }, [headerError, editOpen])
  const headerErrorOf = (field: HeaderField) => headerError?.field === field && headerFieldWrong(review, field) ? headerError.message : undefined
  const selectedSegment = source && segments.find(s => s.imageIndex === source.imageIndex && s.segmentIndex === source.segmentIndex)
  /** El producto que se ha propuesto por parecido para la línea, si falta confirmarlo. */
  const guessedProduct = (line: ReviewLine): string | null => {
    const choice = review.choices[line.key]
    return !line.associationConfirmed && choice?.kind === 'item' ? items.find(i => i.id === choice.itemId)?.name ?? null : null
  }
  const titleOf = (key: string, lines: readonly ReviewLine[]) => {
    const choice = review.choices[key]
    return choice.kind === 'item' ? items.find(i => i.id === choice.itemId)?.name ?? 'Producto' : choice.kind === 'new' ? choice.name : lines[0].rawName
  }
  const addLine = (rawName = 'Producto añadido') => {
    const position = review.nextPosition
    const key = `manual-${position}`
    const line = reviewLine({ position, key, rawName, quantity: 1, unitPriceCents: null,
      amountCents: null, discountCents: 0, weightKg: null, pricePerKgCents: null, taxCode: null, flags: [] })
    onChange({ ...review, nextPosition: position + 1, lines: [...review.lines, line],
      choices: { ...review.choices, [key]: { kind: 'new', name: rawName, ownerId: '', frequency: 'semanal' } } })
    setShowProducts(true)
    setExpanded({ key, place: 'list' })
  }
  const total = readAmount(review.totalText)
  // Mientras se escribe, el selector de fecha da valores como «0002-10-28»: solo se enseña una fecha válida.
  const when = [isValidISODate(review.date) ? formatDate(review.date) : null, review.time || null].filter(Boolean).join(' · ')

  /** El editor de un producto: qué producto es y cada una de sus líneas. */
  const editor = (key: string, lines: readonly ReviewLine[]) => {
    const choice = review.choices[key]
    return <div className="ticket-editor">
      <Field id={`product-${key}`} label="Es el producto">{control => <select {...control} className="select"
        value={choice.kind === 'item' ? choice.itemId : choice.kind === 'ignore' ? '__ignore' : '__new'} onChange={e => {
          const value = e.target.value
          setChoice(key, value === '__ignore' ? { kind: 'ignore' } : value === '__new' ? { kind: 'new', name: lines[0].rawName, ownerId: '', frequency: 'semanal' } : { kind: 'item', itemId: value })
        }}><option value="__new">Un producto nuevo</option><option value="__ignore">No seguir esta línea (bolsas, envases…)</option>
        {items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select>}</Field>
      {choice.kind === 'new' && <>
        <TextField label="Nombre del producto nuevo" value={choice.name} onChange={name => setChoice(key, { ...choice, name })} />
        <div className="field-row"><Field id={`owner-${key}`} label="De quién es">{control => <select {...control} className="select" value={choice.ownerId} onChange={e => setChoice(key, { ...choice, ownerId: e.target.value })}>
          <option value="">Compartido</option>{people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}</Field>
          <Field id={`frequency-${key}`} label="Se compra">{control => <select {...control} className="select" value={choice.frequency} onChange={e => setChoice(key, { ...choice, frequency: e.target.value as PantryFrequency })}>
            {PANTRY_FREQUENCIES.map(f => <option key={f} value={f}>{FREQUENCY_LABELS[f]}</option>)}</select>}</Field></div>
      </>}
      {lines.map((line, index) => {
        const suffix = lines.length > 1 ? ` (${index + 1}.ª línea)` : ''
        const calculation = currentCalculation(line)
        const parsed = lineToInput(line)
        return <fieldset className="ticket-line-editor" key={line.position}><legend>Línea {line.position + 1} · {LINE_STATE_LABELS[lineState(line)]}</legend>
          <TextField label={`Nombre en el ticket${suffix}`} value={line.rawName} onChange={rawName => setLine(line.position, { rawName, associationConfirmed: choice.kind !== 'item' })} />
          <div className="field-row">
            <TextField label={`Cantidad${suffix}`} decimal value={line.quantityText} onChange={quantityText => setLine(line.position, { quantityText })} />
            <TextField label={`Precio unitario${suffix}`} decimal value={line.unitPriceText} onChange={unitPriceText => setLine(line.position, { unitPriceText })} />
            <TextField label={`Importe${suffix}`} decimal value={line.amountText} onChange={amountText => setLine(line.position, { amountText })} />
            <TextField label={`Descuento${suffix}`} decimal value={line.discountText} onChange={discountText => setLine(line.position, { discountText })} />
            <TextField label={`Peso (kg)${suffix}`} decimal value={line.weightText} onChange={weightText => setLine(line.position, { weightText })} />
            <TextField label={`Precio por kilo${suffix}`} decimal value={line.pricePerKgText} onChange={pricePerKgText => setLine(line.position, { pricePerKgText })} />
          </div>
          {calculation !== null && <p>Importe calculado: {formatEuros(calculation)}. {calculation !== lineAmount(line) && <button type="button" className="link-btn" onClick={() => setLine(line.position, { amountText: centsToInput(calculation) })}>Usar importe calculado</button>}</p>}
          {line.evidence && <details><summary>Lectura original y dudas</summary><p className="ticket-raw">{line.evidence.text}</p>
            <p>Importe reconocido: {line.evidence.recognizedCents === null ? 'ilegible' : formatEuros(line.evidence.recognizedCents)}</p>
            {line.evidence.reread && <p>Segunda lectura: {line.evidence.reread}</p>}
            {line.evidence.issues.map(i => <p key={i}>{i}</p>)}</details>}
          {parsed.errors.map(e => <p role="alert" key={e}>{e}</p>)}
          {!line.associationConfirmed && <p className="notice notice--warning">La asociación es por parecido. Confírmala o elige otro producto.</p>}
          <label className="checkbox"><input type="checkbox" checked={line.confirmed} onChange={e => setLine(line.position, { confirmed: e.target.checked, associationConfirmed: e.target.checked })} />Confirmar línea {line.rawName}</label>
          <label className="checkbox"><input type="checkbox" checked={line.occasional} onChange={e => setLine(line.position, { occasional: e.target.checked })} />Compra para una ocasión{suffix}</label>
          <div className="ticket-review__links">
            {line.evidence?.source && previews.length > 0 && <button type="button" className="link-btn" onClick={() => { setSource(line.evidence!.source!); setShowImage(true) }}>Ver esta línea en la imagen</button>}
            <button type="button" className="link-btn" onClick={() => onChange({ ...review, lines: review.lines.filter(l => l.position !== line.position) })}>Eliminar línea {line.position + 1}</button>
          </div>
        </fieldset>
      })}
      <button type="button" className="btn" onClick={() => {
        const card = expanded?.place === 'card' ? doubtful.find(l => l.key === key)?.position ?? null : null
        if (card !== null) resolving(card, () => setExpanded(null))
        else setExpanded(null)
      }}>Listo</button>
    </div>
  }

  return <div className={`ticket-review${showImage ? ' ticket-review--compare' : ''}`}>
    <div className="ticket-review__form">
      <section className="ticket-summary" aria-label="Resumen del ticket" ref={summaryRef} tabIndex={-1}>
        <p className="ticket-summary__line">{review.storeName.trim() ? <strong>{review.storeName}</strong>
          : <strong className="ticket-summary__missing">Falta la tienda</strong>}{when && <span> · {when}</span>}
          <strong className="ticket-summary__total">{total.ok && total.cents !== null ? formatEuros(total.cents) : 'sin total'}</strong></p>
        <div aria-live="polite" className="stack stack--tight">
          {draft.duplicate && <p role="alert" className="notice notice--error">Este ticket ya está guardado ({draft.duplicate.storeName}, {formatDate(draft.duplicate.date)}). No se puede guardar dos veces.</p>}
          {draft.possibleDuplicate && !draft.duplicate && <label className="checkbox notice notice--warning"><input type="checkbox" checked={review.distinctPurchase}
            onChange={e => onChange({ ...review, distinctPurchase: e.target.checked })} />Hay otra compra con la misma fecha, hora y total. Confirmo que esta es otra compra.</label>}
          <p className={`ticket-check notice ${check.status === 'cuadra' ? 'ticket-check--ok' : 'notice--warning'}`} data-testid="ticket-check" data-status={check.status}>
            <span><strong>{CHECK_LABELS[check.status]}:</strong>{' '}
              {check.status === 'cuadra' && <>{review.lines.length} líneas suman {formatEuros(check.linesTotalCents)}{review.adjustments.length > 0 ? ' incluyendo ajustes' : ''}.</>}
              {check.status === 'pendiente' && <>{review.lines.length} líneas suman {formatEuros(check.linesTotalCents)}, igual que el total, pero {check.pending === 1 ? 'una línea tiene' : `${check.pending} líneas tienen`} datos sin confirmar.</>}
              {check.status === 'no_cuadra' && <>suma {formatEuros(check.linesTotalCents)}; diferencia {formatEuros(check.differenceCents!)}.</>}
              {check.status === 'incompleto' && <>{check.unreadable === 1 ? 'falta un importe' : `faltan ${check.unreadable} importes`}; la suma ({formatEuros(check.linesTotalCents)}) no se puede comprobar con el total.</>}
              {check.status === 'sin_total' && <>suma {formatEuros(check.linesTotalCents)}.</>}
              {pending > 0 && ` ${pending === 1 ? 'Una línea pendiente no actualizará' : `${pending} líneas pendientes no actualizarán`} la despensa.`}</span>
          </p>
          {toReview > 0 && <p className="ticket-summary__todo"><strong>{toReview === 1 ? 'Falta 1 línea por revisar' : `Faltan ${toReview} líneas por revisar`}</strong></p>}
          {check.taxMismatches.map(m => <p className="notice notice--warning small" key={m.code}>El desglose de IVA {m.code} no coincide con sus artículos (diferencia {formatEuros(m.differenceCents)}): alguno de esos importes puede estar mal leído.</p>)}
        </div>
        {(() => {
          const notes = (draft.ticket.issues ?? []).filter(i => !/Los importes no cuadran|La suma coincide|desglose de IVA/.test(i))
          return notes.length > 0 && <details className="small ticket-summary__notes"><summary>Avisos de la lectura ({notes.length})</summary>
            <ul>{notes.map(i => <li key={i}>{i}</li>)}</ul></details>
        })()}
        {draft.ticket.paymentMethod && <p className="muted small">Pagado con {draft.ticket.paymentMethod}.</p>}
        <details className="ticket-summary__edit" open={editOpen} onToggle={e => setEditOpen(e.currentTarget.open)}><summary>Editar datos del ticket</summary>
          <div className="field-row">
            <TextField label="Tienda" value={review.storeName} onChange={storeName => onChange({ ...review, storeName })} error={headerErrorOf('store')} />
            <Field id="ticket-date" label="Fecha de la compra" error={headerErrorOf('date')}>{control => <DateInput control={control} value={review.date} onChange={date => onChange({ ...review, date })} />}</Field>
            <TextField label="Hora de la compra" type="time" value={review.time} onChange={time => onChange({ ...review, time })} error={headerErrorOf('time')} />
            <TextField label="Total del ticket" decimal value={review.totalText} onChange={totalText => onChange({ ...review, totalText })} error={headerErrorOf('total')} />
          </div>
          <TextField label="Establecimiento o dirección" value={review.address} onChange={address => onChange({ ...review, address })} />
        </details>
        <div className="ticket-review__links">
          {previews.length > 0 && <button type="button" className="link-btn" aria-expanded={showImage} onClick={() => { setShowImage(!showImage); setSource(null) }}>{showImage ? 'Ocultar la imagen' : 'Ver la imagen para comparar'}</button>}
          <button type="button" className="link-btn" onClick={onRestart}>Volver a empezar</button>
        </div>
      </section>

      {doubtful.length > 0 && <section className="ticket-section" aria-label="Para revisar">
        <h3 className="subsection-title">Para revisar ({doubtful.length})</h3>
        <div className="ticket-cards">
          {doubtful.map(line => <div key={line.position} ref={el => { if (el) cardRefs.current.set(line.position, el); else cardRefs.current.delete(line.position) }}>
            <TicketLineCheck line={line} segments={segments} product={guessedProduct(line)}
              onChange={change => resolving(line.position, () => setLine(line.position, change))}
              onConfirmProduct={() => resolving(line.position, () => setChoice(line.key, review.choices[line.key]))}
              onEdit={() => setExpanded({ key: line.key, place: 'card' })} />
            {expanded?.place === 'card' && expanded.key === line.key && doubtful.find(l => l.key === line.key) === line &&
              editor(line.key, review.lines.filter(l => l.key === line.key))}
          </div>)}
        </div>
      </section>}

      <section className="ticket-section" aria-label="Productos">
        <h3 className="subsection-title">Productos ({groups.length})</h3>
        {doubtful.length === 0 && !showProducts && expanded?.place !== 'list' ? <button type="button" className="link-btn" onClick={() => setShowProducts(true)}>Ver los productos ({groups.length})</button> :
          <ul className="ticket-rows">{groups.map(([key, lines]) => {
            const choice = review.choices[key]
            const title = titleOf(key, lines)
            const amounts = lines.map(l => lineAmount(l))
            const sum = amounts.some(a => a === null) ? null : lines.reduce((s, l) => s + (lineAmount(l) ?? 0) - lineToInput(l).line.discountCents, 0)
            const states = lines.map(lineState)
            const meta = [
              lines.length > 1 ? `${lines.length} líneas` : lineDetail(lines[0]),
              KIND_LABELS[choice.kind],
              nameKey(title) !== nameKey(lines[0].rawName) ? `En el ticket: ${lines[0].rawName}` : '',
              states.includes('pendiente') ? 'Pendiente' : states.includes('sugerido') ? 'Para confirmar' : '',
            ].filter(Boolean).join(' · ')
            const open = expanded?.place === 'list' && expanded.key === key
            return <li key={key} className={`ticket-row${choice.kind === 'ignore' ? ' ticket-row--ignored' : ''}`}>
              <button type="button" className="ticket-row__main" aria-expanded={open} onClick={() => { setShowProducts(true); setExpanded(open ? null : { key, place: 'list' }) }}>
                <span className="ticket-row__text"><strong>{title}</strong><span className="ticket-row__meta">{meta}</span></span>
                <span className="ticket-row__amount">{sum === null ? 'sin importe' : formatEuros(sum)}</span>
              </button>
              {open && editor(key, lines)}
            </li>
          })}</ul>}
        <button type="button" className="btn" onClick={() => addLine()}>Añadir producto omitido</button>
      </section>

      {review.adjustments.length > 0 && <section className="ticket-section" aria-label="Ajustes generales">
        <h3 className="subsection-title">Ajustes generales</h3>
        <ul className="ticket-rows">{review.adjustments.map((a, index) => {
          const update = (change: Partial<typeof a>) => onChange({ ...review, adjustments: review.adjustments.map(x => x.id === a.id ? { ...x, ...change } : x) })
          const amount = readAmount(a.amountText)
          return <li key={a.id} className="ticket-row ticket-adjustment">
            <div className="ticket-row__main ticket-adjustment__head">
              <span className="ticket-row__text"><strong>{a.label}</strong><span className="ticket-row__meta">{a.needsReview ? 'Para confirmar' : 'Confirmado'}</span></span>
              <span className="ticket-row__amount">{amount.ok && amount.cents !== null ? formatEuros(amount.cents) : 'sin importe'}</span>
            </div>
            <div className="ticket-adjustment__actions">
              {a.needsReview && <button type="button" className="btn btn--primary" aria-label={`Confirmar ajuste ${index + 1}`} onClick={() => update({ needsReview: false })}>Confirmar</button>}
              <button type="button" className="btn" aria-label={`Editar ajuste ${index + 1}`} aria-expanded={editingAdjustment === a.id} onClick={() => setEditingAdjustment(editingAdjustment === a.id ? null : a.id)}>Editar</button>
            </div>
            {editingAdjustment === a.id && <fieldset className="ticket-line-editor"><legend>Ajuste {index + 1}</legend>
              <TextField label={`Concepto del ajuste ${index + 1}`} value={a.label} onChange={label => update({ label, needsReview: true })} />
              <TextField label={`Importe del ajuste ${index + 1}`} decimal value={a.amountText} onChange={amountText => update({ amountText, needsReview: true })} />
              <p className="muted small">Los descuentos generales llevan signo negativo y no modifican el precio de un producto.</p>
              <Field id={`adjustment-${a.id}`} label={`Asignar descuento a un artículo (${index + 1})`}>{control => <select {...control} className="select" value="" onChange={e => {
                const position = Number(e.target.value); const r = readAmount(a.amountText)
                if (!r.ok || r.cents === null || r.cents >= 0) return
                setEditingAdjustment(null)
                onChange({ ...review, adjustments: review.adjustments.filter(x => x.id !== a.id), lines: review.lines.map(l => l.position === position ?
                  { ...l, confirmed: false, discountText: centsToInput(lineToInput(l).line.discountCents - r.cents!) } : l) })
              }}><option value="">Mantener como ajuste general</option>{review.lines.map(l => <option value={l.position} key={l.position}>{l.position + 1}. {l.rawName}</option>)}</select>}</Field>
              <button type="button" className="link-btn" onClick={() => { setEditingAdjustment(null); onChange({ ...review, adjustments: review.adjustments.filter(x => x.id !== a.id) }) }}>Eliminar ajuste {index + 1}</button>
            </fieldset>}
          </li>
        })}</ul>
      </section>}
      <button type="button" className="link-btn" onClick={() => {
        const id = `manual-adjustment-${Date.now()}`
        onChange({ ...review, adjustments: [...review.adjustments, { id, label: 'Descuento general', kind: 'other', amountCents: null, amountText: '', needsReview: true }] })
        setEditingAdjustment(id)
      }}>Añadir ajuste general</button>

      {(draft.ticket.nonProducts ?? []).length > 0 && <details className="ticket-section ticket-nonproducts">
        <summary>Texto que no parece un producto ({draft.ticket.nonProducts!.length})</summary>
        <p className="muted small">No cuenta en el ticket. Si alguna línea era un producto, añádela.</p>
        <ul className="ticket-rows">{draft.ticket.nonProducts!.map((line, index) => <li key={`${index}-${line.text}`} className="ticket-row">
          <div className="ticket-row__main"><span className="ticket-row__text ticket-raw">{line.text}</span>
            <button type="button" className="btn" aria-label={`Añadir «${line.text}» como producto`} onClick={() => addLine(line.text.slice(0, 80))}>Añadir</button></div>
        </li>)}</ul>
      </details>}
    </div>
    {showImage && previews.length > 0 && <aside className="ticket-comparison" aria-label="Imagen del ticket">
      <div className="ticket-review__links"><button type="button" className="link-btn" onClick={() => setZoom(!zoom)}>{zoom ? 'Reducir imagen' : 'Ampliar imagen'}</button>
        <button type="button" className="link-btn" onClick={() => setSource(null)}>Ver originales completos</button></div>
      <div className="ticket-preview" tabIndex={0}>
        {selectedSegment && source ? <div className="ticket-image-region" style={{ width: zoom ? '200%' : '100%' }}>
          <img src={selectedSegment.url} alt="Zona del ticket de la línea seleccionada" />
          <span className="ticket-image-highlight" style={{ left: `${100 * source.box.x0 / source.width}%`, width: `${100 * (source.box.x1 - source.box.x0) / source.width}%`,
            top: `${100 * (source.box.y0 - selectedSegment.offsetY) / Math.min(4096, selectedSegment.fullHeight - selectedSegment.offsetY)}%`,
            height: `${100 * (source.box.y1 - source.box.y0) / Math.min(4096, selectedSegment.fullHeight - selectedSegment.offsetY)}%` }} />
        </div> : previews.map((src, i) => <img style={{ width: zoom ? '200%' : '100%', maxWidth: 'none' }} key={src} src={src} alt={`Imagen original ${i + 1} del ticket`} />)}
      </div>
    </aside>}
  </div>
}
