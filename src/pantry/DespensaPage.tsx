import { useMemo, useState } from 'react'
import { formatDate } from '../../shared/core/dates.ts'
import { formatEuros } from '../../shared/core/money.ts'
import {
  describeQuantity,
  excessQuantity,
  FREQUENCY_TITLES,
  matchesOwner,
  missingQuantity,
  monthlyEstimate,
  type OwnerFilter,
  PANTRY_FREQUENCIES,
  pantrySummary,
  priceUnitLabel,
  quantityStep,
  type Rhythms,
} from '../../shared/pantry/pantry.ts'
import { reviewItems, reviewSchedule } from '../../shared/pantry/review.ts'
import { needsReview, rhythmsFor, type ItemRhythm } from '../../shared/pantry/rhythm.ts'
import { isCounted } from '../../shared/pantry/tracking.ts'
import type { PantryEventKind, PantryItem, PantryPerson } from '../../shared/pantry/types.ts'
import type { PantryTicketSummary } from '../../shared/tickets/types.ts'
import { describeStorageError } from '../api/storageErrors.ts'
import { BudgetMeter } from '../ui/BudgetMeter.tsx'
import { EmptyState } from '../ui/EmptyState.tsx'
import { Icon } from '../ui/Icon.tsx'
import { Section } from '../ui/Section.tsx'
import { useToast } from '../ui/toastContext.ts'
import { OwnerTabs } from './components/owner.tsx'
import { encodeOwner, ownerName, parseOwner } from './components/ownerFilter.ts'
import { PantryBudgetDialog } from './components/PantryBudgetDialog.tsx'
import { PantryItemDialog } from './components/PantryItemDialog.tsx'
import { PeopleDialog } from './components/PeopleDialog.tsx'
import { RhythmStatus } from './components/RhythmStatus.tsx'
import { purchaseText, showsRhythmStatus } from './components/rhythmText.ts'
import { ShoppingListDialog } from './components/ShoppingListDialog.tsx'
import { TicketDetailDialog } from './components/TicketDetailDialog.tsx'
import { TicketScanDialog } from './components/TicketScanDialog.tsx'
import { WeeklyReviewCard, WeeklyReviewDialog } from './components/WeeklyReview.tsx'
import { usePantry, usePantryActions } from './pantryContext.ts'
import { PantryProvider } from './PantryProvider.tsx'

type Editing =
  | { kind: 'item'; item: PantryItem | null }
  | { kind: 'people' }
  | { kind: 'budget' }
  | { kind: 'list' }
  | { kind: 'scan' }
  | { kind: 'ticket'; id: string }
  | { kind: 'review'; queue: string[] }
  | null

const REVIEW_LIMIT = 8
const RECENT_LIMIT = 3
/** «Hoy no» en el aviso del repaso: se recuerda solo en este navegador y solo hoy. */
const SNOOZE_KEY = 'cuentas-claras:repaso-pospuesto'

function readSnooze(): string | null {
  try {
    return localStorage.getItem(SNOOZE_KEY)
  } catch {
    return null
  }
}

const priceText = (item: PantryItem) =>
  item.priceCents === null ? null : `${formatEuros(item.priceCents)}${priceUnitLabel(item.unit).slice(1)}`

function StockStatus({ item }: { item: PantryItem }) {
  const missing = missingQuantity(item)
  if (missing > 0) {
    return (
      <span className="chip chip--late">
        <Icon name="alert" size={14} />
        Falta {describeQuantity(missing, item.unit)}
      </span>
    )
  }
  const excess = excessQuantity(item)
  return (
    <span className="chip chip--done">
      <Icon name="check" size={14} />
      {excess > 0 ? `Completo, sobra ${describeQuantity(excess, item.unit)}` : 'Completo'}
    </span>
  )
}

function PantryRow({
  item,
  rhythm,
  ownerLabel,
  busy,
  onEdit,
  onStep,
  onMark,
}: {
  item: PantryItem
  rhythm: ItemRhythm | undefined
  /** Dueño, solo en la vista «Todo». */
  ownerLabel: string | null
  busy: boolean
  onEdit: () => void
  onStep: (delta: number) => void
  onMark: (kind: PantryEventKind) => void
}) {
  const price = priceText(item)
  const counted = isCounted(item)
  const step = quantityStep(item.unit)
  const stepText = describeQuantity(step, item.unit)
  // En la lista de la compra: el botón pasa a ser «Lo he comprado».
  const out = rhythm?.status === 'se_acabo' || rhythm?.status === 'queda_poco' || rhythm?.status === 'probablemente_acabado'
  return (
    <li className="pantry-item">
      <div className="pantry-item__main">
        <button type="button" className="pantry-item__name" onClick={onEdit}>
          <span className="sr-only">Editar </span>
          {item.name}
        </button>
        <span className="pantry-item__meta">
          {counted ? (
            <span>
              Hay {describeQuantity(item.quantity, item.unit)} de {describeQuantity(item.target, item.unit)}
            </span>
          ) : (
            <span>{purchaseText(rhythm)}</span>
          )}
          {price && <span>{price}</span>}
          {ownerLabel && <span>{ownerLabel}</span>}
        </span>
        {counted ? <StockStatus item={item} /> : showsRhythmStatus(rhythm) && <RhythmStatus rhythm={rhythm} />}
        {item.notes && <span className="pantry-item__notes">{item.notes}</span>}
      </div>
      {counted ? (
        <div className="stepper" role="group" aria-label={`Cantidad de ${item.name}`} aria-busy={busy || undefined}>
          <button
            type="button"
            className="stepper__btn"
            aria-label={`Quitar ${stepText} de ${item.name}`}
            disabled={busy || item.quantity === 0}
            onClick={() => onStep(-step)}
          >
            <Icon name="minus" />
          </button>
          <span className="stepper__value" aria-live="polite">
            {describeQuantity(item.quantity, item.unit)}
          </span>
          <button type="button" className="stepper__btn" aria-label={`Añadir ${stepText} a ${item.name}`} disabled={busy} onClick={() => onStep(step)}>
            <Icon name="plus" />
          </button>
        </div>
      ) : (
        <div className="pantry-item__actions">
          {out ? (
            <button type="button" className="btn btn--small" disabled={busy} onClick={() => onMark('comprado')}>
              <Icon name="check" size={16} />
              Lo he comprado<span className="sr-only"> {item.name}</span>
            </button>
          ) : (
            <button type="button" className="btn btn--small" disabled={busy} onClick={() => onMark('se_acabo')}>
              Se acabó<span className="sr-only"> {item.name}</span>
            </button>
          )}
        </div>
      )}
    </li>
  )
}

function ReviewBlock({
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

function RecentTickets({ tickets, onOpen }: { tickets: readonly PantryTicketSummary[]; onOpen: (id: string) => void }) {
  const [showAll, setShowAll] = useState(false)
  if (tickets.length === 0) return null
  const shown = showAll ? tickets : tickets.slice(0, RECENT_LIMIT)
  return (
    <Section id="pantry-tickets" title="Últimas compras">
      <ul className="recent-tickets">
        {shown.map((ticket) => (
          <li key={ticket.id}>
            <button type="button" className="recent-ticket" onClick={() => onOpen(ticket.id)}>
              <Icon name="list" />
              <span className="recent-ticket__text">
                <span className="recent-ticket__title">
                  {ticket.storeName} · {formatDate(ticket.date)}
                </span>
                <span className="muted small">
                  {ticket.productsCount === 1 ? '1 producto' : `${ticket.productsCount} productos`}
                  {ticket.time ? ` · ${ticket.time}` : ''}
                </span>
              </span>
              {ticket.totalCents !== null && <span className="recent-ticket__amount">{formatEuros(ticket.totalCents)}</span>}
            </button>
          </li>
        ))}
      </ul>
      {tickets.length > RECENT_LIMIT && (
        <button type="button" className="link-btn section-more" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Ver menos' : `Ver los ${tickets.length} tickets`}
        </button>
      )}
    </Section>
  )
}

function BudgetBlock({
  items,
  rhythms,
  budgetCents,
  onEdit,
}: {
  items: readonly PantryItem[]
  rhythms: Rhythms
  budgetCents: number | null
  onEdit: () => void
}) {
  const actions = usePantryActions()
  const { notify } = useToast()
  const estimate = monthlyEstimate(items, rhythms)
  const [busy, setBusy] = useState(false)
  const removeBudget = async () => {
    setBusy(true)
    try {
      await actions.setBudget(null)
      notify('Presupuesto de la despensa quitado')
    } catch (error) {
      notify(describeStorageError(error), 'error')
    } finally {
      setBusy(false)
    }
  }
  const partial =
    estimate.withoutPrice > 0
      ? `${estimate.withoutPrice === 1 ? 'Un producto no tiene' : `${estimate.withoutPrice} productos no tienen`} precio y no ${estimate.withoutPrice === 1 ? 'cuenta' : 'cuentan'} en la estimación.`
      : null

  return (
    <div className="pantry-budget">
      <h3 className="subsection-title">Estimación mensual de toda la casa</h3>
      <p className="muted small">
        Lo que se gasta al mes en la despensa (todas las personas y lo compartido), calculado con lo que costó cada producto la última
        vez y cada cuánto se compra. Es una estimación: no aparece en tus cuentas.
      </p>
      {budgetCents === null ? (
        <p>
          <strong>{formatEuros(estimate.cents)}</strong> al mes{partial ? ' (parcial)' : ''}.
        </p>
      ) : (
        <BudgetMeter kind="estimate" line={{ budgetCents, spentCents: estimate.cents, pendingCents: 0, leftCents: budgetCents - estimate.cents }} />
      )}
      {partial && <p className="muted small">{partial}</p>}
      <div className="button-row">
        <button type="button" className="btn btn--small" onClick={onEdit}>
          {budgetCents === null ? 'Fijar presupuesto' : 'Cambiar presupuesto'}
        </button>
        {budgetCents !== null && (
          <button type="button" className="btn btn--small btn--ghost" onClick={() => void removeBudget()} disabled={busy}>
            Quitar presupuesto
          </button>
        )}
      </div>
    </div>
  )
}

function SummaryBlock({
  items,
  rhythms,
  owner,
  people,
}: {
  items: readonly PantryItem[]
  rhythms: Rhythms
  owner: OwnerFilter
  people: readonly PantryPerson[]
}) {
  const summary = pantrySummary(items, owner, rhythms)
  const scope = owner === 'todo' ? 'en toda la casa' : owner === 'compartido' ? 'en lo compartido' : `de ${ownerName(owner, people)}`
  const { pendingCost } = summary
  return (
    <div className="pantry-summary__numbers">
      <p className="pantry-summary__big">
        {summary.missingCount === 0 ? (
          <>
            <Icon name="check" /> No falta nada {scope}.
          </>
        ) : (
          <>
            <Icon name="alert" /> {summary.missingCount === 1 ? 'Falta 1 producto' : `Faltan ${summary.missingCount} productos`} {scope}.
          </>
        )}
      </p>
      {summary.missingCount > 0 && (
        <p>
          {pendingCost.withoutPrice === summary.missingCount ? (
            'Sin precios, no se puede estimar lo que costará.'
          ) : (
            <>
              Compra pendiente estimada: <strong>{formatEuros(pendingCost.cents)}</strong>
              {pendingCost.withoutPrice > 0 &&
                ` (parcial: ${pendingCost.withoutPrice === 1 ? '1 producto sin precio' : `${pendingCost.withoutPrice} productos sin precio`})`}
              .
            </>
          )}
        </p>
      )}
    </div>
  )
}

const MARK_TEXT: Record<PantryEventKind, string> = {
  queda: 'queda. Te avisará más adelante.',
  poco: 'queda poco. Está en la lista de la compra.',
  se_acabo: 'se acabó. Está en la lista de la compra.',
  comprado: 'comprado hoy.',
}

/**
 * Despensa: escanear los tickets de la compra, lo que conviene revisar, la
 * lista de la compra y todos los productos. Es la misma página para invitados
 * y para quien ha escrito el código, y no depende de los datos financieros.
 */
/** La despensa con su propio estado: la usan igual el invitado y la app completa. */
export function DespensaPage() {
  return (
    <PantryProvider>
      <DespensaView />
    </PantryProvider>
  )
}

function DespensaView() {
  const { state, actions } = usePantry()
  const { notify } = useToast()
  const [ownerValue, setOwnerValue] = useState('todo')
  const [editing, setEditing] = useState<Editing>(null)
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set())
  const [retrying, setRetrying] = useState(false)

  const people = useMemo(() => (state.status === 'ready' ? state.people : []), [state])
  const items = useMemo(() => (state.status === 'ready' ? state.items : []), [state])
  const rhythms = useMemo<Rhythms>(
    () => (state.status === 'ready' ? rhythmsFor(state.items, state.activity, state.today) : new Map()),
    [state],
  )
  // Si la persona elegida ya no existe (la han borrado), se vuelve a «Todo».
  const owner: OwnerFilter = useMemo(() => {
    const parsed = parseOwner(ownerValue)
    return typeof parsed === 'object' && !people.some((p) => p.id === parsed.personId) ? 'todo' : parsed
  }, [ownerValue, people])
  const visible = useMemo(() => items.filter((item) => matchesOwner(item, owner)), [items, owner])
  const peopleById = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people])
  const listCount = useMemo(() => pantrySummary(items, 'todo', rhythms).missingCount, [items, rhythms])
  const schedule = useMemo(
    () =>
      state.status === 'ready'
        ? reviewSchedule(state.settings.lastReviewDate, state.items, state.activity.purchases, state.today)
        : { due: false, sinceDays: null },
    [state],
  )
  const [snoozedOn, setSnoozedOn] = useState<string | null>(readSnooze)

  /** Una acción cada vez por producto: la siguiente espera a la respuesta del servidor. */
  const withBusy = async (id: string, work: () => Promise<void>) => {
    if (busyIds.has(id)) return
    setBusyIds((current) => new Set(current).add(id))
    try {
      await work()
    } catch (error) {
      notify(describeStorageError(error), 'error')
    } finally {
      setBusyIds((current) => {
        const next = new Set(current)
        next.delete(id)
        return next
      })
    }
  }

  const step = (item: PantryItem, delta: number) => withBusy(item.id, () => actions.adjustItem(item.id, delta))

  const mark = (item: PantryItem, kind: PantryEventKind) =>
    withBusy(item.id, async () => {
      const event = await actions.addEvent(item.id, kind)
      notify(`${item.name}: ${MARK_TEXT[kind]}`, 'success', {
        action: {
          label: 'Deshacer',
          onAction: () => {
            actions.deleteEvent(event.id).then(
              () => notify('Deshecho'),
              (error: unknown) => notify(describeStorageError(error), 'error'),
            )
          },
        },
      })
    })

  const markPurchased = async (ids: string[]) => {
    const changes = await actions.markPurchased(ids)
    if (changes.length === 0) {
      notify('No había nada que completar: ya estaba todo.')
      return
    }
    notify(changes.length === 1 ? '1 producto comprado' : `${changes.length} productos comprados`, 'success', {
      action: {
        label: 'Deshacer',
        onAction: () => {
          actions.undoPurchase(changes).then(
            () => notify('Compra deshecha'),
            (error: unknown) => notify(describeStorageError(error), 'error'),
          )
        },
      },
    })
  }

  /** «Hoy no»: el aviso del repaso se queda en una línea hasta mañana (en este navegador). */
  const snooze = (today: string) => {
    try {
      localStorage.setItem(SNOOZE_KEY, today)
    } catch {
      // Sin almacenamiento en el navegador vale igual hasta recargar.
    }
    setSnoozedOn(today)
  }

  /** Lo que se repasa se decide al empezar: mientras se responde no cambia de orden. */
  const startReview = (today: string) => setEditing({ kind: 'review', queue: reviewItems(visible, rhythms, today).map((item) => item.id) })

  const defaultOwnerId = typeof owner === 'object' ? owner.personId : null
  const ready = state.status === 'ready'

  return (
    <div className="page pantry">
      <header className="page-header">
        <h1 className="page-title" tabIndex={-1}>
          Despensa
        </h1>
      </header>

      {ready && (
        <div className="pantry-actions">
          <button type="button" className="btn btn--primary pantry-actions__scan" onClick={() => setEditing({ kind: 'scan' })}>
            <Icon name="upload" />
            Escanear ticket
          </button>
          <button type="button" className="btn" onClick={() => setEditing({ kind: 'list' })}>
            <Icon name="list" />
            Lista de la compra{listCount > 0 ? ` (${listCount})` : ''}
          </button>
          <button type="button" className="btn" onClick={() => setEditing({ kind: 'item', item: null })}>
            <Icon name="plus" />
            Nuevo producto
          </button>
        </div>
      )}
      {state.status === 'ready' && state.items.length > 0 ? (
        <WeeklyReviewCard
          schedule={schedule}
          snoozed={snoozedOn === state.today}
          onStart={() => startReview(state.today)}
          onSnooze={() => snooze(state.today)}
        />
      ) : (
        <p className="lede">
          Escanea el ticket después de comprar: la app apunta cuándo compraste cada cosa y te avisa de lo que conviene mirar.
        </p>
      )}

      {state.status === 'loading' && (
        <p className="muted" role="status">
          Cargando la despensa…
        </p>
      )}

      {state.status === 'error' && (
        <div className="notice notice--error" role="alert">
          <Icon name="alert" />
          <div className="stack stack--tight">
            <span>No se ha podido cargar la despensa. {state.message}</span>
            <div>
              <button
                type="button"
                className="btn btn--small"
                disabled={retrying}
                onClick={() => {
                  setRetrying(true)
                  void actions.reload().finally(() => setRetrying(false))
                }}
              >
                {retrying ? 'Reintentando…' : 'Reintentar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {ready && (
        <>
          {/* «Personas» siempre, para poder darlas de alta antes del primer ticket; las pestañas, cuando hay algo que filtrar. */}
          <div className="pantry-owners">
            {(items.length > 0 || people.length > 0) && <OwnerTabs people={people} value={encodeOwner(owner)} onChange={setOwnerValue} />}
            <button type="button" className="btn" onClick={() => setEditing({ kind: 'people' })}>
              <Icon name="people" />
              Personas
            </button>
          </div>

          <ReviewBlock items={visible} rhythms={rhythms} busyIds={busyIds} onMark={(item, kind) => void mark(item, kind)} />
          <RecentTickets tickets={state.tickets} onOpen={(id) => setEditing({ kind: 'ticket', id })} />

          {items.length === 0 ? (
            <EmptyState
              title="Empieza escaneando un ticket"
              actions={
                <>
                  <button type="button" className="btn btn--primary" onClick={() => setEditing({ kind: 'scan' })}>
                    <Icon name="upload" />
                    Escanear un ticket
                  </button>
                  <button type="button" className="btn" onClick={() => setEditing({ kind: 'item', item: null })}>
                    <Icon name="plus" />
                    Añadir el primer producto
                  </button>
                </>
              }
            >
              <p>
                Haz una captura del ticket en la app de Lidl Plus (o una foto del ticket de papel) y elígela: los productos se apuntan
                solos. También puedes añadirlos a mano.
              </p>
            </EmptyState>
          ) : (
            <>
              <section className="sheet pantry-summary" aria-labelledby="pantry-summary-title">
                <h2 id="pantry-summary-title" className="sr-only">
                  Resumen
                </h2>
                <SummaryBlock items={items} rhythms={rhythms} owner={owner} people={people} />
                <BudgetBlock
                  items={items}
                  rhythms={rhythms}
                  budgetCents={state.settings.monthlyBudgetCents}
                  onEdit={() => setEditing({ kind: 'budget' })}
                />
              </section>

              {visible.length === 0 ? (
                <EmptyState
                  title={`No hay productos ${owner === 'compartido' ? 'compartidos' : `de ${ownerName(owner, people)}`}`}
                  actions={
                    <button type="button" className="btn btn--primary" onClick={() => setEditing({ kind: 'item', item: null })}>
                      <Icon name="plus" />
                      Añadir un producto
                    </button>
                  }
                >
                  <p>Elige «Todo» para ver los de toda la casa.</p>
                </EmptyState>
              ) : (
                PANTRY_FREQUENCIES.map((frequency) => {
                  const group = visible.filter((item) => item.frequency === frequency)
                  return (
                    <Section key={frequency} id={`pantry-${frequency}`} title={FREQUENCY_TITLES[frequency]}>
                      {group.length === 0 ? (
                        <p className="muted small">Ningún producto en este bloque.</p>
                      ) : (
                        <ul className="pantry-list">
                          {group.map((item) => (
                            <PantryRow
                              key={item.id}
                              item={item}
                              rhythm={rhythms.get(item.id)}
                              ownerLabel={
                                owner === 'todo' && people.length > 0 ? (item.ownerId ? (peopleById.get(item.ownerId) ?? '') : 'Compartido') : null
                              }
                              busy={busyIds.has(item.id)}
                              onEdit={() => setEditing({ kind: 'item', item })}
                              onStep={(delta) => void step(item, delta)}
                              onMark={(kind) => void mark(item, kind)}
                            />
                          ))}
                        </ul>
                      )}
                    </Section>
                  )
                })
              )}
            </>
          )}

          {editing?.kind === 'scan' && (
            <TicketScanDialog
              items={items}
              people={people}
              defaultOwnerId={defaultOwnerId ?? ''}
              onSaved={(ticket) =>
                notify(`Ticket guardado: ${ticket.productsCount === 1 ? '1 producto apuntado' : `${ticket.productsCount} productos apuntados`}`)
              }
              onClose={() => setEditing(null)}
            />
          )}
          {editing?.kind === 'review' && (
            <WeeklyReviewDialog
              queue={editing.queue}
              items={items}
              rhythms={rhythms}
              people={people}
              listCount={listCount}
              onShowList={() => setEditing({ kind: 'list' })}
              onClose={() => setEditing(null)}
            />
          )}
          {editing?.kind === 'ticket' && (
            <TicketDetailDialog ticketId={editing.id} items={items} onClose={() => setEditing(null)} />
          )}
          {editing?.kind === 'item' && (
            <PantryItemDialog
              item={editing.item}
              people={people}
              defaultOwnerId={defaultOwnerId}
              rhythm={editing.item ? rhythms.get(editing.item.id) : undefined}
              onSave={async (input) => {
                await actions.saveItem(editing.item?.id ?? null, input)
                notify(editing.item ? 'Cambios guardados' : 'Producto añadido')
              }}
              onDelete={async () => {
                if (!editing.item) return
                await actions.deleteItem(editing.item.id)
                notify('Producto eliminado')
              }}
              onClose={() => setEditing(null)}
            />
          )}
          {editing?.kind === 'people' && (
            <PeopleDialog
              people={people}
              onCreate={actions.createPerson}
              onRename={actions.renamePerson}
              onDelete={actions.deletePerson}
              onClose={() => setEditing(null)}
            />
          )}
          {editing?.kind === 'budget' && (
            <PantryBudgetDialog
              budgetCents={state.settings.monthlyBudgetCents}
              onSave={async (cents) => {
                await actions.setBudget(cents)
                notify(cents === null ? 'Presupuesto de la despensa quitado' : 'Presupuesto de la despensa guardado')
              }}
              onClose={() => setEditing(null)}
            />
          )}
          {editing?.kind === 'list' && (
            <ShoppingListDialog
              items={items}
              people={people}
              rhythms={rhythms}
              initialOwner={owner}
              onMarkPurchased={markPurchased}
              onClose={() => setEditing(null)}
            />
          )}
        </>
      )}
    </div>
  )
}
