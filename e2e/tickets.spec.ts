import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resetDatabase } from './auth.ts'

/** Lo que dice de verdad el ticket de ejemplo (para resolver las dudas del OCR como lo haría una persona mirando la imagen). */
const TRUTH = JSON.parse(readFileSync('shared/tickets/fixtures/ticket-lidl-ejemplo.json', 'utf8')) as { lines: { rawName: string; amountCents: number }[] }
const euros = (cents: number) => `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, '0')}`

/**
 * Resuelve cada línea dudosa desde su panel de comprobación: si el lector
 * ofrece el importe correcto, «Usar …»; si no, «Editar» y escribirlo. Así la
 * prueba no depende de qué cifras exactas confunda el OCR en este navegador.
 */
async function resolveDoubts(page: Page, review: Locator) {
  for (let round = 0; round < 30; round++) {
    const open = review.locator('.ticket-line-check--sugerido, .ticket-line-check--pendiente').first()
    if (await open.count() === 0) return
    const name = (await open.locator('.ticket-line-check__head strong').innerText()).trim()
    const truth = TRUTH.lines.find(l => l.rawName === name)
    expect(truth, `línea inesperada: ${name}`).toBeTruthy()
    const amount = euros(truth!.amountCents)
    // La línea se ve en la imagen, junto a lo que leyó el OCR.
    await expect(open.getByRole('img', { name: `Línea ${name} en la imagen del ticket` })).toBeVisible()
    const use = open.getByRole('button', { name: new RegExp(`^Usar ${amount} €`) })
    if (await use.count()) {
      await use.click()
    } else {
      await open.getByRole('button', { name: 'Editar' }).click()
      const editor = review.locator('.ticket-editor .ticket-line-editor').filter({ has: page.getByLabel(`Confirmar línea ${name}`, { exact: true }) }).first()
      await editor.getByLabel(/^Importe/).first().fill(amount)
      await editor.getByLabel(`Confirmar línea ${name}`, { exact: true }).check()
      await review.getByRole('button', { name: 'Listo' }).click()
    }
  }
  throw new Error('Quedan líneas dudosas sin resolver')
}

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
  await page.getByRole('dialog', { name: 'Escanear un ticket' }).getByTestId('ticket-input').setInputFiles('shared/tickets/fixtures/ticket-lidl-ejemplo.png')
  await page.getByRole('button', { name: 'Leer imágenes', exact: true }).click()
  const review = page.getByRole('dialog', { name: 'Revisar el ticket' })
  await expect(review).toBeVisible({ timeout: 90_000 })

  await expect(review.getByLabel('Tienda')).toHaveValue('Lidl')
  await expect(review.getByLabel('Fecha de la compra')).toHaveValue('2026-10-24')
  await expect(review.getByLabel('Total del ticket')).toHaveValue('52,51')
  // El OCR real del navegador deja alguna cifra dudosa: nunca se acepta en silencio.
  const status = review.getByTestId('ticket-check')
  await expect(status).not.toHaveAttribute('data-status', 'cuadra')
  await expect(review.getByRole('heading', { name: /^Para revisar \(\d+\)$/ })).toBeVisible()
  await resolveDoubts(page, review)
  await expect(review.getByText(/Cuadra con el total: 18 líneas suman 52,51/)).toBeVisible()
  await expect(status).toHaveAttribute('data-status', 'cuadra')

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

  await review.getByLabel('Confirmar ajuste 1', { exact: true }).check()

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
  await page.getByRole('dialog', { name: 'Escanear un ticket' }).getByTestId('ticket-input').setInputFiles('shared/tickets/fixtures/ticket-lidl-ejemplo.png')
  await page.getByRole('button', { name: 'Leer imágenes', exact: true }).click()
  await expect(review.getByText(/Este ticket ya está guardado/)).toBeVisible({ timeout: 90_000 })
  await expect(review.getByRole('heading', { name: /^Ya conocidos \(\d+\)$/ })).toBeVisible()
  await expect(review.getByRole('button', { name: 'Guardar ticket' })).toBeDisabled()
})

async function pasteTicket(page: Page, lines: string[]) {
  await page.getByRole('button', { name: 'Escanear ticket' }).click()
  const scan = page.getByRole('dialog', { name: 'Escanear un ticket' })
  await scan.getByRole('button', { name: 'O pega el texto del ticket' }).click()
  await scan.getByLabel('Texto del ticket').fill(lines.join('\n'))
  await scan.getByRole('button', { name: 'Leer el texto' }).click()
  const review = page.getByRole('dialog', { name: 'Revisar el ticket' })
  await expect(review).toBeVisible()
  return review
}

// «PATATA NUEVA 5 KG 4,95X 2 9,90 A» leído como «92,90»: el caso real que motivó la revisión.
const POTATO_TICKET = ['LIDL SUPERMERCADOS S.A.U.', 'EUR', 'PATATA NUEVA 5 KG   4,95X   2   92,90 A', 'HUEVOS MEDIANOS M   2,84X   2   5,68 A',
  'TOTAL 15,58', 'Lidl Pay 15,58', 'FECHA: 28/10/26', 'HORA: 19:24:38']

test('un importe mal leído: se ve la discrepancia y se usa el calculado', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-29T10:00:00+01:00'))
  await page.goto('/')
  const review = await pasteTicket(page, POTATO_TICKET)
  const status = review.getByTestId('ticket-check')
  // Con 9,90 propuesto la suma coincide, pero la línea aún no está confirmada.
  await expect(status).toHaveAttribute('data-status', 'pendiente')

  const check = review.getByRole('group', { name: 'Comprobar PATATA NUEVA 5 KG' })
  await expect(check).toContainText('Cantidad2')
  await expect(check).toContainText('Precio unitario4,95 €')
  await expect(check).toContainText('OCR92,90 €')
  await expect(check).toContainText('Calculado9,90 €')
  await expect(check).toContainText('Sugerido: confírmalo')
  await expect(check).toContainText('Se explica por una cifra de más en el importe')
  // La línea de los huevos cuadra y no pide nada.
  await expect(review.getByRole('group', { name: 'Comprobar HUEVOS MEDIANOS M' })).toHaveCount(0)

  // Elegir la lectura del OCR deja la incoherencia a la vista.
  await check.getByRole('button', { name: 'Usar 92,90 € (leído)' }).click()
  await expect(check).toContainText('El importe reconocido no coincide con el precio unitario multiplicado por la cantidad.')
  await expect(check).toContainText('Pendiente')
  await expect(status).toHaveAttribute('data-status', 'no_cuadra')

  await check.getByRole('button', { name: 'Usar 9,90 €', exact: true }).click()
  await expect(check).toContainText('Confirmado')
  await expect(status).toHaveAttribute('data-status', 'cuadra')
  await review.getByRole('button', { name: 'Guardar ticket' }).click()
  await expect(review).toBeHidden()
  await expect(page.getByText('Ticket guardado: 2 productos apuntados')).toBeVisible()
  // El precio que aprende la despensa sale de 9,90 € (4,95 € cada una), nunca de 92,90 €.
  await expect(item(page, 'Patata nueva 5 kg')).toContainText('4,95 €/ud')
})

test('«Dejar pendiente»: la línea se guarda en el ticket, pero no toca la despensa', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-29T10:00:00+01:00'))
  await page.goto('/')
  const review = await pasteTicket(page, POTATO_TICKET)
  const check = review.getByRole('group', { name: 'Comprobar PATATA NUEVA 5 KG' })
  await check.getByRole('button', { name: 'Dejar pendiente' }).click()
  await expect(check.getByRole('button', { name: 'Quitar de pendientes' })).toHaveAttribute('aria-pressed', 'true')
  await expect(check).toContainText('no cambia la despensa')
  await review.getByRole('button', { name: 'Guardar ticket' }).click()
  const confirm = page.getByRole('dialog', { name: 'Guardar con advertencias' })
  await expect(confirm).toContainText('1 líneas quedarán pendientes y no actualizarán la despensa')
  await confirm.getByRole('button', { name: 'Guardar solo líneas fiables en la despensa' }).click()
  await expect(page.getByText('Ticket guardado: 1 producto apuntado')).toBeVisible()
  await expect(item(page, 'Patata nueva 5 kg')).toHaveCount(0)
  await expect(item(page, 'Huevos medianos M')).toBeVisible()

  // En el ticket guardado se conservan la línea, su estado y lo que leyó el OCR.
  const recent = page.getByRole('region', { name: 'Últimas compras' })
  await recent.getByRole('button', { name: /Lidl · 28\/10\/2026/ }).click()
  const detail = page.getByRole('dialog', { name: 'Lidl · 28/10/2026' })
  await expect(detail).toContainText('pendiente: no actualiza la despensa')
  await expect(detail).toContainText('Leído por el OCR: 92,90 € · calculado: 9,90 €')
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

test('repaso de la semana: «Hoy no», un producto cada vez, volver atrás y la lista hecha', async ({ page, request }) => {
  await saveTicket(request, '2026-10-20', [
    { name: 'LECHE ENTERA', product: 'Leche entera', cents: 200, quantity: 2, frequency: 'semanal' },
    { name: 'PAN BARRA', product: 'Pan de barra', cents: 96, frequency: 'semanal' },
    { name: 'DETERGENTE', product: 'Detergente', cents: 499, frequency: 'mensual' },
  ])
  const rice = await request.post('/api/despensa/productos', {
    data: { name: 'Arroz', ownerId: null, unit: 'kg', tracking: 'cantidad', quantity: 1, target: 2, frequency: 'mensual', priceCents: 120, notes: '' },
  })
  expect(rice.status()).toBe(201)
  await page.clock.setFixedTime(new Date('2026-10-29T10:00:00+01:00'))
  await page.goto('/')

  // Nunca se ha hecho y la primera compra fue hace 9 días: toca. «Hoy no» lo deja en una línea, también al recargar.
  await expect(page.getByRole('heading', { name: 'Toca el repaso de la semana' })).toBeVisible()
  await page.getByRole('button', { name: 'Hoy no' }).click()
  await expect(page.getByRole('heading', { name: 'Toca el repaso de la semana' })).toHaveCount(0)
  await expect(page.getByText('Repaso de la semana: te avisará cada 7 días.')).toBeVisible()
  await page.reload()
  await expect(page.getByText('Repaso de la semana: te avisará cada 7 días.')).toBeVisible()

  await page.getByRole('button', { name: 'Repasar ahora' }).click()
  const review = page.getByRole('dialog', { name: 'Repaso de la semana' })
  // Lo semanal comprado hace 9 días y lo que se cuenta; el detergente (cada mes) todavía no hace falta mirarlo.
  await expect(review.getByText('1 de 3')).toBeVisible()
  await expect(review.getByRole('heading', { name: 'Leche entera' })).toBeFocused()
  await review.getByRole('button', { name: 'Queda poco', exact: true }).click()

  await expect(review.getByRole('heading', { name: 'Pan de barra' })).toBeVisible()
  await review.getByRole('button', { name: 'Se acabó', exact: true }).click()
  // Equivocado: atrás, se ve lo que se había contestado, y se cambia por «Queda».
  await expect(review.getByRole('heading', { name: 'Arroz' })).toBeVisible()
  await review.getByRole('button', { name: 'Atrás' }).click()
  await expect(review.getByRole('button', { name: 'Se acabó', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await review.getByRole('button', { name: 'Queda', exact: true }).click()

  // Lo que se cuenta se ajusta con − y + al momento.
  await review.getByRole('button', { name: 'Añadir 0,5 kg a Arroz' }).click()
  await expect(review.locator('.stepper__value')).toHaveText('1,5 kg')
  await review.getByRole('button', { name: 'Terminar' }).click()

  await expect(review.getByRole('heading', { name: 'Repaso hecho' })).toBeVisible()
  await expect(review).toContainText('Has repasado 3 productos; 1 ha pasado a la lista.')
  await expect(review).toContainText('La lista de la compra tiene 2 productos.')
  await review.getByRole('button', { name: 'Ver la lista de la compra' }).click()
  const list = page.getByRole('dialog', { name: 'Lista de la compra' })
  await expect(list.getByLabel('Texto de la lista')).toHaveValue(/\*Compartido\*\n• Leche entera — 2 ud\n• Arroz — 0,5 kg\n\nTotal estimado: 2,60 €$/)
  await list.getByRole('button', { name: 'Cerrar', exact: true }).last().click()
  await expect(list).toBeHidden()

  // Queda apuntado en el servidor: hasta dentro de una semana no vuelve a avisar.
  await expect(page.getByText('Último repaso: hoy.')).toBeVisible()
  await page.reload()
  await expect(page.getByText('Último repaso: hoy.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Toca el repaso de la semana' })).toHaveCount(0)
  await expect(item(page, 'Leche entera').locator('.chip')).toHaveText('Queda poco')
  // El «Se acabó» del pan se sustituyó por «Queda»: no está en la lista ni cuenta como lo que duró.
  await expect(item(page, 'Pan de barra').locator('.chip')).toHaveCount(0)
  await expect(item(page, 'Pan de barra')).toContainText('Comprado hace 9 días en Lidl')
  await expect(item(page, 'Pan de barra')).not.toContainText('suele durar')
  await expect(page.getByRole('button', { name: 'Lista de la compra (2)' })).toBeVisible()
})
