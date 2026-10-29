import { useMemo } from 'react'
import { generationHorizon, projectOccurrences } from '#shared/finance/recurring.ts'
import type { ISODate } from '#shared/common/types.ts'
import type { Movement } from '#shared/finance/types.ts'
import { useFinance } from './financeContext.ts'

/**
 * Movimientos guardados más los vencimientos proyectados de los recurrentes
 * hasta `until`, para que la previsión de meses lejanos los incluya. Solo para
 * los cálculos del resumen: los proyectados no se pueden pagar ni editar.
 */
export function useForecastMovements(until: ISODate): Movement[] {
  const { data, today } = useFinance()
  return useMemo(() => {
    const projected = projectOccurrences(data.recurring, data.movements, generationHorizon(today), until)
    return projected.length > 0 ? [...data.movements, ...projected] : data.movements
  }, [data.movements, data.recurring, today, until])
}
