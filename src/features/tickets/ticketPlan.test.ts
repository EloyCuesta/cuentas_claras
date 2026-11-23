import { describe, expect, it } from 'vitest'
import { cropGray, type GrayImage } from './ticketImageAnalysis.ts'
import { groupGray, planCaptures, type PlanSource } from './ticketPlan.ts'

const blank = (width: number, height: number, value = 255): GrayImage => ({ width, height, data: new Uint8Array(width * height).fill(value) })
const fill = (image: GrayImage, left: number, top: number, right: number, bottom: number, value: number) => {
  for (let y = top; y < bottom; y++) image.data.fill(value, y * image.width + left, y * image.width + right)
}
function random(seed: number) {
  let state = seed
  return () => { state = (state * 1103515245 + 12345) % 2147483648; return state / 2147483648 }
}
/** Un ticket largo con renglones de «letras» distintos (como en ticketImageAnalysis.test.ts). */
function ticket(width: number, height: number, cap = 14, seed = 7): GrayImage {
  const image = blank(width, height)
  const next = random(seed)
  for (let y = 40; y + cap + 10 < height; y += Math.round(cap * 2.2)) {
    const advance = Math.round(cap * 0.85)
    for (let c = 0; c < Math.floor((width - 60) / advance); c++) {
      if (next() < 0.2) continue
      const x = 30 + c * advance
      const w = Math.max(2, Math.round(advance * (0.4 + next() * 0.4)))
      fill(image, x, y, x + w, y + 3, 20)
      fill(image, x, y + cap - 3, x + w, y + cap, 20)
      fill(image, x, y, x + 2, y + cap, 20)
    }
  }
  return image
}

const LONG = ticket(400, 3000)
/** Una captura de 400 × 1000 del ticket largo desde su fila `y`: barra de estado y cabecera (100 filas) y navegación (60). */
function capture(y: number, clock = 0): GrayImage {
  const image = blank(400, 1000)
  image.data.set(cropGray(LONG, { left: 0, top: y, right: 400, bottom: y + 840 }).data, 100 * 400)
  fill(image, 0, 0, 400, 100, 40)
  fill(image, 10 + clock * 3, 30, 40 + clock * 3, 60, 255) // el reloj cambia
  fill(image, 0, 940, 400, 1000, 40)
  return image
}
const source = (gray: GrayImage, dark = false): PlanSource => ({ gray, tone: 255, dark, autoCrop: true })

/** Las filas del ticket largo que tiene que dar la imagen unida: desde el principio de la primera hasta el final de la última. */
function expectRowsOfLong(gray: GrayImage, left: number, right: number) {
  // Busca dónde empieza en el ticket largo la primera fila con texto de la imagen unida, y compara todo desde ahí.
  const width = right - left
  let start = -1
  for (let y = 0; y + gray.height <= LONG.height && start < 0; y++) {
    if (cropGray(LONG, { left, top: y, right, bottom: y + 1 }).data.every((v, x) => v === gray.data[x])) {
      if (cropGray(LONG, { left, top: y, right, bottom: y + gray.height }).data.every((v, i) => v === gray.data[i])) start = y
    }
  }
  expect(start, 'la imagen unida es un trozo seguido del ticket, sin filas perdidas ni repetidas').toBeGreaterThanOrEqual(0)
  expect(width).toBeGreaterThan(0)
  return start
}

describe('planCaptures: qué imágenes se envían a leer', () => {
  it('sin imágenes no hay nada que leer, y una sola va tal cual', () => {
    expect(planCaptures([])).toEqual({ groups: [], warnings: [] })
    const plan = planCaptures([source(capture(0))])
    expect(plan.warnings).toEqual([])
    expect(plan.groups).toHaveLength(1)
    expect(plan.groups[0].sources).toEqual([0])
  })

  it('une tres capturas que se solapan en una imagen, sin perder ni repetir filas', () => {
    const sources = [0, 600, 1200].map((y, i) => source(capture(y, i)))
    const plan = planCaptures(sources)
    expect(plan.warnings).toEqual([])
    expect(plan.groups).toHaveLength(1)
    const [group] = plan.groups
    expect(group.sources).toEqual([0, 1, 2])
    const gray = groupGray(group, sources)
    const start = expectRowsOfLong(gray, group.left, group.right)
    // Va de lo primero de la primera captura a lo último de la tercera.
    expect(start).toBeLessThan(60)
    expect(start + gray.height).toBeGreaterThan(1200 + 840 - 60)
  })

  it('las ordena si vienen desordenadas', () => {
    const sources = [1200, 0, 600].map((y, i) => source(capture(y, i)))
    const [group] = planCaptures(sources).groups
    expect(group.sources).toEqual([1, 2, 0])
    expectRowsOfLong(groupGray(group, sources), group.left, group.right)
  })

  it('una captura que cabe dentro de la anterior se trata como repetida: no se usa y no se pierde ninguna fila', () => {
    // La 2.ª es la misma zona que la 1.ª, pero con un aviso oscuro de la app encima: su papel es más corto.
    const covered = capture(0, 1)
    fill(covered, 0, 100, 400, 250, 40)
    fill(covered, 0, 800, 400, 940, 40)
    const sources = [source(capture(0)), source(covered), source(capture(600, 2))]
    const plan = planCaptures(sources)
    expect(plan.warnings).toEqual(['La captura 2 ya está dentro de la 1: no aporta nada nuevo y no se usa.'])
    expect(plan.groups).toHaveLength(1)
    const [group] = plan.groups
    expect(group.sources).toEqual([0, 2])
    const gray = groupGray(group, sources)
    const start = expectRowsOfLong(gray, group.left, group.right)
    expect(start + gray.height).toBeGreaterThan(600 + 840 - 60)
  })

  it('avisa antes de leer cuando no se pueden unir: tamaños distintos, claras y oscuras, o bordes distintos', () => {
    const small = blank(300, 1000)
    small.data.set(cropGray(LONG, { left: 0, top: 0, right: 300, bottom: 1000 }).data)
    const sizes = planCaptures([source(capture(0)), source(small)])
    expect(sizes.groups).toHaveLength(2)
    expect(sizes.warnings).toEqual(['Las imágenes no tienen el mismo tamaño y no se pueden unir: se leen por separado, revisa si hay productos repetidos o que falten.'])

    const ink = planCaptures([source(capture(0)), source(capture(600, 1), true)])
    expect(ink.groups).toHaveLength(2)
    expect(ink.warnings).toEqual(['Unas capturas son claras y otras oscuras y no se pueden unir: se leen por separado, revisa si hay productos repetidos o que falten.'])

    // La 2.ª con el papel más estrecho (fondo de la app a los lados).
    const narrow = capture(600, 1)
    fill(narrow, 0, 100, 40, 940, 40)
    fill(narrow, 360, 100, 400, 940, 40)
    const borders = planCaptures([source(capture(0)), source(narrow)])
    expect(borders.groups).toHaveLength(2)
    expect(borders.warnings).toEqual(['Los bordes del ticket no coinciden en todas las capturas y no se pueden unir: se leen por separado, revisa si hay productos repetidos o que falten.'])
  })

  it('dos capturas que no se solapan van por separado y se avisa', () => {
    const plan = planCaptures([source(capture(0)), source(capture(2000, 1))])
    expect(plan.groups).toHaveLength(2)
    expect(plan.warnings).toEqual(['Las capturas 1 y 2 no se solapan: puede faltar una parte del ticket.'])
  })
})
