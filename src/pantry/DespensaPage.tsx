import { useMemo, useState } from 'react'
import {
  FREQUENCY_TITLES,
  matchesOwner,
  type OwnerFilter,
  PANTRY_FREQUENCIES,
  pantrySummary,
  type Rhythms,
} from '../../shared/pantry/pantry.ts'
import { reviewItems, reviewSchedule } from '../../shared/pantry/review.ts'
import { rhythmsFor } from '../../shared/pantry/rhythm.ts'
import type { PantryEventKind, PantryItem } from '../../shared/pantry/types.ts'
import { describeStorageError } from '../api/storageErrors.ts'
import { EmptyState } from '../ui/EmptyState.tsx'
import { Icon } from '../ui/Icon.tsx'
import { Section } from '../ui/Section.tsx'
import { useToast } from '../ui/toastContext.ts'
import { OwnerTabs } from './components/owner.tsx'
import { encodeOwner, ownerName, parseOwner } from './components/ownerFilter.ts'
import { PantryBudgetDialog } from './components/PantryBudgetDialog.tsx'
import { PantryItemDialog } from './components/PantryItemDialog.tsx'
import { PantryRow } from './components/PantryRow.tsx'
import { BudgetBlock, SummaryBlock } from './components/PantrySummary.tsx'
import { PeopleDialog } from './components/PeopleDialog.tsx'
import { RecentTickets } from './components/RecentTickets.tsx'
import { ReviewBlock } from './components/ReviewBlock.tsx'
import { ShoppingListDialog } from './components/ShoppingListDialog.tsx'
import { TicketDetailDialog } from './components/TicketDetailDialog.tsx'
import { TicketScanDialog } from './components/TicketScanDialog.tsx'
import { WeeklyReviewCard, WeeklyReviewDialog } from './components/WeeklyReview.tsx'
import { usePantry } from './pantryContext.ts'
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

/** «Hoy no» en el aviso del repaso: se recuerda solo en este navegador y solo hoy. */
const SNOOZE_KEY = 'cuentas-claras:repaso-pospuesto'

function readSnooze(): string | null {
  try {
    return localStorage.getItem(SNOOZE_KEY)
  } catch {
    return null
  }
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
 * y para quien ha escrito el código, y no depende de los datos financieros:
 * tiene su propio estado (PantryProvider).
 */
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
