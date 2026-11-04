import { Router } from 'express'
import { sendData } from '../../../../common/http/response.ts'

/**
 * GET /api/health: el servidor responde y MySQL contesta a un ping.
 * Es pública, así que no dice a qué servidor ni a qué base se conecta, ni nada
 * de los datos. `ping` falla si MySQL no responde (y entonces la respuesta es
 * un 500).
 */
export function healthRoutes({ ping, schemaVersion }: { ping: () => Promise<void>; schemaVersion: number }): Router {
  const router = Router()
  router.get('/health', async (_req, res) => {
    await ping()
    sendData(res, { status: 'ok', schemaVersion })
  })
  return router
}
