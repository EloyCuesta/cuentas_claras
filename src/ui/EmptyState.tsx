import type { ReactNode } from 'react'

/** Mensaje para pantallas vacías: qué falta y cómo empezar. */
export function EmptyState({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="empty">
      <h2 className="empty__title">{title}</h2>
      <div className="empty__text">{children}</div>
      {actions && <div className="empty__actions">{actions}</div>}
    </div>
  )
}
