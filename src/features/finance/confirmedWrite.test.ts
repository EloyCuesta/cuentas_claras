import { describe, expect, it, vi } from 'vitest'
import { writeThenReload } from './confirmedWrite.ts'

describe('escribir y releer (guardado confirmado frente a recarga fallida)', () => {
  it('si la escritura falla, el error llega a quien guardaba y no se relee', async () => {
    const reload = vi.fn(async () => undefined)
    const onReloadFailed = vi.fn()
    await expect(writeThenReload(() => Promise.reject(new Error('no se ha guardado')), reload, onReloadFailed)).rejects.toThrow('no se ha guardado')
    expect(reload).not.toHaveBeenCalled()
    expect(onReloadFailed).not.toHaveBeenCalled()
  })

  it('si se guardó y la relectura falla, no se rechaza: se avisa una vez y se devuelve lo guardado', async () => {
    const failure = new Error('sin red')
    const onReloadFailed = vi.fn()
    const result = await writeThenReload(async () => 3, () => Promise.reject(failure), onReloadFailed)
    expect(result).toBe(3)
    expect(onReloadFailed).toHaveBeenCalledTimes(1)
    expect(onReloadFailed).toHaveBeenCalledWith(failure)
  })

  it('si todo va bien, relee después de guardar y no avisa', async () => {
    const order: string[] = []
    const onReloadFailed = vi.fn()
    await writeThenReload(
      async () => {
        order.push('guardar')
      },
      async () => {
        order.push('releer')
      },
      onReloadFailed,
    )
    expect(order).toEqual(['guardar', 'releer'])
    expect(onReloadFailed).not.toHaveBeenCalled()
  })
})
