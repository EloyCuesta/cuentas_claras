import { useId, useLayoutEffect, useRef, useState } from 'react'
import { formatEuros } from '#shared/common/money.ts'
import { lineProblems } from '#shared/tickets/ticketArithmetic.ts'
import type { TicketAmountOption, TicketSegment, TicketSource } from '#shared/tickets/types.ts'
import { chooseAmountChange, currentCalculation, lineAmount, lineState, lineToInput, LINE_STATE_LABELS, type ReviewLine } from './ticketReviewState.ts'

/**
 * La tarjeta de una línea dudosa del ticket, compacta para el móvil: el
 * recorte de la línea entera (todo el ancho del papel, importe incluido), lo
 * leído frente a lo calculado (con «Por qué», que despliega la explicación, en
 * la misma fila), un botón por opción («Usar 9,90 €», «Editar», «Dejar
 * pendiente»). Si el producto se
 * emparejó solo por parecido, la tarjeta pregunta si es ese («Sí, es …»).
 */

/** Una franja leída, para enseñarla: su URL local (de un Blob) en lugar de la imagen en base64. */
export type ShownSegment = Omit<TicketSegment, 'image'> & { url: string }

/** Alto, en píxeles de pantalla, al que se enseña el renglón al abrir la tarjeta: las mayúsculas quedan en unos 15-16 px. */
const READABLE_LINE_PX = 22

/**
 * La línea en la imagen, a todo el ancho del papel (el nombre y el importe a la
 * vez). Las coordenadas vienen del OCR, en píxeles de la franja que se envió a
 * leer, así que el recorte es exacto. Se abre ampliada lo justo para que las
 * letras se lean (por la altura del renglón) y desplazada hasta el final, donde
 * está el importe; «Reducir» la ajusta al ancho de la tarjeta, y
 * «Ampliar» vuelve a ampliarla (al doble, si ajustada ya se leía).
 */
export function LineSnippet({ source, segments, label }: { source: TicketSource; segments: readonly ShownSegment[]; label: string }) {
  /** Lo que ha pedido la persona: nada (se abre legible), la línea entera o ampliada. */
  const [view, setView] = useState<'auto' | 'entera' | 'ampliada'>('auto')
  const [width, setWidth] = useState(0)
  const scroller = useRef<HTMLDivElement>(null)
  const segment = segments.find(s => s.imageIndex === source.imageIndex && s.segmentIndex === source.segmentIndex)
  const lineHeight = Math.max(1, source.box.y1 - source.box.y0)
  // Cuánto hay que ampliar la línea (ajustada al ancho) para que el renglón mida READABLE_LINE_PX. Si ya se lee, «Ampliar» la deja al doble.
  const readable = width > 0 ? Math.min(6, Math.max(1, READABLE_LINE_PX * source.width / (lineHeight * width))) : 1
  const zoom = view === 'entera' ? 1 : readable > 1.15 ? readable : view === 'ampliada' ? 2 : 1
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    setWidth(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setWidth(el.clientWidth))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  // Ampliada, se ve el final de la línea: el importe.
  useLayoutEffect(() => {
    const el = scroller.current
    if (el) el.scrollLeft = zoom > 1 ? el.scrollWidth : 0
  }, [zoom])
  if (!segment) return null
  const stripHeight = Math.min(4096, segment.fullHeight - segment.offsetY)
  const pad = Math.max(4, Math.round(lineHeight * 0.3))
  const y0 = Math.max(0, source.box.y0 - segment.offsetY - pad)
  const y1 = Math.min(stripHeight, source.box.y1 - segment.offsetY + pad)
  const height = Math.max(1, y1 - y0)
  return <div className="ticket-snippet">
    <div className="ticket-snippet__scroll" ref={scroller} tabIndex={0} role="img" aria-label={label}>
      <div className="ticket-snippet__frame" style={{ width: `${zoom * 100}%`, aspectRatio: `${source.width} / ${height}` }}>
        <img src={segment.url} alt="" style={{ top: `${-100 * y0 / height}%` }} />
      </div>
    </div>
    <button type="button" className="btn btn--small ticket-snippet__zoom" aria-pressed={zoom > 1}
      onClick={() => setView(zoom > 1 ? 'entera' : 'ampliada')}>{zoom > 1 ? 'Reducir' : 'Ampliar'}</button>
  </div>
}

/** El importe tal como lo leyó el OCR («2,939»), si tenía cifras de más; si no, en euros. */
function printedAmount(normalized: string | undefined, cents: number): string {
  const tokens = normalized?.match(/-?\d{1,4}[,.]\d{2,3}(?![\d,.]*[xX×*])/g) ?? []
  const last = tokens.at(-1)
  return last && /[,.]\d{3}$/.test(last) ? `«${last.replace('.', ',')}»` : formatEuros(cents)
}

const ORIGIN_SUFFIX: Record<TicketAmountOption['origin'], string> = { calculation: '', read: ' (leído)', reread: ' (2.ª lectura)' }

export function TicketLineCheck({ line, segments, product, onChange, onConfirmProduct, onEdit }: {
  line: ReviewLine
  segments: readonly ShownSegment[]
  /** El producto con el que se ha emparejado por parecido, si falta confirmarlo. */
  product: string | null
  onChange: (change: Partial<ReviewLine>) => void
  onConfirmProduct: () => void
  onEdit: () => void
}) {
  const [showWhy, setShowWhy] = useState(false)
  const whyId = `ticket-why-${useId()}`
  const state = lineState(line)
  const parsed = lineToInput(line)
  const evidence = line.evidence
  const calculation = currentCalculation(line)
  const current = lineAmount(line)
  const weighted = parsed.line.weightKg !== null && parsed.line.pricePerKgCents !== null
  const problems = parsed.errors.length ? parsed.errors : lineProblems(parsed.line)
  const mismatch = calculation !== null && current !== null && calculation !== current
  const recognized = evidence?.recognizedCents ?? null
  const options = (evidence?.options ?? []).filter((o, i, all) => all.findIndex(x => x.cents === o.cents) === i)
  // Si ya se ha elegido o escrito un importe y es coherente, las opciones ya no hacen falta.
  const showOptions = state !== 'confirmado' && options.length > 0
  const otherIssues = (evidence?.issues ?? []).filter(i => i !== evidence?.discrepancy?.explanation)
  const formula = weighted ? `${line.weightText} kg × ${formatEuros(parsed.line.pricePerKgCents!)}/kg`
    : parsed.line.unitPriceCents !== null ? `${line.quantityText} × ${formatEuros(parsed.line.unitPriceCents)}` : null
  const facts = [
    recognized !== null ? `Leído ${printedAmount(evidence?.normalized, recognized)}` : 'Sin importe leído',
    formula && calculation !== null ? `${formula} = ${formatEuros(calculation)}` : null,
    current !== recognized ? `Se guardará ${current === null ? 'sin importe' : formatEuros(current)}` : null,
    line.discountText && parsed.line.discountCents > 0 ? `Descuento ${formatEuros(parsed.line.discountCents)}` : null,
  ].filter(Boolean)
  // Sin repetir: una misma explicación puede llegar por dos caminos.
  const why = [...new Set([
    ...(evidence?.discrepancy ? [evidence.discrepancy.explanation, ...evidence.discrepancy.reasons] : []),
    ...otherIssues,
    ...problems.filter(p => !mismatch || !/no coincide/.test(p)),
  ])]
  return <div className={`ticket-line-check ticket-line-check--${state}`} role="group" aria-label={`Comprobar ${line.rawName}`} tabIndex={-1}>
    <div className="ticket-line-check__head">
      <strong>{line.rawName}</strong>
      <span className={`ticket-state ticket-state--${state}`}>{LINE_STATE_LABELS[state]}</span>
    </div>
    {evidence?.source && <LineSnippet source={evidence.source} segments={segments} label={`Línea ${line.rawName} en la imagen del ticket`} />}
    <div className="ticket-line-check__facts-row">
      <p className="ticket-line-check__facts">{facts.join(' · ')}{mismatch && <strong className="ticket-line-check__warning"> · no coincide</strong>}</p>
      {state !== 'confirmado' && why.length > 0 && <button type="button" className="link-btn ticket-line-check__why-toggle" aria-expanded={showWhy}
        aria-controls={whyId} onClick={() => setShowWhy(!showWhy)}>Por qué</button>}
    </div>
    {/* Plegada como un <details>: en la página, pero oculta hasta pulsar «Por qué». */}
    {state !== 'confirmado' && why.length > 0 && <div className="small ticket-line-check__why" id={whyId} hidden={!showWhy}>
      <ul>{why.map(reason => <li key={reason}>{reason}</li>)}</ul>
      {evidence && <p className="ticket-raw">OCR: {evidence.text}{evidence.reread ? ` · 2.ª lectura: ${evidence.reread}` : ''}</p>}
    </div>}
    {product !== null && <p className="ticket-line-check__product">Se parece a tu producto <strong>{product}</strong>. ¿Es el mismo?</p>}
    <div className="ticket-line-check__actions">
      {product !== null && <button type="button" className="btn btn--primary" onClick={onConfirmProduct}>Sí, es {product}</button>}
      {showOptions && options.map(o => <button key={`${o.origin}-${o.cents}`} type="button"
        className={`btn${o.origin === 'calculation' && product === null ? ' btn--primary' : ''}`}
        onClick={() => onChange(chooseAmountChange(line, o))}>Usar {formatEuros(o.cents)}{ORIGIN_SUFFIX[o.origin]}</button>)}
      {!showOptions && state === 'sugerido' && current !== null &&
        <button type="button" className="btn btn--primary" onClick={() => onChange({ confirmed: true, heldPending: false, associationConfirmed: true })}>
          Confirmar {formatEuros(current)}</button>}
      <button type="button" className="btn" onClick={onEdit}>Editar</button>
      <button type="button" className="btn" aria-pressed={line.heldPending}
        onClick={() => onChange({ heldPending: !line.heldPending, confirmed: false })}>{line.heldPending ? 'Quitar de pendientes' : 'Dejar pendiente'}</button>
    </div>
    {state === 'pendiente' && <p className="small muted">Se guarda en el ticket, pero no cambia la despensa hasta que esté confirmada.</p>}
  </div>
}
