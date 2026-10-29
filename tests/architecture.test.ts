import { readdirSync, readFileSync } from 'node:fs'
import { posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Vigila las reglas de dependencia de docs/arquitectura.md leyendo los imports
 * de cada archivo .ts y .tsx de server/, shared/ y src/. Si falla, el mensaje
 * dice qué archivo, qué import y qué regla se rompe.
 *
 * Los tests, server/common/testing/ y shared/testing/ quedan fuera de las reglas.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url)).split('\\').join('/')

/** Archivos .ts y .tsx de una carpeta, con su ruta desde la raíz y con «/». */
function sourceFiles(folder: string): string[] {
  const found: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(`${ROOT}${dir}`, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && path !== 'server/data') walk(path)
      } else if (/\.tsx?$/.test(entry.name)) {
        found.push(path)
      }
    }
  }
  walk(folder)
  return found.sort()
}

/** El código sin comentarios (respetando las cadenas), para no confundir un ejemplo con un import. */
function stripComments(code: string): string {
  let out = ''
  let quote: string | null = null
  for (let i = 0; i < code.length; i++) {
    const char = code[i]
    if (quote) {
      out += char
      if (char === '\\') out += code[++i] ?? ''
      else if (char === quote) quote = null
    } else if (char === '/' && code[i + 1] === '/') {
      while (i < code.length && code[i] !== '\n') i++
      out += '\n'
    } else if (char === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2)
      out += code.slice(i, end === -1 ? code.length : end + 2).replace(/[^\n]/g, ' ')
      i = end === -1 ? code.length : end + 1
    } else {
      if (char === "'" || char === '"' || char === '`') quote = char
      out += char
    }
  }
  return out
}

interface Import {
  specifier: string
  /** Ruta desde la raíz para los imports del repositorio (relativos o #shared/), o null para los paquetes. */
  target: string | null
  /** Los nombres importados entre llaves, si los hay. */
  names: string[]
}

/** `… from '…'` (imports y reexports), `import('…')` e `import '…'`. */
const SPECIFIERS = [/\bfrom\s*(['"])([^'"]+)\1/g, /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g, /^\s*import\s*(['"])([^'"]+)\1/gm]
/** Los nombres entre llaves de `import { a, type B } from '…'`. */
const NAMED = /\bimport\s+(?:type\s+)?(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from\s*(['"])([^'"]+)\2/g

function importsOf(file: string): Import[] {
  const code = stripComments(readFileSync(`${ROOT}${file}`, 'utf8'))
  const names = new Map<string, string[]>()
  for (const match of code.matchAll(NAMED)) {
    const list = match[1].split(',').map((n) => n.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0])
    names.set(match[3], [...(names.get(match[3]) ?? []), ...list.filter(Boolean)])
  }
  const found: Import[] = []
  for (const pattern of SPECIFIERS) {
    for (const match of code.matchAll(pattern)) {
      const specifier = match[2]
      let target: string | null = null
      if (specifier.startsWith('.')) target = posix.normalize(posix.join(posix.dirname(file), specifier))
      else if (specifier.startsWith('#shared/')) target = specifier.slice(1)
      found.push({ specifier, target, names: names.get(specifier) ?? [] })
    }
  }
  return found
}

const isTest = (file: string) => /\.test\.tsx?$/.test(file)
const isExempt = (file: string) =>
  isTest(file) || file.startsWith('server/common/testing/') || file.startsWith('shared/testing/') || file === 'src/test/setup.ts'
/** Módulo del servidor y capa de un archivo: server/modules/<módulo>/<capa>/… */
function serverModule(path: string): { module: string; layer: string } | null {
  const match = /^server\/modules\/([^/]+)\/(?:([^/]+)\/)?/.exec(path)
  if (!match) return null
  return { module: match[1], layer: match[2] ?? (path.endsWith('/index.ts') ? 'index' : 'raíz') }
}

/** Carpeta de tecnología de un adaptador: server/modules/<m>/adapters/<tecnología>/… */
const adapterTech = (path: string) => /^server\/modules\/[^/]+\/adapters\/([^/]+)\//.exec(path)?.[1] ?? null

type Rule = (file: string, imp: Import) => string | null

/** Reglas del servidor y de shared/ (docs/arquitectura.md, «Reglas de dependencia»). */
const SERVER_RULES: Rule[] = [
  // shared/: solo shared/, sin paquetes ni node:*.
  (file, imp) => {
    if (!file.startsWith('shared/')) return null
    if (imp.target === null) return 'shared/ no importa paquetes ni node:* (es lógica pura que usan la web y el servidor)'
    return imp.target.startsWith('shared/') ? null : 'shared/ solo importa de shared/'
  },
  // domain/: shared/ y su propio domain/.
  (file, imp) => {
    const own = serverModule(file)
    if (!own || own.layer !== 'domain') return null
    if (imp.target === null) return 'domain/ no importa paquetes ni node:*'
    return imp.target.startsWith('shared/') || imp.target.startsWith(`server/modules/${own.module}/domain/`)
      ? null
      : 'domain/ solo importa shared/ y su propio domain/'
  },
  // application/: su domain, su application, shared/, common/errors.ts y common/ports.ts.
  (file, imp) => {
    const own = serverModule(file)
    if (!own || own.layer !== 'application') return null
    if (imp.target === null) return 'application/ no importa paquetes ni node:* (Express, better-sqlite3, tesseract.js…): van en adapters/ o detrás de un puerto'
    const allowed =
      imp.target.startsWith('shared/') ||
      imp.target.startsWith(`server/modules/${own.module}/domain/`) ||
      imp.target.startsWith(`server/modules/${own.module}/application/`) ||
      imp.target === 'server/common/errors.ts' ||
      imp.target === 'server/common/ports.ts'
    return allowed ? null : 'application/ solo importa su domain/ y su application/, shared/, common/errors.ts y common/ports.ts'
  },
  // adapters/: su application y su domain, su propia carpeta de adaptador, shared/, common/ y librerías.
  (file, imp) => {
    const own = serverModule(file)
    if (!own || own.layer !== 'adapters' || imp.target === null) return null
    const allowed =
      imp.target.startsWith('shared/') ||
      (imp.target.startsWith('server/common/') && !imp.target.startsWith('server/common/testing/')) ||
      imp.target.startsWith(`server/modules/${own.module}/domain/`) ||
      imp.target.startsWith(`server/modules/${own.module}/application/`) ||
      imp.target.startsWith(`server/modules/${own.module}/adapters/${adapterTech(file)}/`)
    return allowed ? null : 'un adaptador importa su application/ y su domain/, shared/, common/ y librerías; ni otros módulos ni otros adaptadores'
  },
  // index.ts de un módulo: todo su módulo, common/, shared/ y librerías; de otro módulo, solo su index.ts.
  (file, imp) => {
    const own = serverModule(file)
    if (!own || own.layer !== 'index' || imp.target === null) return null
    const other = serverModule(imp.target)
    if (other && other.module !== own.module) {
      return imp.target === `server/modules/${other.module}/index.ts` ? null : `de otro módulo solo se importa su index.ts (server/modules/${other.module}/index.ts)`
    }
    const allowed =
      imp.target.startsWith(`server/modules/${own.module}/`) ||
      imp.target.startsWith('shared/') ||
      (imp.target.startsWith('server/common/') && !imp.target.startsWith('server/common/testing/'))
    return allowed ? null : 'el index.ts de un módulo importa su módulo, common/, shared/ y, de otros módulos, su index.ts'
  },
  // Cualquier archivo de un módulo: de otro módulo, nada (lo conecta app.ts).
  (file, imp) => {
    const own = serverModule(file)
    const other = imp.target ? serverModule(imp.target) : null
    if (!own || !other || own.module === other.module || own.layer === 'index') return null
    return `un módulo no usa el interior de otro (${imp.target}): app.ts conecta los módulos a través de su index.ts`
  },
  // Archivos sueltos en la raíz de un módulo (fuera de domain/, application/ y adapters/): no debería haberlos.
  (file) => {
    const own = serverModule(file)
    return own && own.layer === 'raíz' ? 'un módulo tiene index.ts, domain/, application/ y adapters/; nada más en su raíz' : null
  },
  // common/: transversal, sin módulos.
  (file, imp) => {
    if (!file.startsWith('server/common/') || imp.target === null) return null
    const allowed = imp.target.startsWith('server/common/') || imp.target.startsWith('server/migrations/') || imp.target.startsWith('shared/')
    return allowed ? null : 'common/ no importa módulos ni app.ts: es transversal y no sabe nada del negocio'
  },
  // migrations/: librerías, shared/ (las categorías iniciales) y sí misma.
  (file, imp) => {
    if (!file.startsWith('server/migrations/') || imp.target === null) return null
    return imp.target.startsWith('server/migrations/') || imp.target.startsWith('shared/') ? null : 'una migración solo importa librerías, shared/ y otras migraciones'
  },
  // app.ts e index.ts: la raíz de composición solo conoce el index.ts de cada módulo y common/.
  (file, imp) => {
    if ((file !== 'server/app.ts' && file !== 'server/index.ts') || imp.target === null) return null
    const allowed =
      imp.target === 'server/app.ts' ||
      /^server\/modules\/[^/]+\/index\.ts$/.test(imp.target) ||
      (imp.target.startsWith('server/common/') && !imp.target.startsWith('server/common/testing/'))
    return allowed ? null : 'app.ts e index.ts solo importan el index.ts de cada módulo y common/'
  },
  // La web no importa nada del servidor.
  (file, imp) => (file.startsWith('src/') && imp.target?.startsWith('server/') ? 'src/ no importa nada de server/' : null),
]

/** Node y sus globales fuera de shared/, domain/ y application/: van en adaptadores o detrás de un puerto. */
const NODE_GLOBALS = /\bBuffer\b|\bprocess\./

function pureLayer(file: string): boolean {
  const own = serverModule(file)
  return file.startsWith('shared/') || own?.layer === 'domain' || own?.layer === 'application'
}

function violations(files: string[], rules: Rule[]): string[] {
  const found: string[] = []
  for (const file of files) {
    if (isExempt(file)) continue
    for (const imp of importsOf(file)) {
      for (const rule of rules) {
        const broken = rule(file, imp)
        if (broken) found.push(`${file}: importa '${imp.specifier}'${imp.target ? ` (${imp.target})` : ''}. Regla: ${broken}`)
      }
    }
    if (pureLayer(file) && NODE_GLOBALS.test(stripComments(readFileSync(`${ROOT}${file}`, 'utf8')))) {
      found.push(`${file}: usa Buffer o process. Regla: lo de Node va en un adaptador o detrás de un puerto`)
    }
  }
  return found
}

const serverFiles = sourceFiles('server')
const sharedFiles = sourceFiles('shared')
const webFiles = sourceFiles('src')

describe('arquitectura', () => {
  it('encuentra el código que vigila (si no, el test pasaría sin comprobar nada)', () => {
    expect(serverFiles.length).toBeGreaterThan(80)
    expect(sharedFiles.length).toBeGreaterThan(30)
    expect(webFiles.length).toBeGreaterThan(50)
    const modules = [...new Set(serverFiles.map((f) => serverModule(f)?.module).filter(Boolean))].sort()
    expect(modules).toEqual(['auth', 'finance', 'health', 'pantry', 'tickets'])
    for (const module of modules) expect(serverFiles, `falta server/modules/${module}/index.ts`).toContain(`server/modules/${module}/index.ts`)
  })

  it('el servidor y shared/ cumplen las reglas de dependencia', () => {
    const found = violations([...serverFiles, ...sharedFiles, ...webFiles], SERVER_RULES)
    expect(found, found.join('\n')).toEqual([])
  })
})
