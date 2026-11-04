import { useEffect, useRef, useState } from 'react'
import { todayISO } from '#shared/common/dates.ts'
import type { TicketDraft } from '#shared/tickets/ticketMatch.ts'
import type { PantryItem, PantryPerson } from '#shared/pantry/types.ts'
import type { PantryTicket, TicketSegment } from '#shared/tickets/types.ts'
import { describeStorageError } from '../../api/storageErrors.ts'
import type { TicketActions } from './ticketActions.ts'
import { defaultImageOptions, MAX_SEGMENTS, MAX_TOTAL_BYTES, prepareTicketImage, TicketImageError, type TicketImageOptions } from './ticketImages.ts'
import { ConfirmDialog, Dialog, DialogError } from '../../ui/Dialog.tsx'
import { Icon } from '../../ui/Icon.tsx'
import { TicketReview } from './TicketReview.tsx'
import { initialReview, reviewToInput, reviewWarnings, type ReviewState } from './ticketReviewState.ts'

type Step = { kind: 'elegir' } | { kind: 'leyendo'; images: number } | { kind: 'revisar'; draft: TicketDraft }

const MAX_IMAGES = 6

/**
 * Escanear un ticket: elegir la captura (o capturas) de la app de la tienda, o
 * una foto del ticket de papel, o pegar su texto; leerlo; revisarlo y guardarlo.
 *
 * Pasos (`step`):
 * - «elegir»: hasta 6 imágenes, cada una con su giro y su recorte, o el texto pegado.
 * - «leyendo»: el navegador prepara las imágenes (ticketImages.ts: gira, recorta,
 *   divide en franjas y, solo si es una foto de poco contraste, la retoca) y las
 *   envía como `franjas` a POST /api/despensa/tickets/leer. El texto va tal cual.
 *   Si algo falla se vuelve a «elegir» con el error.
 * - «revisar»: TicketReview con el estado de ticketReviewState.ts.
 * - Al guardar: si hay una posible compra duplicada sin confirmar, se avisa; si
 *   quedan advertencias (no cuadra, líneas pendientes…), se pide confirmación
 *   («Guardar con advertencias») y solo las líneas fiables cambian la despensa.
 *
 * Reglas: como mucho 24 franjas y 20 MB en total (los mismos límites que el
 * servidor); la imagen original no se toca y es la que se ve al comparar; las URL
 * locales de las imágenes se liberan al cerrar.
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
  actions: TicketActions
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
  const [selected, setSelected] = useState<{ file: File; options: TicketImageOptions }[]>([])
  const [segments, setSegments] = useState<TicketSegment[]>([])
  const [confirmation, setConfirmation] = useState<string[] | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  // Las imágenes se ven en la revisión desde URL locales: se liberan al cerrar.
  useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews])

  const startReview = (draft: TicketDraft) => {
    setReview(initialReview(draft, todayISO(), defaultOwnerId))
    setStep({ kind: 'revisar', draft })
  }

  const readImages = async () => {
    const files = selected.map(s => s.file)
    if (files.length === 0) return
    setError(null)
    if (files.length > MAX_IMAGES) {
      setError(`Elige como máximo ${MAX_IMAGES} imágenes de un mismo ticket.`)
      return
    }
    setStep({ kind: 'leyendo', images: files.length })
    try {
      const prepared: TicketSegment[] = []
      const warnings: string[] = []
      let bytes = 0
      for (const [i, selection] of selected.entries()) {
        const part = await prepareTicketImage(selection.file, i, selection.options)
        bytes += part.bytes
        prepared.push(...part.segments)
        warnings.push(...part.warnings)
        if (prepared.length > MAX_SEGMENTS || bytes > MAX_TOTAL_BYTES) throw new TicketImageError('El conjunto supera 24 franjas o 20 MB. Recorta las zonas informativas antes de leer.')
      }
      const draft = await actions.readTicket({ franjas: prepared })
      draft.ticket.issues.push(...new Set(warnings))
      setSegments(prepared)
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
      setSegments([])
      startReview(draft)
    } catch (failure) {
      setError(describeStorageError(failure))
      setStep({ kind: 'elegir' })
    }
  }

  const save = async (acknowledged = false) => {
    if (step.kind !== 'revisar' || !review || saving) return
    const result = reviewToInput(step.draft, review, acknowledged)
    if (!result.ok) {
      setError(result.error)
      return
    }
    if (step.draft.possibleDuplicate && !review.distinctPurchase) {
      setError('Comprueba la posible compra duplicada y confirma si esta es otra compra.')
      return
    }
    const warnings = [...new Set([...reviewWarnings(review), ...(result.input.issues ?? [])])]
    if (!acknowledged && warnings.length) { setConfirmation(warnings); return }
    setConfirmation(null)
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

  if (confirmation) return <ConfirmDialog title="Guardar con advertencias" confirmLabel="Guardar solo líneas fiables en la despensa"
    onClose={() => setConfirmation(null)} onConfirm={() => void save(true)}>
    <p>Se guardará el ticket completo. Las líneas pendientes no cambiarán cantidades, precios ni historial de la despensa.</p>
    <ul>{confirmation.map(w => <li key={w}>{w}</li>)}</ul>
  </ConfirmDialog>

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
                onChange={(event) => {
                  const files = [...(event.target.files ?? [])]
                  if (files.length > MAX_IMAGES) { setError(`Elige como máximo ${MAX_IMAGES} imágenes.`); return }
                  setError(null)
                  setSelected(files.map(file => ({ file, options: defaultImageOptions() })))
                  setPreviews(files.map(file => URL.createObjectURL(file)))
                }}
              />
            </label>
            {selected.map((s, i) => <div className="ticket-image-options" key={`${i}-${s.file.name}`}>
              <img src={previews[i]} alt={`Preparar imagen ${i + 1}`} style={{ transform: `rotate(${s.options.rotation}deg)` }} />
              <div className="stack stack--tight"><strong>{i + 1}. {s.file.name}</strong>
                <button type="button" className="btn btn--small" onClick={() => setSelected(selected.map((x, j) => j === i ? { ...x, options: { ...x.options, rotation: ((x.options.rotation + 90) % 360) as TicketImageOptions['rotation'] } } : x))}>Girar imagen {i + 1}</button>
                {i > 0 && <button type="button" className="link-btn" onClick={() => {
                  const next = [...selected]; [next[i - 1], next[i]] = [next[i], next[i - 1]]
                  setSelected(next)
                  // Recreate URLs: the previous set is released by the effect.
                  setPreviews(next.map(x => URL.createObjectURL(x.file)))
                }}>Mover imagen {i + 1} antes</button>}
                <details><summary>Recortar márgenes de la imagen {i + 1}</summary>
                  <p className="muted small">Porcentaje que se quitará de cada borde después de girar.</p>
                  {([['top', 'arriba'], ['bottom', 'abajo'], ['left', 'izquierda'], ['right', 'derecha']] as const).map(([edge, label]) => <label className="field" key={edge}>
                    Recortar {label} imagen {i + 1} (%)<input type="number" className="input" min="0" max="90" value={s.options.crop[edge]} onChange={e => setSelected(selected.map((x, j) => j === i ? { ...x, options: { ...x.options, crop: { ...x.options.crop, [edge]: Number(e.target.value) } } } : x))} />
                  </label>)}
                </details>
              </div>
            </div>)}
            {selected.length > 0 && <button type="button" className="btn btn--primary" onClick={() => void readImages()}>Leer imágenes</button>}
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
              segments={segments}
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
