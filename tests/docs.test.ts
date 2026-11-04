import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Vigila la documentación para agentes, sus enlaces y el orden de la migración.
 * Recorre también los subdirectorios de docs/. Si falla, indica el archivo y el problema.
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
const ZONES = ['', 'backend/', 'database/mysql/', 'server/', 'shared/', 'src/', 'e2e/', 'tools/sqlite/', ...MODULES.map((m) => `server/modules/${m}/`), ...FEATURES.map((f) => `src/features/${f}/`)]

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

/** Rutas que solo existen al usar o compilar la app (están en .gitignore): se pueden citar aunque no estén en un clon nuevo. */
const RUNTIME_PATHS = ['server/data/cuentas.db', 'dist/']
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
  const docs = markdownFiles('docs')
  const rules = exists('.claude/rules') ? markdownFiles('.claude/rules') : []
  return [...agents, ...docs, ...rules]
}

/** Markdown de una carpeta y sus subcarpetas, sin depender de que exista un índice. */
function markdownFiles(folder: string): string[] {
  return readdirSync(`${ROOT}${folder}`, { withFileTypes: true }).flatMap((entry) => {
    const path = `${folder}/${entry.name}`
    if (entry.isDirectory()) return markdownFiles(path)
    return entry.name.endsWith('.md') ? [path] : []
  }).sort()
}

/** No trata los ejemplos de código como enlaces ni rutas de la documentación. */
function withoutCodeBlocks(markdown: string): string {
  return markdown.replace(/^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s*\1\s*$/gm, '')
}

/** Rutas citadas entre comillas invertidas (fuera de los bloques de código) que no existen. */
function missingPaths(file: string): string[] {
  const text = withoutCodeBlocks(read(file))
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

/** Destinos de enlaces e imágenes, incluidos los definidos al pie por referencia. */
function linkTargets(markdown: string): string[] {
  const text = withoutCodeBlocks(markdown).replace(/`[^`\n]*`/g, '')
  const inline = /!?\[[^\]\n]*\]\(\s*(?:<([^>\n]+)>|([^\s)]+))(?:\s+["'][^"'\n]*["'])?\s*\)/g
  const references = /^\s*\[[^\]\n]+\]:\s*(?:<([^>\n]+)>|(\S+))/gm
  return [...text.matchAll(inline), ...text.matchAll(references)].map((match) => match[1] ?? match[2])
}

/** Enlaces relativos a archivos o carpetas; las URLs y los fragmentos no son rutas locales. */
function missingLinks(file: string): string[] {
  const problems: string[] = []
  for (const target of linkTargets(read(file))) {
    if (/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(target)) continue
    let path: string
    try {
      path = decodeURIComponent(target.split(/[?#]/)[0])
    } catch {
      problems.push(`${file}: enlace «${target}» con escape no válido`)
      continue
    }
    if (!path) continue
    const resolved = posix.normalize(posix.join(posix.dirname(file), path))
    if (resolved === '..' || resolved.startsWith('../') || !exists(resolved)) {
      problems.push(`${file}: enlace «${target}» no existe dentro del repositorio`)
    }
  }
  return problems
}

interface MigrationTask {
  id: string
  dependencies: string[]
  state: string
}

const TASK_STATES = ['pendiente', 'en_curso', 'implementado', 'verificado', 'bloqueado']

/** Solo las filas del plan: los IDs repetidos en el registro histórico no son tareas nuevas. */
function migrationTasks(markdown: string): MigrationTask[] {
  const table = section(markdown, 'Plan por módulos y funcionalidades') ?? ''
  return table.split('\n').filter((line) => /^\|\s*[A-Z]+-\d+\s*\|/.test(line)).map((line) => {
    const [id, , dependencies, state] = line.split('|').slice(1, -1).map((cell) => cell.trim())
    return { id, dependencies: dependencies === '—' ? [] : dependencies.split(',').map((value) => value.trim()), state }
  })
}

/** Cada dependencia debe apuntar a otra tarea y el grafo debe permitir avanzar. */
function taskProblems(tasks: MigrationTask[]): string[] {
  const problems: string[] = []
  const byId = new Map<string, MigrationTask>()
  for (const task of tasks) {
    if (byId.has(task.id)) problems.push(`${task.id}: ID repetido`)
    byId.set(task.id, task)
    if (!TASK_STATES.includes(task.state)) problems.push(`${task.id}: estado no válido «${task.state}»`)
  }
  const visited = new Set<string>()
  function visit(task: MigrationTask, chain: string[]): void {
    if (chain.includes(task.id)) {
      problems.push(`dependencias cíclicas: ${[...chain, task.id].join(' → ')}`)
      return
    }
    if (visited.has(task.id)) return
    for (const id of task.dependencies) {
      const dependency = byId.get(id)
      if (!dependency) {
        problems.push(`${task.id}: dependencia desconocida «${id}»`)
        continue
      }
      if (task.state === 'verificado' && dependency.state !== 'verificado') {
        problems.push(`${task.id}: verificada con dependencia ${id} sin verificar`)
      }
      visit(dependency, [...chain, task.id])
    }
    visited.add(task.id)
  }
  for (const task of tasks) visit(task, [])
  return problems
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

  it('los enlaces relativos existen, también en los documentos de migración y el README', () => {
    const files = ['README.md', ...documentationFiles()]
    expect(files).toContain('docs/migration/STATUS.md')
    expect(files).toContain('docs/migration/MODULES.md')
    const problems = files.flatMap(missingLinks)
    expect(problems, problems.join('\n')).toEqual([])
  })

  it('el plan de migración tiene IDs únicos, estados conocidos y dependencias sin ciclos', () => {
    const tasks = migrationTasks(read('docs/migration/STATUS.md'))
    expect(tasks.length).toBeGreaterThanOrEqual(18)
    expect(tasks.map((task) => task.id)).toEqual(expect.arrayContaining(['DOC-01', 'BASE-01', 'CUT-01']))
    const problems = taskProblems(tasks)
    expect(problems, problems.join('\n')).toEqual([])
  })

  it('reconoce enlaces con título o por referencia sin interpretar ejemplos de código', () => {
    const markdown = [
      '[Guía](../README.md "Inicio")',
      '![Imagen](<imagen de prueba.png>)',
      '[Referencia][datos]',
      '[datos]: DATA.md#inventario',
      '`[Ejemplo](no-existe.md)`',
      '```md',
      '[Ejemplo en bloque](tampoco-existe.md)',
      '```',
    ].join('\n')
    expect(linkTargets(markdown)).toEqual(['../README.md', 'imagen de prueba.png', 'DATA.md#inventario'])
  })

  it('detecta registros de tareas duplicados, estados desconocidos y dependencias imposibles', () => {
    const problems = taskProblems([
      { id: 'BASE-01', state: 'pendiente', dependencies: ['BASE-02'] },
      { id: 'BASE-02', state: 'verificado', dependencies: ['BASE-01', 'NO-01'] },
      { id: 'BASE-01', state: 'terminado', dependencies: ['BASE-02'] },
    ])
    expect(problems).toEqual(expect.arrayContaining([
      'BASE-01: ID repetido',
      'BASE-01: estado no válido «terminado»',
      'BASE-02: dependencia desconocida «NO-01»',
      'BASE-02: verificada con dependencia BASE-01 sin verificar',
      'dependencias cíclicas: BASE-01 → BASE-02 → BASE-01',
    ]))
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
