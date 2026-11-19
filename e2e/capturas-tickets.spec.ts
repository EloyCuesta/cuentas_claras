import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { resetDatabase } from './auth.ts'
import { expect, test } from './test.ts'

/**
 * Capturas de la interfaz de los tickets, para comparar antes y después de un
 * cambio. No es una prueba: se salta si no hay CUENTAS_CAPTURAS_DIR (la carpeta,
 * fuera de git, donde se guardan).
 *
 * Escanea las capturas sintéticas de «mediano» (o las imágenes de
 * CUENTAS_CAPTURAS_IMAGENES, separadas por «;») y fotografía cada paso:
 * elegir, leyendo, la revisión pantalla a pantalla y la primera línea dudosa,
 * en claro y en oscuro, en el proyecto que toque (escritorio o móvil). Anota
 * en medidas.json cuántas pantallas mide la revisión.
 */

const DIR = process.env.CUENTAS_CAPTURAS_DIR
const BANCO = 'fixtures/tickets/banco/'
const IMAGES = process.env.CUENTAS_CAPTURAS_IMAGENES?.split(';').filter(Boolean)
  ?? readdirSync(BANCO).filter((f) => /^mediano-captura-\d+\.png$/.test(f)).sort().map((f) => `${BANCO}${f}`)

test.skip(!DIR, 'Solo para hacer capturas: con CUENTAS_CAPTURAS_DIR')

for (const [scheme, theme] of [['light', 'claro'], ['dark', 'oscuro']] as const) {
  test(`capturas de la lectura de un ticket (${theme})`, async ({ page, request }, info) => {
    test.setTimeout(240_000)
    await resetDatabase(request)
    await page.emulateMedia({ colorScheme: scheme })
    const dir = join(DIR!, `${info.project.name}-${theme}`)
    mkdirSync(dir, { recursive: true })
    const shot = (name: string) => page.screenshot({ path: join(dir, `${name}.png`) })

    await page.goto('/')
    await page.getByRole('button', { name: 'Escanear ticket' }).click()
    const dialog = page.getByRole('dialog', { name: 'Escanear un ticket' })
    await dialog.getByTestId('ticket-input').setInputFiles(IMAGES)
    await shot('1-elegir')
    await page.getByRole('button', { name: /^Leer( imágenes)?$/ }).click()
    await shot('2-leyendo')

    const review = page.getByRole('dialog', { name: 'Revisar el ticket' })
    await expect(review).toBeVisible({ timeout: 200_000 })
    const body = review.locator('.dialog__body')
    const { scrollHeight, clientHeight } = await body.evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }))
    const viewport = page.viewportSize()!
    for (let i = 0; i * clientHeight < scrollHeight; i++) {
      await body.evaluate((el, y) => el.scrollTo(0, y), i * clientHeight)
      await shot(`3-revision-${String(i + 1).padStart(2, '0')}`)
    }
    const doubt = review.locator('.ticket-line-check').first()
    let doubtHeight: number | null = null
    if (await doubt.count()) {
      await doubt.scrollIntoViewIfNeeded()
      await doubt.screenshot({ path: join(dir, '4-linea-dudosa.png') })
      doubtHeight = (await doubt.boundingBox())?.height ?? null
    }
    writeFileSync(join(dir, 'medidas.json'), `${JSON.stringify({
      imagenes: IMAGES.length,
      pantalla: viewport,
      pantallasDeRevision: Math.round((scrollHeight / viewport.height) * 10) / 10,
      alturaLineaDudosa: doubtHeight,
      lineasDudosas: await review.locator('.ticket-line-check').count(),
    }, null, 1)}\n`)
  })
}
