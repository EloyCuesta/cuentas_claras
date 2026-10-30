import { useState } from 'react'
import type { Rhythms } from '../../../shared/pantry/pantry.ts'
import { needsReview } from '../../../shared/pantry/rhythm.ts'
import type { PantryEventKind, PantryItem } from '../../../shared/pantry/types.ts'
import { Section } from '../../ui/Section.tsx'
import { RhythmStatus } from './RhythmStatus.tsx'
import { purchaseText } from './rhythmText.ts'

/** Cuántos se ven antes de «Ver más». */
const REVIEW_LIMIT = 8

/** Lo que conviene revisar: productos que, por cuándo se compraron, pueden estar acabándose. */
export function ReviewBlock({
  items,
  rhythms,
  busyIds,
  onMark,
}: {
  items: readonly PantryItem[]
  rhythms: Rhythms
  busyIds: ReadonlySet<string>
  onMark: (item: PantryItem, kind: PantryEventKind) => void
}) {
  const [showAll, setShowAll] = useState(false)
  const pending = items
    .filter((item) => needsReview(rhythms.get(item.id)))
    .sort((a, b) => (rhythms.get(a.id)?.dueDate ?? '').localeCompare(rhythms.get(b.id)?.dueDate ?? '') || a.name.localeCompare(b.name, 'es'))
  if (pending.length === 0) return null
  const shown = showAll ? pending : pending.slice(0, REVIEW_LIMIT)
  return (
    <Section id="pantry-review" title={`Para revisar (${pending.length})`} className="pantry-review">
      <p className="section-sub">Según cuándo los compraste, puede que se estén acabando. ¿Cuánto queda?</p>
      <ul className="review-list">
        {shown.map((item) => {
          const rhythm = rhythms.get(item.id)
          const busy = busyIds.has(item.id)
          return (
            <li key={item.id} className="review-item">
              <div className="review-item__text">
                <span className="review-item__name">{item.name}</span>
                <span className="muted small">{purchaseText(rhythm)}</span>
                <RhythmStatus rhythm={rhythm} />
              </div>
              <div className="review-item__actions">
                <button type="button" className="btn" disabled={busy} onClick={() => onMark(item, 'queda')}>
                  Queda<span className="sr-only"> {item.name}</span>
                </button>
                <button type="button" className="btn" disabled={busy} onClick={() => onMark(item, 'poco')}>
                  Queda poco<span className="sr-only"> de {item.name}</span>
                </button>
                <button type="button" className="btn btn--primary" disabled={busy} onClick={() => onMark(item, 'se_acabo')}>
                  Se acabó<span className="sr-only"> {item.name}</span>
                </button>
              </div>
            </li>
          )
        })}
      </ul>
      {pending.length > REVIEW_LIMIT && (
        <button type="button" className="link-btn section-more" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Ver menos' : `Ver las ${pending.length}`}
        </button>
      )}
    </Section>
  )
}
