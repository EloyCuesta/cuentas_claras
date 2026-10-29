import { Router } from 'express'
import { sendData } from './response.ts'

/**
 * POST /api/test/reset: deja la base de datos como recién creada antes de cada
 * prueba en navegador, despensa incluida. Solo existe si el servidor se arranca
 * con CUENTAS_TEST=1 (lo hace playwright.config.ts con una base de datos aparte),
 * nunca con npm run dev. Como el resto de rutas financieras, exige sesión:
 * app.ts la monta detrás de requireAdmin.
 *
 * No sabe qué tablas se vacían: app.ts le pasa el reset de cada módulo.
 */
export function testingRoutes(reset: () => void | Promise<void>): Router {
  const router = Router()
  router.post('/test/reset', async (_req, res) => {
    await reset()
    sendData(res, null)
  })
  return router
}
