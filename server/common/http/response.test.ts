import { afterEach, describe, expect, it, vi } from 'vitest'
import { startApi, stopApis } from '../testing/testApi.ts'
import { removeTempDbs } from '../testing/tempDb.ts'

/**
 * Contrato del host Express que debe conocer la migración: errores completos,
 * límites reales del lector JSON y cabeceras observadas, también sus carencias.
 * Solo abre bases temporales; no modifica el middleware para hacer pasar los tests.
 */

afterEach(async () => {
  await stopApis()
  removeTempDbs()
  vi.restoreAllMocks()
})

const invalidJson = {
  ok: false,
  error: { code: 'VALIDATION', message: 'El cuerpo de la petición no es JSON válido.' },
}
const tooLarge = {
  ok: false,
  error: { code: 'VALIDATION', message: 'Los datos enviados son demasiado grandes.' },
}

/** JSON ASCII de un tamaño exacto en bytes, sin guardar megabytes en fixtures. */
function jsonOfBytes(size: number): string {
  const empty = '{"padding":""}'
  return '{"padding":"' + 'x'.repeat(size - empty.length) + '"}'
}

describe('caracterización del host HTTP para BASE-01', () => {
  it.each(['/auth/login', '/despensa/tickets/leer'])('JSON mal formado en %s: 400 y sin no-store actualmente', async (route) => {
    const api = await startApi({ login: false })
    const result = await api.call('POST', route, undefined, { raw: '{' })
    expect(result.status).toBe(400)
    expect(result.body).toEqual(invalidJson)
    expect(result.headers.get('content-type')).toBe('application/json; charset=utf-8')
    // El lector JSON corre antes del router /api: registrar la diferencia, no ocultarla.
    expect(result.headers.get('cache-control')).toBeNull()
  })

  it.each([
    { route: '/auth/login', megabytes: 20, message: 'Escribe el código de acceso.' },
    { route: '/despensa/tickets/leer', megabytes: 30, message: 'Elige al menos una imagen del ticket.' },
  ])('$route admite exactamente $megabytes MiB y rechaza un byte más', async ({ route, megabytes, message }) => {
    const api = await startApi({ login: false })
    const limit = megabytes * 1024 * 1024
    const accepted = await api.call('POST', route, undefined, { raw: jsonOfBytes(limit) })
    // El cuerpo llega al validador de negocio: el 400 no es un rechazo por tamaño.
    expect(accepted.status).toBe(400)
    expect(accepted.body).toEqual({ ok: false, error: { code: 'VALIDATION', message } })
    expect(accepted.headers.get('cache-control')).toBe('no-store')

    const rejected = await api.call('POST', route, undefined, { raw: jsonOfBytes(limit + 1) })
    expect(rejected.status).toBe(413)
    expect(rejected.body).toEqual(tooLarge)
    expect(rejected.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(rejected.headers.get('cache-control')).toBeNull()
  })

  it('una ruta inexistente responde 401 como invitado y 404 con sesión, siempre JSON', async () => {
    const api = await startApi({ login: false })
    const guest = await api.call('GET', '/no-existe?origen=ensayo')
    expect(guest.status).toBe(401)
    expect(guest.body).toEqual({
      ok: false,
      error: { code: 'UNAUTHORIZED', message: 'Hace falta el código de acceso para ver esta sección.' },
    })
    await api.signIn()
    const admin = await api.call('GET', '/no-existe?origen=ensayo')
    expect(admin.status).toBe(404)
    expect(admin.body).toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'No existe GET /api/no-existe?origen=ensayo.' },
    })
    for (const result of [guest, admin]) {
      expect(result.headers.get('cache-control')).toBe('no-store')
      expect(result.headers.get('location')).toBeNull()
    }
  })

  it('un fallo inesperado conserva el 500 en español y no revela el detalle ni escribe parcialmente', async () => {
    const failure = new Error('Fallo sintético al crear un identificador')
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const api = await startApi({ login: false, ids: { newId: () => { throw failure } } })
    const result = await api.call('POST', '/despensa/personas', { name: 'Persona de ensayo' })
    expect(result.status).toBe(500)
    expect(result.body).toEqual({
      ok: false,
      error: { code: 'INTERNAL', message: 'Error interno del servidor. Revisa la consola donde se ejecuta npm run dev.' },
    })
    expect(result.headers.get('cache-control')).toBe('no-store')
    expect(logged).toHaveBeenCalledWith('[api] Error inesperado:', failure)
    expect((await api.call('GET', '/despensa/personas')).body).toEqual({ ok: true, data: [] })
  })
})
