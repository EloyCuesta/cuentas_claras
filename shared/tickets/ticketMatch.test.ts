import { describe, expect, it } from 'vitest'
import { suggestForTicket } from './ticketMatch.ts'
import { nameKey } from './ticketText.ts'

const line = (rawName: string) => ({ rawName, key: nameKey(rawName) })
const items = [
  { id: 'leche', name: 'Leche' },
  { id: 'pechuga', name: 'Filete de pechuga' },
  { id: 'pizza', name: 'Pizza barbacoa' },
]

describe('suggestForTicket', () => {
  it('usa lo recordado, también con pequeños errores del OCR', () => {
    const aliases = [
      { key: 'LECHE SEMIDESNATADA', itemId: 'leche' },
      { key: 'BOLSA PLASTICO', itemId: null },
      { key: 'PIZZA BARBACOA', itemId: 'pizza' },
    ]
    const result = suggestForTicket([line('LECHE SEMIDESNATADA'), line('BOLSA PLÁSTICO'), line('PTZZA BARBACOA')], aliases, items)
    expect(result.get('LECHE SEMIDESNATADA')).toEqual({ kind: 'item', itemId: 'leche', how: 'recordado' })
    expect(result.get('BOLSA PLASTICO')).toEqual({ kind: 'ignore', how: 'recordado' })
    expect(result.get('PTZZA BARBACOA')).toEqual({ kind: 'item', itemId: 'pizza', how: 'parecido' })
  })

  it('propone productos existentes por su nombre y crea los demás con un nombre legible', () => {
    const result = suggestForTicket([line('FILETE DE PECHUGA'), line('PAPEL HIGIÉNICO 12R')], [], items)
    expect(result.get('FILETE DE PECHUGA')).toEqual({ kind: 'item', itemId: 'pechuga', how: 'nombre' })
    expect(result.get('PAPEL HIGIENICO 12R')).toEqual({ kind: 'new', name: 'Papel higiénico 12r', frequency: 'mensual' })
  })

  it('mantiene separadas las variantes nuevas hasta que el usuario las asocie', () => {
    const lines = [line('FILETE DE PAVO'), line('FTLETE DE PAVO'), line('FILETE DE PAVO'), line('NOCILLA')]
    const result = suggestForTicket(lines, [], [])
    expect(result.get('FTLETE DE PAVO')).not.toEqual(result.get('FILETE DE PAVO'))
    expect(result.get('FILETE DE PAVO')).toMatchObject({ kind: 'new', name: 'Filete de pavo' })
    expect(result.get('NOCILLA')).toMatchObject({ kind: 'new', name: 'Nocilla' })
  })

  it('no usa equivalencias de productos que ya no existen', () => {
    const result = suggestForTicket([line('YOGUR GRIEGO')], [{ key: 'YOGUR GRIEGO', itemId: 'borrado' }], items)
    expect(result.get('YOGUR GRIEGO')).toMatchObject({ kind: 'new', name: 'Yogur griego' })
  })
})
