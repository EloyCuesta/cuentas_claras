import { SessionPanel } from '../../auth/index.ts'
import { Skeleton } from '../../../ui/Loading.tsx'
import { lazyComponent } from '../../../ui/lazyComponent.tsx'

// Las copias de seguridad y el editor de categorías se descargan al abrir los Ajustes (UX-06).
const BackupPanel = lazyComponent(
  () => import('../components/BackupPanel.tsx').then((loaded) => loaded.BackupPanel),
  <Skeleton label="Cargando las copias de seguridad…" blocks={1} />,
)
const CategoryEditor = lazyComponent(
  () => import('../components/CategoryEditor.tsx').then((loaded) => loaded.CategoryEditor),
  <Skeleton label="Cargando las categorías…" blocks={1} />,
)

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
        <SessionPanel />
      </div>
    </div>
  )
}
