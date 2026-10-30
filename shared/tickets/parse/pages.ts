import { nameKey, similarity } from '../text.ts'
import type { OcrLine } from '../types.ts'
import { readTail } from './amounts.ts'
import { cleanText, tokensOf } from './clean.ts'

/** Varias capturas de un mismo ticket y texto pegado. */

/**
 * Une las líneas de varias capturas. Si una captura empieza repitiendo las
 * últimas líneas de la anterior (al hacer capturas de un ticket largo), esas
 * líneas repetidas se quitan. Se exigen al menos dos líneas seguidas iguales
 * para no borrar productos repetidos de verdad.
 */
export function mergePages(pages: readonly (readonly OcrLine[])[]): OcrLine[] {
  const merged: OcrLine[] = []
  const same = (a: OcrLine, b: OcrLine) => {
    const x = readTail(tokensOf(cleanText(a.text)))
    const y = readTail(tokensOf(cleanText(b.text)))
    return nameKey(a.text) !== '' && similarity(a.text, b.text) >= 0.95 &&
      x.amount?.cents === y.amount?.cents && x.quantity === y.quantity && x.unitCents === y.unitCents && x.tax === y.tax
  }
  for (const page of pages) {
    // Internal strips refer to the same source coordinate system. Match by
    // geometry, never by name alone: repeated products have distinct boxes.
    if (page[0]?.source && merged.some(l => l.source?.imageIndex === page[0].source!.imageIndex)) {
      for (const line of page) {
        const source = line.source
        const duplicate = source && merged.findIndex(l => l.source?.imageIndex === source.imageIndex &&
          Math.abs((l.source.box.y0 + l.source.box.y1) / 2 - (source.box.y0 + source.box.y1) / 2) <
          Math.max(4, (source.box.y1 - source.box.y0) / 2))
        if (typeof duplicate === 'number' && duplicate >= 0) {
          if ((line.confidence ?? 0) > (merged[duplicate].confidence ?? 0)) merged[duplicate] = line
        } else merged.push(line)
      }
      continue
    }
    let overlap = 0
    for (let k = Math.min(merged.length, page.length, 40); k >= 2; k--) {
      let all = true
      for (let j = 0; j < k && all; j++) all = same(merged[merged.length - k + j], page[j])
      if (all && new Set(page.slice(0, k).map(l => nameKey(l.text))).size >= 2) {
        overlap = k
        break
      }
    }
    merged.push(...page.slice(overlap))
  }
  return merged
}

/** Texto pegado (por ejemplo, de un ticket por email) como si fuera una captura. */
export function linesFromText(text: string): OcrLine[] {
  return text.split(/\r?\n/).map((line) => ({ text: line, reread: null }))
}
