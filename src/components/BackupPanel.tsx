import { useRef, useState, type ChangeEvent } from 'react'
import { parseBackup, serializeBackup, type BackupSummary } from '#shared/finance/backup.ts'
import { movementsToCsv } from '#shared/finance/csv.ts'
import { formatDateTime } from '#shared/common/dates.ts'
import { nowISO } from '#shared/common/ids.ts'
import type { FinanceData } from '#shared/finance/types.ts'
import { useFinance } from '../state/financeContext.ts'
import { describeStorageError } from '../state/storageErrors.ts'
import { useToast } from '../state/toastContext.ts'
import { downloadFile } from '../ui/helpers.ts'
import { ConfirmDialog } from './Dialog.tsx'
import { Icon } from './Icon.tsx'

/** Una copia de Cuentas claras nunca debería acercarse a este tamaño. */
const MAX_BACKUP_BYTES = 50 * 1024 * 1024

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

/** Exportar a JSON, restaurar desde JSON (con validación y confirmación) y exportar a CSV. */
export function BackupPanel() {
  const { data, today, lastBackupAt, actions } = useFinance()
  const { notify } = useToast()
  const fileInput = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<{ data: FinanceData; summary: BackupSummary; fileName: string } | null>(null)
  const [restoreError, setRestoreError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const exportJson = async () => {
    downloadFile(serializeBackup(data, nowISO()), `cuentas-claras-copia-${today}.json`, 'application/json')
    notify('Copia de seguridad descargada')
    try {
      await actions.registerBackup()
    } catch {
      // No es grave: solo se pierde la fecha de la última copia.
    }
  }

  const exportCsv = () => {
    // El BOM (\uFEFF) hace que Excel reconozca las tildes (UTF-8).
    downloadFile(`\uFEFF${movementsToCsv(data.movements, data.categories)}`, `cuentas-claras-movimientos-${today}.csv`, 'text/csv;charset=utf-8')
    notify(`CSV descargado con ${plural(data.movements.length, 'movimiento', 'movimientos')}`)
  }

  const chooseFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = '' // permite volver a elegir el mismo archivo
    if (!file) return
    setRestoreError(null)
    if (file.size > MAX_BACKUP_BYTES) {
      setRestoreError('El archivo es demasiado grande para ser una copia de Cuentas claras.')
      return
    }
    const result = parseBackup(await file.text())
    if (!result.ok) {
      setRestoreError(result.error)
      return
    }
    setPending({ data: result.data, summary: result.summary, fileName: file.name })
  }

  const restore = async () => {
    if (!pending) return
    setBusy(true)
    try {
      await actions.replaceAll(pending.data)
      setPending(null)
      notify('Copia restaurada')
    } catch (error) {
      setSaveError(describeStorageError(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="sheet stack" aria-labelledby="backup-title">
      <h2 id="backup-title" className="section-title">
        Tus datos y copias de seguridad
      </h2>
      <div className="notice">
        <Icon name="info" />
        <div className="stack stack--tight">
          <p>
            <strong>Los datos se guardan en una base de datos SQLite de este equipo</strong> (el archivo{' '}
            <code>server/data/cuentas.db</code> de la aplicación). No se envían a internet.
          </p>
          <p>
            Si borras ese archivo o cambias de equipo, no los verás. Descarga una copia de seguridad de vez en cuando y
            guárdala en un lugar seguro.
          </p>
        </div>
      </div>
      <p>
        Última copia:{' '}
        <strong>{lastBackupAt ? formatDateTime(lastBackupAt) : 'todavía no has descargado ninguna'}</strong>.
      </p>
      <div className="button-row">
        <button type="button" className="btn btn--primary" onClick={() => void exportJson()}>
          <Icon name="download" />
          Descargar copia (JSON)
        </button>
        <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
          <Icon name="upload" />
          Restaurar una copia…
        </button>
        <button type="button" className="btn" onClick={exportCsv} disabled={data.movements.length === 0}>
          <Icon name="table" />
          Exportar movimientos (CSV)
        </button>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(event) => void chooseFile(event)}
        data-testid="restore-input"
      />
      {restoreError && (
        <p className="notice notice--error" role="alert">
          <Icon name="alert" />
          <span>No se ha restaurado nada. {restoreError}</span>
        </p>
      )}
      <p className="muted small">
        El CSV se abre en Excel o LibreOffice: usa punto y coma como separador, coma decimal y los gastos en negativo.
      </p>

      {pending && (
        <ConfirmDialog
          title="Restaurar copia"
          confirmLabel="Sustituir mis datos"
          danger
          busy={busy}
          error={saveError}
          onConfirm={() => void restore()}
          onClose={() => {
            setSaveError(null)
            setPending(null)
          }}
        >
          <p>
            Archivo «{pending.fileName}»
            {pending.summary.exportedAt ? `, creado el ${formatDateTime(pending.summary.exportedAt)}` : ''}. Contiene{' '}
            {plural(pending.summary.movements, 'movimiento', 'movimientos')},{' '}
            {plural(pending.summary.recurring, 'recurrente', 'recurrentes')} y{' '}
            {plural(pending.summary.categories, 'categoría', 'categorías')}.
          </p>
          <p>
            <strong>Se sustituirán todos los datos actuales de la base de datos</strong> (
            {plural(data.movements.length, 'movimiento', 'movimientos')}). No se puede deshacer.
          </p>
          <p>
            Si quieres conservarlos,{' '}
            <button type="button" className="link-btn" onClick={() => void exportJson()}>
              descarga antes una copia
            </button>
            .
          </p>
        </ConfirmDialog>
      )}
    </section>
  )
}
