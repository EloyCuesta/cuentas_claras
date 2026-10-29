import { periodUnit, type Period } from '#shared/finance/period.ts'
import type { BudgetLine } from '#shared/finance/summary.ts'
import { BudgetMeter } from './BudgetMeter.tsx'
import { Section } from './Section.tsx'

/** Consumo de las categorías con presupuesto en un periodo, con enlace a Presupuestos. */
export function BudgetSummary({ id, title, lines, period }: { id: string; title: string; lines: BudgetLine[]; period: Period }) {
  const withBudget = lines.filter((line) => line.budgetCents !== null)
  return (
    <Section
      id={id}
      title={title}
      aside={
        <a className="link-btn" href="#presupuestos">
          {withBudget.length > 0 ? 'Ver todos' : 'Fijar presupuestos'}
        </a>
      }
    >
      {withBudget.length === 0 ? (
        <p className="muted">Fija un máximo mensual para las categorías que quieras vigilar, como Alimentación u Ocio.</p>
      ) : (
        <>
          {period.kind === 'anual' && <p className="section-sub">El presupuesto anual es el mensual multiplicado por doce.</p>}
          <ul className="budget-mini">
            {withBudget.map((line) => (
              <li key={line.category.id}>
                <span className="budget-mini__name">{line.category.name}</span>
                <BudgetMeter line={line} unit={periodUnit(period)} />
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  )
}
