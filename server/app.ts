import express, { Router, type Express } from 'express'
import type { OpenedDatabase } from './database.ts'
import { errorHandler, notFoundHandler } from './http.ts'
import type { SqliteFinanceRepository } from './repository.ts'
import { categoryRoutes } from './routes/categories.ts'
import { dataRoutes } from './routes/data.ts'
import { healthRoutes } from './routes/health.ts'
import { metaRoutes } from './routes/meta.ts'
import { movementRoutes } from './routes/movements.ts'
import { recurringRoutes } from './routes/recurring.ts'
import { testingRoutes } from './routes/testing.ts'

export interface AppOptions {
  database: OpenedDatabase
  repository: SqliteFinanceRepository
  /** Activa POST /api/test/reset (solo para las pruebas en navegador). */
  testMode?: boolean
}

/** La aplicación Express con todas las rutas bajo /api. No escucha en ningún puerto (eso lo hace index.ts). */
export function createApp({ database, repository, testMode = false }: AppOptions): Express {
  const app = express()
  app.disable('x-powered-by')
  // Una copia de seguridad grande cabe de sobra en 20 MB.
  app.use(express.json({ limit: '20mb' }))

  const api = Router()
  api.use(healthRoutes(database))
  api.use(dataRoutes(repository))
  api.use(movementRoutes(repository))
  api.use(categoryRoutes(repository))
  api.use(recurringRoutes(repository))
  api.use(metaRoutes(repository))
  if (testMode) api.use(testingRoutes(repository))
  api.use(notFoundHandler)

  app.use('/api', api)
  app.use(errorHandler)
  return app
}
