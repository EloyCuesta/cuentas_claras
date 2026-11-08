import { useEffect, useMemo, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { monthView, yearView, type MonthView, type YearView } from '#shared/finance/summaryViews.ts'
import { describeStorageError } from '../../api/storageErrors.ts'
import { summaryApi } from './api.ts'
import { useFinance } from './financeContext.ts'

/** Con la web compilada para .NET (CUENTAS_BACKEND=dotnet), los resúmenes los calcula el servidor (FIN-04). */
const SERVER_SUMMARIES = __CUENTAS_BACKEND__ === 'dotnet'

export type SummaryState<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; view: T }

/**
 * Espera la respuesta del servidor: una que llega tarde no pisa a la última pedida, y mientras llega la nueva se sigue
 * enseñando la anterior.
 */
function follow<T>(response: Promise<T>, latest: RefObject<number>, setState: Dispatch<SetStateAction<SummaryState<T>>>): void {
  const request = ++latest.current
  response.then(
    (view) => {
      if (latest.current === request) setState({ status: 'ready', view })
    },
    (error: unknown) => {
      if (latest.current === request) setState({ status: 'error', message: describeStorageError(error) })
    },
  )
}

/**
 * La plantilla mensual: calculada en el navegador contra Express, o pedida a .NET de nuevo cuando cambian los datos
 * (después de cada escritura), la fecha de hoy o el mes.
 */
export function useMonthView(year: number, month: number): SummaryState<MonthView> {
  const { data, today } = useFinance()
  const local = useMemo(() => (SERVER_SUMMARIES ? null : monthView(data, today, year, month)), [data, today, year, month])
  const [remote, setRemote] = useState<SummaryState<MonthView>>({ status: 'loading' })
  const latest = useRef(0)
  useEffect(() => {
    if (SERVER_SUMMARIES) follow(summaryApi.month(year, month, today), latest, setRemote)
  }, [data, today, year, month])
  return local ? { status: 'ready', view: local } : remote
}

/** La plantilla anual: calculada en el navegador contra Express, o pedida a .NET de nuevo cuando cambian los datos, hoy o el año. */
export function useYearView(year: number): SummaryState<YearView> {
  const { data, today } = useFinance()
  const local = useMemo(() => (SERVER_SUMMARIES ? null : yearView(data, today, year)), [data, today, year])
  const [remote, setRemote] = useState<SummaryState<YearView>>({ status: 'loading' })
  const latest = useRef(0)
  useEffect(() => {
    if (SERVER_SUMMARIES) follow(summaryApi.year(year, today), latest, setRemote)
  }, [data, today, year])
  return local ? { status: 'ready', view: local } : remote
}
