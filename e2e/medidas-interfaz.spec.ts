import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Locator, Page, Request } from '@playwright/test'
import { resetDatabase, signIn } from './auth.ts'
import { expect, test } from './test.ts'

/**
 * La línea base de la interfaz (UX-00 de docs/terminar-el-proyecto.md) y su
 * comparación al terminar (UX-07). No es una prueba: se salta si no hay
 * CUENTAS_MEDIDAS_DIR, la carpeta fuera de git donde se guardan las capturas y
 * las medidas (por ejemplo, .medidas-interfaz/, que está en .gitignore).
 *
 * Con la base de pruebas, la copia `ejemplo/copia-de-ejemplo.json` y unos
 * productos inventados, en el proyecto que toque (escritorio o móvil):
 * - capturas de cada pantalla y de los diálogos de añadir movimiento, pagar,
 *   producto y ticket, en claro y en oscuro;
 * - los toques de cada tarea (un toque es pulsar algo; elegir en una lista
 *   cuenta 2, abrirla y elegir; escribir en un campo que no tenía el foco
 *   cuenta 1 por tocarlo, y lo escrito va aparte);
 * - el JS y el CSS que descarga la web al abrirse, como invitado y con el código;
 * - las peticiones a /api y el tiempo al abrir, al guardar un movimiento y al
 *   volver a la Despensa;
 * - los objetivos táctiles de menos de 44 px de cada pantalla.
 *
 * Escribe `<proyecto>-medidas.json` y lo resume en la consola.
 */

const DIR = process.env.CUENTAS_MEDIDAS_DIR
/** Una espera en Node: la de la página (waitForTimeout) no avanza con el reloj fijo de page.clock. */
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

test.skip(!DIR, 'Solo para medir la interfaz: con CUENTAS_MEDIDAS_DIR')
// Que un paso que no llega falle pronto, en lugar de esperar todo el tiempo de la prueba.
test.use({ actionTimeout: 15_000, navigationTimeout: 30_000 })

/** Los datos de ejemplo son de octubre de 2026. */
const NOW = new Date('2026-10-28T12:00:00+01:00')

interface Task { taps: number; typed: number }
const SCREENS = [
  ['resumen', 'Resumen'], ['anual', 'Año'], ['movimientos', 'Movimientos'], ['recurrentes', 'Recurrentes'],
  ['presupuestos', 'Presupuestos'], ['despensa', 'Despensa'], ['ajustes', 'Ajustes'],
] as const

/** Cuenta lo que hace una persona: toques y campos escritos. */
function counter() {
  const task: Task = { taps: 0, typed: 0 }
  return {
    task,
    async tap(locator: Locator) { task.taps++; await locator.click() },
    async choose(select: Locator, label: string) { task.taps += 2; await select.selectOption({ label }) },
    async type(field: Locator, text: string) {
      if (!(await field.evaluate((el) => el === document.activeElement))) task.taps++
      task.typed++
      await field.fill(text)
    },
  }
}

/** Peticiones a /api mientras dura `work`, y cuánto tarda. */
async function measure(page: Page, work: () => Promise<void>) {
  const requests: string[] = []
  const onRequest = (request: Request) => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/api/')) requests.push(`${request.method()} ${url.pathname}`)
  }
  page.on('request', onRequest)
  const started = Date.now()
  await work()
  const ms = Date.now() - started
  page.off('request', onRequest)
  return { requests: requests.length, list: requests, ms }
}

/** Los objetivos táctiles visibles de menos de 44 px de alto o de ancho. */
function smallTargets(page: Page) {
  return page.evaluate(() => {
    const selector = 'button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], label.checkbox'
    const found: { what: string; width: number; height: number }[] = []
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      const box = el.getBoundingClientRect()
      const style = getComputedStyle(el)
      if (box.width === 0 || box.height === 0 || style.visibility === 'hidden' || el.closest('[hidden], .sr-only')) continue
      // Un control nativo dentro de su etiqueta grande cuenta como la etiqueta.
      if ((el instanceof HTMLInputElement && (el.type === 'radio' || el.type === 'checkbox')) && el.closest('label')) continue
      if (box.height < 44 || box.width < 44) {
        const name = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40)
        found.push({ what: `${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).split(' ')[0]}` : ''} «${name}»`, width: Math.round(box.width), height: Math.round(box.height) })
      }
    }
    return found
  })
}

/** El JS y el CSS que se descargan al abrir (en bytes, sin comprimir) hasta que se ve `ready`. */
async function initialAssets(page: Page, path: string, ready: Locator) {
  const sizes = { js: 0, css: 0, files: 0 }
  const onResponse = async (response: import('@playwright/test').Response) => {
    const type = response.request().resourceType()
    if (type !== 'script' && type !== 'stylesheet') return
    const body = await response.body().catch(() => null)
    if (!body) return
    sizes.files++
    if (type === 'script') sizes.js += body.length
    else sizes.css += body.length
  }
  // Desde una página en blanco (si no, ir a otra sección solo cambia el hash y no se descarga nada) y sin la caché del
  // navegador: con una ruta interceptada, Playwright no la usa, y así se cuenta lo que descarga cada vez.
  await page.goto('about:blank')
  await page.route('**/assets/**', (route) => route.continue())
  page.on('response', onResponse)
  await page.goto(path)
  await expect(ready).toBeVisible()
  // Lo que se pide justo después de pintar (la fuente, por ejemplo) también cuenta.
  await pause(1500)
  page.off('response', onResponse)
  await page.unroute('**/assets/**')
  return sizes
}

async function seedPantry(page: Page) {
  const api = page.request
  const person = await (await api.post('/api/despensa/personas', { data: { name: 'Persona A' } })).json() as { data: { id: string } }
  const items: [string, string | null, string, number, number, string][] = [
    ['Leche semidesnatada', null, 'ud', 2, 6, 'semanal'], ['Pan de barra', null, 'ud', 0, 1, 'semanal'],
    ['Arroz', null, 'kg', 1, 2, 'mensual'], ['Café molido', person.data.id, 'ud', 1, 2, 'mensual'],
    ['Detergente', null, 'ud', 1, 1, 'ocasional'], ['Yogur natural', person.data.id, 'ud', 4, 8, 'semanal'],
  ]
  for (const [name, ownerId, unit, quantity, target, frequency] of items) {
    const response = await api.post('/api/despensa/productos', { data: { name, ownerId, unit, quantity, target, frequency, priceCents: 120, notes: '' } })
    expect(response.ok()).toBe(true)
  }
}

test('medidas de la interfaz: capturas, toques, peticiones, peso y objetivos pequeños', async ({ page, request }, info) => {
  test.setTimeout(300_000)
  const step = (name: string) => console.log(`[medidas ${info.project.name}] ${name}`)
  await resetDatabase(request)
  await page.clock.setFixedTime(NOW)
  const phone = info.project.name.includes('movil')
  const report: Record<string, unknown> = { proyecto: info.project.name, pantalla: page.viewportSize() }

  step('invitado')
  // Peso al abrir como invitado (sin sesión), antes de iniciarla.
  report.invitado = await initialAssets(page, '/', page.getByRole('heading', { name: 'Despensa', level: 1 }))

  await signIn(page.request)
  // Ir a #ajustes desde la página ya abierta solo cambia el hash: hay que volver a cargarla para entrar con la sesión.
  await page.goto('about:blank')
  await page.goto('/#ajustes')
  await page.locator('[data-testid=restore-input]').setInputFiles('ejemplo/copia-de-ejemplo.json')
  await page.getByRole('dialog', { name: 'Restaurar copia' }).getByRole('button', { name: 'Sustituir mis datos' }).click()
  await expect(page.getByText('Copia restaurada')).toBeVisible()
  await seedPantry(page)

  // Peso y peticiones al abrir con el código.
  const heading = page.getByRole('heading', { level: 1 })
  report.administrador = await initialAssets(page, '/#resumen', heading)
  report.abrir = await measure(page, async () => {
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Octubre de 2026', level: 1 })).toBeVisible()
  })

  step('capturas')
  // Capturas y objetivos pequeños de cada pantalla, en claro y en oscuro.
  const small: Record<string, number> = {}
  const smallList: Record<string, { what: string; width: number; height: number }[]> = {}
  for (const [scheme, theme] of [['light', 'claro'], ['dark', 'oscuro']] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    const dir = join(DIR!, `${info.project.name}-${theme}`)
    mkdirSync(dir, { recursive: true })
    for (const [i, [route]] of SCREENS.entries()) {
      await page.goto(`/#${route}`)
      await expect(heading).toBeVisible()
      await pause(400)
      await page.screenshot({ path: join(dir, `${i + 1}-${route}.png`), fullPage: true })
      if (theme === 'claro') {
        const found = await smallTargets(page)
        small[route] = found.length
        smallList[route] = found
      }
    }
    // Los diálogos: añadir movimiento, pagar, producto y ticket.
    await page.goto('/#resumen')
    await page.getByRole('button', { name: phone ? 'Añadir movimiento' : 'Añadir movimiento' }).first().click()
    await page.screenshot({ path: join(dir, '8-dialogo-movimiento.png') })
    if (theme === 'claro') smallList['dialogo-movimiento'] = await smallTargets(page)
    await page.keyboard.press('Escape')
    const pay = page.getByRole('button', { name: /^Marcar pagado/ }).first()
    if (await pay.count()) {
      await pay.click()
      await page.screenshot({ path: join(dir, '9-dialogo-pago.png') })
      await page.keyboard.press('Escape')
    }
    await page.goto('/#despensa')
    await page.getByRole('button', { name: 'Nuevo producto' }).click()
    await page.screenshot({ path: join(dir, '10-dialogo-producto.png') })
    if (theme === 'claro') smallList['dialogo-producto'] = await smallTargets(page)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Escanear ticket' }).click()
    await page.screenshot({ path: join(dir, '11-dialogo-ticket.png') })
    await page.keyboard.press('Escape')
  }
  await page.emulateMedia({ colorScheme: 'light' })
  for (const [name, list] of Object.entries(smallList)) small[name] ??= list.length
  report.objetivosPequenos = small
  report.objetivosPequenosDetalle = smallList

  step('toques')
  // Toques de cada tarea.
  const tasks: Record<string, Task> = {}
  {
    await page.goto('/#resumen')
    const c = counter()
    await c.tap(page.getByRole('button', { name: 'Añadir movimiento' }).first())
    const dialog = page.getByRole('dialog', { name: 'Nuevo movimiento' })
    await c.type(dialog.getByLabel('Importe'), '12,50')
    await c.type(dialog.getByLabel('Concepto'), 'Panadería')
    await c.choose(dialog.getByLabel('Categoría'), 'Alimentación › Supermercado')
    const save = measure(page, async () => {
      await c.tap(dialog.getByRole('button', { name: 'Guardar gasto' }))
      await expect(dialog).toBeHidden()
    })
    report.guardarMovimiento = await save
    tasks['añadir un gasto'] = c.task
  }
  {
    const c = counter()
    await c.tap(page.getByRole('button', { name: 'Añadir movimiento' }).first())
    const dialog = page.getByRole('dialog', { name: 'Nuevo movimiento' })
    await c.tap(dialog.getByRole('radio', { name: 'Ingreso' }))
    await c.type(dialog.getByLabel('Importe'), '100')
    await c.type(dialog.getByLabel('Concepto'), 'Venta')
    await c.choose(dialog.getByLabel('Categoría'), (await dialog.getByLabel('Categoría').locator('option').nth(1).innerText()).trim())
    await c.tap(dialog.getByRole('button', { name: /^Guardar/ }))
    await expect(dialog).toBeHidden()
    tasks['añadir un ingreso'] = c.task
  }
  {
    const pay = page.getByRole('button', { name: /^Marcar pagado/ }).first()
    if (await pay.count()) {
      const c = counter()
      await c.tap(pay)
      const dialog = page.getByRole('dialog', { name: 'Confirmar pago' })
      await c.tap(dialog.getByRole('button', { name: 'Marcar como pagado' }))
      await expect(dialog).toBeHidden()
      tasks['marcar pagado'] = c.task
    }
  }
  {
    await page.goto('/#despensa')
    const c = counter()
    await c.tap(page.getByRole('button', { name: 'Nuevo producto' }))
    const dialog = page.getByRole('dialog', { name: 'Nuevo producto' })
    await c.type(dialog.getByLabel('Nombre'), 'Galletas')
    await c.tap(dialog.getByRole('button', { name: 'Guardar producto' }))
    await expect(dialog).toBeHidden()
    tasks['añadir un producto'] = c.task
  }
  {
    // + y −: dónde está el primer + al abrir la Despensa (cuánto hay que desplazarse para llegar a él).
    await page.goto('/#despensa')
    const plus = page.getByRole('button', { name: /^Añadir .* a / }).first()
    await expect(plus).toBeAttached()
    const box = await plus.evaluate((el) => el.getBoundingClientRect().top + window.scrollY)
    report.primerMasDesdeArriba = Math.round(box)
    report.primerMasEnLaPrimeraPantalla = box < page.viewportSize()!.height
    tasks['+ / −'] = { taps: 1 + (box < page.viewportSize()!.height ? 0 : 1), typed: 0 }
  }
  {
    // Escanear un ticket (pegando el texto): toques hasta guardarlo, con una línea dudosa.
    const c = counter()
    await c.tap(page.getByRole('button', { name: 'Escanear ticket' }))
    const scan = page.getByRole('dialog', { name: 'Escanear un ticket' })
    await c.tap(scan.getByRole('button', { name: 'O pega el texto del ticket' }))
    await c.type(scan.getByLabel('Texto del ticket'), ['LIDL SUPERMERCADOS S.A.U.', 'EUR', 'PATATA NUEVA 5 KG   4,95X   2   92,90 A',
      'HUEVOS MEDIANOS M   2,84X   2   5,68 A', 'TOTAL 15,58', 'Lidl Pay 15,58', 'FECHA: 28/10/26', 'HORA: 19:24:38'].join('\n'))
    await c.tap(scan.getByRole('button', { name: 'Leer el texto' }))
    const review = page.getByRole('dialog', { name: 'Revisar el ticket' })
    await c.tap(review.getByRole('group', { name: 'Comprobar PATATA NUEVA 5 KG' }).getByRole('button', { name: 'Usar 9,90 €', exact: true }))
    await c.tap(review.getByRole('button', { name: 'Guardar ticket' }))
    await expect(review).toBeHidden()
    tasks['escanear un ticket (texto pegado, una duda)'] = c.task
  }
  {
    // Ver el mes: al abrir ya se ve el Resumen del mes.
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Octubre de 2026', level: 1 })).toBeVisible()
    tasks['ver el mes'] = { taps: 0, typed: 0 }
  }
  report.toques = tasks

  // Volver a la Despensa desde otra sección.
  await page.goto('/#resumen')
  await expect(page.getByRole('heading', { name: 'Octubre de 2026', level: 1 })).toBeVisible()
  let sawLoading = false
  report.volverADespensa = await measure(page, async () => {
    await page.getByRole('link', { name: 'Despensa' }).first().click()
    sawLoading = await page.getByText('Cargando la despensa…').isVisible().catch(() => false)
    await expect(page.getByRole('button', { name: /^Editar Leche semidesnatada/ })).toBeVisible()
  })
  report.volverADespensaCargando = sawLoading

  writeFileSync(join(DIR!, `${info.project.name}-medidas.json`), `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ ...report, objetivosPequenosDetalle: undefined }, null, 2))
})
