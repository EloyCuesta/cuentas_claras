import { formatEuros, MINUS } from '../../shared/common/money.ts'
import type { MovementType } from '../../shared/finance/types.ts'

/** Importe con signo según el tipo: −54,30 € (gasto) o +1.850,00 € (ingreso). */
export function Amount({ cents, type, pending = false }: { cents: number; type: MovementType; pending?: boolean }) {
  const classes = ['amount', `amount--${type}`, pending ? 'amount--pending' : ''].filter(Boolean).join(' ')
  return (
    <span className={classes}>
      {type === 'gasto' ? MINUS : '+'}
      {formatEuros(cents)}
    </span>
  )
}

/** Total con signo; los negativos ("números rojos") se marcan en rojo. */
export function Total({ cents, className = '' }: { cents: number; className?: string }) {
  return <span className={`${className} ${cents < 0 ? 'is-negative' : ''}`.trim()}>{formatEuros(cents, 'always')}</span>
}
