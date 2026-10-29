import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Bases de datos temporales para los tests: cada una en su propia carpeta del
 * directorio temporal del sistema, nunca en server/data.
 */
const folders: string[] = []

export function tempDbPath(): string {
  const folder = mkdtempSync(join(tmpdir(), 'cuentas-claras-test-'))
  folders.push(folder)
  return join(folder, 'cuentas.db')
}

/** Borra las carpetas temporales (cerrar antes las conexiones). */
export function removeTempDbs(): void {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
}
