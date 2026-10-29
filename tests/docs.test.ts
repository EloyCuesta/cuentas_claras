import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Vigila que la documentación para agentes (AGENTS.md, docs/ y .claude/rules/)
 * esté completa y al día. Si algo falla, el mensaje dice qué archivo y qué falta.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url)).split('\\').join('/')
const read = (path: string) => readFileSync(`${ROOT}${path}`, 'utf8').replace(/\r\n/g, '\n')
const exists = (path: string) => existsSync(`${ROOT}${path}`)
const subfolders = (path: string) =>
  readdirSync(`${ROOT}${path}`, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()

const MODULES = subfolders('server/modules')
const FEATURES = subfolders('src/features')

/** Zonas con su propio AGENTS.md: la raíz, las carpetas principales, cada módulo y cada feature. */
const ZONES = ['', 'server/', 'server/migrations/', 'shared/', 'src/', 'e2e/', ...MODULES.map((m) => `server/modules/${m}/`), ...FEATURES.map((f) => `src/features/${f}/`)]

const MODULE_SECTIONS = [
  'Qué hace',
  'Acceso',
  'API pública (index.ts)',
  'Casos de uso y rutas',
  'Puertos',
  'Reglas que no se rompen',
  'Datos',
  'Pruebas',
  'Trampas y decisiones',
  'Si cambias este módulo',
]
const FEATURE_SECTIONS = ['Qué ve la persona', 'Componentes', 'Estado y datos', 'Textos y accesibilidad', 'Pruebas', 'Trampas', 'Si cambias esta pantalla']

/** Rutas que solo existen al usar la app (están en .gitignore): se pueden citar aunque no estén en un clon nuevo. */
const RUNTIME_PATHS = ['server/data/cuentas.db']
/** Texto entre comillas invertidas con «/» que no es una ruta del repositorio. */
const NOT_PATHS = ['react/only-export-components']

/** El cuerpo de una sección «## Título», hasta la siguiente sección del mismo nivel. */
function section(markdown: string, title: string): string | null {
  const lines = markdown.split('\n')
  const start = lines.findIndex((line) => line.trim() === `## ${title}`)
  if (start === -1) return null
  const end = lines.findIndex((line, i) => i > start && line.startsWith('## '))
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n')
}

/** Archivos de documentación cuyas rutas citadas se comprueban. */
function documentationFiles(): string[] {
  const agents = ZONES.map((zone) => `${zone}AGENTS.md`).filter(exists)
  const docs = readdirSync(`${ROOT}docs`).filter((name) => name.endsWith('.md')).map((name) => `docs/${name}`)
  const rules = exists('.claude/rules') ? readdirSync(`${ROOT}.claude/rules`).filter((name) => name.endsWith('.md')).map((name) => `.claude/rules/${name}`) : []
  return [...agents, ...docs, ...rules]
}

/** Rutas citadas entre comillas invertidas (fuera de los bloques de código) que no existen. */
function missingPaths(file: string): string[] {
  const text = read(file).replace(/```[\s\S]*?```/g, '')
  const missing: string[] = []
  for (const [, span] of text.matchAll(/`([^`\n]+)`/g)) {
    // Una ruta: sin espacios ni comodines, con «/», que empieza por una letra (no ./, ../, /api, #shared, @paquete…).
    const path = span.replace(/#[\w-]*$/, '').replace(/:\d+$/, '')
    if (!/^[A-Za-z0-9_][A-Za-z0-9._\-/]*$/.test(path) || !path.includes('/') || NOT_PATHS.includes(path)) continue
    const fromFile = posix.normalize(posix.join(posix.dirname(file), path))
    if (exists(fromFile) || exists(path) || RUNTIME_PATHS.includes(path)) continue
    missing.push(`${file}: «${span}» no existe`)
  }
  return missing
}

describe('documentación para agentes', () => {
  it('cada zona, módulo y feature tiene su AGENTS.md y, al lado, un CLAUDE.md con @AGENTS.md', () => {
    expect(MODULES).toEqual(['auth', 'finance', 'health', 'pantry', 'tickets'])
    expect(FEATURES).toEqual(['auth', 'finance', 'pantry', 'tickets'])
    const problems: string[] = []
    for (const zone of ZONES) {
      if (!exists(`${zone}AGENTS.md`)) problems.push(`falta ${zone}AGENTS.md`)
      if (!exists(`${zone}CLAUDE.md`)) problems.push(`falta ${zone}CLAUDE.md`)
      else if (read(`${zone}CLAUDE.md`).trim() !== '@AGENTS.md') problems.push(`${zone}CLAUDE.md debe contener solo «@AGENTS.md»`)
    }
    expect(problems, problems.join('\n')).toEqual([])
  })

  it('el AGENTS.md de cada módulo y de cada feature tiene todas las secciones de su plantilla', () => {
    const problems: string[] = []
    for (const module of MODULES) {
      const text = read(`server/modules/${module}/AGENTS.md`)
      for (const title of MODULE_SECTIONS) if (section(text, title) === null) problems.push(`server/modules/${module}/AGENTS.md: falta «## ${title}»`)
    }
    for (const feature of FEATURES) {
      const text = read(`src/features/${feature}/AGENTS.md`)
      for (const title of FEATURE_SECTIONS) if (section(text, title) === null) problems.push(`src/features/${feature}/AGENTS.md: falta «## ${title}»`)
    }
    expect(problems, problems.join('\n')).toEqual([])
  })

  it('las rutas citadas entre comillas invertidas existen (si ya no existe, se escribe sin comillas invertidas)', () => {
    const files = documentationFiles()
    expect(files.length).toBeGreaterThan(20)
    const problems = files.flatMap(missingPaths)
    expect(problems, problems.join('\n')).toEqual([])
  })

  it('cada caso de uso aparece en la tabla «Casos de uso y rutas» de su módulo', () => {
    const problems: string[] = []
    for (const module of MODULES) {
      const folder = `server/modules/${module}/application`
      if (!exists(folder)) continue
      const useCases = readdirSync(`${ROOT}${folder}`).filter((name) => /^[A-Z][A-Za-z]*\.ts$/.test(name)).map((name) => name.replace(/\.ts$/, ''))
      const table = section(read(`server/modules/${module}/AGENTS.md`), 'Casos de uso y rutas') ?? ''
      for (const useCase of useCases) {
        if (!new RegExp(`\\b${useCase}\\b`).test(table)) problems.push(`server/modules/${module}/AGENTS.md: falta ${useCase} (${folder}/${useCase}.ts)`)
      }
    }
    expect(problems, problems.join('\n')).toEqual([])
  })

  it('la tabla «Si vas a tocar… lee…» de la raíz nombra todos los módulos y features', () => {
    const table = section(read('AGENTS.md'), 'Si vas a tocar… lee…')
    expect(table, 'falta la sección «## Si vas a tocar… lee…» en AGENTS.md').not.toBeNull()
    const missing = [...MODULES.map((m) => `server/modules/${m}/`), ...FEATURES.map((f) => `src/features/${f}/`)].filter((path) => !table!.includes(path))
    expect(missing, `AGENTS.md no nombra: ${missing.join(', ')}`).toEqual([])
  })

  it('cada AGENTS.md cabe en 200 líneas (lo que sobre, a docs/ con un enlace)', () => {
    const long = ZONES.map((zone) => `${zone}AGENTS.md`)
      .filter(exists)
      .map((file) => [file, read(file).split('\n').length] as const)
      .filter(([, lines]) => lines > 200)
      .map(([file, lines]) => `${file}: ${lines} líneas`)
    expect(long, long.join('\n')).toEqual([])
  })
})
