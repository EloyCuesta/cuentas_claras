/**
 * Feature finance: las cuentas (ver AGENTS.md). Es lo único que pueden
 * importar de ella la raíz (Root, App) y las demás features.
 */
export { ApiFinanceRepository } from './ApiFinanceRepository.ts'
export { describeBrowserMigration, migrateBrowserData } from './browserMigration/browserDataMigration.ts'
export { MovementDialog } from './components/MovementDialog.tsx'
export { PaymentDialog } from './components/PaymentDialog.tsx'
export { useFinance } from './financeContext.ts'
export { FinanceProvider } from './FinanceProvider.tsx'
export { BudgetsPage } from './pages/BudgetsPage.tsx'
export { MovementsPage } from './pages/MovementsPage.tsx'
export { RecurringPage } from './pages/RecurringPage.tsx'
export { SettingsPage } from './pages/SettingsPage.tsx'
export { SummaryPage } from './pages/SummaryPage.tsx'
export { YearPage } from './pages/YearPage.tsx'
