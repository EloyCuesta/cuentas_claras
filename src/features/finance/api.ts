import { apiRequest } from '../../api/client.ts'
import type { ISODate } from '#shared/common/types.ts'
import type { MonthView, YearView } from '#shared/finance/summaryViews.ts'

/**
 * Las consultas de resumen del backend .NET (FIN-04), que calculan en el servidor lo mismo que
 * shared/finance/summaryViews.ts. Solo se usan con la web compilada para .NET (CUENTAS_BACKEND=dotnet): Express no las
 * tiene. `today` es la fecha de hoy del navegador, que decide lo que se proyecta.
 */
export const summaryApi = {
  month: (year: number, month: number, today: ISODate) =>
    apiRequest<MonthView>('GET', `/summary/month?year=${year}&month=${month}&hoy=${encodeURIComponent(today)}`),
  year: (year: number, today: ISODate) => apiRequest<YearView>('GET', `/summary/year?year=${year}&hoy=${encodeURIComponent(today)}`),
}
