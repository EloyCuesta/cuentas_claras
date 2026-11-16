import { test as base, type Browser, type BrowserContext } from '@playwright/test'

export { expect, type Locator, type Page } from '@playwright/test'

/** true cuando la suite va contra el host .NET (playwright.dotnet.config.ts lo fija). */
export const againstDotnet = () => process.env.CUENTAS_E2E_BACKEND === 'dotnet'

/**
 * El `test` de las pruebas de la app, el mismo contra Express y contra .NET. Desde TIC-04 el host .NET tiene todas las
 * rutas, así que ya no se responde nada en el navegador: todo va al servidor de verdad.
 */
export const test = base

/** Otro móvil: un contexto nuevo del navegador, en español y con la hora de Madrid, como el de cada prueba. */
export async function newPhone(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({ locale: 'es-ES', timezoneId: 'Europe/Madrid' })
}
