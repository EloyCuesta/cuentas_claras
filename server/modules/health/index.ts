import type { Router } from 'express'
import type { OpenedDatabase } from '../../common/mysql/MysqlDatabase.ts'
import { healthRoutes } from './adapters/http/routes.ts'

/**
 * Módulo health: solo GET /api/health. No tiene casos de uso ni puertos: el
 * router hace ping a MySQL (SELECT 1) en cada petición con la función que le
 * da este archivo.
 */
export function createHealthModule({ database }: { database: OpenedDatabase }): { router: Router } {
  return { router: healthRoutes({ ping: () => database.db.ping(), schemaVersion: database.schemaVersion }) }
}
