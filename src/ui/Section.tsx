import type { ReactNode } from 'react'

/** Hoja con su título y, a la derecha, una acción opcional (enlace o botón). */
export function Section({
  id,
  title,
  aside,
  className = '',
  children,
}: {
  /** Prefijo del id del título: "budget" -> "budget-title". */
  id: string
  title: ReactNode
  aside?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <section className={`sheet ${className}`.trim()} aria-labelledby={`${id}-title`}>
      <div className="section-head">
        <h2 id={`${id}-title`} className="section-title">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  )
}
