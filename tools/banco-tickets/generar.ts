import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { abrirNavegador, type Navegador } from './navegador.ts'
import { APP, APP_VISIBLE, ticketHtml, type TemplateOptions } from './plantilla.ts'
import { FIXTURES_DIR, IMAGES_DIR } from './rutas.ts'
import { TICKETS, type SyntheticTicket } from './tickets.ts'
import { verdadDe } from './verdad.ts'

/**
 * `npm run generar:tickets`: dibuja los tickets sintéticos con Chrome y guarda
 * sus variantes en .banco-tickets/imagenes/<ticket>/<variante>/ (fuera de git):
 *
 * - completa: la imagen entera que da Lidl Plus, de 1080 px de ancho;
 * - completa-400: la misma reducida a 400 px;
 * - capturas-claro y capturas-oscuro: capturas de 1080 × 2400 con la app
 *   alrededor y un 22 % de solape entre una y la siguiente;
 * - whatsapp-claro y whatsapp-oscuro: esas capturas como llegan por WhatsApp
 *   (720 × 1600, JPEG de calidad 0,7).
 *
 * Escribe además la verdad de cada ticket en fixtures/tickets/banco/<ticket>.json
 * y copia allí las imágenes que usan las e2e (las de «mediano»).
 */

/** Solape entre capturas seguidas: un 22 % de lo que se ve del ticket. */
const OVERLAP = 0.22

const png = (bytes: Buffer) => ({ nombre: 'imagen.png', tipo: 'image/png', base64: bytes.toString('base64') })

async function render(navegador: Navegador, ticket: SyntheticTicket, options: TemplateOptions) {
  const page = navegador.dibujo
  await page.setViewportSize({ width: APP.width, height: options.mode === 'app' ? APP.height : 1200 })
  await page.setContent(ticketHtml(ticket, options))
  await page.evaluate('document.fonts.ready.then(() => true)')
}

function save(dir: string, name: string, bytes: Buffer | string) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(`${dir}${name}`, typeof bytes === 'string' ? Buffer.from(bytes, 'base64') : bytes)
}

async function generate(navegador: Navegador, ticket: SyntheticTicket) {
  const dir = `${IMAGES_DIR}${ticket.id}/`
  rmSync(dir, { recursive: true, force: true })
  await render(navegador, ticket, { mode: 'completa', theme: 'claro' })
  const full = await navegador.dibujo.screenshot({ fullPage: true, type: 'png' })
  save(`${dir}completa/`, '01.png', full)
  save(`${dir}completa-400/`, '01.png', await navegador.reescalar(png(full), 400, null, 'image/png', 1))

  for (const theme of ['claro', 'oscuro'] as const) {
    await render(navegador, ticket, { mode: 'app', theme })
    const height = Number(await navegador.dibujo.evaluate('document.documentElement.scrollHeight'))
    const last = Math.max(0, height - APP.height)
    const step = Math.round(APP_VISIBLE * (1 - OVERLAP))
    const offsets: number[] = []
    for (let y = 0; y < last; y += step) offsets.push(y)
    offsets.push(last)
    for (const [i, y] of offsets.entries()) {
      // El reloj de la barra de estado cambia entre capturas, como en el móvil.
      await navegador.dibujo.evaluate(`window.scrollTo(0, ${y}); document.querySelector('.estado__hora').textContent = '${i < 2 ? '18:51' : '18:52'}'`)
      const shot = await navegador.dibujo.screenshot({ type: 'png' })
      const name = String(i + 1).padStart(2, '0')
      save(`${dir}capturas-${theme}/`, `${name}.png`, shot)
      save(`${dir}whatsapp-${theme}/`, `${name}.jpg`, await navegador.reescalar(png(shot), 720, 1600, 'image/jpeg', 0.7))
    }
  }
}

async function main() {
  const navegador = await abrirNavegador()
  try {
    mkdirSync(FIXTURES_DIR, { recursive: true })
    for (const ticket of TICKETS) {
      writeFileSync(`${FIXTURES_DIR}${ticket.id}.json`, `${JSON.stringify(verdadDe(ticket), null, 1)}\n`)
      await generate(navegador, ticket)
      console.log(`${ticket.id}: listo`)
    }
    // Las imágenes de las e2e: la completa y las capturas en claro de «mediano».
    copyFileSync(`${IMAGES_DIR}mediano/completa/01.png`, `${FIXTURES_DIR}mediano-completa.png`)
    for (let i = 1; ; i++) {
      const source = `${IMAGES_DIR}mediano/capturas-claro/${String(i).padStart(2, '0')}.png`
      try {
        copyFileSync(source, `${FIXTURES_DIR}mediano-captura-${i}.png`)
      } catch {
        break
      }
    }
  } finally {
    await navegador.cerrar()
  }
}

await main()
