import { useEffect, useRef, useState } from 'react'
import { formatEuros } from '#shared/common/money.ts'
import { lineProblems } from '#shared/tickets/ticketArithmetic.ts'
import type { TicketAmountOption, TicketSegment, TicketSource } from '#shared/tickets/types.ts'
import { chooseAmountChange, currentCalculation, lineAmount, lineState, lineToInput, LINE_STATE_LABELS, type ReviewLine } from './ticketReviewState.ts'

/**
 * La tarjeta de una línea dudosa del ticket, compacta para el móvil: el
 * recorte de la línea entera (todo el ancho del papel, importe incluido), lo
 * leído frente a lo calculado, un botón por opción («Usar 9,90 €», «Editar»,
 * «Dejar pendiente») y la explicación plegada en «Por qué».
 */

/** Una franja preparada como URL de datos: PNG si es de pantalla, JPEG si es una foto. */
export const segmentUrl = (segment: TicketSegment) => `data:image/${segment.image.startsWith('iVBOR') ? 'png' : 'jpeg'};base64,${segment.image}`

/**
 * La línea en la imagen, a todo el ancho del papel (el nombre y el importe a la
 * vez) y ajustada al ancho de la tarjeta. Las coordenadas vienen del OCR, en
 * píxeles de la franja que se envió a leer, así que el recorte es exacto.
 * «Ampliar» la muestra al doble, empezando por el final: los importes.
 */
export function LineSnippet({ source, segments, label }: { source: TicketSource; segments: readonly TicketSegment[]; label: string }) {
  const [zoom, setZoom] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const segment = segments.find(s => s.imageIndex === source.imageIndex && s.segmentIndex === source.segmentIndex)
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollLeft = zoom ? el.scrollWidth : 0
  }, [zoom])
  if (!segment) return null
  const stripHeight = Math.min(4096, segment.fullHeight - segment.offsetY)
  const lineHeight = source.box.y1 - source.box.y0
  const pad = Math.max(4, Math.round(lineHeight * 0.3))
  const y0 = Math.max(0, source.box.y0 - segment.offsetY - pad)
  const y1 = Math.min(stripHeight, source.box.y1 - segment.offsetY + pad)
  const height = Math.max(1, y1 - y0)
  return <div className="ticket-snippet">
    <div className="ticket-snippet__scroll" ref={scroller} tabIndex={0} role="img" aria-label={label}>
      <div className="ticket-snippet__frame" style={{ width: zoom ? '200%' : '100%', aspectRatio: `${source.width} / ${height}` }}>
        <img src={segmentUrl(segment)} alt="" style={{ top: `${-100 * y0 / height}%` }} />
      </div>
    </div>
    <button type="button" className="link-btn ticket-snippet__zoom" aria-pressed={zoom} onClick={() => setZoom(!zoom)}>{zoom ? 'Reducir' : 'Ampliar'}</button>
  </div>
}

/** El importe tal como lo leyó el OCR («2,939»), si tenía cifras de más; si no, en euros. */
function printedAmount(normalized: string | undefined, cents: number): string {
  const tokens = normalized?.match(/-?\d{1,4}[,.]\d{2,3}(?![\d,.]*[xX×*])/g) ?? []
  const last = tokens.at(-1)
  return last && /[,.]\d{3}$/.test(last) ? `«${last.replace('.', ',')}»` : formatEuros(cents)
}

const ORIGIN_SUFFIX: Record<TicketAmountOption['origin'], string> = { calculation: '', read: ' (leído)', reread: ' (2.ª lectura)' }

export function TicketLineCheck({ line, segments, onChange, onEdit }: {
  line: ReviewLine
  segments: readonly TicketSegment[]
  onChange: (change: Partial<ReviewLine>) => void
  onEdit: () => void
}) {
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
  const why = [
    ...(evidence?.discrepancy ? [evidence.discrepancy.explanation, ...evidence.discrepancy.reasons] : []),
    ...otherIssues,
    ...problems.filter(p => !mismatch || !/no coincide/.test(p)),
  ]
  return <div className={`ticket-line-check ticket-line-check--${state}`} role="group" aria-label={`Comprobar ${line.rawName}`}>
    <div className="ticket-line-check__head">
      <strong>{line.rawName}</strong>
      <span className={`ticket-state ticket-state--${state}`}>{LINE_STATE_LABELS[state]}</span>
    </div>
    {evidence?.source && <LineSnippet source={evidence.source} segments={segments} label={`Línea ${line.rawName} en la imagen del ticket`} />}
    <p className="ticket-line-check__facts">{facts.join(' · ')}{mismatch && <strong className="ticket-line-check__warning"> · no coincide</strong>}</p>
    <div className="ticket-line-check__actions">
      {showOptions && options.map(o => <button key={`${o.origin}-${o.cents}`} type="button"
        className={`btn${o.origin === 'calculation' ? ' btn--primary' : ''}`}
        onClick={() => onChange(chooseAmountChange(line, o))}>Usar {formatEuros(o.cents)}{ORIGIN_SUFFIX[o.origin]}</button>)}
      {!showOptions && state === 'sugerido' && current !== null &&
        <button type="button" className="btn btn--primary" onClick={() => onChange({ confirmed: true, heldPending: false, associationConfirmed: true })}>
          Confirmar {formatEuros(current)}</button>}
      <button type="button" className="btn" onClick={onEdit}>Editar</button>
      <button type="button" className="btn" aria-pressed={line.heldPending}
        onClick={() => onChange({ heldPending: !line.heldPending, confirmed: false })}>{line.heldPending ? 'Quitar de pendientes' : 'Dejar pendiente'}</button>
    </div>
    {state !== 'confirmado' && why.length > 0 && <details className="small ticket-line-check__why"><summary>Por qué</summary>
      <ul>{why.map(reason => <li key={reason}>{reason}</li>)}</ul>
      {evidence && <p className="ticket-raw">OCR: {evidence.text}{evidence.reread ? ` · 2.ª lectura: ${evidence.reread}` : ''}</p>}
    </details>}
    {state === 'pendiente' && <p className="small muted">Se guarda en el ticket, pero no cambia la despensa hasta que esté confirmada.</p>}
  </div>
}
