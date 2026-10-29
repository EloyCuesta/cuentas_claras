import express, { Router, type Express } from 'express'
import { errorHandler, notFoundHandler } from './common/http/response.ts'
import { testingRoutes } from './common/http/testingRoutes.ts'
import type { Clock, IdGenerator } from './common/ports.ts'
import type { OpenedDatabase } from './common/sqlite/openDatabase.ts'
import { SqliteUnitOfWork } from './common/sqlite/SqliteUnitOfWork.ts'
import { randomIds, systemClock } from './common/system.ts'
import { createAuthModule } from './modules/auth/index.ts'
import { createHealthModule } from './modules/health/index.ts'
import { createPantryModule } from './modules/pantry/index.ts'
import { createTesseractReader, type TicketReader } from './ocr.ts'
import { SqliteFinanceRepository } from './repository.ts'
import { categoryRoutes } from './routes/categories.ts'
import { dataRoutes } from './routes/data.ts'
import { metaRoutes } from './routes/meta.ts'
import { movementRoutes } from './routes/movements.ts'
import { recurringRoutes } from './routes/recurring.ts'
import { ticketRoutes } from './routes/tickets.ts'
import { SqliteTicketRepository } from './ticketRepository.ts'

export interface AppOptions {
  database: OpenedDatabase
  /** Código que da acceso a las finanzas (CUENTAS_CODIGO). Obligatorio: sin él no se crea la aplicación. */
  accessCode: string
  /** Activa POST /api/test/reset (solo para las pruebas en navegador). También exige sesión. */
  testMode?: boolean
  /** Reloj del servidor: sesiones, bloqueos, marcas de tiempo y la fecha de respaldo (inyectable en los tests). */
  clock?: Clock
  /** Ids de lo que crea el servidor (inyectables en los tests). */
  ids?: IdGenerator
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
  clock = systemClock,
  ids = randomIds,
  ticketReader,
}: AppOptions): Express {
  // Lanza si falta el código o no es válido: nunca hay una aplicación con el acceso abierto.
  const auth = createAuthModule({ accessCode, clock })
  const health = createHealthModule({ database })
  const unitOfWork = new SqliteUnitOfWork(database.db)
  const deps = { db: database.db, clock, ids, unitOfWork }
  const stamps = { now: () => clock.nowISO(), newId: () => ids.newId() }
  const repository = new SqliteFinanceRepository(database.db, stamps)
  const pantry = createPantryModule(deps)
  const tickets = new SqliteTicketRepository(database.db, pantry.api, stamps)
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
  api.use(health.router)
  api.use(auth.router)
  api.use(pantry.router)
  api.use(ticketRoutes(tickets, pantry.api, reader))

  api.use(auth.requireAdmin)
  api.use(dataRoutes(repository))
  api.use(movementRoutes(repository))
  api.use(categoryRoutes(repository))
  api.use(recurringRoutes(repository))
  api.use(metaRoutes(repository))
  if (testMode) {
    api.use(
      testingRoutes(async () => {
        await repository.reset()
        pantry.reset()
      }),
    )
  }
  api.use(notFoundHandler)

  app.use('/api', api)
  app.use(errorHandler)
  return app
}
