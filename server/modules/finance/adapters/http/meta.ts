import { Router } from 'express'
import { META_KEYS, type MetaKey } from '#shared/finance/meta.ts'
import { AppError } from '../../../../common/errors.ts'
import { readBody } from '../../../../common/http/request.ts'
import { sendData } from '../../../../common/http/response.ts'
import type { FinanceQueries } from '../../application/queries.ts'
import type { SetMeta } from '../../application/SetMeta.ts'

function readKey(value: string): MetaKey {
  if (!(META_KEYS as readonly string[]).includes(value)) throw new AppError('NOT_FOUND', `No existe el dato «${value}».`)
  return value as MetaKey
}

/** GET y PUT /api/meta/:key: datos auxiliares (fecha de la última copia descargada…). */
export function metaRoutes({ queries, setMeta }: { queries: FinanceQueries; setMeta: SetMeta }): Router {
  const router = Router()

  router.get('/meta/:key', (req, res) => {
    sendData(res, { value: queries.getMeta(readKey(req.params.key)) })
  })

  router.put('/meta/:key', (req, res) => {
    const key = readKey(req.params.key)
    const { value } = readBody(req.body)
    if (typeof value !== 'string' || value.length > 100) {
      throw new AppError('VALIDATION', 'El campo «value» debe ser un texto de 100 caracteres como máximo.')
    }
    setMeta.execute(key, value)
    sendData(res, null)
  })

  return router
}
