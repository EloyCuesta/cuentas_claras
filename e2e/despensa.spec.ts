import { expect, test, type Page } from '@playwright/test'
import { E2E_CODE, resetDatabase } from './auth.ts'

/**
 * Invitado y despensa, en un navegador real. El navegador de cada prueba
 * empieza sin sesión (nadie ha escrito el código); solo el cliente de API
 * `request` inicia sesión para vaciar la base de datos de pruebas.
 */

test.beforeEach(async ({ request }) => {
  await resetDatabase(request)
})

/** Peticiones financieras que no deben salir nunca de la vista de invitado. */
const FINANCE_REQUEST = /\/api\/(data|import|movements|categories|recurring|occurrences|meta)\b/

function recordApiRequests(page: Page): string[] {
  const seen: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/api/')) seen.push(`${request.method()} ${url.pathname}`)
  })
  return seen
}

async function addPerson(page: Page, name: string) {
  await page.getByRole('button', { name: 'Personas' }).click()
  const dialog = page.getByRole('dialog', { name: 'Personas de casa' })
  await dialog.getByLabel('Nombre de la persona nueva').fill(name)
  await dialog.getByRole('button', { name: 'Añadir persona' }).click()
  await expect(dialog.getByLabel(`Nombre de ${name}`)).toBeVisible()
  await dialog.getByRole('button', { name: 'Cerrar', exact: true }).last().click()
  await expect(dialog).toBeHidden()
}

async function addProduct(
  page: Page,
  product: { name: string; owner?: string; unit: string; quantity: string; target: string; frequency: RegExp; price?: string },
) {
  await page.getByRole('button', { name: 'Nuevo producto' }).click()
  const dialog = page.getByRole('dialog', { name: 'Nuevo producto' })
  await dialog.getByLabel('Nombre').fill(product.name)
  if (product.owner) await dialog.getByLabel('De quién es').selectOption({ label: product.owner })
  await dialog.getByLabel('Unidad').selectOption({ label: product.unit })
  await dialog.getByLabel('Hay ahora').fill(product.quantity)
  await dialog.getByLabel('Quiero tener').fill(product.target)
  const frequency = dialog.getByLabel('Cada cuánto se compra')
  const option = await frequency.locator('option').filter({ hasText: product.frequency }).first().getAttribute('value')
  await frequency.selectOption(option ?? '')
  if (product.price) await dialog.getByLabel(/Precio estimado/).fill(product.price)
  await dialog.getByRole('button', { name: 'Guardar producto' }).click()
  await expect(dialog).toBeHidden()
}

const item = (page: Page, name: string) => page.locator('.pantry-item', { has: page.getByRole('button', { name: `Editar ${name}` }) })

test('el invitado solo ve la despensa y no pide datos financieros ni migra el navegador', async ({ page }) => {
  const requests = recordApiRequests(page)
  await page.goto('/')
  // Datos de una versión anterior guardados en este navegador: como invitado no se tocan.
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('cuentas-claras', 1)
        open.onupgradeneeded = () => {
          for (const store of ['categories', 'movements', 'recurring', 'meta']) open.result.createObjectStore(store, { keyPath: store === 'meta' ? 'key' : 'id' })
        }
        open.onsuccess = () => {
          open.result.close()
          resolve()
        }
        open.onerror = () => reject(open.error)
      }),
  )
  await page.reload()

  await expect(page.getByRole('heading', { name: 'Despensa', level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Tengo el código' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Resumen' })).toHaveCount(0)
  await expect(page.getByRole('navigation')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'La despensa está vacía' })).toBeVisible()

  // Un enlace directo a una sección financiera también lleva a la despensa.
  await page.goto('/#resumen')
  await expect(page.getByRole('heading', { name: 'Despensa', level: 1 })).toBeVisible()
  await expect(page).toHaveURL(/#despensa$/)
  await page.goto('/#ajustes')
  await expect(page.getByRole('heading', { name: 'Despensa', level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Ajustes' })).toHaveCount(0)

  expect(requests.filter((r) => FINANCE_REQUEST.test(r))).toEqual([])
  expect(requests).toContain('GET /api/auth/me')
  expect(await page.evaluate(() => localStorage.getItem('cuentas-claras:datos-del-navegador'))).toBeNull()
  // Y aunque se intente a mano, el servidor no da los datos.
  expect((await page.request.get('/api/data')).status()).toBe(401)
})

test('crea una persona y un producto que falta, y lo envía en la lista de WhatsApp', async ({ page }) => {
  await page.goto('/')
  await addPerson(page, 'Eloy')
  await addProduct(page, { name: 'Proteína', owner: 'Eloy', unit: 'bolsa', quantity: '0', target: '1', frequency: /Mensual/, price: '12' })
  await addProduct(page, { name: 'Leche', unit: 'l', quantity: '2', target: '6', frequency: /Semanal/, price: '0,95' })

  await expect(item(page, 'Proteína')).toContainText('Falta 1 bolsa')
  await expect(item(page, 'Proteína')).toContainText('Eloy')
  await expect(page.getByText('Faltan 2 productos en toda la casa.')).toBeVisible()
  await expect(page.getByText('Compra pendiente estimada: 15,80 €.')).toBeVisible()

  // Solo lo de Eloy.
  await page.getByRole('radio', { name: 'Eloy' }).check()
  await expect(item(page, 'Leche')).toHaveCount(0)
  await expect(page.getByText('Falta 1 producto de Eloy.')).toBeVisible()

  await page.getByRole('radio', { name: 'Todo' }).check()
  await page.getByRole('button', { name: 'Lista de la compra' }).click()
  const dialog = page.getByRole('dialog', { name: 'Lista de la compra' })
  await expect(dialog.getByLabel('Texto de la lista')).toHaveValue(/\*Compartido\*\n• Leche — 4 l\n\n\*Eloy\*\n• Proteína — 1 bolsa\n\nTotal estimado: 15,80 €$/)

  const href = await dialog.getByRole('link', { name: 'Enviar por WhatsApp' }).getAttribute('href')
  expect(href).toMatch(/^https:\/\/wa\.me\/\?text=/)
  const sent = decodeURIComponent((href ?? '').slice('https://wa.me/?text='.length))
  expect(sent).toContain('• Proteína — 1 bolsa')
  expect(sent).toContain('*Eloy*')

  // Filtros: solo lo semanal.
  await dialog.getByRole('checkbox', { name: 'Cada mes' }).uncheck()
  await expect(dialog.getByLabel('Texto de la lista')).not.toHaveValue(/Proteína/)
  await dialog.getByRole('checkbox', { name: 'Cada semana' }).uncheck()
  await dialog.getByRole('checkbox', { name: 'De vez en cuando' }).uncheck()
  await expect(dialog.getByText(/No falta nada con estos filtros/)).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Marcar todo como comprado' })).toBeDisabled()
  await expect(dialog.getByRole('button', { name: 'Enviar por WhatsApp' })).toBeDisabled()
})

test('los botones + y −, marcar como comprado y deshacer', async ({ page, request }) => {
  await request.post('/api/despensa/productos', {
    data: { name: 'Arroz', ownerId: null, unit: 'kg', quantity: 1, target: 2, frequency: 'mensual', priceCents: 120, notes: '' },
  })
  await page.goto('/')
  const rice = item(page, 'Arroz')
  await expect(rice).toContainText('Falta 1 kg')

  await rice.getByRole('button', { name: 'Añadir 0,5 kg a Arroz' }).click()
  await expect(rice.locator('.stepper__value')).toHaveText('1,5 kg')
  await rice.getByRole('button', { name: 'Quitar 0,5 kg de Arroz' }).click()
  await rice.getByRole('button', { name: 'Quitar 0,5 kg de Arroz' }).click()
  await expect(rice.locator('.stepper__value')).toHaveText('0,5 kg')
  await rice.getByRole('button', { name: 'Quitar 0,5 kg de Arroz' }).click()
  await expect(rice.locator('.stepper__value')).toHaveText('0 kg')
  await expect(rice.getByRole('button', { name: 'Quitar 0,5 kg de Arroz' })).toBeDisabled()

  await page.getByRole('button', { name: 'Lista de la compra' }).click()
  const dialog = page.getByRole('dialog', { name: 'Lista de la compra' })
  await expect(dialog.getByLabel('Texto de la lista')).toHaveValue(/• Arroz — 2 kg\n\nTotal estimado: 2,40 €$/)
  await dialog.getByRole('button', { name: 'Marcar todo como comprado' }).click()
  await expect(dialog).toBeHidden()
  await expect(rice.locator('.stepper__value')).toHaveText('2 kg')
  await expect(rice).toContainText('Completo')

  await page.getByRole('button', { name: 'Deshacer' }).click()
  await expect(page.getByText(/Compra deshecha/)).toBeVisible()
  await expect(rice.locator('.stepper__value')).toHaveText('0 kg')
  // Deshecho de verdad en el servidor, no solo en pantalla.
  await page.reload()
  await expect(item(page, 'Arroz').locator('.stepper__value')).toHaveText('0 kg')
})

test('sin portapapeles, «Copiar» selecciona el texto para copiarlo a mano', async ({ page, request }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
  })
  await request.post('/api/despensa/productos', {
    data: { name: 'Pan', ownerId: null, unit: 'ud', quantity: 0, target: 2, frequency: 'semanal', priceCents: null, notes: '' },
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Lista de la compra' }).click()
  const dialog = page.getByRole('dialog', { name: 'Lista de la compra' })
  await dialog.getByRole('button', { name: 'Copiar' }).click()
  await expect(dialog.getByText(/no deja copiar automáticamente/)).toBeVisible()
  await expect(dialog.getByText('Lista copiada. Pégala donde quieras.')).toHaveCount(0)
  const text = dialog.getByLabel('Texto de la lista')
  await expect(text).toBeFocused()
  const selection = await text.evaluate((area: HTMLTextAreaElement) => [area.selectionStart, area.selectionEnd, area.value.length])
  expect(selection).toEqual([0, selection[2], selection[2]])
  // Sin precio no hay total.
  await expect(text).not.toHaveValue(/Total/)
})

test('si el portapapeles rechaza la copia, tampoco dice que se ha copiado', async ({ page, request }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(new DOMException('Denegado', 'NotAllowedError')) },
      configurable: true,
    })
  })
  await request.post('/api/despensa/productos', {
    data: { name: 'Pan', ownerId: null, unit: 'ud', quantity: 0, target: 2, frequency: 'semanal', priceCents: 100, notes: '' },
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Lista de la compra' }).click()
  const dialog = page.getByRole('dialog', { name: 'Lista de la compra' })
  await dialog.getByRole('button', { name: 'Copiar' }).click()
  await expect(dialog.getByText(/no deja copiar automáticamente/)).toBeVisible()
  await expect(dialog.getByLabel('Texto de la lista')).toBeFocused()
})

test('con el código se ve todo; al cerrar la sesión se vuelve a la despensa', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Tengo el código' }).click()
  const dialog = page.getByRole('dialog', { name: 'Código de acceso' })
  const code = dialog.getByLabel('Código')
  await expect(code).toBeFocused()
  await expect(code).toHaveAttribute('type', 'password')
  await expect(code).toHaveAttribute('autocomplete', 'off')

  await code.fill('no-es-este')
  await dialog.getByRole('button', { name: 'Entrar' }).click()
  await expect(dialog.getByRole('alert')).toHaveText('El código no es correcto.')
  await expect(dialog).toBeVisible()

  await code.fill(E2E_CODE)
  await dialog.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByRole('heading', { name: 'Empieza apuntando tu primer gasto' })).toBeVisible()
  await expect(page).toHaveURL(/#resumen$/)
  await expect(page.getByRole('link', { name: 'Despensa' })).toBeVisible()
  // La sesión sobrevive a recargar.
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Empieza apuntando tu primer gasto' })).toBeVisible()
  // El código no se guarda en el navegador.
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + document.cookie)
  expect(stored).not.toContain(E2E_CODE)

  await page.getByRole('link', { name: 'Despensa' }).click()
  await expect(page.getByRole('heading', { name: 'Despensa', level: 1 })).toBeVisible()

  await page.getByRole('link', { name: 'Ajustes' }).click()
  await page.getByRole('button', { name: 'Cerrar sesión' }).click()
  await expect(page.getByRole('button', { name: 'Tengo el código' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Despensa', level: 1 })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Resumen' })).toHaveCount(0)
  expect((await page.request.get('/api/data')).status()).toBe(401)
})

test('si la sesión deja de valer mientras se usa la app, vuelve a la despensa', async ({ page }) => {
  await page.request.post('/api/auth/login', { data: { codigo: E2E_CODE } })
  await page.goto('/#movimientos')
  await expect(page.getByRole('heading', { name: 'Movimientos', level: 1 })).toBeVisible()
  // La sesión se cierra en el servidor (por ejemplo, desde otra pestaña) sin que esta lo sepa.
  await page.request.post('/api/auth/logout')

  await page.getByRole('button', { name: 'Añadir movimiento' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Nuevo movimiento' })
  await dialog.getByLabel('Importe').fill('5')
  await dialog.getByLabel('Concepto').fill('Pan')
  await dialog.getByLabel('Categoría').selectOption({ label: 'Alimentación › Supermercado' })
  await dialog.getByRole('button', { name: 'Guardar gasto' }).click()

  await expect(page.getByText(/La sesión ha terminado/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Despensa', level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Tengo el código' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Movimientos' })).toHaveCount(0)
})
