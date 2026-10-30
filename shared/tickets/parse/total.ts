import type { OcrLine } from '../types.ts'
import { type Candidate, readAmountToken } from './amounts.ts'
import { cleanText, tokensOf } from './clean.ts'
import { addCandidate } from './lines.ts'
import { sorted } from './select.ts'

/** Total del ticket. */

export function readTotal(lines: readonly OcrLine[], totalIndex: number | null): number | null {
  const votes: Candidate[] = []
  const lastAmount = (text: string | null) => {
    if (!text) return null
    const tokens = tokensOf(cleanText(text))
    for (let i = tokens.length - 1; i >= 0; i--) {
      const amount = readAmountToken(tokens[i])
      if (amount) return amount.cents
    }
    return null
  }
  if (totalIndex !== null) {
    const fromReread = lastAmount(lines[totalIndex].reread)
    const fromText = lastAmount(lines[totalIndex].text)
    if (fromText !== null) return fromText
    if (fromReread !== null) return fromReread
  }
  for (const line of lines.slice(totalIndex ?? 0)) {
    if (/^\s*(IMPORTE|Lidl\s*Pay|TARJETA|Suma)\b/i.test(line.text)) {
      const value = lastAmount(line.text)
      if (value !== null) addCandidate(votes, value, 1)
    }
  }
  return sorted(votes)[0]?.cents ?? null
}
