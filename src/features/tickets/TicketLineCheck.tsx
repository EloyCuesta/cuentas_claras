import { useEffect, useRef } from 'react'
import { formatEuros } from '#shared/common/money.ts'
import { lineProblems } from '#shared/tickets/ticketArithmetic.ts'
import type { TicketAmountOption, TicketSegment, TicketSource } from '#shared/tickets/types.ts'
import { chooseAmountChange, currentCalculation, lineAmount, lineState, lineToInput, LINE_STATE_LABELS, type ReviewLine } from './ticketReviewState.ts'

/**
 * La comprobación visible de una línea dudosa del ticket: su trozo de imagen,
 * lo que leyó el OCR, lo calculado, por qué no coinciden y las tres acciones
 * («Usar 9,90 €», «Editar» y «Dejar pendiente»).
 */

/** Altura (px CSS) a la que se muestra la línea: legible también en un móvil. */
const SNIPPET_HEIGHT = 52

/**
 * El trozo de la imagen donde está una línea, a una altura legible. Las
 * coordenadas vienen del OCR (en píxeles de la imagen preparada) y la franja
 * es la misma que se envió a leer, así que el recorte es exacto. Si no cabe a
 * lo ancho se puede desplazar, y empieza mostrando el final: los importes.
 */
export function LineSnippet({ source, segments, label }: { source: TicketSource; segments: readonly TicketSegment[]; label: string }) {
  const scroller = useRef<HTMLDivElement>(null)
  const segment = segments.find(s => s.imageIndex === source.imageIndex && s.segmentIndex === source.segmentIndex)
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [segment])
  if (!segment) return null
  const stripHeight = Math.min(4096, segment.fullHeight - segment.offsetY)
  const lineHeight = source.box.y1 - source.box.y0
  const pad = Math.max(4, Math.round(lineHeight * 0.25))
  const y0 = Math.max(0, source.box.y0 - segment.offsetY - pad)
  const y1 = Math.min(stripHeight, source.box.y1 - segment.offsetY + pad)
  const x0 = Math.max(0, source.box.x0 - pad * 2)
  const x1 = Math.min(source.width, source.box.x1 + pad * 2)
  const scale = SNIPPET_HEIGHT / Math.max(1, y1 - y0)
  return <div className="ticket-snippet" ref={scroller} tabIndex={0} aria-label={label} role="img">
    <div className="ticket-snippet__frame" style={{ width: `${Math.round((x1 - x0) * scale)}px`, height: `${SNIPPET_HEIGHT}px` }}>
      <img src={`data:image/jpeg;base64,${segment.image}`} alt="" style={{
        width: `${Math.round(source.width * scale)}px`, left: `${-Math.round(x0 * scale)}px`, top: `${-Math.round(y0 * scale)}px` }} />
    </div>
  </div>
}

/** El importe tal como lo leyó el OCR («2,939»), si tenía cifras de más; si no, en euros. */
function printedAmount(normalized: string | undefined, cents: number): string {
  const tokens = normalized?.match(/-?\d{1,4}[,.]\d{2,3}(?![\d,.]*[xX×*])/g) ?? []
  const last = tokens.at(-1)
  return last && /[,.]\d{3}$/.test(last) ? `«${last.replace('.', ',')}»` : formatEuros(cents)
}

const ORIGIN_SUFFIX: Record<TicketAmountOption['origin'], string> = { calculation: '', read: ' (leído)', reread: ' (2.ª lectura)' }

/**
 * Comprobación visible de una línea dudosa, sin tener que abrir el editor:
 * cantidad, precio, lo que leyó el OCR, lo que da la multiplicación, por qué
 * no coinciden y qué hacer («Usar 9,90 €», «Editar», «Dejar pendiente»).
 */
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
  return <div className={`ticket-line-check ticket-line-check--${state}`} role="group" aria-label={`Comprobar ${line.rawName}`}>
    <div className="ticket-line-check__head">
      <strong>{line.rawName}</strong>
      <span className={`ticket-state ticket-state--${state}`}>{LINE_STATE_LABELS[state]}</span>
    </div>
    {evidence?.source && <LineSnippet source={evidence.source} segments={segments} label={`Línea ${line.rawName} en la imagen del ticket`} />}
    <dl className="ticket-line-check__facts">
      {weighted ? <>
        <div><dt>Peso</dt><dd>{line.weightText} kg</dd></div>
        <div><dt>Precio por kilo</dt><dd>{formatEuros(parsed.line.pricePerKgCents!)}/kg</dd></div>
      </> : <>
        <div><dt>Cantidad</dt><dd>{line.quantityText}</dd></div>
        {parsed.line.unitPriceCents !== null && <div><dt>Precio unitario</dt><dd>{formatEuros(parsed.line.unitPriceCents)}</dd></div>}
      </>}
      {recognized !== null && <div><dt>OCR</dt><dd>{printedAmount(evidence?.normalized, recognized)}</dd></div>}
      {calculation !== null && <div><dt>Calculado</dt><dd>{formatEuros(calculation)}</dd></div>}
      <div><dt>Se guardará</dt><dd>{current === null ? 'sin importe' : formatEuros(current)}</dd></div>
    </dl>
    {mismatch && <p className="ticket-line-check__warning">
      <span aria-hidden="true">⚠ </span>{weighted ? 'El importe no coincide con el peso multiplicado por el precio por kilo.'
        : 'El importe reconocido no coincide con el precio unitario multiplicado por la cantidad.'}</p>}
    {evidence?.discrepancy && state !== 'confirmado' && <p className="small">{evidence.discrepancy.explanation}</p>}
    {evidence?.discrepancy && evidence.discrepancy.reasons.length > 0 && state !== 'confirmado' &&
      <details className="small"><summary>Por qué</summary><ul>{evidence.discrepancy.reasons.map(r => <li key={r}>{r}</li>)}</ul>
        <p className="ticket-raw">OCR: {evidence.text}{evidence.reread ? ` · 2.ª lectura: ${evidence.reread}` : ''}</p></details>}
    {state !== 'confirmado' && otherIssues.map(i => <p className="small muted" key={i}>{i}</p>)}
    {state !== 'confirmado' && problems.filter(p => !mismatch || !/no coincide/.test(p)).map(p => <p className="small" role="note" key={p}>{p}</p>)}
    <div className="ticket-line-check__actions">
      {showOptions && options.map(o => <button key={`${o.origin}-${o.cents}`} type="button"
        className={`btn btn--small${o.origin === 'calculation' ? ' btn--primary' : ''}`}
        onClick={() => onChange(chooseAmountChange(line, o))}>Usar {formatEuros(o.cents)}{ORIGIN_SUFFIX[o.origin]}</button>)}
      {!showOptions && state === 'sugerido' && current !== null &&
        <button type="button" className="btn btn--small" onClick={() => onChange({ confirmed: true, heldPending: false, associationConfirmed: true })}>
          Confirmar {formatEuros(current)}</button>}
      <button type="button" className="btn btn--small" onClick={onEdit}>Editar</button>
      <button type="button" className="btn btn--small" aria-pressed={line.heldPending}
        onClick={() => onChange({ heldPending: !line.heldPending, confirmed: false })}>{line.heldPending ? 'Quitar de pendientes' : 'Dejar pendiente'}</button>
    </div>
    {state === 'pendiente' && <p className="small muted">Se guarda en el ticket, pero no cambia la despensa hasta que esté confirmada.</p>}
  </div>
}
