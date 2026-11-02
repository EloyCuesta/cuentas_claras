import { readdirSync, readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { startApi, stopApis, TEST_CODE } from './common/testing/testApi.ts'
import { removeTempDbs } from './common/testing/tempDb.ts'

/**
 * Contratos HTTP de BASE-01: reproduce los JSON de ensayo contra Express y
 * SQLite temporal. Los resultados están fijados en archivos portables, nunca
 * se regeneran al ejecutar las pruebas. El futuro backend debe reproducirlos.
 */

interface ContractStep {
  name: string
  advanceMs?: number
  request: {
    method: string
    path: string
    body?: unknown
    guest?: boolean
  }
  expected: {
    status: number
    body: unknown
    headers: Record<string, string | null>
  }
}

interface ContractScenario {
  name: string
  setup: {
    accessCode: string
    now: string
    today: string
    login: boolean
    testMode: boolean
    ids: string[]
  }
  steps: ContractStep[]
}

interface ContractFile {
  format: 'cuentas-claras-http-v1'
  provenance: string
  scenarios: ContractScenario[]
}

// Lista explícita: otros corpus de migración (reglas, errores…) tienen sus propios ejecutores.
const FILES = ['health', 'auth', 'finance', 'pantry', 'tickets', 'testing']
const fixtures = FILES.map((module) => ({
  module,
  fixture: JSON.parse(readFileSync(new URL(`../fixtures/migration/http-${module}.json`, import.meta.url), 'utf8')) as ContractFile,
}))

afterEach(async () => {
  await stopApis()
  removeTempDbs()
})

/** Solo el token aleatorio se sustituye; sus atributos y su uso real se comprueban. */
function normalizedCookie(value: string | null): string | null {
  if (value === null || value.startsWith('cc_sesion=;')) return value
  expect(value).toMatch(/^cc_sesion=[0-9a-f]{64};/)
  return value.replace(/^cc_sesion=[0-9a-f]{64};/, 'cc_sesion=<token>;')
}

for (const { module, fixture } of fixtures) {
  describe(`contratos de migración: ${module}`, () => {
    for (const scenario of fixture.scenarios) {
      it(scenario.name, async () => {
        let elapsed = 0
        let nextId = 0
        const { setup } = scenario
        expect(setup.accessCode, 'el código de ensayo debe coincidir con el host de pruebas').toBe(TEST_CODE)
        const api = await startApi({
          login: setup.login,
          testMode: setup.testMode,
          clock: {
            nowMs: () => Date.parse(setup.now) + elapsed,
            nowISO: () => new Date(Date.parse(setup.now) + elapsed).toISOString(),
            today: () => setup.today,
          },
          ids: {
            newId: () => {
              const id = setup.ids[nextId++]
              if (id === undefined) throw new Error('El escenario ha agotado sus IDs de ensayo')
              return id
            },
          },
        })
        for (const step of scenario.steps) {
          elapsed += step.advanceMs ?? 0
          const { request, expected } = step
          expect(request.path, step.name).toMatch(/^\/api\//)
          const result = await api.call(request.method, request.path.slice(4), request.body, {
            cookie: request.guest ? null : api.cookie,
          })
          expect({ status: result.status, body: result.body }, step.name).toEqual({
            status: expected.status,
            body: expected.body,
          })
          for (const [name, value] of Object.entries(expected.headers)) {
            const actual = result.headers.get(name)
            expect(name === 'set-cookie' ? normalizedCookie(actual) : actual, `${step.name}: ${name}`).toBe(value)
          }
          const cookie = result.headers.get('set-cookie')
          if (cookie) api.cookie = cookie.startsWith('cc_sesion=;') ? null : cookie.split(';')[0]
        }
        expect(nextId, 'los IDs de preparación deben consumirse exactamente').toBe(setup.ids.length)
      })
    }
  })
}

/** Inventario obtenido de los routers actuales: cuenta métodos, no solo URL distintas. */
function routesFromSource(): string[] {
  const modules = new URL('./modules/', import.meta.url)
  const files = readdirSync(modules, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const folder = new URL(`${entry.name}/adapters/http/`, modules)
      return readdirSync(folder).filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
        .map((file) => new URL(file, folder))
    })
  files.push(new URL('./common/http/testingRoutes.ts', import.meta.url))
  return files.flatMap((file) => {
    const source = readFileSync(file, 'utf8')
    return [...source.matchAll(/^\s*router\.(get|post|put|delete|patch)\('([^']+)'/gm)]
      .map(([, method, path]) => `${method.toUpperCase()} /api${path}`)
  }).sort()
}

describe('inventario de contratos de migración', () => {
  it('cada ruta de aplicación y el reset tienen un recorrido HTTP válido y una respuesta completa', () => {
    const routes = routesFromSource()
    expect(routes).toHaveLength(40)
    expect(new Set(routes).size).toBe(routes.length)
    const covered = new Set<string>()
    for (const { fixture } of fixtures) {
      expect(fixture.format).toBe('cuentas-claras-http-v1')
      expect(fixture.provenance).toContain('inventados')
      expect(fixture.scenarios.length).toBeGreaterThan(0)
      for (const scenario of fixture.scenarios) {
        expect(scenario.steps.length).toBeGreaterThan(0)
        for (const { request, expected } of scenario.steps) {
          if (expected.status < 200 || expected.status >= 300) continue
          const actual = `${request.method} ${request.path.split('?')[0]}`
          const matching = routes.filter((route) => new RegExp(`^${route.replace(/:[A-Za-z]+/g, '[^/]+')}$`).test(actual))
          expect(matching, `ruta de fixture sin implementación: ${actual}`).toHaveLength(1)
          covered.add(matching[0])
        }
      }
    }
    expect([...covered].sort()).toEqual(routes)
  })
})
