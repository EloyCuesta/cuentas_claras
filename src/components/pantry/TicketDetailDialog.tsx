import { useEffect, useMemo, useState } from 'react'
import { formatDate } from '../../domain/dates.ts'
import { formatEuros } from '../../domain/money.ts'
import { formatQuantity } from '../../domain/pantry.ts'
import type { PantryItem, PantryTicket } from '../../domain/types.ts'
import { describeStorageError } from '../../state/storageErrors.ts'
import { useToast } from '../../state/toastContext.ts'
import { usePantryActions } from '../../state/pantryContext.ts'
import { ConfirmDialog, Dialog, DialogError } from '../Dialog.tsx'
import { Icon } from '../Icon.tsx'

/** Un ticket guardado: sus líneas, a qué producto corresponde cada una (se puede cambiar) y borrarlo. */
export function TicketDetailDialog({
  ticketId,
  items,
  onClose,
}: {
  ticketId: string
  items: readonly PantryItem[]
  onClose: () => void
}) {
  const actions = usePantryActions()
  const { notify } = useToast()
  const [ticket, setTicket] = useState<PantryTicket | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const sortedItems = useMemo(() => [...items].sort((a, b) => a.name.localeCompare(b.name, 'es')), [items])

  useEffect(() => {
    let active = true
    actions.getTicket(ticketId).then(
      (loaded) => {
        if (active) setTicket(loaded)
      },
      (failure: unknown) => {
        if (active) setError(describeStorageError(failure))
      },
    )
    return () => {
      active = false
    }
  }, [actions, ticketId])

  const change = async (lineId: string, itemId: string | null) => {
    setBusy(true)
    setError(null)
    try {
      setTicket(await actions.setTicketLine(ticketId, lineId, itemId))
      notify('Cambiado. La próxima vez se emparejará así.')
    } catch (failure) {
      setError(describeStorageError(failure))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    try {
      await actions.deleteTicket(ticketId)
      notify('Ticket borrado')
      onClose()
    } catch (failure) {
      setError(describeStorageError(failure))
      setBusy(false)
    }
  }

  if (confirming && ticket) {
    return (
      <ConfirmDialog
        title="Borrar ticket"
        confirmLabel="Borrar ticket"
        danger
        busy={busy}
        error={error}
        onConfirm={() => void remove()}
        onClose={() => setConfirming(false)}
      >
        <p>
          Vas a borrar el ticket de {ticket.storeName} del {formatDate(ticket.date)}. Sus compras dejarán de contar para el ritmo de
          cada producto. Los productos y lo aprendido se conservan, y las cantidades contadas no se tocan.
        </p>
      </ConfirmDialog>
    )
  }

  return (
    <Dialog title={ticket ? `${ticket.storeName} · ${formatDate(ticket.date)}` : 'Ticket'} onClose={onClose}>
      <div className="dialog__body">
        {!ticket && !error && (
          <p className="muted" role="status">
            Cargando el ticket…
          </p>
        )}
        <DialogError message={error} />
        {ticket && (
          <>
            <p className="muted">
              {ticket.time ? `A las ${ticket.time}` : 'Sin hora'}
              {ticket.address ? ` · ${ticket.address}` : ''}
              {ticket.totalCents !== null ? ` · Total ${formatEuros(ticket.totalCents)}` : ''}
            </p>
            <ul className="ticket-lines">
              {ticket.lines.map((line) => (
                <li key={line.id} className="ticket-line">
                  <div className="ticket-line__text">
                    <span className="ticket-line__name">{line.rawName}</span>
                    <span className="muted small">
                      {line.weightKg !== null ? `${formatQuantity(line.weightKg)} kg · ` : line.quantity > 1 ? `${line.quantity} ud · ` : ''}
                      {line.amountCents !== null ? formatEuros(line.amountCents - line.discountCents) : 'sin importe'}
                      {line.occasional ? ' · para una ocasión' : ''}
                      {line.reviewStatus === 'pending' ? ' · pendiente: no actualiza la despensa' : ''}
                    </span>
                    {line.evidence?.discrepancy && (
                      <span className="muted small">
                        Leído por el OCR: {formatEuros(line.evidence.discrepancy.recognizedCents)} · calculado: {formatEuros(line.evidence.discrepancy.calculatedCents)}
                        {line.evidence.selectedBy === 'manual' ? ' · corregido a mano' : line.confirmed ? ' · confirmado' : ''}
                      </span>
                    )}
                  </div>
                  <label className="sr-only" htmlFor={`line-${line.id}`}>
                    Producto de {line.rawName}
                  </label>
                  <select
                    id={`line-${line.id}`}
                    className="select select--compact"
                    value={line.itemId ?? ''}
                    disabled={busy}
                    onChange={(event) => void change(line.id, event.target.value === '' ? null : event.target.value)}
                  >
                    <option value="">No se sigue</option>
                    {sortedItems.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
            {(ticket.adjustments ?? []).length > 0 && <section aria-label="Ajustes generales"><h3>Ajustes generales</h3><ul>
              {ticket.adjustments!.map(a => <li key={a.id}>{a.label}: {a.amountCents === null ? 'importe pendiente' : formatEuros(a.amountCents)}{a.needsReview ? ' · pendiente' : ''}</li>)}
            </ul></section>}
            {(ticket.issues ?? []).length > 0 && <details><summary>Advertencias al guardar</summary><ul>{ticket.issues!.map(i => <li key={i}>{i}</li>)}</ul></details>}
          </>
        )}
      </div>
      <div className="dialog__footer">
        {ticket && (
          <button type="button" className="btn btn--danger dialog__footer-start" onClick={() => setConfirming(true)}>
            <Icon name="trash" />
            Borrar ticket
          </button>
        )}
        <button type="button" className="btn" onClick={onClose}>
          Cerrar
        </button>
      </div>
    </Dialog>
  )
}
