import { useEffect, useRef, useState } from 'react'
import { todayISO } from '../../domain/dates.ts'
import type { TicketDraft } from '../../domain/ticketMatch.ts'
import type { PantryItem, PantryPerson, PantryTicket } from '../../domain/types.ts'
import { describeStorageError } from '../../state/storageErrors.ts'
import type { PantryActions } from '../../state/usePantry.ts'
import { prepareTicketImage, TicketImageError } from '../../ui/ticketImages.ts'
import { Dialog, DialogError } from '../Dialog.tsx'
import { Icon } from '../Icon.tsx'
import { TicketReview } from './TicketReview.tsx'
import { initialReview, reviewToInput, type ReviewState } from './ticketReviewState.ts'

type Step = { kind: 'elegir' } | { kind: 'leyendo'; images: number } | { kind: 'revisar'; draft: TicketDraft }

const MAX_IMAGES = 6

/**
 * Escanear un ticket: elegir la captura (o capturas) de la app de la tienda, o
 * una foto del ticket de papel, o pegar su texto; leerlo; revisarlo y guardarlo.
 */
export function TicketScanDialog({
  items,
  people,
  defaultOwnerId,
  actions,
  onSaved,
  onClose,
}: {
  items: readonly PantryItem[]
  people: readonly PantryPerson[]
  /** Persona elegida arriba en la despensa ('' = Compartido): dueña de los productos nuevos. */
  defaultOwnerId: string
  actions: PantryActions
  onSaved: (ticket: PantryTicket) => void
  onClose: () => void
}) {
  const [step, setStep] = useState<Step>({ kind: 'elegir' })
  const [review, setReview] = useState<ReviewState | null>(null)
  const [pasting, setPasting] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [previews, setPreviews] = useState<string[]>([])
  const fileInput = useRef<HTMLInputElement>(null)

  // Las imágenes se ven en la revisión desde URL locales: se liberan al cerrar.
  useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews])

  const startReview = (draft: TicketDraft) => {
    setReview(initialReview(draft, todayISO(), defaultOwnerId))
    setStep({ kind: 'revisar', draft })
  }

  const readImages = async (files: File[]) => {
    if (files.length === 0) return
    setError(null)
    if (files.length > MAX_IMAGES) {
      setError(`Elige como máximo ${MAX_IMAGES} imágenes de un mismo ticket.`)
      return
    }
    setStep({ kind: 'leyendo', images: files.length })
    try {
      const prepared = await Promise.all(files.map(prepareTicketImage))
      const draft = await actions.readTicket({ imagenes: prepared })
      setPreviews(files.map((file) => URL.createObjectURL(file)))
      startReview(draft)
    } catch (failure) {
      setError(failure instanceof TicketImageError ? failure.message : describeStorageError(failure))
      setStep({ kind: 'elegir' })
    } finally {
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const readText = async () => {
    if (text.trim() === '') {
      setError('Pega el texto del ticket.')
      return
    }
    setError(null)
    setStep({ kind: 'leyendo', images: 0 })
    try {
      const draft = await actions.readTicket({ texto: text })
      setPreviews([])
      startReview(draft)
    } catch (failure) {
      setError(describeStorageError(failure))
      setStep({ kind: 'elegir' })
    }
  }

  const save = async () => {
    if (step.kind !== 'revisar' || !review || saving) return
    const result = reviewToInput(step.draft, review)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setSaving(true)
    setError(null)
    try {
      onSaved(await actions.saveTicket(result.input))
      onClose()
    } catch (failure) {
      setError(describeStorageError(failure))
      setSaving(false)
    }
  }

  return (
    <Dialog title={step.kind === 'revisar' ? 'Revisar el ticket' : 'Escanear un ticket'} onClose={onClose} size="wide">
      <div className="dialog__body">
        {step.kind === 'elegir' && (
          <div className="stack">
            <p>
              Haz una captura del ticket en la app de la tienda (en Lidl Plus: <em>Tickets</em>) o una foto del ticket de papel, y
              elígela aquí. Si el ticket es largo, puedes elegir varias capturas seguidas.
            </p>
            <label className="ticket-pick">
              <Icon name="upload" size={28} />
              <span className="ticket-pick__title">Elegir capturas o fotos del ticket</span>
              <span className="muted small">PNG o JPEG · hasta {MAX_IMAGES} imágenes · la imagen se lee en este equipo</span>
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                multiple
                className="sr-only"
                data-testid="ticket-input"
                onChange={(event) => void readImages([...(event.target.files ?? [])])}
              />
            </label>
            <DialogError message={error} />
            {pasting ? (
              <div className="field">
                <label className="field__label" htmlFor="ticket-text">
                  Texto del ticket
                </label>
                <textarea
                  id="ticket-text"
                  className="textarea"
                  rows={8}
                  value={text}
                  placeholder="Pega aquí el ticket (por ejemplo, el que llega por email)"
                  onChange={(event) => setText(event.target.value)}
                />
                <div>
                  <button type="button" className="btn" onClick={() => void readText()}>
                    Leer el texto
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="link-btn" onClick={() => setPasting(true)}>
                O pega el texto del ticket
              </button>
            )}
          </div>
        )}

        {step.kind === 'leyendo' && (
          <div className="ticket-reading" role="status">
            <span className="ticket-reading__spinner" aria-hidden="true" />
            <p>
              <strong>Leyendo el ticket…</strong>
              <br />
              {step.images > 0 ? 'Suele tardar entre 10 y 30 segundos.' : 'Un momento.'}
            </p>
          </div>
        )}

        {step.kind === 'revisar' && review && (
          <>
            <TicketReview
              draft={step.draft}
              review={review}
              onChange={setReview}
              items={items}
              people={people}
              previews={previews}
              onRestart={() => {
                setError(null)
                setStep({ kind: 'elegir' })
              }}
            />
            <DialogError message={error} />
          </>
        )}
      </div>
      <div className="dialog__footer">
        <button type="button" className="btn" onClick={onClose}>
          Cancelar
        </button>
        {step.kind === 'revisar' && (
          <button type="button" className="btn btn--primary" onClick={() => void save()} disabled={saving || step.draft.duplicate !== null}>
            {saving ? 'Guardando…' : 'Guardar ticket'}
          </button>
        )}
      </div>
    </Dialog>
  )
}
