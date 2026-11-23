import { useEffect, useRef, useState } from 'react'
import { todayISO } from '#shared/common/dates.ts'
import type { TicketDraft } from '#shared/tickets/ticketMatch.ts'
import type { PantryItem, PantryPerson } from '#shared/pantry/types.ts'
import type { PantryTicket } from '#shared/tickets/types.ts'
import { describeStorageError } from '../../api/storageErrors.ts'
import type { TicketActions } from './ticketActions.ts'
import {
  analyzeTicketImages, createTicketImageCache, defaultImageOptions, prepareTicketImages, TicketImageError, type TicketImageOptions, type TicketImagesAnalysis,
} from './ticketImages.ts'
import { ConfirmDialog, Dialog, DialogError } from '../../ui/Dialog.tsx'
import { Icon } from '../../ui/Icon.tsx'
import { TicketReview } from './TicketReview.tsx'
import type { ShownSegment } from './TicketLineCheck.tsx'
import { initialReview, reviewToInput, reviewWarnings, type HeaderField, type ReviewState } from './ticketReviewState.ts'

type Step = { kind: 'elegir' } | { kind: 'leyendo'; images: number } | { kind: 'revisar'; draft: TicketDraft }

const MAX_IMAGES = 6

/**
 * Escanear un ticket: elegir la captura (o capturas) de la app de la tienda, o
 * una foto del ticket de papel, o pegar su texto; leerlo; revisarlo y guardarlo.
 *
 * Pasos (`step`):
 * - «elegir»: hasta 6 imágenes en fila (número, girar y quitar), o el texto
 *   pegado. Con dos o más se comprueba si las capturas se solapan
 *   (analyzeTicketImages, en un Web Worker) y se avisa antes de leer. Lo que se
 *   calcula queda en una caché de la ventana y la lectura lo reutiliza. «Leer»
 *   va en el pie.
 * - «leyendo»: el navegador prepara las imágenes (ticketImages.ts: gira, une las
 *   capturas, recorta al papel, escala por la altura de las letras y divide en
 *   franjas) y las envía como `franjas` a POST /api/despensa/tickets/leer; se ve
 *   el paso y los segundos. El texto va tal cual. Si algo falla se vuelve a
 *   «elegir» con el error.
 * - «revisar»: TicketReview con el estado de ticketReviewState.ts.
 * - Al guardar: si hay una posible compra duplicada sin confirmar, se avisa; si
 *   quedan advertencias (no cuadra, líneas pendientes…), se pide confirmación
 *   («Guardar con advertencias») y solo las líneas fiables cambian la despensa.
 *
 * Reglas: como mucho 24 franjas y 20 MB en total (los mismos límites que el
 * servidor); la imagen original no se toca y es la que se ve al comparar; las URL
 * locales (de cada imagen elegida y de cada franja) se liberan al quitarla, al
 * volver a leer y al cerrar.
 */

interface Selected { file: File; options: TicketImageOptions; url: string }
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
  /** El dato de la cabecera que ha impedido guardar: la revisión abre «Editar datos del ticket» y lleva el foco a él. */
  const [headerError, setHeaderError] = useState<{ field: HeaderField; message: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState<Selected[]>([])
  /** Si lo que se revisa salió de las imágenes elegidas (no del texto pegado): solo entonces se comparan. */
  const [fromImages, setFromImages] = useState(false)
  const [segments, setSegments] = useState<ShownSegment[]>([])
  const [cache] = useState(createTicketImageCache)
  const [confirmation, setConfirmation] = useState<string[] | null>(null)
  const [analysis, setAnalysis] = useState<TicketImagesAnalysis | null>(null)
  const [progress, setProgress] = useState<{ label: string; since: number }>({ label: 'Leyendo el ticket…', since: 0 })
  const [now, setNow] = useState(() => Date.now())
  const fileInput = useRef<HTMLInputElement>(null)

  // Las imágenes elegidas se ven desde URL locales: cada una se libera al quitarla, y las que quedan, al cerrar.
  const selectedNow = useRef(selected)
  useEffect(() => { selectedNow.current = selected }, [selected])
  useEffect(() => () => selectedNow.current.forEach((s) => URL.revokeObjectURL(s.url)), [])
  // Las franjas leídas, también: al volver a leer y al cerrar.
  useEffect(() => () => segments.forEach((s) => URL.revokeObjectURL(s.url)), [segments])

  const startReview = (draft: TicketDraft) => {
    setReview(initialReview(draft, todayISO(), defaultOwnerId))
    setStep({ kind: 'revisar', draft })
  }

  // Al elegir (o girar, o quitar) imágenes, se comprueba antes de leer si las capturas se solapan. Con una sola, no hay nada que comparar.
  useEffect(() => {
    let current = true
    setAnalysis(null)
    if (selected.length < 2) return
    analyzeTicketImages(selected, cache).then(result => { if (current) setAnalysis(result) }, () => { if (current) setAnalysis(null) })
    return () => { current = false }
  }, [selected, cache])

  // Mientras se lee, un reloj para enseñar los segundos que lleva.
  useEffect(() => {
    if (step.kind !== 'leyendo') return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [step.kind])

  const readImages = async () => {
    const files = selected.map(s => s.file)
    if (files.length === 0) return
    setError(null)
    if (files.length > MAX_IMAGES) {
      setError(`Elige como máximo ${MAX_IMAGES} imágenes de un mismo ticket.`)
      return
    }
    setStep({ kind: 'leyendo', images: files.length })
    setProgress({ label: 'Preparando las imágenes', since: Date.now() })
    try {
      const { segments: prepared, warnings, blobs } = await prepareTicketImages(selected, (s) => setProgress({ since: Date.now(),
        label: s.kind === 'uniendo' ? `Uniendo ${s.total} capturas` : s.total > 1 ? `Preparando la imagen ${s.image} de ${s.total}` : 'Preparando la imagen' }), cache)
      setProgress({ label: 'Leyendo el ticket…', since: Date.now() })
      const draft = await actions.readTicket({ franjas: prepared })
      draft.ticket.issues.push(...warnings)
      // Cada franja se enseña desde una URL local (no como texto en base64, que puede ocupar 8 MB por tarjeta).
      setSegments(prepared.map(({ image: _image, ...segment }, i) => ({ ...segment, url: URL.createObjectURL(blobs[i]) })))
      setFromImages(true)
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
    setProgress({ label: 'Leyendo el ticket…', since: Date.now() })
    try {
      const draft = await actions.readTicket({ texto: text })
      setFromImages(false)
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
      setError(result.field ? null : result.error)
      setHeaderError(result.field ? { field: result.field, message: result.error } : null)
      return
    }
    setHeaderError(null)
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
            <p className="ticket-tip">
              Lo mejor es la <strong>imagen completa del ticket</strong> que da Lidl Plus (<em>Tickets</em>, el ticket y compartir o guardar la
              imagen). Si no, una captura larga o varias que se solapen un poco. También vale una foto del ticket de papel.
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
                  selected.forEach(s => URL.revokeObjectURL(s.url))
                  setSelected(files.map(file => ({ file, options: defaultImageOptions(), url: URL.createObjectURL(file) })))
                }}
              />
            </label>
            {selected.length > 0 && <ul className="ticket-thumbs" aria-label="Imágenes elegidas">
              {selected.map((s, i) => <li className="ticket-thumbs__item" key={s.url}>
                <span className="ticket-thumbs__number" aria-hidden="true">{i + 1}</span>
                <span className="ticket-thumbs__frame"><img src={s.url} alt={`Imagen ${i + 1}`}
                  className={s.options.rotation % 180 ? 'ticket-thumbs__img--sideways' : undefined}
                  style={{ transform: `rotate(${s.options.rotation}deg)` }} /></span>
                <div className="ticket-thumbs__actions">
                  <button type="button" className="icon-btn" aria-label={`Girar imagen ${i + 1}`} title="Girar"
                    onClick={() => setSelected(selected.map((x, j) => j === i ? { ...x, options: { ...x.options, rotation: ((x.options.rotation + 90) % 360) as TicketImageOptions['rotation'] } } : x))}>
                    <Icon name="repeat" size={18} /></button>
                  <button type="button" className="icon-btn" aria-label={`Quitar imagen ${i + 1}`} title="Quitar" onClick={() => {
                    URL.revokeObjectURL(s.url)
                    setSelected(selected.filter((_, j) => j !== i))
                  }}><Icon name="trash" size={18} /></button>
                </div>
              </li>)}
            </ul>}
            {selected.length > 1 && <div role="status" className="stack stack--tight">
              {!analysis && <p className="muted small">Comprobando si las capturas se solapan…</p>}
              {analysis && analysis.warnings.length === 0 && analysis.images === 1 && <p className="muted small">Las {selected.length} capturas se solapan: se unirán en una sola imagen.</p>}
              {analysis?.warnings.map(w => <p className="notice notice--warning small" key={w}>{w}</p>)}
            </div>}
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
              {/* El contador va fuera del anuncio: si no, el lector de pantalla lo repetiría cada segundo. */}
              <strong>{progress.label}<span aria-hidden="true"> {Math.max(0, Math.floor((now - progress.since) / 1000))} s</span></strong>
              <br />
              {step.images > 0 ? 'Se lee en este equipo: suele tardar entre 10 y 30 segundos.' : 'Un momento.'}
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
              previews={fromImages ? selected.map(s => s.url) : []}
              segments={segments}
              headerError={headerError}
              onRestart={() => {
                setError(null)
                setHeaderError(null)
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
        {step.kind === 'elegir' && (
          <button type="button" className="btn btn--primary" onClick={() => void readImages()} disabled={selected.length === 0}>
            Leer
          </button>
        )}
        {step.kind === 'revisar' && (
          <button type="button" className="btn btn--primary" onClick={() => void save()} disabled={saving || step.draft.duplicate !== null}>
            {saving ? 'Guardando…' : 'Guardar ticket'}
          </button>
        )}
      </div>
    </Dialog>
  )
}
