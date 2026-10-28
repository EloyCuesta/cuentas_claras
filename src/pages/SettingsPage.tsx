import { BackupPanel } from '../components/BackupPanel.tsx'
import { CategoryEditor } from '../components/CategoryEditor.tsx'

export function SettingsPage() {
  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title" tabIndex={-1}>
          Ajustes
        </h1>
      </header>
      <div className="settings-grid">
        <BackupPanel />
        <CategoryEditor />
      </div>
    </div>
  )
}
