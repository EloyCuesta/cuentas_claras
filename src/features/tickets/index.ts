/**
 * Feature tickets: escanear, revisar y ver los tickets de la compra (ver
 * AGENTS.md). Es lo único que puede importar de ella la feature pantry, que
 * abre estos diálogos desde la Despensa y les da las acciones (TicketActions).
 */
import { lazyComponent } from '../../ui/lazyComponent.tsx'

export type { TicketActions } from './ticketActions.ts'

// Los diálogos (con la lectura, el análisis de las imágenes y la revisión) se descargan aparte, al abrirlos por
// primera vez (UX-06): quien abre la Despensa no los descarga hasta que escanea o abre un ticket.
export const TicketScanDialog = lazyComponent(() => import('./TicketScanDialog.tsx').then((loaded) => loaded.TicketScanDialog))
export const TicketDetailDialog = lazyComponent(() => import('./TicketDetailDialog.tsx').then((loaded) => loaded.TicketDetailDialog))
