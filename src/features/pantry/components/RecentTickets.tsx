import { useState } from 'react'
import { formatDate } from '#shared/common/dates.ts'
import { formatEuros } from '#shared/common/money.ts'
import type { PantryTicketSummary } from '#shared/tickets/types.ts'
import { Icon } from '../../../ui/Icon.tsx'
import { Section } from '../../../ui/Section.tsx'

/** «Últimas compras»: los tickets guardados (3, y «Ver los n tickets»); cada uno abre su detalle. */

const RECENT_LIMIT = 3

export function RecentTickets({ tickets, onOpen }: { tickets: readonly PantryTicketSummary[]; onOpen: (id: string) => void }) {
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
