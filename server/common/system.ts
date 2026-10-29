import { todayISO } from '#shared/common/dates.ts'
import { newId, nowISO } from '#shared/common/ids.ts'
import type { Clock, IdGenerator } from './ports.ts'

/** El reloj de verdad. Los tests pasan otro a createApp (solo las partes que necesitan). */
export const systemClock: Clock = {
  nowMs: () => Date.now(),
  nowISO: () => nowISO(),
  today: () => todayISO(),
}

/** UUID v4 con crypto.randomUUID (global en Node y en el navegador). */
export const randomIds: IdGenerator = {
  newId: () => newId(),
}
