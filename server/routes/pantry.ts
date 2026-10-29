import { Router } from 'express'
import {
  validateBudgetInput,
  validateDeltaInput,
  validateEventInput,
  validateItemInput,
  validatePersonInput,
  validatePurchaseInput,
  validateReviewInput,
  validateUndoInput,
} from '#shared/pantry/pantryValidation.ts'
import { sendData, valid } from '../http.ts'
import type { SqlitePantryRepository } from '../pantryRepository.ts'

/**
 * Despensa. Rutas públicas a propósito: las puede usar cualquiera de casa,
 * sepa o no el código de acceso. No devuelven ningún dato financiero.
 *
 * Personas
 * - GET    /api/despensa/personas            lista ordenada por nombre
 * - POST   /api/despensa/personas            { name } → 201 con la persona creada
 * - PUT    /api/despensa/personas/:id        { name } → la persona renombrada
 * - DELETE /api/despensa/personas/:id        409 si todavía tiene productos
 * Productos
 * - GET    /api/despensa/productos           lista ordenada por frecuencia y nombre
 * - POST   /api/despensa/productos           PantryItemInput → 201 con el producto (id, versión y fechas del servidor)
 * - PUT    /api/despensa/productos/:id       PantryItemInput → el producto actualizado
 * - POST   /api/despensa/productos/:id/ajustar  { delta } → suma o resta a la cantidad actual (botones + y −)
 * - POST   /api/despensa/productos/:id/revision { kind: 'queda' | 'poco' | 'se_acabo' | 'comprado', date } → 201 con la revisión
 * - DELETE /api/despensa/revisiones/:id        deshace una revisión
 * - DELETE /api/despensa/productos/:id
 * Presupuesto y repaso de la semana
 * - GET    /api/despensa/presupuesto         { monthlyBudgetCents, lastReviewDate }
 * - PUT    /api/despensa/presupuesto         { monthlyBudgetCents: número o null }
 * - PUT    /api/despensa/repaso              { date } → apunta el día del repaso de la semana
 * Compra
 * - POST   /api/despensa/comprado            { ids, date? } → { changes, items }
 * - POST   /api/despensa/comprado/deshacer   { changes } → items, o 409 si algo cambió después
 *
 * Los id inexistentes responden 404 sin cambiar nada.
 */
export function pantryRoutes(pantry: SqlitePantryRepository): Router {
  const router = Router()

  router.get('/despensa/personas', (_req, res) => {
    sendData(res, pantry.listPeople())
  })

  router.post('/despensa/personas', (req, res) => {
    sendData(res, pantry.createPerson(valid(validatePersonInput(req.body)).name), 201)
  })

  router.put('/despensa/personas/:id', (req, res) => {
    sendData(res, pantry.renamePerson(req.params.id, valid(validatePersonInput(req.body)).name))
  })

  router.delete('/despensa/personas/:id', (req, res) => {
    pantry.deletePerson(req.params.id)
    sendData(res, null)
  })

  router.get('/despensa/productos', (_req, res) => {
    sendData(res, pantry.listItems())
  })

  router.post('/despensa/productos', (req, res) => {
    sendData(res, pantry.createItem(valid(validateItemInput(req.body))), 201)
  })

  router.put('/despensa/productos/:id', (req, res) => {
    sendData(res, pantry.updateItem(req.params.id, valid(validateItemInput(req.body))))
  })

  router.post('/despensa/productos/:id/ajustar', (req, res) => {
    sendData(res, pantry.adjustItem(req.params.id, valid(validateDeltaInput(req.body))))
  })

  router.post('/despensa/productos/:id/revision', (req, res) => {
    const { kind, date } = valid(validateEventInput(req.body))
    sendData(res, pantry.addEvent(req.params.id, kind, date), 201)
  })

  router.delete('/despensa/revisiones/:id', (req, res) => {
    pantry.deleteEvent(req.params.id)
    sendData(res, null)
  })

  router.delete('/despensa/productos/:id', (req, res) => {
    pantry.deleteItem(req.params.id)
    sendData(res, null)
  })

  router.get('/despensa/presupuesto', (_req, res) => {
    sendData(res, pantry.getSettings())
  })

  router.put('/despensa/presupuesto', (req, res) => {
    sendData(res, pantry.setBudget(valid(validateBudgetInput(req.body)).monthlyBudgetCents))
  })

  router.put('/despensa/repaso', (req, res) => {
    sendData(res, pantry.setReviewDate(valid(validateReviewInput(req.body)).date))
  })

  router.post('/despensa/comprado', (req, res) => {
    const { ids, date } = valid(validatePurchaseInput(req.body))
    sendData(res, pantry.markPurchased(ids, date))
  })

  router.post('/despensa/comprado/deshacer', (req, res) => {
    sendData(res, pantry.undoPurchase(valid(validateUndoInput(req.body))))
  })

  return router
}
