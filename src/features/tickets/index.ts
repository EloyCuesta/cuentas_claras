/**
 * Feature tickets: escanear, revisar y ver los tickets de la compra (ver
 * AGENTS.md). Es lo único que puede importar de ella la feature pantry, que
 * abre estos diálogos desde la Despensa y les da las acciones (TicketActions).
 */
export type { TicketActions } from './ticketActions.ts'
export { TicketDetailDialog } from './TicketDetailDialog.tsx'
export { TicketScanDialog } from './TicketScanDialog.tsx'
