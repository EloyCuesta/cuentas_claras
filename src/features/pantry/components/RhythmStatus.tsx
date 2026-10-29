import { RHYTHM_LABELS, type ItemRhythm, type RhythmStatus as Status } from '#shared/pantry/pantryRhythm.ts'
import { Icon } from '../../../ui/Icon.tsx'

const TONES: Record<Status, string> = {
  sin_compras: '',
  al_dia: 'chip--done',
  revisar: 'chip--warn',
  queda_poco: 'chip--warn',
  probablemente_acabado: 'chip--late',
  se_acabo: 'chip--late',
}

/** Etiqueta del ritmo de compra: «Revisar pronto», «Queda poco», «Probablemente se acabó»… */
export function RhythmStatus({ rhythm }: { rhythm: ItemRhythm | undefined }) {
  const status = rhythm?.status ?? 'sin_compras'
  const icon = status === 'al_dia' ? 'check' : status === 'sin_compras' ? 'info' : 'alert'
  return (
    <span className={`chip ${TONES[status]}`.trim()}>
      <Icon name={icon} size={14} />
      {RHYTHM_LABELS[status]}
    </span>
  )
}
