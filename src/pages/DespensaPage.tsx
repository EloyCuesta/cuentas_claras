import { useMemo, useState } from 'react'
import { BudgetMeter } from '../components/BudgetMeter.tsx'
import { EmptyState } from '../components/EmptyState.tsx'
import { Icon } from '../components/Icon.tsx'
import { OwnerTabs } from '../components/pantry/owner.tsx'
import { encodeOwner, ownerName, parseOwner } from '../components/pantry/ownerFilter.ts'
import { PantryBudgetDialog } from '../components/pantry/PantryBudgetDialog.tsx'
import { PantryItemDialog } from '../components/pantry/PantryItemDialog.tsx'
import { PeopleDialog } from '../components/pantry/PeopleDialog.tsx'
import { ShoppingListDialog } from '../components/pantry/ShoppingListDialog.tsx'
import { Section } from '../components/Section.tsx'
import { formatEuros } from '../domain/money.ts'
import {
  describeQuantity,
  excessQuantity,
  FREQUENCY_TITLES,
  matchesOwner,
  missingQuantity,
  monthlyEstimate,
  PANTRY_FREQUENCIES,
  pantrySummary,
  priceUnitLabel,
  quantityStep,
  type OwnerFilter,
} from '../domain/pantry.ts'
import type { PantryItem, PantryPerson } from '../domain/types.ts'
import { describeStorageError } from '../state/storageErrors.ts'
import { useToast } from '../state/toastContext.ts'
import { usePantry, type PantryActions } from '../state/usePantry.ts'

type Editing = { kind: 'item'; item: PantryItem | null } | { kind: 'people' } | { kind: 'budget' } | { kind: 'list' } | null

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
  ownerLabel,
  busy,
  onEdit,
  onStep,
}: {
  item: PantryItem
  /** Dueño, solo en la vista «Todo». */
  ownerLabel: string | null
  busy: boolean
  onEdit: () => void
  onStep: (delta: number) => void
}) {
  const step = quantityStep(item.unit)
  const stepText = describeQuantity(step, item.unit)
  const price = priceText(item)
  return (
    <li className="pantry-item">
      <div className="pantry-item__main">
        <button type="button" className="pantry-item__name" onClick={onEdit}>
          <span className="sr-only">Editar </span>
          {item.name}
        </button>
        <span className="pantry-item__meta">
          <span>
            Hay {describeQuantity(item.quantity, item.unit)} de {describeQuantity(item.target, item.unit)}
          </span>
          {price && <span>{price}</span>}
          {ownerLabel && <span>{ownerLabel}</span>}
        </span>
        <StockStatus item={item} />
        {item.notes && <span className="pantry-item__notes">{item.notes}</span>}
      </div>
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
        <button
          type="button"
          className="stepper__btn"
          aria-label={`Añadir ${stepText} a ${item.name}`}
          disabled={busy}
          onClick={() => onStep(step)}
        >
          <Icon name="plus" />
        </button>
      </div>
    </li>
  )
}

function BudgetBlock({
  items,
  budgetCents,
  actions,
  onEdit,
}: {
  items: readonly PantryItem[]
  budgetCents: number | null
  actions: PantryActions
  onEdit: () => void
}) {
  const { notify } = useToast()
  const estimate = monthlyEstimate(items)
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
        Lo que costaría al mes comprar el objetivo de cada producto según su frecuencia (todas las personas y lo compartido).
        Es una estimación: no es un gasto ni aparece en tus cuentas.
      </p>
      {budgetCents === null ? (
        <p>
          <strong>{formatEuros(estimate.cents)}</strong> al mes{partial ? ' (parcial)' : ''}.
        </p>
      ) : (
        <BudgetMeter
          kind="estimate"
          line={{ budgetCents, spentCents: estimate.cents, pendingCents: 0, leftCents: budgetCents - estimate.cents }}
        />
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

function SummaryBlock({ items, owner, people }: { items: readonly PantryItem[]; owner: OwnerFilter; people: readonly PantryPerson[] }) {
  const summary = pantrySummary(items, owner)
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
            <Icon name="alert" /> {summary.missingCount === 1 ? 'Falta 1 producto' : `Faltan ${summary.missingCount} productos`}{' '}
            {scope}.
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

/**
 * Despensa: lo que hay en casa, lo que falta y la lista de la compra. Es la
 * misma página para invitados y para quien ha escrito el código, y no depende
 * de los datos financieros.
 */
export function DespensaPage() {
  const { state, actions } = usePantry()
  const { notify } = useToast()
  const [ownerValue, setOwnerValue] = useState('todo')
  const [editing, setEditing] = useState<Editing>(null)
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set())
  const [retrying, setRetrying] = useState(false)

  const people = useMemo(() => (state.status === 'ready' ? state.people : []), [state])
  const items = useMemo(() => (state.status === 'ready' ? state.items : []), [state])
  // Si la persona elegida ya no existe (la han borrado), se vuelve a «Todo».
  const owner: OwnerFilter = useMemo(() => {
    const parsed = parseOwner(ownerValue)
    return typeof parsed === 'object' && !people.some((p) => p.id === parsed.personId) ? 'todo' : parsed
  }, [ownerValue, people])
  const visible = useMemo(() => items.filter((item) => matchesOwner(item, owner)), [items, owner])
  const peopleById = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people])

  const step = async (item: PantryItem, delta: number) => {
    // Una pulsación cada vez por producto: la siguiente espera a la respuesta del servidor.
    if (busyIds.has(item.id)) return
    setBusyIds((current) => new Set(current).add(item.id))
    try {
      await actions.adjustItem(item.id, delta)
    } catch (error) {
      notify(describeStorageError(error), 'error')
    } finally {
      setBusyIds((current) => {
        const next = new Set(current)
        next.delete(item.id)
        return next
      })
    }
  }

  const markPurchased = async (ids: string[]) => {
    const changes = await actions.markPurchased(ids)
    if (changes.length === 0) {
      notify('No había nada que completar: ya estaba todo.')
      return
    }
    notify(changes.length === 1 ? '1 producto completado' : `${changes.length} productos completados`, 'success', {
      action: {
        label: 'Deshacer',
        onAction: () => {
          actions.undoPurchase(changes).then(
            () => notify('Compra deshecha: se han recuperado las cantidades anteriores'),
            (error: unknown) => notify(describeStorageError(error), 'error'),
          )
        },
      },
    })
  }

  const defaultOwnerId = typeof owner === 'object' ? owner.personId : null
  const ready = state.status === 'ready'

  return (
    <div className="page pantry">
      <header className="page-header">
        <h1 className="page-title" tabIndex={-1}>
          Despensa
        </h1>
        {ready && (
          <div className="page-header__tools">
            <button type="button" className="btn" onClick={() => setEditing({ kind: 'list' })}>
              <Icon name="list" />
              Lista de la compra
            </button>
            <button type="button" className="btn btn--primary" onClick={() => setEditing({ kind: 'item', item: null })}>
              <Icon name="plus" />
              Nuevo producto
            </button>
          </div>
        )}
      </header>
      <p className="lede">
        Lo que hay en casa y lo que falta, de cada persona y de lo compartido. Pulsa − al gastar algo y + al reponerlo.
      </p>

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
          <div className="pantry-owners">
            <OwnerTabs people={people} value={encodeOwner(owner)} onChange={setOwnerValue} />
            <button type="button" className="btn" onClick={() => setEditing({ kind: 'people' })}>
              <Icon name="people" />
              Personas
            </button>
          </div>

          <section className="sheet pantry-summary" aria-labelledby="pantry-summary-title">
            <h2 id="pantry-summary-title" className="sr-only">
              Resumen
            </h2>
            <SummaryBlock items={items} owner={owner} people={people} />
            <BudgetBlock
              items={items}
              budgetCents={state.settings.monthlyBudgetCents}
              actions={actions}
              onEdit={() => setEditing({ kind: 'budget' })}
            />
          </section>

          {items.length === 0 ? (
            <EmptyState
              title="La despensa está vacía"
              actions={
                <button type="button" className="btn btn--primary" onClick={() => setEditing({ kind: 'item', item: null })}>
                  <Icon name="plus" />
                  Añadir el primer producto
                </button>
              }
            >
              <p>
                Apunta lo que soléis tener en casa: leche, huevos, arroz… Indica cuánto hay y cuánto queréis tener, y verás de
                un vistazo lo que falta.
              </p>
            </EmptyState>
          ) : visible.length === 0 ? (
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
                          ownerLabel={owner === 'todo' ? (item.ownerId ? (peopleById.get(item.ownerId) ?? '') : 'Compartido') : null}
                          busy={busyIds.has(item.id)}
                          onEdit={() => setEditing({ kind: 'item', item })}
                          onStep={(delta) => void step(item, delta)}
                        />
                      ))}
                    </ul>
                  )}
                </Section>
              )
            })
          )}

          {editing?.kind === 'item' && (
            <PantryItemDialog
              item={editing.item}
              people={people}
              defaultOwnerId={defaultOwnerId}
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
