import { createHash } from 'node:crypto'
import type { Hasher } from '../../application/ports.ts'

/** SHA-256 de node:crypto: los textos en UTF-8 y las imágenes byte a byte, en orden. */
export class Sha256Hasher implements Hasher {
  sha256Hex(parts: readonly (string | Uint8Array)[]): string {
    const hash = createHash('sha256')
    for (const part of parts) hash.update(part)
    return hash.digest('hex')
  }
}
