import { createHash, timingSafeEqual } from 'node:crypto'
import type { CodeVerifier } from '../../application/ports.ts'

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest()

/**
 * Compara los hashes SHA-256 (siempre 32 bytes) con timingSafeEqual: el tiempo
 * no depende del código recibido. Solo se guarda el hash del código, no el código.
 */
export class Sha256CodeVerifier implements CodeVerifier {
  private readonly codeHash: Buffer

  constructor(accessCode: string) {
    this.codeHash = sha256(accessCode)
  }

  matches(code: string): boolean {
    return timingSafeEqual(sha256(code), this.codeHash)
  }
}
