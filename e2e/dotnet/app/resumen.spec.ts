import { resetDatabase, signIn } from '../../auth.ts'
import { expect, test, type Page } from '../../test.ts'

/**
 * Solo contra .NET (playwright.dotnet.config.ts, web compilada con CUENTAS_BACKEND=dotnet): el resumen del mes, el del
 * año y los presupuestos los calcula el servidor (GET /api/summary/*, FIN-04) con la fecha de hoy del navegador, y la web
 * enseña lo mismo que calculaba ella. Las cifras son las de «la plantilla anual cuadra con la mensual…» (e2e/app.spec.ts).
 */

test.beforeEach(async ({ request, page }) => {
  await resetDatabase(request)
  await signIn(page.request)
})

const ledgerValue = (page: Page, label: string) =>
  page.locator('.ledger__row', { has: page.locator('.ledger__label', { hasText: label }) }).locator('dd')

test('el mes, el año y los presupuestos los calcula .NET con la fecha del navegador', { tag: '@dotnet' }, async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-28T12:00:00+01:00'))
  const summaries: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/api/summary/')) summaries.push(`${request.method()} ${url.pathname}${url.search}`)
  })
  await page.goto('/#ajustes')
  await page.locator('[data-testid=restore-input]').setInputFiles('ejemplo/copia-de-ejemplo.json')
  await page.getByRole('dialog', { name: 'Restaurar copia' }).getByRole('button', { name: 'Sustituir mis datos' }).click()
  await expect(page.getByText('Copia restaurada')).toBeVisible()

  await page.goto('/#resumen')
  await expect(ledgerValue(page, 'Resultado previsto')).toHaveText('+95,56 €')
  expect(summaries).toContain('GET /api/summary/month?year=2026&month=10&hoy=2026-10-28')

  await page.getByRole('link', { name: 'Año', exact: true }).click()
  await expect(ledgerValue(page, 'Resultado previsto')).toHaveText('+725,67 €')
  expect(summaries).toContain('GET /api/summary/year?year=2026&hoy=2026-10-28')

  await page.goto('/#presupuestos')
  await expect(page.getByRole('heading', { name: 'Presupuestos', level: 1 })).toBeVisible()
  await expect(page.locator('.budget-item').first()).toBeVisible()
  // Nada del resumen se ha calculado en el navegador sin preguntar al servidor, y ninguna consulta ha fallado.
  await expect(page.getByText('No se ha podido calcular el resumen')).toHaveCount(0)
})
