import { Router } from 'express'
import { sendData } from '../../../../common/http/response.ts'

/**
 * GET /api/health: el servidor responde y la base de datos se puede consultar.
 * Es pública, así que no dice dónde está el archivo ni nada de los datos.
 * `ping` lanza si la base de datos no responde (y entonces la respuesta es un 500).
 */
export function healthRoutes({ ping, schemaVersion }: { ping: () => void; schemaVersion: number }): Router {
  const router = Router()
  router.get('/health', (_req, res) => {
    ping()
    sendData(res, { status: 'ok', schemaVersion })
  })
  return router
}
