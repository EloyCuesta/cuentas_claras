import { planCaptures, type Plan, type PlanSource } from './ticketPlan.ts'

/**
 * El análisis de solapes de las capturas (planCaptures), fuera del hilo
 * principal: así la ventana no se congela mientras se comparan las capturas.
 * Lo arranca `ticketImages.ts`; si el navegador no puede, calcula lo mismo en
 * el hilo principal.
 */

export interface PlanRequest { id: number; sources: PlanSource[] }
export type PlanResponse = { id: number; plan: Plan } | { id: number; error: string }

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<PlanRequest>) => void) | null
  postMessage: (message: PlanResponse) => void
}

scope.onmessage = ({ data }) => {
  try {
    scope.postMessage({ id: data.id, plan: planCaptures(data.sources) })
  } catch (error) {
    scope.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) })
  }
}
