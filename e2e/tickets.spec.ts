import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { resetDatabase } from './auth.ts'

/**
 * Tickets de la compra y ritmo de compra, como invitado (sin el código): leer
 * la captura de un ticket de Lidl (ficticio), revisarlo y guardarlo; y lo que
 * toca revisar días después, con «Queda», «Se acabó» y la lista de la compra.
 */

test.beforeEach(async ({ request }) => {
  await resetDatabase(request)
})

const item = (page: Page, name: string) => page.locator('.pantry-item', { has: page.getByRole('button', { name: `Editar ${name}`, exact: true }) })

test('lee la captura de un ticket de Lidl, se revisa y se guarda', async ({ page }) => {
  // La imagen se lee en el propio servidor (OCR local): tarda unos segundos.
  test.setTimeout(120_000)
  await page.clock.setFixedTime(new Date('2026-10-29T10:00:00+01:00'))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Empieza escaneando un ticket' })).toBeVisible()

  await page.getByRole('button', { name: 'Escanear ticket' }).click()
  await page.getByRole('dialog', { name: 'Escanear un ticket' }).getByTestId('ticket-input').setInputFiles('server/fixtures/ticket-lidl-ejemplo.png')
  const review = page.getByRole('dialog', { name: 'Revisar el ticket' })
  await expect(review).toBeVisible({ timeout: 90_000 })

  await expect(review.getByLabel('Tienda')).toHaveValue('Lidl')
  await expect(review.getByLabel('Fecha de la compra')).toHaveValue('2026-10-24')
  await expect(review.getByLabel('Total del ticket')).toHaveValue('52,51')
  await expect(review.getByText(/Cuadra con el total: 18 líneas suman 52,51/)).toBeVisible()
  await expect(review.getByRole('heading', { name: 'Productos nuevos (17)' })).toBeVisible()

  // Las dos líneas de macarrones van juntas.
  await expect(review.getByRole('button', { name: /^Macarrones.*2 líneas/ })).toBeVisible()

  // Un producto con otro nombre y una línea que no se sigue.
  await review.getByRole('button', { name: /^Huevos camperos L/ }).click()
  await review.getByLabel('Nombre del producto nuevo').fill('Huevos')
  await review.getByRole('button', { name: 'Listo' }).click()
  await review.getByRole('button', { name: /^Papel higiénico 12r/ }).click()
  await review.getByLabel('Es el producto').selectOption({ label: 'No seguir esta línea (bolsas, envases…)' })
  await review.getByRole('button', { name: 'Listo' }).click()
  await expect(review.getByRole('button', { name: /^PAPEL HIGIÉNICO 12R.*No se sigue/ })).toBeVisible()

  await review.getByRole('button', { name: 'Guardar ticket' }).click()
  await expect(review).toBeHidden()
  await expect(page.getByText('Ticket guardado: 16 productos apuntados')).toBeVisible()

  const recent = page.getByRole('region', { name: 'Últimas compras' })
  await expect(recent).toContainText('Lidl · 24/10/2026')
  await expect(recent).toContainText('16 productos · 18:05')
  await expect(recent).toContainText('52,51 €')

  await expect(item(page, 'Leche semidesnatada')).toContainText('Comprado hace 5 días en Lidl (6 ud)')
  await expect(item(page, 'Leche semidesnatada')).toContainText('0,95 €/ud')
  await expect(item(page, 'Plátano canario')).toContainText('(0,812 kg)')
  await expect(item(page, 'Huevos')).toBeVisible()
  await expect(item(page, 'Papel higiénico 12r')).toHaveCount(0)
  // Cinco días después de comprar, aún no toca revisar nada.
  await expect(page.getByRole('heading', { name: /Para revisar/ })).toHaveCount(0)

  // El ticket guardado: sus líneas y a qué producto va cada una.
  await recent.getByRole('button', { name: /Lidl · 24\/10\/2026/ }).click()
  const detail = page.getByRole('dialog', { name: 'Lidl · 24/10/2026' })
  await expect(detail.getByLabel('Producto de LECHE SEMIDESNATADA')).toHaveValue(/.+/)
  await expect(detail.getByLabel('Producto de PAPEL HIGIÉNICO 12R')).toHaveValue('')
  await detail.getByRole('button', { name: 'Cerrar', exact: true }).last().click()
  await expect(detail).toBeHidden()

  // El mismo ticket no se puede guardar dos veces.
  await page.getByRole('button', { name: 'Escanear ticket' }).click()
  await page.getByRole('dialog', { name: 'Escanear un ticket' }).getByTestId('ticket-input').setInputFiles('server/fixtures/ticket-lidl-ejemplo.png')
  await expect(review.getByText(/Este ticket ya está guardado/)).toBeVisible({ timeout: 90_000 })
  await expect(review.getByRole('heading', { name: 'Ya conocidos (16)' })).toBeVisible()
  await expect(review.getByRole('button', { name: 'Guardar ticket' })).toBeDisabled()
})

/** Un ticket guardado directamente por la API (sin leer ninguna imagen). */
async function saveTicket(request: APIRequestContext, date: string, lines: { name: string; product: string; cents: number; quantity?: number; frequency: string }[]) {
  const response = await request.post('/api/despensa/tickets', {
    data: {
      store: 'lidl',
      storeName: 'Lidl',
      address: '',
      date,
      time: '19:00',
      totalCents: lines.reduce((sum, line) => sum + line.cents, 0),
      lines: lines.map((line) => ({
        rawName: line.name,
        quantity: line.quantity ?? 1,
        unitPriceCents: null,
        amountCents: line.cents,
        discountCents: 0,
        weightKg: null,
        pricePerKgCents: null,
        taxCode: 'A',
        occasional: false,
      })),
      decisions: Object.fromEntries(lines.map((line) => [line.name, { kind: 'new', name: line.product, ownerId: null, frequency: line.frequency }])),
    },
  })
  expect(response.status()).toBe(201)
}

test('días después: qué toca revisar, «Queda», «Se acabó» y la lista de la compra', async ({ page, request }) => {
  await saveTicket(request, '2026-10-20', [
    { name: 'LECHE ENTERA', product: 'Leche entera', cents: 200, quantity: 2, frequency: 'semanal' },
    { name: 'PAN BARRA', product: 'Pan de barra', cents: 96, frequency: 'semanal' },
    { name: 'DETERGENTE', product: 'Detergente', cents: 499, frequency: 'mensual' },
  ])
  // Nueve días después: lo semanal probablemente se acabó; el detergente, no.
  await page.clock.setFixedTime(new Date('2026-10-29T10:00:00+01:00'))
  await page.goto('/')

  const toReview = page.getByRole('region', { name: /Para revisar/ })
  await expect(toReview.getByRole('heading', { name: 'Para revisar (2)' })).toBeVisible()
  await expect(toReview).toContainText('Leche entera')
  await expect(toReview).toContainText('Pan de barra')
  await expect(toReview).not.toContainText('Detergente')
  await expect(item(page, 'Detergente')).toContainText('Comprado hace 9 días en Lidl')
  await expect(page.getByRole('button', { name: 'Lista de la compra (2)' })).toBeVisible()

  await toReview.getByRole('button', { name: 'Queda Leche entera' }).click()
  await expect(page.getByText('Leche entera: queda. Te avisará más adelante.')).toBeVisible()
  await expect(toReview.getByRole('heading', { name: 'Para revisar (1)' })).toBeVisible()

  await toReview.getByRole('button', { name: 'Se acabó Pan de barra' }).click()
  await expect(page.getByText('Pan de barra: se acabó. Está en la lista de la compra.')).toBeVisible()
  await expect(page.getByRole('heading', { name: /Para revisar/ })).toHaveCount(0)
  await expect(item(page, 'Pan de barra').locator('.chip')).toHaveText('Se acabó')
  await expect(item(page, 'Leche entera').locator('.chip')).toHaveCount(0)

  await page.getByRole('button', { name: 'Lista de la compra (1)' }).click()
  const list = page.getByRole('dialog', { name: 'Lista de la compra' })
  await expect(list.getByLabel('Texto de la lista')).toHaveValue(/\*Compartido\*\n• Pan de barra — 1 ud\n\nTotal estimado: 0,96 €$/)
  await list.getByRole('button', { name: 'Marcar todo como comprado' }).click()
  await expect(list).toBeHidden()
  await expect(page.getByText('1 producto comprado')).toBeVisible()
  await expect(item(page, 'Pan de barra')).toContainText('Comprado hoy')
  await expect(page.getByRole('button', { name: 'Lista de la compra', exact: true })).toBeVisible()

  // Deshacer la compra la vuelve a poner en la lista, también en el servidor.
  await page.locator('.toast', { hasText: '1 producto comprado' }).getByRole('button', { name: 'Deshacer' }).click()
  await expect(page.getByText('Compra deshecha')).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Lista de la compra (1)' })).toBeVisible()
  await expect(item(page, 'Pan de barra')).toContainText('Comprado hace 9 días en Lidl')
})
