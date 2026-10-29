import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { movement } from '#shared/testing/factories.ts'
import { startApi, stopApis, TEST_CODE } from './common/testing/testApi.ts'
import { createApp } from './app.ts'
import { ATTEMPT_WINDOW_MS, checkAccessCode, LOCK_MS, SESSION_MS } from './auth.ts'
import { openDatabase } from './common/sqlite/openDatabase.ts'
import { removeTempDbs, tempDbPath } from './common/testing/tempDb.ts'

afterEach(async () => {
  await stopApis()
  removeTempDbs()
})

/** Reloj controlado: las caducidades y los bloqueos se prueban sin esperar minutos reales. */
function fakeClock(start = Date.UTC(2026, 9, 29, 8, 0, 0)) {
  let now = start
  return {
    now: () => now,
    advance(ms: number) {
      now += ms
    },
  }
}

/** Como llega una petición a través del proxy de Vite: con la IP real al final de X-Forwarded-For. */
const viaProxy = (deviceIp: string, spoofed?: string) => ({
  'X-Forwarded-For': spoofed ? `${spoofed}, ${deviceIp}` : deviceIp,
})

/** Todas las rutas financieras, con un cuerpo válido o casi. */
const FINANCE_ROUTES: [method: string, path: string, body?: unknown][] = [
  ['GET', '/data'],
  ['PUT', '/data', { categories: [], movements: [], recurring: [] }],
  ['POST', '/import', { data: { categories: [], movements: [], recurring: [] }, lastBackupAt: null }],
  ['PUT', '/movements/m1', movement({ id: 'm1' })],
  ['DELETE', '/movements/m1'],
  ['PUT', '/categories/g-ocio', { id: 'g-ocio', name: 'Ocio', type: 'gasto', parentId: null, order: 1, budgetCents: null }],
  ['DELETE', '/categories/g-ocio'],
  ['PUT', '/recurring/r1', { rule: {}, horizon: '2026-11-30', markPaidBefore: null }],
  ['DELETE', '/recurring/r1'],
  ['POST', '/occurrences/generate', { horizon: '2026-11-30' }],
  ['GET', '/meta/lastBackupAt'],
  ['PUT', '/meta/lastBackupAt', { value: 'x' }],
  ['POST', '/test/reset'],
]

describe('checkAccessCode', () => {
  it('exige un código de al menos 4 caracteres que no sea solo espacios', () => {
    expect(checkAccessCode(undefined).ok).toBe(false)
    expect(checkAccessCode('').ok).toBe(false)
    expect(checkAccessCode('abc').ok).toBe(false)
    expect(checkAccessCode('      ').ok).toBe(false)
    expect(checkAccessCode('1234')).toEqual({ ok: true, code: '1234' })
    expect(checkAccessCode(' a b ')).toEqual({ ok: true, code: ' a b ' })
  })

  it('createApp no se crea sin un código válido: el acceso nunca queda abierto', () => {
    const database = openDatabase(tempDbPath())
    try {
      expect(() => createApp({ database, accessCode: '' })).toThrow(/código/)
      expect(() => createApp({ database, accessCode: '   ' })).toThrow(/espacios/)
      // @ts-expect-error: accessCode es obligatorio
      expect(() => createApp({ database })).toThrow(/código/)
    } finally {
      database.db.close()
    }
  })
})

describe('arranque del servidor', () => {
  const start = (code: string | undefined) => {
    const dbPath = tempDbPath()
    const env: NodeJS.ProcessEnv = { ...process.env, CUENTAS_DB_PATH: dbPath, CUENTAS_PORT: '0' }
    delete env.CUENTAS_CODIGO
    if (code !== undefined) env.CUENTAS_CODIGO = code
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'server/index.ts'], { env, encoding: 'utf8', timeout: 20_000 })
    return { ...result, dbPath }
  }

  it.each([
    ['sin código', undefined, /Falta el código de acceso/],
    ['con un código de solo espacios', '     ', /solo espacios/],
    ['con un código demasiado corto', 'abc', /al menos 4 caracteres/],
  ])('%s termina con un mensaje en español antes de crear la base de datos', (_label, code, message) => {
    const { status, stderr, dbPath } = start(code)
    expect(status).toBe(1)
    expect(stderr).toMatch(message)
    expect(existsSync(dbPath)).toBe(false)
  })
})

describe('acceso con código', () => {
  it('sin sesión: la despensa responde y las finanzas devuelven 401', async () => {
    const api = await startApi({ login: false })
    expect((await api.call('GET', '/auth/me')).body).toEqual({ ok: true, data: { rol: 'invitado' } })
    expect((await api.call('GET', '/despensa/productos')).status).toBe(200)
    expect(await api.call('GET', '/data')).toMatchObject({
      status: 401,
      body: { ok: false, error: { code: 'UNAUTHORIZED', message: 'Hace falta el código de acceso para ver esta sección.' } },
    })
  })

  it('protege todas las rutas financieras, también la generación, la importación y el reinicio de pruebas', async () => {
    const api = await startApi({ testMode: true })
    const kept = movement({ concept: 'Debe seguir aquí' })
    await api.call('PUT', `/movements/${kept.id}`, kept)

    for (const [method, path, body] of FINANCE_ROUTES) {
      const result = await api.call(method, path, body, { cookie: null })
      expect([method, path, result.status, result.body.error?.code]).toEqual([method, path, 401, 'UNAUTHORIZED'])
    }
    // Una ruta que no existe tampoco dice nada sin sesión.
    expect((await api.call('GET', '/no-existe', undefined, { cookie: null })).status).toBe(401)

    const data = (await api.call('GET', '/data')).body.data as { movements: unknown[] }
    expect(data.movements).toEqual([kept])
  })

  it('con el código correcto da una cookie de sesión HttpOnly y acceso a las finanzas', async () => {
    const api = await startApi({ login: false })
    const login = await api.signIn()
    expect(login.status).toBe(200)
    expect(login.body).toEqual({ ok: true, data: { rol: 'admin' } })
    expect(JSON.stringify(login.body)).not.toContain(TEST_CODE)

    const cookie = login.headers.get('set-cookie') ?? ''
    expect(cookie).toMatch(/^cc_sesion=[0-9a-f]{64}; /)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    expect(cookie).toContain('Path=/api')
    expect(cookie).toContain(`Max-Age=${SESSION_MS / 1000}`)
    // Por HTTP en la red de casa una cookie "Secure" no se guardaría.
    expect(cookie).not.toContain('Secure')
    expect(login.headers.get('cache-control')).toBe('no-store')

    expect((await api.call('GET', '/auth/me')).body.data).toEqual({ rol: 'admin' })
    const data = await api.call('GET', '/data')
    expect(data.status).toBe(200)
    expect(data.headers.get('cache-control')).toBe('no-store')
  })

  it('valida el cuerpo del acceso sin contarlo como intento', async () => {
    const api = await startApi({ login: false })
    expect((await api.call('POST', '/auth/login', { codigo: '' }, { cookie: null })).body.error?.code).toBe('VALIDATION')
    expect((await api.call('POST', '/auth/login', { code: TEST_CODE }, { cookie: null })).status).toBe(400)
    expect((await api.call('POST', '/auth/login', undefined, { raw: '{"codigo"', cookie: null })).status).toBe(400)
    for (let i = 0; i < 6; i++) await api.call('POST', '/auth/login', { codigo: 42 }, { cookie: null })
    expect((await api.signIn()).status).toBe(200)
  })

  it('tokens inventados, cookies mal formadas y cabeceras raras son invitados', async () => {
    const api = await startApi({ login: false })
    for (const cookie of [`cc_sesion=${'a'.repeat(64)}`, 'cc_sesion=', 'cc_sesion', ';;;=', 'otra=1; cc_sesion=zz', '%%%']) {
      expect((await api.call('GET', '/auth/me', undefined, { cookie })).body.data).toEqual({ rol: 'invitado' })
      expect((await api.call('GET', '/data', undefined, { cookie })).status).toBe(401)
    }
  })

  it('la sesión dura 12 horas', async () => {
    const clock = fakeClock()
    const api = await startApi({ clock: { nowMs: clock.now } })
    clock.advance(SESSION_MS - 1)
    expect((await api.call('GET', '/data')).status).toBe(200)
    clock.advance(1)
    expect((await api.call('GET', '/data')).status).toBe(401)
    expect((await api.call('GET', '/auth/me')).body.data).toEqual({ rol: 'invitado' })
  })

  it('cerrar la sesión la invalida, borra la cookie con el mismo ámbito y se puede repetir', async () => {
    const api = await startApi()
    const session = api.cookie
    const logout = await api.call('POST', '/auth/logout')
    expect(logout).toMatchObject({ status: 200, body: { ok: true, data: null } })
    expect(logout.headers.get('set-cookie')).toBe('cc_sesion=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0')
    expect((await api.call('GET', '/data', undefined, { cookie: session })).status).toBe(401)
    expect((await api.call('POST', '/auth/logout', undefined, { cookie: session })).status).toBe(200)
    expect((await api.call('POST', '/auth/logout', undefined, { cookie: null })).status).toBe(200)
  })

  it('al reiniciar el servidor las sesiones anteriores dejan de valer', async () => {
    const first = await startApi()
    const session = first.cookie
    await first.stop()
    const second = await startApi({ path: first.path, login: false })
    expect((await second.call('GET', '/data', undefined, { cookie: session })).status).toBe(401)
  })
})

describe('límite de intentos', () => {
  const failLogin = (api: Awaited<ReturnType<typeof startApi>>, headers?: Record<string, string>) =>
    api.signIn('codigo-incorrecto', headers)

  it('cinco fallos dan 401; a partir del sexto, 429 aunque el código sea correcto', async () => {
    const api = await startApi({ login: false })
    for (let i = 1; i <= 5; i++) {
      expect(await failLogin(api)).toMatchObject({ status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'El código no es correcto.' } } })
    }
    const blocked = await api.signIn()
    expect(blocked.status).toBe(429)
    expect(blocked.body.error?.code).toBe('TOO_MANY_ATTEMPTS')
    expect(blocked.body.error?.message).toMatch(/15 min/)
    expect(blocked.headers.get('retry-after')).toBe(String(LOCK_MS / 1000))
    expect(blocked.headers.get('set-cookie')).toBeNull()
    expect((await failLogin(api)).status).toBe(429)
  })

  it('el bloqueo caduca a los 15 minutos', async () => {
    const clock = fakeClock()
    const api = await startApi({ login: false, clock: { nowMs: clock.now } })
    for (let i = 0; i < 5; i++) await failLogin(api)
    clock.advance(LOCK_MS - 1000)
    const almost = await api.signIn()
    expect(almost.status).toBe(429)
    expect(almost.headers.get('retry-after')).toBe('1')
    clock.advance(1000)
    expect((await api.signIn()).status).toBe(200)
  })

  it('los fallos se olvidan pasada la ventana de 15 minutos, y un acceso correcto reinicia la cuenta', async () => {
    const clock = fakeClock()
    const api = await startApi({ login: false, clock: { nowMs: clock.now } })
    for (let i = 0; i < 4; i++) await failLogin(api)
    clock.advance(ATTEMPT_WINDOW_MS)
    for (let i = 0; i < 4; i++) expect((await failLogin(api)).status).toBe(401)
    expect((await api.signIn()).status).toBe(200)
    for (let i = 0; i < 4; i++) expect((await failLogin(api)).status).toBe(401)
    expect((await api.signIn()).status).toBe(200)
  })

  it('cuenta por dispositivo detrás del proxy de Vite y no se puede eludir con X-Forwarded-For', async () => {
    const api = await startApi({ login: false })
    // El móvil A falla cinco veces inventándose una IP distinta en cada intento.
    for (let i = 0; i < 5; i++) expect((await failLogin(api, viaProxy('192.168.1.20', `10.9.9.${i}`))).status).toBe(401)
    expect((await api.signIn(TEST_CODE, viaProxy('192.168.1.20', '8.8.8.8'))).status).toBe(429)
    expect((await api.signIn(TEST_CODE, viaProxy('192.168.1.20'))).status).toBe(429)
    // Otro móvil de la misma red no queda bloqueado.
    expect((await api.signIn(TEST_CODE, viaProxy('192.168.1.21'))).status).toBe(200)
  })
})
