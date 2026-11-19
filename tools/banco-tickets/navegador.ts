import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'
import { ROOT } from './rutas.ts'
import type { BancoPagina, ImagenBanco, PreparadoBanco } from './tipos.ts'

/**
 * El navegador del banco: un servidor de Vite que sirve pagina/ (y, a través
 * de ella, el código de la web) y un Chrome de Playwright con dos pestañas: la
 * de la página del banco y otra en blanco para dibujar los tickets sintéticos.
 *
 * Chrome: CUENTAS_E2E_CHANNEL (como las e2e); sin ella, el Chromium de
 * Playwright y, si no está descargado, el Chrome instalado.
 */

export interface Navegador {
  /** Pestaña en blanco para dibujar HTML y hacer capturas. */
  dibujo: Page
  preparar(imagenes: ImagenBanco[]): Promise<PreparadoBanco>
  reescalar(imagen: ImagenBanco, ancho: number, alto: number | null, tipo: string, calidad: number): Promise<string>
  cerrar(): Promise<void>
}

async function launch(): Promise<Browser> {
  const channel = process.env.CUENTAS_E2E_CHANNEL
  if (channel) return chromium.launch({ channel })
  try {
    return await chromium.launch()
  } catch {
    return chromium.launch({ channel: 'chrome' })
  }
}

export async function abrirNavegador(): Promise<Navegador> {
  const vite: ViteDevServer = await createServer({
    configFile: false,
    root: fileURLToPath(new URL('./pagina/', import.meta.url)),
    cacheDir: `${ROOT}node_modules/.vite-banco-tickets`,
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 4190, strictPort: false, fs: { allow: [ROOT] } },
  })
  await vite.listen()
  const url = vite.resolvedUrls?.local[0]
  if (!url) throw new Error('Vite no ha dado una dirección para la página del banco')
  const browser = await launch()
  const context = await browser.newContext({ deviceScaleFactor: 1 })
  const pagina = await context.newPage()
  await pagina.goto(url)
  await pagina.waitForFunction('typeof globalThis.banco === "object"')
  const dibujo = await context.newPage()
  return {
    dibujo,
    preparar: (imagenes) => pagina.evaluate((args) => (globalThis as unknown as { banco: BancoPagina }).banco.preparar(args), imagenes),
    reescalar: (imagen, ancho, alto, tipo, calidad) => pagina.evaluate(
      ([i, w, h, t, q]) => (globalThis as unknown as { banco: BancoPagina }).banco.reescalar(i, w, h, t, q),
      [imagen, ancho, alto, tipo, calidad] as const,
    ),
    async cerrar() {
      await browser.close()
      await vite.close()
    },
  }
}
