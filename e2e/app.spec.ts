import { readFile } from 'node:fs/promises'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { DEFAULT_CATEGORIES } from '../shared/finance/categories.ts'
import type { FinanceData, Movement } from '../shared/finance/types.ts'
import { resetDatabase, signIn } from './auth.ts'

/**
 * Comprobaciones pedidas, hechas como lo haría una persona: con la interfaz y
 * en un navegador real. Los datos van a la base de datos SQLite del servidor de
 * pruebas (ver playwright.config.ts), que se vacía antes de cada prueba.
 *
 * Son pruebas de las funciones financieras: el navegador inicia sesión con el
 * código antes de cada una (las del invitado están en despensa.spec.ts).
 */

test.beforeEach(async ({ request, page }) => {
  await resetDatabase(request)
  await signIn(page.request)
})

/** Importe de una fila de la cuenta del resumen ("Gastos pagados", "Resultado previsto"…). */
function ledgerValue(page: Page, label: string): Locator {
  return page.locator('.ledger__row', { has: page.locator('.ledger__label', { hasText: label }) }).locator('dd')
}

/** Abre el formulario de nuevo movimiento (botón lateral en escritorio, botón flotante en móvil). */
async function openNewMovement(page: Page) {
  await page.getByRole('button', { name: 'Añadir movimiento' }).click()
  await expect(page.getByRole('dialog', { name: 'Nuevo movimiento' })).toBeVisible()
}

async function addExpense(page: Page, { amount, concept, category, pending = false }: { amount: string; concept: string; category: string; pending?: boolean }) {
  await openNewMovement(page)
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Importe').fill(amount)
  await dialog.getByLabel('Concepto').fill(concept)
  await dialog.getByLabel('Categoría').selectOption({ label: category })
  if (pending) await dialog.getByRole('radio', { name: 'Pendiente' }).check()
  await dialog.getByRole('button', { name: 'Guardar gasto' }).click()
  await expect(dialog).toBeHidden()
}

/** Número de movimientos guardados en la base de datos (lo que hay de verdad en el servidor). */
async function storedMovements(page: Page): Promise<number> {
  const response = await page.request.get('/api/data')
  const body = (await response.json()) as { data: FinanceData }
  return body.data.movements.length
}

/** Lo que dejaba guardado en el navegador (IndexedDB) la versión anterior de la app. */
function seedBrowserStorage(page: Page, data: FinanceData): Promise<void> {
  return page.evaluate(
    (data) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('cuentas-claras', 1)
        request.onupgradeneeded = () => {
          const db = request.result
          db.createObjectStore('categories', { keyPath: 'id' })
          const movements = db.createObjectStore('movements', { keyPath: 'id' })
          movements.createIndex('byRecurring', 'recurringId')
          movements.createIndex('byOccurrence', ['recurringId', 'occurrenceDate'], { unique: true })
          db.createObjectStore('recurring', { keyPath: 'id' })
          db.createObjectStore('meta', { keyPath: 'key' })
        }
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction(['categories', 'movements', 'recurring'], 'readwrite')
          for (const category of data.categories) tx.objectStore('categories').put(category)
          for (const movement of data.movements) tx.objectStore('movements').put(movement)
          for (const rule of data.recurring) tx.objectStore('recurring').put(rule)
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
      }),
    data,
  )
}

/** Número de movimientos que siguen guardados en el navegador (IndexedDB). */
function browserStoredMovements(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const request = indexedDB.open('cuentas-claras')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result
          const count = db.transaction('movements').objectStore('movements').count()
          count.onsuccess = () => {
            resolve(count.result)
            db.close()
          }
          count.onerror = () => reject(count.error)
        }
      }),
  )
}

test('empieza vacía y explica cómo añadir el primer movimiento', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Empieza apuntando tu primer gasto' })).toBeVisible()
  await expect(ledgerValue(page, 'Gastos pagados')).toHaveText('0,00 €')
  await page.goto('/#movimientos')
  await expect(page.getByRole('heading', { name: 'Todavía no has apuntado ningún movimiento' })).toBeVisible()
  expect(await storedMovements(page)).toBe(0)
})

test('registra un gasto en pocos pasos y se conserva después de recargar', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Añadir un gasto' }).click()
  const dialog = page.getByRole('dialog', { name: 'Nuevo movimiento' })
  // El importe recibe el foco directamente.
  await expect(dialog.getByLabel('Importe')).toBeFocused()
  await page.keyboard.type('12,50')
  await dialog.getByLabel('Concepto').fill('Panadería')
  await dialog.getByLabel('Categoría').selectOption({ label: 'Alimentación › Supermercado' })
  await dialog.getByRole('button', { name: 'Guardar gasto' }).click()

  await expect(page.getByText('Gasto guardado')).toBeVisible()
  await expect(ledgerValue(page, 'Gastos pagados')).toHaveText('12,50 €')

  await page.reload()
  await expect(ledgerValue(page, 'Gastos pagados')).toHaveText('12,50 €')
  await page.goto('/#movimientos')
  await expect(page.getByRole('button', { name: /Panadería/ })).toBeVisible()
})

test('valida los campos obligatorios', async ({ page }) => {
  await page.goto('/')
  await openNewMovement(page)
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Guardar gasto' }).click()
  await expect(dialog.getByText('Escribe el importe.')).toBeVisible()
  await expect(dialog.getByText(/Escribe un concepto/)).toBeVisible()
  await expect(dialog.getByText('Elige una categoría.')).toBeVisible()
  await expect(dialog.getByLabel('Importe')).toBeFocused()
  await expect(dialog.getByLabel('Importe')).toHaveAttribute('aria-invalid', 'true')
  expect(await storedMovements(page)).toBe(0)
})

test('editar o eliminar un movimiento actualiza los totales', async ({ page }) => {
  await page.goto('/')
  await addExpense(page, { amount: '10', concept: 'Café', category: 'Ocio' })
  await addExpense(page, { amount: '20,40', concept: 'Gasolina', category: 'Coche › Combustible' })
  await expect(ledgerValue(page, 'Gastos pagados')).toHaveText('30,40 €')

  await page.goto('/#movimientos')
  await page.getByRole('button', { name: /Café/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Editar movimiento' })
  await dialog.getByLabel('Importe').fill('15,00')
  await dialog.getByRole('button', { name: 'Guardar cambios' }).click()
  await expect(dialog).toBeHidden()

  await page.getByRole('button', { name: /Gasolina/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Eliminar' }).click()
  await page.getByRole('dialog', { name: 'Eliminar movimiento' }).getByRole('button', { name: 'Eliminar movimiento' }).click()
  await expect(page.getByText('Movimiento eliminado')).toBeVisible()

  await page.goto('/#resumen')
  await expect(ledgerValue(page, 'Gastos pagados')).toHaveText('15,00 €')
  expect(await storedMovements(page)).toBe(1)
})

test('marcar un pago pendiente como pagado no duplica el gasto', async ({ page }) => {
  await page.goto('/')
  // Pendiente con vencimiento hoy (la fecha prevista por defecto).
  await addExpense(page, { amount: '80', concept: 'Recibo del gas', category: 'Vivienda › Gas', pending: true })
  await expect(ledgerValue(page, 'Gastos pagados')).toHaveText('0,00 €')
  await expect(ledgerValue(page, 'Pagos pendientes del mes')).toHaveText('80,00 €')
  await expect(ledgerValue(page, 'Resultado previsto')).toHaveText('−80,00 €')

  await page.getByRole('button', { name: /Marcar pagado: Recibo del gas/ }).click()
  await page.getByRole('dialog', { name: 'Confirmar pago' }).getByRole('button', { name: 'Marcar como pagado' }).click()
  await expect(page.getByText('Pago confirmado')).toBeVisible()

  await expect(ledgerValue(page, 'Gastos pagados')).toHaveText('80,00 €')
  await expect(ledgerValue(page, 'Pagos pendientes del mes')).toHaveText('0,00 €')
  await expect(ledgerValue(page, 'Resultado previsto')).toHaveText('−80,00 €')
  expect(await storedMovements(page)).toBe(1)
})

test('abrir varias veces la aplicación no duplica vencimientos', async ({ page, context }) => {
  await page.goto('/#recurrentes')
  await page.getByRole('button', { name: 'Nuevo recurrente' }).click()
  const dialog = page.getByRole('dialog', { name: 'Nuevo recurrente' })
  await dialog.getByLabel('Concepto').fill('Alquiler')
  await dialog.getByLabel('Importe de cada vencimiento').fill('650')
  await dialog.getByLabel('Categoría').selectOption({ label: 'Vivienda › Alquiler o hipoteca' })
  await dialog.getByRole('button', { name: 'Guardar recurrente' }).click()
  await expect(page.getByText(/Recurrente guardado/)).toBeVisible()

  const created = await storedMovements(page)
  expect(created).toBeGreaterThan(0)

  // Recargar varias veces y abrir otras dos pestañas a la vez.
  for (let i = 0; i < 3; i++) {
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Recurrentes', level: 1 })).toBeVisible()
  }
  const [tab1, tab2] = await Promise.all([context.newPage(), context.newPage()])
  await Promise.all([tab1.goto('/'), tab2.goto('/')])
  await Promise.all([tab1, tab2].map((tab) => expect(tab.locator('.ledger')).toBeVisible()))

  expect(await storedMovements(page)).toBe(created)
  // Todos siguen pendientes hasta que se confirme su pago.
  await page.goto('/#movimientos')
  await expect(page.locator('.move--pending')).toHaveCount(created)
})

test('exportar y restaurar una copia conserva los datos', async ({ page, browser }) => {
  await page.goto('/')
  await addExpense(page, { amount: '54,30', concept: 'Mercadona; compra «semanal»', category: 'Alimentación › Supermercado' })
  await addExpense(page, { amount: '386,40', concept: 'Seguro del coche', category: 'Seguros › Coche', pending: true })

  await page.goto('/#ajustes')
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Descargar copia (JSON)' }).click(),
  ])
  expect(download.suggestedFilename()).toMatch(/^cuentas-claras-copia-\d{4}-\d{2}-\d{2}\.json$/)
  const original = JSON.parse(await readFile(await download.path(), 'utf8'))
  expect(original.data.movements).toHaveLength(2)

  // Instalación nueva (base de datos vacía) y otro navegador: restaurar la copia pide
  // confirmación y deja los mismos datos.
  expect((await page.request.post('/api/test/reset')).ok()).toBe(true)
  const otherContext = await browser.newContext({ locale: 'es-ES', timezoneId: 'Europe/Madrid' })
  await signIn(otherContext.request)
  const other = await otherContext.newPage()
  await other.goto('/#ajustes')
  await other.locator('[data-testid=restore-input]').setInputFiles(await download.path())
  const confirm = other.getByRole('dialog', { name: 'Restaurar copia' })
  await expect(confirm).toContainText('Contiene 2 movimientos')
  await confirm.getByRole('button', { name: 'Sustituir mis datos' }).click()
  await expect(other.getByText('Copia restaurada')).toBeVisible()

  const [secondDownload] = await Promise.all([
    other.waitForEvent('download'),
    other.getByRole('button', { name: 'Descargar copia (JSON)' }).click(),
  ])
  const restored = JSON.parse(await readFile(await secondDownload.path(), 'utf8'))
  expect(restored.data).toEqual(original.data)
  await otherContext.close()
})

test('rechaza una copia no válida sin tocar los datos', async ({ page }) => {
  await page.goto('/')
  await addExpense(page, { amount: '5', concept: 'Pan', category: 'Alimentación › Supermercado' })
  await page.goto('/#ajustes')
  await page.locator('[data-testid=restore-input]').setInputFiles({
    name: 'copia.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ app: 'cuentas-claras', version: 1, data: { categories: [], movements: [{ id: 'x' }], recurring: [] } })),
  })
  await expect(page.getByRole('alert')).toContainText('No se ha restaurado nada')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await storedMovements(page)).toBe(1)
})

test('exporta los movimientos a CSV con formato español', async ({ page }) => {
  await page.goto('/')
  await addExpense(page, { amount: '1.234,56', concept: 'Ordenador', category: 'Otros' })
  await page.goto('/#ajustes')
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Exportar movimientos (CSV)' }).click(),
  ])
  const csv = await readFile(await download.path(), 'utf8')
  const lines = csv.replace(/^﻿/, '').trimEnd().split('\r\n')
  expect(lines[0]).toBe('Fecha;Tipo;Concepto;Categoría;Subcategoría;Importe (€);Estado;Fecha de pago o cobro;Fecha prevista;Recurrente;Notas')
  expect(lines[1]).toMatch(/^\d{2}\/\d{2}\/\d{4};Gasto;Ordenador;Otros;;-1234,56;Pagado;\d{2}\/\d{2}\/\d{4};;No;$/)
})

test('la plantilla anual cuadra con la mensual y se descarga como hoja de cálculo', async ({ page }) => {
  // Los datos de ejemplo son de octubre de 2026: se fija el reloj para que la previsión no dependa del día.
  await page.clock.setFixedTime(new Date('2026-10-28T12:00:00+01:00'))
  await page.goto('/#ajustes')
  await page.locator('[data-testid=restore-input]').setInputFiles('ejemplo/copia-de-ejemplo.json')
  await page.getByRole('dialog', { name: 'Restaurar copia' }).getByRole('button', { name: 'Sustituir mis datos' }).click()
  await expect(page.getByText('Copia restaurada')).toBeVisible()

  await page.goto('/#resumen')
  await expect(page.getByRole('heading', { name: 'Octubre de 2026', level: 1 })).toBeVisible()
  await expect(ledgerValue(page, 'Resultado previsto')).toHaveText('+95,56 €')
  await expect(page.getByRole('table', { name: /por categoría en octubre de 2026/ })).toBeVisible()
  const stored = await storedMovements(page)

  await page.getByRole('link', { name: 'Año', exact: true }).click()
  await expect(page.getByRole('heading', { name: '2026', level: 1 })).toBeVisible()
  // Noviembre ya está creado; diciembre se proyecta desde los recurrentes sin guardarse.
  await expect(page.locator('.ledger__count', { hasText: /proyectados?$/ }).first()).toBeVisible()
  await expect(ledgerValue(page, 'Resultado previsto')).toHaveText('+725,67 €')
  const result = page.locator('.grid-table tfoot tr').locator('td')
  await expect(result.nth(9)).toHaveText('+95,56') // octubre, igual que en la vista mensual
  await expect(result.last()).toHaveText('+725,67')

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Descargar hoja de cálculo' }).click(),
  ])
  expect(download.suggestedFilename()).toBe('cuentas-claras-ano-2026.csv')
  const lines = (await readFile(await download.path(), 'utf8')).replace(/^﻿/, '').trimEnd().split('\r\n')
  expect(lines[0]).toBe('Tipo;Categoría;Ene;Feb;Mar;Abr;May;Jun;Jul;Ago;Sep;Oct;Nov;Dic;Total')
  expect(lines.find((line) => line.startsWith(';Resultado;'))).toMatch(/;95,56;.*;725,67$/)
  // Ver la previsión del año no guarda los vencimientos proyectados.
  expect(await storedMovements(page)).toBe(stored)
})

test('pasa a la base de datos los datos que había en el navegador y conserva la copia', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-28T12:00:00+01:00'))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Empieza apuntando tu primer gasto' })).toBeVisible()

  // Lo que dejaba guardado en el navegador la versión anterior de la app.
  const bread: Movement = {
    id: 'del-navegador',
    concept: 'Panadería',
    amountCents: 1250,
    type: 'gasto',
    categoryId: 'g-alimentacion-supermercado',
    status: 'realizado',
    paidDate: '2026-10-27',
    dueDate: null,
    notes: '',
    recurringId: null,
    occurrenceDate: null,
    installmentNumber: null,
    createdAt: '2026-10-27T09:00:00.000Z',
    updatedAt: '2026-10-27T09:00:00.000Z',
  }
  await seedBrowserStorage(page, { categories: [...DEFAULT_CATEGORIES], movements: [bread], recurring: [] })
  await page.reload()

  await expect(page.getByText('Se han pasado a la base de datos 1 movimiento y 0 recurrentes que había en este navegador.')).toBeVisible()
  await expect(ledgerValue(page, 'Gastos pagados')).toHaveText('12,50 €')
  expect(await storedMovements(page)).toBe(1)
  // La copia del navegador no se borra.
  expect(await browserStoredMovements(page)).toBe(1)

  // Al volver a abrir no se importa otra vez ni se duplica nada.
  await page.reload()
  await expect(ledgerValue(page, 'Gastos pagados')).toHaveText('12,50 €')
  expect(await storedMovements(page)).toBe(1)
})
