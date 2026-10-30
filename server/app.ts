import express, { Router, type Express } from 'express'
import { SqliteFinanceRepository } from './finance/repository.ts'
import { categoryRoutes } from './finance/routes/categories.ts'
import { dataRoutes } from './finance/routes/data.ts'
import { metaRoutes } from './finance/routes/meta.ts'
import { movementRoutes } from './finance/routes/movements.ts'
import { recurringRoutes } from './finance/routes/recurring.ts'
import { AccessControl, authRoutes, requireAdmin } from './infra/auth.ts'
import type { OpenedDatabase } from './infra/database.ts'
import { healthRoutes } from './infra/health.ts'
import { errorHandler, notFoundHandler } from './infra/http.ts'
import { SqliteContext, type SqliteContextOptions } from './infra/sqlite.ts'
import { testingRoutes } from './infra/testing.ts'
import { SqlitePantryRepository } from './pantry/repository.ts'
import { pantryRoutes } from './pantry/routes.ts'
import { createTesseractReader, type TicketReader } from './tickets/ocr.ts'
import { SqliteTicketRepository } from './tickets/repository.ts'
import { ticketRoutes } from './tickets/routes.ts'
import { TicketService } from './tickets/service.ts'

export interface AppOptions {
  database: OpenedDatabase
  /** Código que da acceso a las finanzas (CUENTAS_CODIGO). Obligatorio: sin él no se crea la aplicación. */
  accessCode: string
  /** Activa POST /api/test/reset (solo para las pruebas en navegador). También exige sesión. */
  testMode?: boolean
  /** Reloj en milisegundos para las sesiones y los bloqueos (inyectable en los tests). */
  clock?: () => number
  /** Reloj e ids de los repositorios (inyectables en los tests). */
  sqlite?: SqliteContextOptions
  /** Lector de tickets (OCR). Por defecto, Tesseract en este equipo; los tests pasan uno falso. */
  ticketReader?: TicketReader
}

/**
 * La aplicación Express con todas las rutas bajo /api. No escucha en ningún
 * puerto (eso lo hace index.ts).
 *
 * Orden: salud, acceso y despensa son públicas; después requireAdmin; y detrás
 * todas las rutas financieras (datos, importación, movimientos, categorías,
 * recurrentes, generación de vencimientos, metadatos y el reinicio de pruebas).
 */
export function createApp({
  database,
  accessCode,
  testMode = false,
  clock,
  sqlite,
  ticketReader,
}: AppOptions): Express {
  // Lanza si falta el código o no es válido: nunca hay una aplicación con el acceso abierto.
  const access = new AccessControl(accessCode, clock)
  const ctx = new SqliteContext(database.db, sqlite)
  const repository = new SqliteFinanceRepository(ctx)
  const pantry = new SqlitePantryRepository(ctx)
  const tickets = new SqliteTicketRepository(ctx, pantry)
  const reader = ticketReader ?? createTesseractReader()

  const app = express()
  app.disable('x-powered-by')
  // Solo se confía en el proxy de Vite del propio equipo: req.ip es la IP real del móvil,
  // y una cabecera X-Forwarded-For inventada por un cliente de la red no sirve para nada.
  app.set('trust proxy', 'loopback')
  // Varias capturas de un ticket caben en 30 MB; el resto de peticiones (una copia de seguridad grande), en 20 MB.
  app.use('/api/despensa/tickets/leer', express.json({ limit: '30mb' }))
  app.use(express.json({ limit: '20mb' }))

  const api = Router()
  // Ni la sesión ni los datos privados deben quedarse en la caché del navegador o de un proxy.
  api.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store')
    next()
  })
  api.use(healthRoutes(database))
  api.use(authRoutes(access))
  api.use(pantryRoutes(pantry))
  api.use(ticketRoutes(tickets, new TicketService(tickets, pantry, reader)))

  api.use(requireAdmin(access))
  api.use(dataRoutes(repository))
  api.use(movementRoutes(repository))
  api.use(categoryRoutes(repository))
  api.use(recurringRoutes(repository))
  api.use(metaRoutes(repository))
  if (testMode) api.use(testingRoutes(repository, pantry))
  api.use(notFoundHandler)

  app.use('/api', api)
  app.use(errorHandler)
  return app
}
