import { useEffect, useMemo, useState } from 'react'
import {
  FREQUENCY_TITLES,
  matchesName,
  matchesOwner,
  PANTRY_FREQUENCIES,
  pantrySummary,
  type OwnerFilter,
  type Rhythms,
} from '#shared/pantry/pantry.ts'
import { reviewItems, reviewSchedule } from '#shared/pantry/pantryReview.ts'
import { rhythmsFor } from '#shared/pantry/pantryRhythm.ts'
import type { PantryEventKind, PantryItem, PantryPerson } from '#shared/pantry/types.ts'
import { describeStorageError } from '../../api/storageErrors.ts'
import { EmptyState } from '../../ui/EmptyState.tsx'
import { Icon } from '../../ui/Icon.tsx'
import { Section } from '../../ui/Section.tsx'
import { useToast } from '../../ui/toastContext.ts'
import { TicketDetailDialog, TicketScanDialog } from '../tickets/index.ts'
import { BudgetBlock } from './components/BudgetBlock.tsx'
import { OwnerTabs } from './components/owner.tsx'
import { encodeOwner, ownerName, parseOwner } from './components/ownerFilter.ts'
import { PantryBudgetDialog } from './components/PantryBudgetDialog.tsx'
import { itemUpdate } from './components/itemEdit.ts'
import { PantryItemDialog } from './components/PantryItemDialog.tsx'
import { PantryRow } from './components/PantryRow.tsx'
import { PeopleDialog } from './components/PeopleDialog.tsx'
import { RecentTickets } from './components/RecentTickets.tsx'
import { ReviewBlock } from './components/ReviewBlock.tsx'
import { ShoppingListDialog } from './components/ShoppingListDialog.tsx'
import { SummaryBlock } from './components/SummaryBlock.tsx'
import { WeeklyReviewCard, WeeklyReviewDialog } from './components/WeeklyReview.tsx'
import { usePantry } from './pantryContext.ts'
import { Skeleton } from '../../ui/Loading.tsx'

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
/** La persona elegida («Todo», «Compartido» o una persona): se recuerda en este navegador. */
const OWNER_KEY = 'cuentas-claras:despensa-persona'

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Sin almacenamiento en el navegador vale igual hasta recargar.
  }
}

const NO_PEOPLE: PantryPerson[] = []
const NO_ITEMS: PantryItem[] = []

const MARK_TEXT: Record<PantryEventKind, string> = {
  queda: 'queda. Te avisará más adelante.',
  poco: 'queda poco. Está en la lista de la compra.',
  se_acabo: 'se acabó. Está en la lista de la compra.',
  comprado: 'comprado hoy.',
}

/**
 * Despensa: escanear los tickets de la compra, lo que conviene revisar, la
 * lista de la compra y todos los productos. Es la misma página para invitados
 * y para quien ha escrito el código, y no depende de los datos financieros. Su
 * estado vive en PantryProvider: al volver a ella se ve al momento y se relee
 * en segundo plano (también al volver a la pestaña).
 */
export function DespensaPage() {
  const { state, actions } = usePantry()
  const { notify } = useToast()
  const [ownerValue, setOwnerValue] = useState(() => readStored(OWNER_KEY) ?? 'todo')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Editing>(null)
  const [retrying, setRetrying] = useState(false)

  // Al abrir la Despensa (la primera vez, carga; después, relee sin quitar lo que se ve) y al volver a la pestaña.
  useEffect(() => {
    void actions.reload()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void actions.reload()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [actions])

  // Cada cálculo depende solo de lo que usa: releer los tickets, por ejemplo, no recalcula el ritmo de los productos.
  const loaded = state.status === 'ready' ? state : null
  const people = loaded?.people ?? NO_PEOPLE
  const items = loaded?.items ?? NO_ITEMS
  const activity = loaded?.activity ?? null
  const today = loaded?.today ?? null
  const lastReviewDate = loaded?.settings.lastReviewDate ?? null
  const rhythms = useMemo<Rhythms>(
    () => (activity && today ? rhythmsFor(items, activity, today) : new Map()),
    [items, activity, today],
  )
  // Si la persona elegida ya no existe (la han borrado), se vuelve a «Todo».
  const owner: OwnerFilter = useMemo(() => {
    const parsed = parseOwner(ownerValue)
    return typeof parsed === 'object' && !people.some((p) => p.id === parsed.personId) ? 'todo' : parsed
  }, [ownerValue, people])
  const visible = useMemo(() => items.filter((item) => matchesOwner(item, owner)), [items, owner])
  const found = useMemo(() => visible.filter((item) => matchesName(item, query)), [visible, query])
  const peopleById = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people])
  const listCount = useMemo(() => pantrySummary(items, 'todo', rhythms).missingCount, [items, rhythms])
  const schedule = useMemo(
    () => (activity && today ? reviewSchedule(lastReviewDate, items, activity.purchases, today) : { due: false, sinceDays: null }),
    [lastReviewDate, items, activity, today],
  )
  const [snoozedOn, setSnoozedOn] = useState<string | null>(() => readStored(SNOOZE_KEY))

  const chooseOwner = (value: string) => {
    setOwnerValue(value)
    store(OWNER_KEY, value)
  }

  /** + y −: se ve al momento; los pasos de un producto van al servidor de uno en uno (PantryProvider). Si falla, se avisa. */
  const step = (item: PantryItem, delta: number) =>
    actions.adjustItem(item.id, delta).catch((error: unknown) => notify(describeStorageError(error), 'error'))

  const mark = (item: PantryItem, kind: PantryEventKind) =>
    actions.addEvent(item.id, kind).then(
      (event) =>
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
        }),
      (error: unknown) => notify(describeStorageError(error), 'error'),
    )

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
    store(SNOOZE_KEY, today)
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

      {state.status === 'loading' && <Skeleton label="Cargando la despensa…" />}

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
            {(items.length > 0 || people.length > 0) && <OwnerTabs people={people} value={encodeOwner(owner)} onChange={chooseOwner} />}
            {/* En el móvil, solo el icono (el nombre sigue para los lectores de pantalla), para que quepa junto a las pestañas. */}
            <button type="button" className="btn pantry-owners__people" title="Personas" onClick={() => setEditing({ kind: 'people' })}>
              <Icon name="people" />
              <span className="pantry-owners__people-label">Personas</span>
            </button>
          </div>

          <ReviewBlock items={visible} rhythms={rhythms} onMark={(item, kind) => void mark(item, kind)} />

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
              {/* El buscador, para llegar a + y − de cualquier producto sin recorrer los bloques. */}
              <div className="search pantry-search">
                <Icon name="search" />
                <label className="sr-only" htmlFor="pantry-search">
                  Buscar producto
                </label>
                <input
                  id="pantry-search"
                  type="search"
                  className="input"
                  autoComplete="off"
                  enterKeyHint="search"
                  placeholder="Buscar producto"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>

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
              ) : found.length === 0 ? (
                <p className="muted" role="status">
                  Ningún producto se llama «{query.trim()}»{owner === 'todo' ? '' : ` en ${ownerName(owner, people)}`}.
                </p>
              ) : (
                PANTRY_FREQUENCIES.map((frequency) => {
                  // Los bloques sin productos (o sin ninguno de los buscados) no se muestran.
                  const group = found.filter((item) => item.frequency === frequency)
                  if (group.length === 0) return null
                  return (
                    <Section key={frequency} id={`pantry-${frequency}`} title={FREQUENCY_TITLES[frequency]}>
                      <ul className="pantry-list">
                        {group.map((item) => (
                          <PantryRow
                            key={item.id}
                            item={item}
                            rhythm={rhythms.get(item.id)}
                            ownerLabel={
                              owner === 'todo' && people.length > 0 ? (item.ownerId ? (peopleById.get(item.ownerId) ?? '') : 'Compartido') : null
                            }
                            onEdit={() => setEditing({ kind: 'item', item })}
                            onStep={(delta) => void step(item, delta)}
                            onMark={(kind) => void mark(item, kind)}
                          />
                        ))}
                      </ul>
                    </Section>
                  )
                })
              )}
            </>
          )}

          {/* Lo que se mira de vez en cuando, plegado: las últimas compras, el resumen y el presupuesto. */}
          {(state.tickets.length > 0 || items.length > 0) && (
            <details className="pantry-more">
              <summary>{state.tickets.length > 0 ? 'Últimas compras, resumen y presupuesto' : 'Resumen y presupuesto'}</summary>
              <div className="pantry-more__body">
                <RecentTickets tickets={state.tickets} onOpen={(id) => setEditing({ kind: 'ticket', id })} />
                {items.length > 0 && (
                  <section className="sheet pantry-summary" aria-labelledby="pantry-summary-title">
                    <h2 id="pantry-summary-title" className="sr-only">
                      Resumen
                    </h2>
                    <SummaryBlock items={items} rhythms={rhythms} owner={owner} people={people} />
                    <BudgetBlock
                      items={items}
                      rhythms={rhythms}
                      budgetCents={state.settings.monthlyBudgetCents}
                      actions={actions}
                      onEdit={() => setEditing({ kind: 'budget' })}
                    />
                  </section>
                )}
              </div>
            </details>
          )}

          {editing?.kind === 'scan' && (
            <TicketScanDialog
              items={items}
              people={people}
              defaultOwnerId={defaultOwnerId ?? ''}
              actions={actions}
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
              actions={actions}
              onShowList={() => setEditing({ kind: 'list' })}
              onClose={() => setEditing(null)}
            />
          )}
          {editing?.kind === 'ticket' && (
            <TicketDetailDialog ticketId={editing.id} items={items} actions={actions} onClose={() => setEditing(null)} />
          )}
          {editing?.kind === 'item' && (
            <PantryItemDialog
              item={editing.item}
              people={people}
              defaultOwnerId={defaultOwnerId}
              rhythm={editing.item ? rhythms.get(editing.item.id) : undefined}
              onSave={async (input, opened) => {
                if (opened) await actions.updateItem(opened.id, itemUpdate(opened, input))
                else await actions.createItem(input)
                notify(opened ? 'Cambios guardados' : 'Producto añadido')
              }}
              onReload={actions.reloadItem}
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
