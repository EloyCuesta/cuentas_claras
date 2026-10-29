import type { Router } from 'express'
import type { OpenedDatabase } from '../../common/sqlite/openDatabase.ts'
import { healthRoutes } from './adapters/http/routes.ts'

/**
 * Módulo health: solo GET /api/health. No tiene casos de uso ni puertos: el
 * SELECT 1 se prepara aquí una vez y el router lo ejecuta en cada petición.
 */
export function createHealthModule({ database }: { database: OpenedDatabase }): { router: Router } {
  const ping = database.db.prepare('SELECT 1')
  return { router: healthRoutes({ ping: () => void ping.get(), schemaVersion: database.schemaVersion }) }
}
