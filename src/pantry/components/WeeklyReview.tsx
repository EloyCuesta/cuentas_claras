import { useEffect, useMemo, useRef, useState } from 'react'
import { describeQuantity, missingQuantity, quantityStep, type Rhythms } from '../../../shared/pantry/pantry.ts'
import type { ReviewSchedule } from '../../../shared/pantry/review.ts'
import { agoText } from '../../../shared/pantry/rhythm.ts'
import { isCounted } from '../../../shared/pantry/tracking.ts'
import type { PantryItem, PantryPerson } from '../../../shared/pantry/types.ts'
import { ApiError } from '../../api/apiClient.ts'
import { describeStorageError } from '../../api/storageErrors.ts'
import { Dialog, DialogError } from '../../ui/Dialog.tsx'
import { Icon } from '../../ui/Icon.tsx'
import { usePantryActions } from '../pantryContext.ts'
import { RhythmStatus } from './RhythmStatus.tsx'
import { purchaseText, showsRhythmStatus } from './rhythmText.ts'

/**
 * Repaso de la semana: el aviso en la Despensa y la ventana que va producto a
 * producto. Cada respuesta se guarda al momento (si se cierra a medias, lo
 * hecho queda hecho); al llegar al final se apunta el día del repaso.
 */

/** Aviso grande cuando toca; si no, una línea con el último repaso y «Repasar ahora». */
export function WeeklyReviewCard({
  schedule,
  snoozed,
  onStart,
  onSnooze,
}: {
  schedule: ReviewSchedule
  /** «Hoy no»: hoy, en este dispositivo, solo la línea pequeña. */
  snoozed: boolean
  onStart: () => void
  onSnooze: () => void
}) {
  if (schedule.due && !snoozed) {
    return (
      <section className="sheet week-review" aria-labelledby="week-review-title">
        <div className="week-review__head">
          <Icon name="calendar" size={26} />
          <h2 id="week-review-title" className="section-title">
            Toca el repaso de la semana
          </h2>
        </div>
        <p>En un par de minutos miras lo que puede acabarse antes de la próxima compra, y la lista queda hecha.</p>
        <div className="button-row">
          <button type="button" className="btn btn--primary" onClick={onStart}>
            Empezar el repaso
          </button>
          <button type="button" className="btn btn--ghost" onClick={onSnooze}>
            Hoy no
          </button>
        </div>
      </section>
    )
  }
  return (
    <p className="week-review-strip">
      <Icon name="calendar" />
      <span>{schedule.sinceDays === null ? 'Repaso de la semana: te avisará cada 7 días.' : `Último repaso: ${agoText(schedule.sinceDays)}.`}</span>
      <button type="button" className="link-btn" onClick={onStart}>
        Repasar ahora
      </button>
    </p>
  )
}

type Mark = 'queda' | 'poco' | 'se_acabo'
type Answer = { kind: Mark; eventId: string } | { kind: 'saltado' } | { kind: 'contado' }

const MARKS: { kind: Mark; label: string }[] = [
  { kind: 'queda', label: 'Queda' },
  { kind: 'poco', label: 'Queda poco' },
  { kind: 'se_acabo', label: 'Se acabó' },
]

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function WeeklyReviewDialog({
  queue,
  items,
  rhythms,
  people,
  listCount,
  onShowList,
  onClose,
}: {
  /** Ids de lo que hay que repasar, en orden. Se calcula al abrir y no cambia mientras se repasa. */
  queue: readonly string[]
  /** Productos actuales: así se ven al momento los cambios de cantidad. */
  items: readonly PantryItem[]
  rhythms: Rhythms
  people: readonly PantryPerson[]
  /** Productos en la lista de la compra ahora mismo. */
  listCount: number
  onShowList: () => void
  onClose: () => void
}) {
  const actions = usePantryActions()
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  const peopleById = useMemo(() => new Map(people.map((person) => [person.id, person.name])), [people])
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, Answer>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [finished, setFinished] = useState(false)
  // En cada paso el foco va al nombre del producto (o a «Repaso hecho»): el botón pulsado desaparece.
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    heading.current?.focus()
  }, [index, finished])

  /** Una acción cada vez; los errores se quedan en la ventana. */
  const run = async (work: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (failure) {
      setError(describeStorageError(failure))
    } finally {
      setBusy(false)
    }
  }

  const advance = async () => {
    if (index + 1 < queue.length) {
      setIndex(index + 1)
      return
    }
    await actions.finishReview()
    setFinished(true)
  }

  const answer = (item: PantryItem, kind: Mark) =>
    run(async () => {
      const previous = answers[item.id]
      const sameAnswer = previous !== undefined && 'eventId' in previous && previous.kind === kind
      if (!sameAnswer) {
        // Al volver atrás y cambiar la respuesta, la anterior se borra (si sigue existiendo).
        if (previous !== undefined && 'eventId' in previous) {
          await actions.deleteEvent(previous.eventId).catch((failure: unknown) => {
            if (!(failure instanceof ApiError && failure.status === 404)) throw failure
          })
        }
        const event = await actions.addEvent(item.id, kind)
        setAnswers((current) => ({ ...current, [item.id]: { kind, eventId: event.id } }))
      }
      await advance()
    })

  const moveOn = (item: PantryItem | undefined, kind: 'saltado' | 'contado') =>
    run(async () => {
      if (item) setAnswers((current) => (current[item.id] ? current : { ...current, [item.id]: { kind } }))
      await advance()
    })

  const adjust = (item: PantryItem, delta: number) => run(() => actions.adjustItem(item.id, delta))

  if (finished) {
    const counts = Object.values(answers).reduce<Record<string, number>>((acc, a) => ({ ...acc, [a.kind]: (acc[a.kind] ?? 0) + 1 }), {})
    const toList = (counts.se_acabo ?? 0) + (counts.poco ?? 0)
    const reviewed = Object.keys(answers).length
    return (
      <Dialog title="Repaso de la semana" onClose={onClose}>
        <div className="dialog__body">
          <div className="review-done" role="status">
            <Icon name="check" size={36} />
            <h3 ref={heading} className="review-done__title" tabIndex={-1}>
              Repaso hecho
            </h3>
            <p>
              Has repasado {plural(reviewed, 'producto', 'productos')}
              {toList > 0 ? `; ${plural(toList, 'ha pasado', 'han pasado')} a la lista` : ''}.
            </p>
            <p>
              {listCount === 0
                ? 'No falta nada: la lista de la compra está vacía.'
                : `La lista de la compra tiene ${plural(listCount, 'producto', 'productos')}.`}
            </p>
            <p className="muted small">El próximo repaso, dentro de 7 días.</p>
          </div>
        </div>
        <div className="dialog__footer">
          <button type="button" className="btn" onClick={onClose}>
            Cerrar
          </button>
          {listCount > 0 && (
            <button type="button" className="btn btn--primary" onClick={onShowList}>
              <Icon name="list" />
              Ver la lista de la compra
            </button>
          )}
        </div>
      </Dialog>
    )
  }

  if (queue.length === 0) {
    return (
      <Dialog title="Repaso de la semana" onClose={onClose}>
        <div className="dialog__body">
          <div className="review-done">
            <Icon name="check" size={36} />
            <h3 className="review-done__title">Todo al día</h3>
            <p>No hace falta repasar nada: lo que se sigue por compras se compró hace poco o ya está en la lista.</p>
          </div>
          <DialogError message={error} />
        </div>
        <div className="dialog__footer">
          <button type="button" className="btn" onClick={onClose}>
            Cerrar
          </button>
          <button
            type="button"
            className="btn btn--primary"
            data-autofocus
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await actions.finishReview()
                onClose()
              })
            }
          >
            Dar el repaso por hecho
          </button>
        </div>
      </Dialog>
    )
  }

  const item = byId.get(queue[index])
  const answered = item ? answers[item.id] : undefined
  const rhythm = item ? rhythms.get(item.id) : undefined
  const owner = item && people.length > 0 ? (item.ownerId ? (peopleById.get(item.ownerId) ?? '') : 'Compartido') : null

  return (
    <Dialog title="Repaso de la semana" onClose={onClose}>
      <div className="dialog__body">
        <div className="review-step">
          <p className="review-step__count" aria-live="polite">
            {index + 1} de {queue.length}
          </p>
          <div
            className="review-progress"
            role="progressbar"
            aria-label="Avance del repaso"
            aria-valuemin={0}
            aria-valuemax={queue.length}
            aria-valuenow={index}
          >
            <span style={{ width: `${(index / queue.length) * 100}%` }} />
          </div>

          {!item ? (
            <p className="muted">Este producto ya no está en la despensa.</p>
          ) : (
            <>
              <h3 ref={heading} className="review-step__name" tabIndex={-1}>
                {item.name}
              </h3>
              {owner && <p className="muted small">{owner}</p>}
              {!isCounted(item) ? (
                <>
                  <p>{purchaseText(rhythm)}</p>
                  {showsRhythmStatus(rhythm) && (
                    <div>
                      <RhythmStatus rhythm={rhythm} />
                    </div>
                  )}
                  <p className="review-step__question" id="review-question">
                    ¿Cuánto queda?
                  </p>
                  <div className="review-step__answers" role="group" aria-labelledby="review-question">
                    {MARKS.map((mark) => {
                      const selected = answered?.kind === mark.kind
                      return (
                        <button
                          key={mark.kind}
                          type="button"
                          className={`btn review-answer review-answer--${mark.kind}`}
                          aria-pressed={selected}
                          disabled={busy}
                          onClick={() => void answer(item, mark.kind)}
                        >
                          {selected && <Icon name="check" size={18} />}
                          {mark.label}
                        </button>
                      )
                    })}
                  </div>
                  <p className="muted small">«Queda poco» y «Se acabó» lo ponen en la lista de la compra.</p>
                </>
              ) : (
                <CountStep item={item} busy={busy} onAdjust={(delta) => void adjust(item, delta)} />
              )}
            </>
          )}
        </div>
        <DialogError message={error} />
      </div>
      <div className="dialog__footer">
        {index > 0 && (
          <button type="button" className="btn" disabled={busy} onClick={() => setIndex(index - 1)}>
            Atrás
          </button>
        )}
        {item && isCounted(item) ? (
          <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void moveOn(item, 'contado')}>
            {index + 1 < queue.length ? 'Siguiente' : 'Terminar'}
          </button>
        ) : (
          <button type="button" className="btn" disabled={busy} onClick={() => void moveOn(item, 'saltado')}>
            {answered ? (index + 1 < queue.length ? 'Siguiente' : 'Terminar') : 'Saltar'}
          </button>
        )}
      </div>
    </Dialog>
  )
}

/** Un producto que se cuenta: − y + sobre lo que hay, como en la lista. */
function CountStep({ item, busy, onAdjust }: { item: PantryItem; busy: boolean; onAdjust: (delta: number) => void }) {
  const step = quantityStep(item.unit)
  const stepText = describeQuantity(step, item.unit)
  const missing = missingQuantity(item)
  return (
    <>
      <p>
        ¿Cuánto hay? Quieres tener {describeQuantity(item.target, item.unit)}
        {missing > 0 ? ` (faltan ${describeQuantity(missing, item.unit)}).` : '.'}
      </p>
      <div className="stepper review-step__stepper" role="group" aria-label={`Cantidad de ${item.name}`} aria-busy={busy || undefined}>
        <button
          type="button"
          className="stepper__btn"
          aria-label={`Quitar ${stepText} de ${item.name}`}
          disabled={busy || item.quantity === 0}
          onClick={() => onAdjust(-step)}
        >
          <Icon name="minus" />
        </button>
        <span className="stepper__value" aria-live="polite">
          {describeQuantity(item.quantity, item.unit)}
        </span>
        <button type="button" className="stepper__btn" aria-label={`Añadir ${stepText} a ${item.name}`} disabled={busy} onClick={() => onAdjust(step)}>
          <Icon name="plus" />
        </button>
      </div>
    </>
  )
}
