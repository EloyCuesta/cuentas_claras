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
    // La relectura va en segundo plano: el aviso llega en cuanto falla.
    await vi.waitFor(() => expect(onReloadFailed).toHaveBeenCalledTimes(1))
    expect(onReloadFailed).toHaveBeenCalledWith(failure)
  })

  it('el cambio entra en la pantalla en cuanto se guarda, y no se espera a la relectura (UX-01)', async () => {
    const order: string[] = []
    let finishReload: () => void = () => undefined
    const reload = () => new Promise<void>((resolve) => {
      order.push('releer')
      finishReload = resolve
    })
    const apply = vi.fn((result: number) => order.push(`pantalla ${result}`))
    const result = await writeThenReload(async () => { order.push('guardar'); return 7 }, reload, vi.fn(), apply)
    // La acción ya ha terminado aunque la relectura siga pendiente.
    expect(result).toBe(7)
    expect(order).toEqual(['guardar', 'pantalla 7', 'releer'])
    finishReload()
  })

  it('si la escritura falla, la pantalla no cambia', async () => {
    const apply = vi.fn()
    await expect(writeThenReload(() => Promise.reject(new Error('no')), async () => undefined, vi.fn(), apply)).rejects.toThrow('no')
    expect(apply).not.toHaveBeenCalled()
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
