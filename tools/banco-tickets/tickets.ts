/**
 * Los tickets sintéticos del banco de medida: datos inventados con el formato
 * del ticket de Lidl Plus (ver plantilla.ts). Cada uno reúne lo que más cuesta
 * leer: multiplicaciones («3,95x   2»), pesos («0,544 kg x 6,75   EUR/kg»),
 * «Desc.» (también detrás de un peso), la PROMO LIDL PLUS bajo su producto,
 * productos repetidos y nombres con cifras («SERVILLETAS 100U», «GEL DUCHA 750ML»).
 *
 * Nada de aquí sale de un ticket real: nombres, importes, tiendas y números son
 * inventados. Las cuentas (importes, total y desglose de IVA) las hace verdad.ts.
 */

export type TaxCode = 'A' | 'B' | 'C'

export interface SyntheticLine {
  name: string
  tax: TaxCode
  /** Importe de la línea; con `quantity`, el precio de una unidad. Sin él, lo da el peso. */
  cents?: number
  quantity?: number
  weightKg?: number
  pricePerKgCents?: number
  /** «Desc.» sangrado debajo del producto (o de su peso), en positivo. */
  discountCents?: number
  /** «PROMO LIDL PLUS» en azul, sangrada debajo del producto, en positivo. */
  promoCents?: number
}

export interface SyntheticTicket {
  id: string
  note: string
  /** AAAA-MM-DD y HH:MM:SS (la línea HORA del bloque de pago). */
  date: string
  time: string
  /** El pie: tienda, operación y la hora de la caja, que no es la del pago («4123 118402/02 03.11.26 18:45»). */
  footer: { store: string; operation: string; time: string }
  /** Dirección de la tienda, con el código postal pegado al pueblo («39300Torrelavega»). */
  address: [string, string]
  /** «Compra realizada en». */
  shop: string
  card: string
  points: number
  offers: string[]
  lines: SyntheticLine[]
}

const unit = (name: string, cents: number, tax: TaxCode, extra: Partial<SyntheticLine> = {}): SyntheticLine => ({ name, cents, tax, ...extra })
const times = (name: string, unitCents: number, quantity: number, tax: TaxCode, extra: Partial<SyntheticLine> = {}): SyntheticLine =>
  ({ name, cents: unitCents, quantity, tax, ...extra })
const kilos = (name: string, weightKg: number, pricePerKgCents: number, tax: TaxCode, extra: Partial<SyntheticLine> = {}): SyntheticLine =>
  ({ name, weightKg, pricePerKgCents, tax, ...extra })

const GRANDE: SyntheticTicket = {
  id: 'grande',
  note: '60 productos: 10 multiplicaciones, 8 pesos (4 FILETE PECHUGA POLLO con pesos distintos), «Desc.» detrás de un peso y de un producto, PROMO bajo su producto y un producto repetido.',
  date: '2026-11-03',
  time: '18:47:12',
  footer: { store: '4123', operation: '118402/02', time: '18:45' },
  address: ['Avda. del Ensayo s/n', '39300Torrelavega'],
  shop: 'Torrelavega-Ensayo',
  card: '4321',
  points: 52,
  offers: ['TURRÓN DE CHOCOLATE      1,99 B', '-20% en yogures griegos'],
  lines: [
    unit('PAPEL COCINA 3 ROLL', 245, 'C'),
    unit('DETERGENTE GEL 40D', 699, 'C'),
    times('LECHE SEMIDESNATADA', 92, 6, 'A'),
    unit('PAN DE MOLDE 0%', 159, 'A'),
    unit('HUEVOS CAMPEROS L', 299, 'A'),
    times('YOGUR GRIEGO NATURAL', 55, 4, 'A'),
    unit('QUESO RALLADO 4QUES.', 189, 'B'),
    unit('SERVILLETAS 100U', 109, 'C'),
    unit('MANTEQUILLA 250G', 265, 'B'),
    kilos('FILETE PECHUGA POLLO', 0.612, 699, 'B'),
    kilos('FILETE PECHUGA POLLO', 0.587, 699, 'B'),
    kilos('FILETE PECHUGA POLLO', 0.633, 699, 'B', { discountCents: 43 }),
    kilos('FILETE PECHUGA POLLO', 0.598, 699, 'B'),
    unit('LONGANIZA FRESCA', 289, 'B'),
    times('HAMBURGUESA VACUNO', 349, 2, 'B'),
    unit('JAMÓN COCIDO EXTRA', 239, 'B', { discountCents: 48 }),
    unit('CHORIZO SARTA', 199, 'B'),
    times('PIZZA 4 QUESOS', 239, 2, 'B'),
    unit('LASAÑA VERDURAS', 319, 'B'),
    unit('CROQUETAS JAMÓN', 229, 'B'),
    times('NUGGETS POLLO', 289, 3, 'B'),
    unit('PATATAS PREFRITAS', 175, 'B'),
    unit('GUISANTES CONGELADOS', 135, 'A'),
    kilos('MANZANA FUJI', 1.204, 229, 'A'),
    kilos('NARANJA ZUMO', 2.315, 119, 'A'),
    unit('PERA CONFERENCIA', 215, 'A'),
    unit('TOMATE RAMA', 189, 'A'),
    unit('CEBOLLA MALLA 1KG', 119, 'A'),
    unit('ZANAHORIA BOLSA', 79, 'A'),
    unit('LECHUGA ICEBERG', 89, 'A'),
    times('AGUA MINERAL 1,5L', 35, 6, 'B'),
    unit('REFRESCO COLA 2L', 149, 'C'),
    unit('CERVEZA LATA PACK 6', 399, 'C'),
    unit('ACEITE OLIVA V.E. 1L', 899, 'A'),
    unit('ARROZ REDONDO 1KG', 129, 'A'),
    unit('ESPAGUETI Nº5', 95, 'A'),
    times('TOMATE FRITO', 69, 3, 'A'),
    unit('ATÚN CLARO PACK 3', 349, 'B'),
    unit('GARBANZO COCIDO', 85, 'A'),
    times('LENTEJAS COCIDAS', 79, 2, 'A'),
    unit('GALLETAS MARÍA', 109, 'B'),
    unit('CEREALES CHOCOLATE', 225, 'B'),
    unit('CAFÉ MOLIDO MEZCLA', 349, 'B', { promoCents: 35 }),
    unit('CACAO SOLUBLE', 279, 'B'),
    unit('MERMELADA FRESA', 149, 'B'),
    unit('BOLLERÍA SURTIDA', 199, 'B'),
    unit('BOLLERÍA SURTIDA', 199, 'B'),
    unit('CHOCOLATE LECHE', 99, 'B'),
    times('PATATAS FRITAS LISAS', 105, 2, 'B'),
    unit('FRUTOS SECOS MIX', 299, 'B'),
    times('GEL DUCHA 750ML', 115, 4, 'C'),
    unit('CHAMPÚ ANTICASPA', 249, 'C'),
    unit('PASTA DIENTES', 159, 'C'),
    unit('LEJÍA 2L', 99, 'C'),
    unit('BOLSAS BASURA 30L', 179, 'C'),
    unit('PAÑALES T4', 999, 'C'),
    unit('PIENSO GATO 1,5KG', 549, 'B'),
    kilos('PIMIENTO ROJO', 0.455, 279, 'A'),
    kilos('CALABACÍN', 0.389, 189, 'A', { discountCents: 12 }),
    unit('BOLSA REUTILIZABLE', 15, 'C'),
  ],
}

const MEDIANO: SyntheticTicket = {
  id: 'mediano',
  note: '41 productos: 7 multiplicaciones, 4 pesos (uno con «Desc.»), PROMO bajo su producto y un producto repetido. Es el de las E2E.',
  date: '2026-11-12',
  time: '13:05:44',
  footer: { store: '4088', operation: '230177/03', time: '13:03' },
  address: ['C/ Prueba Ficticia 14', '39001Santander'],
  shop: 'Santander-Ficticia',
  card: '8765',
  points: 31,
  offers: ['ROSCÓN DE NATA          5,99 B', '-15% en cafés molidos'],
  lines: [
    times('LECHE ENTERA', 95, 6, 'A'),
    unit('PAN BARRA RÚSTICA', 65, 'A'),
    unit('PAN BARRA RÚSTICA', 65, 'A'),
    unit('HUEVOS M DOCENA', 255, 'A'),
    unit('QUESO TIERNO CUÑA', 399, 'A'),
    unit('YOGUR SABORES 8U', 179, 'A'),
    kilos('PECHUGA PAVO', 0.412, 899, 'B'),
    kilos('LOMO CERDO FILETES', 0.733, 659, 'B', { discountCents: 97 }),
    unit('SALCHICHAS FRANKFURT', 159, 'B'),
    times('PIZZA PROSCIUTTO', 255, 2, 'B'),
    unit('EMPANADILLAS ATÚN', 209, 'B'),
    unit('SOPA DE SOBRE', 75, 'B'),
    times('FIDEOS FINOS', 59, 3, 'A'),
    unit('ARROZ BASMATI 1KG', 219, 'A'),
    unit('ACEITE GIRASOL 1L', 189, 'A'),
    unit('VINAGRE DE VINO', 79, 'B'),
    unit('SAL FINA 1KG', 35, 'B'),
    times('ALUBIAS BLANCAS', 99, 2, 'A'),
    unit('MAÍZ DULCE LATA', 89, 'B'),
    unit('ACEITUNAS RELLENAS', 119, 'B'),
    kilos('UVA BLANCA', 0.856, 329, 'A'),
    kilos('KIWI', 0.504, 349, 'A'),
    unit('FRESÓN TARRINA', 299, 'A', { promoCents: 30 }),
    unit('ESPINACAS BOLSA', 149, 'A'),
    unit('AGUACATE MALLA', 279, 'A'),
    times('ZUMO NARANJA 1L', 119, 2, 'B'),
    unit('LECHE AVENA 1L', 135, 'B'),
    unit('GALLETAS DIGESTIVE', 129, 'B'),
    unit('MAGDALENAS', 149, 'B'),
    times('TORTITAS MAÍZ', 89, 2, 'B'),
    unit('CHOCOLATE NEGRO 72%', 165, 'B'),
    unit('INFUSIÓN MANZANILLA', 99, 'B'),
    unit('DETERGENTE VAJILLAS', 145, 'C'),
    unit('SUAVIZANTE 60D', 299, 'C'),
    unit('PAPEL HIGIÉN. 12R', 449, 'C'),
    times('ESTROPAJO PACK 3', 99, 2, 'C'),
    unit('DESODORANTE SPRAY', 225, 'C'),
    unit('MAQUINILLAS 5U', 349, 'C'),
    unit('PIENSO PERRO 3KG', 699, 'B'),
    unit('VELAS AROMÁTICAS', 199, 'C'),
    unit('BOLSA REUTILIZABLE', 15, 'C'),
  ],
}

const CORTO: SyntheticTicket = {
  id: 'corto',
  note: '15 productos: cabe casi en una captura. 2 multiplicaciones, un peso, un «Desc.», PROMO y un producto repetido.',
  date: '2026-11-17',
  time: '09:41:03',
  footer: { store: '4201', operation: '004519/01', time: '09:40' },
  address: ['Paseo Inventado 3', '39700Castro Urdiales'],
  shop: 'Castro-Inventado',
  card: '1357',
  points: 12,
  offers: ['PANETTONE CLÁSICO       3,49 B'],
  lines: [
    unit('BAGUETTE', 45, 'A'),
    times('CRUASÁN MANTEQUILLA', 69, 4, 'B'),
    unit('LECHE SIN LACTOSA', 115, 'A'),
    unit('ZUMO MELOCOTÓN', 135, 'B'),
    kilos('CLEMENTINA', 1.032, 199, 'A'),
    unit('JAMÓN SERRANO LONCH.', 299, 'B', { discountCents: 60 }),
    unit('QUESO FRESCO BATIDO', 149, 'A'),
    times('YOGUR LÍQUIDO FRESA', 45, 6, 'A'),
    unit('CAFÉ CÁPSULAS 20U', 349, 'B', { promoCents: 20 }),
    unit('AZÚCAR BLANCO 1KG', 109, 'B'),
    unit('HARINA TRIGO 1KG', 79, 'A'),
    unit('LEVADURA PANADERÍA', 89, 'B'),
    unit('LIMPIACRISTALES', 189, 'C'),
    unit('LIMPIACRISTALES', 189, 'C'),
    unit('PILAS AA PACK 4', 399, 'C'),
  ],
}

export const TICKETS: readonly SyntheticTicket[] = [GRANDE, MEDIANO, CORTO]
