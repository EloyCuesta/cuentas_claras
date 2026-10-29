import { Router } from 'express'
import { META_KEYS, type MetaKey } from '#shared/finance/meta.ts'
import { AppError } from '../errors.ts'
import { readBody, sendData } from '../http.ts'
import type { SqliteFinanceRepository } from '../repository.ts'

function readKey(value: string): MetaKey {
  if (!(META_KEYS as readonly string[]).includes(value)) throw new AppError('NOT_FOUND', `No existe el dato «${value}».`)
  return value as MetaKey
}

/** GET y PUT /api/meta/:key: datos auxiliares (fecha de la última copia descargada…). */
export function metaRoutes(repository: SqliteFinanceRepository): Router {
  const router = Router()

  router.get('/meta/:key', async (req, res) => {
    sendData(res, { value: await repository.getMeta(readKey(req.params.key)) })
  })

  router.put('/meta/:key', async (req, res) => {
    const key = readKey(req.params.key)
    const { value } = readBody(req.body)
    if (typeof value !== 'string' || value.length > 100) {
      throw new AppError('VALIDATION', 'El campo «value» debe ser un texto de 100 caracteres como máximo.')
    }
    await repository.setMeta(key, value)
    sendData(res, null)
  })

  return router
}
