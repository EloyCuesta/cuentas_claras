import { useMemo, useRef, useState } from 'react'
import { todayISO } from '../../domain/dates.ts'
import {
  FREQUENCY_TITLES,
  listaCompraTexto,
  PANTRY_FREQUENCIES,
  shoppingListItems,
  whatsAppUrl,
  type OwnerFilter,
} from '../../domain/pantry.ts'
import type { PantryFrequency, PantryItem, PantryPerson } from '../../domain/types.ts'
import { describeStorageError } from '../../state/storageErrors.ts'
import { downloadFile } from '../../ui/helpers.ts'
import { Dialog, DialogError } from '../Dialog.tsx'
import { Icon } from '../Icon.tsx'
import { OwnerSelect } from './owner.tsx'
import { encodeOwner, parseOwner } from './ownerFilter.ts'

type CopyState = { kind: 'idle' } | { kind: 'copied' } | { kind: 'manual' }

/**
 * Lista de la compra: el texto de lo que falta, con filtros, y las formas de
 * llevárselo. WhatsApp va primero porque funciona aunque la app vaya por HTTP
 * en la red de casa, donde el navegador no deja compartir ni copiar solo.
 */
export function ShoppingListDialog({
  items,
  people,
  initialOwner,
  onMarkPurchased,
  onClose,
}: {
  items: readonly PantryItem[]
  people: readonly PantryPerson[]
  initialOwner: OwnerFilter
  /** Marca como comprados los productos de la lista. Si va bien, el diálogo se cierra. */
  onMarkPurchased: (ids: string[]) => Promise<void>
  onClose: () => void
}) {
  const [owner, setOwner] = useState<OwnerFilter>(initialOwner)
  const [frequencies, setFrequencies] = useState<PantryFrequency[]>([...PANTRY_FREQUENCIES])
  const [copy, setCopy] = useState<CopyState>({ kind: 'idle' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)
  // La fecha se fija al abrir la lista.
  const [date] = useState(() => todayISO())

  const filter = useMemo(() => ({ date, owner, frequencies }), [date, owner, frequencies])
  const included = useMemo(() => shoppingListItems(items, filter), [items, filter])
  const text = useMemo(() => listaCompraTexto(items, people, filter), [items, people, filter])
  const empty = included.length === 0
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  const toggleFrequency = (frequency: PantryFrequency, checked: boolean) => {
    setCopy({ kind: 'idle' })
    setFrequencies((current) =>
      PANTRY_FREQUENCIES.filter((f) => (f === frequency ? checked : current.includes(f))),
    )
  }

  const selectText = () => {
    const area = textRef.current
    if (!area) return
    area.focus()
    area.select()
  }

  const copyText = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Sin portapapeles')
      await navigator.clipboard.writeText(text)
      setCopy({ kind: 'copied' })
    } catch {
      // Por HTTP en la red de casa el navegador no deja copiar solo: se selecciona el texto para copiarlo a mano.
      selectText()
      setCopy({ kind: 'manual' })
    }
  }

  const share = async () => {
    try {
      await navigator.share({ text })
    } catch (failure) {
      // Cerrar el menú de compartir no es un error.
      if (failure instanceof DOMException && failure.name === 'AbortError') return
      setError('No se ha podido compartir. Usa «Enviar por WhatsApp» o «Copiar».')
    }
  }

  const markPurchased = async () => {
    if (busy || empty) return
    setBusy(true)
    setError(null)
    try {
      await onMarkPurchased(included.map((item) => item.id))
      onClose()
    } catch (failure) {
      setError(describeStorageError(failure))
      setBusy(false)
    }
  }

  return (
    <Dialog title="Lista de la compra" onClose={onClose}>
      <div className="dialog__body">
        <div className="shopping-filters">
          <OwnerSelect
            id="shopping-owner"
            label="De quién"
            people={people}
            value={encodeOwner(owner)}
            onChange={(value) => {
              setCopy({ kind: 'idle' })
              setOwner(parseOwner(value))
            }}
          />
          <fieldset className="checks">
            <legend className="segmented__legend">Qué incluir</legend>
            {PANTRY_FREQUENCIES.map((frequency) => (
              <label key={frequency} className="checkbox">
                <input
                  type="checkbox"
                  checked={frequencies.includes(frequency)}
                  onChange={(event) => toggleFrequency(frequency, event.target.checked)}
                />
                <span>{FREQUENCY_TITLES[frequency]}</span>
              </label>
            ))}
          </fieldset>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="shopping-text">
            Texto de la lista
          </label>
          <textarea
            ref={textRef}
            id="shopping-text"
            className="textarea shopping-text"
            readOnly
            rows={Math.min(14, text.split('\n').length + 1)}
            value={text}
            aria-describedby="shopping-count"
          />
          <p className="field__hint" id="shopping-count">
            {empty
              ? 'No falta nada con estos filtros: no hay nada que enviar ni que marcar como comprado.'
              : `${included.length} ${included.length === 1 ? 'producto' : 'productos'} en la lista.`}
          </p>
        </div>

        <p className="sr-only" role="status">
          {copy.kind === 'copied' ? 'Lista copiada.' : ''}
        </p>
        {copy.kind === 'copied' && (
          <p className="notice" aria-hidden="true">
            <Icon name="check" />
            <span>Lista copiada. Pégala donde quieras.</span>
          </p>
        )}
        {copy.kind === 'manual' && (
          <p className="notice notice--warning" role="alert">
            <Icon name="info" />
            <span>
              Este navegador no deja copiar automáticamente. El texto está seleccionado: mantén pulsado y elige «Copiar» (o
              Ctrl+C en el ordenador).
            </span>
          </p>
        )}
        <DialogError message={error} />

        <div className="shopping-actions">
          {empty ? (
            <button type="button" className="btn btn--primary" disabled>
              <Icon name="chat" />
              Enviar por WhatsApp
            </button>
          ) : (
            <a className="btn btn--primary" href={whatsAppUrl(text)} target="_blank" rel="noopener noreferrer">
              <Icon name="chat" />
              Enviar por WhatsApp
            </a>
          )}
          {canShare && (
            <button type="button" className="btn" onClick={() => void share()} disabled={empty}>
              <Icon name="share" />
              Compartir
            </button>
          )}
          <button type="button" className="btn" onClick={() => void copyText()} disabled={empty}>
            <Icon name="copy" />
            Copiar
          </button>
          <button
            type="button"
            className="btn"
            disabled={empty}
            onClick={() => downloadFile(text, `lista-compra-${date}.txt`, 'text/plain;charset=utf-8')}
          >
            <Icon name="download" />
            Descargar .txt
          </button>
        </div>
      </div>
      <div className="dialog__footer">
        <button type="button" className="btn" onClick={onClose}>
          Cerrar
        </button>
        <button type="button" className="btn btn--primary" onClick={() => void markPurchased()} disabled={busy || empty}>
          <Icon name="check" />
          Marcar todo como comprado
        </button>
      </div>
    </Dialog>
  )
}
