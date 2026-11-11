import { describe, expect, it } from 'vitest'
import type { PantryItem } from '#shared/pantry/types.ts'
import { ApiError, ServerUnavailableError } from '../../../api/client.ts'
import { GONE_MESSAGE, isStaleEdit, itemUpdate, reloadedEdit, toDraft } from './itemEdit.ts'

const opened: PantryItem = {
  id: 'p-1',
  name: 'Arroz',
  ownerId: null,
  unit: 'kg',
  tracking: 'cantidad',
  quantity: 1.5,
  target: 2,
  frequency: 'mensual',
  priceCents: 120,
  notes: 'redondo',
  version: 3,
  createdAt: '2026-11-01T08:00:00.000Z',
  updatedAt: '2026-11-01T08:00:00.000Z',
}

describe('editar un producto sin pisar otro cambio', () => {
  it('envía la versión con la que se abrió el formulario, no otra', () => {
    const input = { name: 'Arroz', ownerId: 'eloy', unit: 'kg', tracking: 'cantidad', quantity: 1, target: 4, frequency: 'mensual', priceCents: null, notes: '' } as const
    expect(itemUpdate(opened, input)).toEqual({ ...input, expectedVersion: 3 })
  })

  it('solo un 409 del servidor es un conflicto de versión', () => {
    expect(isStaleEdit(new ApiError('Este producto ha cambiado…', 409, 'CONFLICT'))).toBe(true)
    expect(isStaleEdit(new ApiError('Ese producto ya no existe.', 404, 'NOT_FOUND'))).toBe(false)
    expect(isStaleEdit(new ApiError('El campo…', 400, 'VALIDATION'))).toBe(false)
    expect(isStaleEdit(new ServerUnavailableError())).toBe(false)
    expect(isStaleEdit(new Error('otro'))).toBe(false)
  })

  it('volver a cargar muestra el producto como está ahora y toma su versión', () => {
    const current = { ...opened, quantity: 0.25, ownerId: 'ana', priceCents: null, notes: 'integral', version: 5 }
    expect(reloadedEdit(current)).toEqual({
      ok: true,
      opened: current,
      draft: { name: 'Arroz', ownerId: 'ana', unit: 'kg', tracking: 'cantidad', quantity: '0,25', target: '2', frequency: 'mensual', price: '', notes: 'integral' },
    })
  })

  it('si lo han borrado, lo dice y no se puede seguir editando', () => {
    expect(reloadedEdit(null)).toEqual({ ok: false, error: GONE_MESSAGE })
  })

  it('el borrador de un producto compartido deja el dueño vacío y el precio con coma', () => {
    expect(toDraft(opened)).toMatchObject({ ownerId: '', quantity: '1,5', price: '1,20' })
  })
})
