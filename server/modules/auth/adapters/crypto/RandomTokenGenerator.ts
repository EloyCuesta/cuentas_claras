import { randomBytes } from 'node:crypto'
import type { TokenGenerator } from '../../application/ports.ts'

/** Tokens de sesión: 32 bytes aleatorios en hexadecimal (64 caracteres). */
export class RandomTokenGenerator implements TokenGenerator {
  newToken(): string {
    return randomBytes(32).toString('hex')
  }
}
