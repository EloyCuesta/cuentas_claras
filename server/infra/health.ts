import { Router } from 'express'
import type { OpenedDatabase } from './database.ts'
import { sendData } from './http.ts'

/**
 * GET /api/health: el servidor responde y la base de datos se puede consultar.
 * Es pública, así que no dice dónde está el archivo ni nada de los datos.
 */
export function healthRoutes(database: OpenedDatabase): Router {
  const router = Router()
  const ping = database.db.prepare('SELECT 1')
  router.get('/health', (_req, res) => {
    ping.get()
    sendData(res, { status: 'ok', schemaVersion: database.schemaVersion })
  })
  return router
}
