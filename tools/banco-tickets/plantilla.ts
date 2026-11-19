import { lineAmount, taxGroupsOf, TAX_RATES } from './verdad.ts'
import type { SyntheticTicket } from './tickets.ts'

/**
 * El ticket sintético como HTML, con el formato del ticket de Lidl Plus: letra
 * monoespaciada a todo el ancho (42 columnas), «Copia» y un recuadro gris donde
 * va el logotipo, la dirección con el código postal pegado al pueblo, las
 * multiplicaciones con x minúscula, los pesos, «Desc.» y la PROMO (en azul)
 * sangrados, el bloque de pago, el desglose de IVA con «Suma», los recuadros de
 * descuentos, el pie de la caja, un código de barras y las secciones de la app.
 *
 * Dos modos: `completa` es la imagen entera que da la app (solo el papel); `app`
 * es la pantalla del móvil, con la barra de estado, la cabecera «Ticket de compra»
 * y la barra de navegación fijas alrededor del papel, para hacer capturas.
 *
 * Funciones puras: solo construyen texto. Lo dibuja generar.ts con Playwright.
 */

export const COLUMNS = 42

/** La pantalla del móvil (1080 × 2400) en el modo `app`. */
export const APP = { width: 1080, height: 2400, statusBar: 84, header: 168, navigation: 150 } as const
/** Alto visible del ticket entre las barras fijas. */
export const APP_VISIBLE = APP.height - APP.statusBar - APP.header - APP.navigation

export type RowKind = 'mono' | 'promo' | 'centro' | 'copia' | 'logo' | 'raya' | 'caja' | 'barras' | 'titulo' | 'texto'
export interface Row { kind: RowKind; text: string }

/** «1234» → «12,34»; negativos con «-». */
export const euros = (cents: number) => `${cents < 0 ? '-' : ''}${Math.floor(Math.abs(cents) / 100)},${String(Math.abs(cents) % 100).padStart(2, '0')}`
const kg = (weight: number) => weight.toFixed(3).replace('.', ',')

/** Una fila de 42 columnas: el texto a la izquierda y el importe acabando en la columna 40 (y la letra del IVA en la 42). */
function priced(left: string, cents: number, tax = ''): string {
  const amount = euros(cents)
  return `${left.padEnd(40 - amount.length)}${amount}${tax ? ` ${tax}` : ''}`.slice(0, COLUMNS)
}

/** Las filas del ticket, de arriba abajo. */
export function ticketRows(ticket: SyntheticTicket): Row[] {
  const rows: Row[] = [
    { kind: 'copia', text: 'Copia' },
    { kind: 'logo', text: '' },
    { kind: 'centro', text: 'LIDL SUPERMERCADOS S.A.U.' },
    { kind: 'centro', text: ticket.address[0] },
    { kind: 'centro', text: ticket.address[1] },
    { kind: 'mono', text: 'EUR'.padStart(COLUMNS) },
  ]
  for (const line of ticket.lines) {
    const name = line.name.padEnd(20).slice(0, 20)
    if (line.quantity !== undefined && line.quantity > 1) {
      const quantity = String(line.quantity)
      const times = `${euros(line.cents!)}x`.padEnd(9 - quantity.length) + quantity
      rows.push({ kind: 'mono', text: priced(`${name} ${times}`, lineAmount(line), line.tax) })
    } else rows.push({ kind: 'mono', text: priced(name, lineAmount(line), line.tax) })
    if (line.weightKg !== undefined) rows.push({ kind: 'mono', text: `  ${kg(line.weightKg)} kg x ${euros(line.pricePerKgCents!)}   EUR/kg` })
    if (line.discountCents) rows.push({ kind: 'mono', text: priced('  Desc.', -line.discountCents) })
    if (line.promoCents) rows.push({ kind: 'promo', text: priced('  PROMO LIDL PLUS', -line.promoCents) })
  }
  const total = ticket.lines.reduce((sum, line) => sum + lineAmount(line) - (line.discountCents ?? 0) - (line.promoCents ?? 0), 0)
  const [day, month, year] = [ticket.date.slice(8, 10), ticket.date.slice(5, 7), ticket.date.slice(2, 4)]
  rows.push(
    { kind: 'raya', text: '-'.repeat(COLUMNS) },
    { kind: 'mono', text: priced('TOTAL', total) },
    { kind: 'mono', text: priced('Lidl Pay', total) },
    { kind: 'raya', text: '-'.repeat(COLUMNS) },
    { kind: 'mono', text: 'COMERCIO: Lidl Pay ES Stores' },
    { kind: 'mono', text: ` NUM. OPERACION: ${ticket.footer.operation.replace('/', '')}${ticket.card}` },
    { kind: 'mono', text: ` METODO DE PAGO: ************${ticket.card}` },
    { kind: 'mono', text: ` FECHA: ${day}/${month}/${year}` },
    { kind: 'mono', text: ` HORA: ${ticket.time}` },
    { kind: 'mono', text: ` CAJA: ${ticket.footer.operation.slice(-2)}` },
    { kind: 'mono', text: ` IMPORTE: ${euros(total)} EUR` },
    { kind: 'raya', text: '-'.repeat(COLUMNS) },
    { kind: 'mono', text: 'IVA%       IVA  +    P N   =      PVP' },
  )
  const groups = taxGroupsOf(ticket.lines)
  for (const group of groups) {
    rows.push({ kind: 'mono', text: `${`${group.code} ${TAX_RATES[group.code]}%`.padEnd(7)}${euros(group.tax).padStart(8)}${euros(group.base).padStart(11)}${euros(group.gross).padStart(11)}` })
  }
  const sum = (key: 'tax' | 'base' | 'gross') => groups.reduce((s, g) => s + g[key], 0)
  rows.push({ kind: 'mono', text: `${'Suma'.padEnd(7)}${euros(sum('tax')).padStart(8)}${euros(sum('base')).padStart(11)}${euros(sum('gross')).padStart(11)}` })
  const discounts = ticket.lines.reduce((s, line) => s + (line.discountCents ?? 0), 0)
  const promos = ticket.lines.reduce((s, line) => s + (line.promoCents ?? 0), 0)
  const boxed = (label: string, cents: number) => `${label.padEnd(28)}${euros(cents).padStart(7)}`
  if (discounts) rows.push({ kind: 'caja', text: boxed('Desc. total en compra', discounts) })
  if (promos) rows.push({ kind: 'caja', text: boxed('Total oferta Lidl Plus', promos) })
  rows.push(
    { kind: 'mono', text: `${ticket.footer.store}   ${ticket.footer.operation}          ${day}.${month}.${year}   ${ticket.footer.time}` },
    { kind: 'barras', text: `${ticket.footer.store}${ticket.footer.operation.replace('/', '')}${day}${month}${year}` },
    { kind: 'titulo', text: 'Ofertas Lidl Plus' },
    ...ticket.offers.map((text) => ({ kind: 'texto' as const, text })),
    { kind: 'titulo', text: 'Puntos obtenidos' },
    { kind: 'texto', text: `+${ticket.points} puntos en esta compra` },
    { kind: 'titulo', text: 'Compra realizada en' },
    { kind: 'texto', text: ticket.shop },
    { kind: 'texto', text: `${ticket.address[0]}, ${ticket.address[1].replace(/^(\d{5})/, '$1 ')}` },
  )
  return rows
}

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Barras de anchos 1-3 sacados de las cifras: siempre el mismo dibujo para el mismo ticket. */
function barcode(digits: string): string {
  const bars: string[] = []
  for (const [i, d] of [...digits.repeat(3)].entries()) {
    const n = Number(d) || 0
    bars.push(`<i style="width:${3 + (n % 3) * 3}px;background:${i % 2 ? 'transparent' : '#111'}"></i>`)
    bars.push(`<i style="width:${3 + ((n + i) % 2) * 3}px;background:transparent"></i>`)
  }
  return `<div class="barras">${bars.join('')}</div>`
}

function rowHtml(row: Row): string {
  switch (row.kind) {
    case 'copia': return `<div class="copia">${escape(row.text)}</div>`
    case 'logo': return '<div class="logo"></div>'
    case 'centro': return `<div class="m centro">${escape(row.text)}</div>`
    case 'raya': case 'mono': return `<div class="m">${escape(row.text)}</div>`
    case 'promo': return `<div class="m promo">${escape(row.text)}</div>`
    case 'caja': return `<div class="m caja">${escape(row.text)}</div>`
    case 'barras': return barcode(row.text)
    case 'titulo': return `<div class="titulo">${escape(row.text)}</div>`
    case 'texto': return `<div class="texto">${escape(row.text)}</div>`
  }
}

export interface TemplateOptions {
  mode: 'completa' | 'app'
  theme: 'claro' | 'oscuro'
}

/**
 * El HTML de la página. La letra se ajusta al cargar para que las 42 columnas
 * ocupen todo el ancho del papel, como en la imagen de la app.
 */
export function ticketHtml(ticket: SyntheticTicket, { mode, theme }: TemplateOptions): string {
  const dark = theme === 'oscuro'
  const appBg = dark ? '#121417' : '#eef0f3'
  const barBg = dark ? '#1d2127' : '#ffffff'
  const barInk = dark ? '#e8eaed' : '#1b1d21'
  const paperMargin = mode === 'app' ? 24 : 0
  const body = ticketRows(ticket).map(rowHtml).join('\n')
  const appChrome = mode === 'app' ? `
<div class="estado"><span class="estado__hora">18:51</span><span>5G  ▮▮▮▮  87 %</span></div>
<div class="cabecera"><span class="cabecera__atras">‹</span><span>Ticket de compra</span><span class="cabecera__compartir">⇪</span></div>
<nav class="navegacion"><span>⌂<br>Inicio</span><span>%<br>Ofertas</span><span>★<br>Lidl Plus</span><span>▤<br>Tickets</span></nav>` : ''
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><style>
* { box-sizing: border-box; margin: 0; padding: 0 }
html, body { background: ${mode === 'app' ? appBg : '#ffffff'}; width: ${APP.width}px }
body { font-family: 'Segoe UI', Arial, sans-serif; color: #111;
  ${mode === 'app' ? `padding: ${APP.statusBar + APP.header + 24}px 0 ${APP.navigation + 24}px` : 'padding: 0'} }
.papel { background: #ffffff; margin: 0 ${paperMargin}px; padding: 56px 46px 40px; ${mode === 'app' ? 'border-radius: 18px; box-shadow: 0 2px 10px rgb(0 0 0 / 0.18)' : ''} }
.m { font-family: Consolas, 'DejaVu Sans Mono', monospace; font-size: var(--mono, 40px); line-height: 1.42; white-space: pre; color: #161616 }
.centro { text-align: center }
.promo { color: #0050aa }
.copia { font-weight: 700; font-size: 44px; text-align: center; margin-bottom: 26px }
.logo { width: 190px; height: 190px; margin: 0 auto 30px; background: #c9ccd1; border-radius: 6px }
.caja { border: 3px solid #161616; border-radius: 8px; padding: 6px 14px; margin: 18px 0; width: fit-content }
.barras { display: flex; height: 120px; margin: 26px auto 10px; width: fit-content }
.barras i { display: block; height: 100% }
.titulo { font-weight: 700; font-size: 46px; margin: 40px 0 12px; color: ${mode === 'app' && dark ? barInk : '#111'} }
.texto { font-size: 38px; line-height: 1.4; color: ${mode === 'app' && dark ? barInk : '#222'} }
.secciones { padding: 0 ${paperMargin + 30}px 30px }
.estado, .cabecera, .navegacion { position: fixed; left: 0; width: ${APP.width}px; background: ${barBg}; color: ${barInk}; display: flex; align-items: center; z-index: 2 }
.estado { top: 0; height: ${APP.statusBar}px; justify-content: space-between; padding: 0 44px; font-size: 34px; font-weight: 600 }
.cabecera { top: ${APP.statusBar}px; height: ${APP.header}px; gap: 34px; padding: 0 40px; font-size: 50px; font-weight: 700;
  border-bottom: 2px solid ${dark ? '#2c313a' : '#dde0e4'} }
.cabecera__atras { font-size: 80px; font-weight: 400 }
.cabecera__compartir { margin-left: auto; font-size: 50px }
.navegacion { bottom: 0; height: ${APP.navigation}px; justify-content: space-around; font-size: 28px; text-align: center; line-height: 1.3;
  border-top: 2px solid ${dark ? '#2c313a' : '#dde0e4'} }
</style></head><body>
${appChrome}
<main class="papel">
${body}
</main>
<script>
  // Que las 42 columnas ocupen todo el ancho del papel.
  const papel = document.querySelector('.papel')
  const prueba = document.createElement('div')
  prueba.className = 'm'
  prueba.style.cssText = 'position:absolute;visibility:hidden;--mono:40px'
  prueba.textContent = '0'.repeat(${COLUMNS})
  document.body.appendChild(prueba)
  const ancho = papel.clientWidth - 92
  document.documentElement.style.setProperty('--mono', (40 * ancho / prueba.getBoundingClientRect().width).toFixed(2) + 'px')
  prueba.remove()
  // Las secciones de la app van después del papel, fuera de él.
  const secciones = document.createElement('section')
  secciones.className = 'secciones'
  for (const nodo of [...papel.querySelectorAll('.titulo, .texto')]) secciones.appendChild(nodo)
  papel.after(secciones)
</script>
</body></html>`
}
