import type { PantryItem } from '#shared/pantry/types.ts'
import { canApplyLine } from '#shared/tickets/ticketArithmetic.ts'
import { nameKey } from '#shared/tickets/ticketText.ts'
import type { PantryTicket, TicketSaveInput, TicketSaveLine } from '#shared/tickets/types.ts'
import { AppError } from '../../../common/errors.ts'
import type { Clock, IdGenerator, UnitOfWork } from '../../../common/ports.ts'
import { aliasStoreOf } from '../domain/ticketIdentity.ts'
import { lineReviewStatus, newItemUnit, priceFromLines, quantityFromLines } from '../domain/ticketPurchase.ts'
import { findDuplicate, possibleDuplicate, ticketFingerprint } from './duplicates.ts'
import type { Hasher, PantryGateway, TicketRepository } from './ports.ts'
import type { TicketQueries } from './queries.ts'

/**
 * Guardar un ticket revisado, todo o nada (una transacción inmediata):
 *
 * 1. 409 si ya estaba guardado, o si hay otra compra igual y no se ha
 *    confirmado que es distinta (`distinctPurchase`).
 * 2. Cada producto del ticket (las líneas con el mismo nombre normalizado van
 *    juntas) se asocia a uno de la despensa, a uno nuevo (uno por nombre y
 *    persona, aunque venga en varias líneas) o a ninguno, según su decisión.
 * 3. Se recuerda lo aprendido en esa tienda, y los productos que ya existían
 *    reciben el precio y, si se cuentan, lo comprado.
 * 4. Se guardan el ticket y sus líneas, también las dudosas (con lo que leyó
 *    el OCR), que quedan pendientes y no cambian la despensa.
 *
 * Solo las líneas fiables (canApplyLine) crean productos, cambian precios y
 * cantidades o cuentan para lo aprendido.
 */
export class SaveTicket {
  private readonly repository: TicketRepository
  private readonly pantry: PantryGateway
  private readonly queries: TicketQueries
  private readonly hasher: Hasher
  private readonly clock: Clock
  private readonly ids: IdGenerator
  private readonly unitOfWork: UnitOfWork

  constructor(
    repository: TicketRepository,
    pantry: PantryGateway,
    queries: TicketQueries,
    hasher: Hasher,
    clock: Clock,
    ids: IdGenerator,
    unitOfWork: UnitOfWork,
  ) {
    this.repository = repository
    this.pantry = pantry
    this.queries = queries
    this.hasher = hasher
    this.clock = clock
    this.ids = ids
    this.unitOfWork = unitOfWork
  }

  execute(input: TicketSaveInput): { ticket: PantryTicket; items: PantryItem[] } {
    return this.unitOfWork.run(
      () => {
        const duplicate = findDuplicate(this.repository, this.hasher, input)
        if (duplicate) {
          throw new AppError(
            'CONFLICT',
            `Este ticket ya está guardado (${duplicate.storeName}, ${duplicate.date.split('-').reverse().join('/')}).`,
          )
        }
        if (!input.distinctPurchase && possibleDuplicate(this.repository, input)) {
          throw new AppError(
            'CONFLICT',
            'Hay una compra con la misma fecha, hora y total. Confirma si se trata de otra compra.',
          )
        }
        const aliasStore = aliasStoreOf(input.store, input.storeName)
        const now = this.clock.nowISO()
        const linesByKey = new Map<string, TicketSaveLine[]>()
        for (const line of input.lines) {
          const key = nameKey(line.rawName)
          linesByKey.set(key, [...(linesByKey.get(key) ?? []), line])
        }

        // Producto de cada clave: uno que ya existe, uno nuevo (uno por nombre y persona) o ninguno.
        const itemOfKey = new Map<string, string | null>()
        const created = new Map<string, string>()
        for (const [key, lines] of linesByKey) {
          const decision = input.decisions[key]
          if (!decision) throw new AppError('VALIDATION', `Falta qué hacer con «${lines[0].rawName}».`)
          if (decision.kind === 'ignore') {
            itemOfKey.set(key, null)
            continue
          }
          if (decision.kind === 'item') {
            if (!this.pantry.getItem(decision.itemId)) {
              throw new AppError(
                'VALIDATION',
                `«${lines[0].rawName}» está asociado a un producto que ya no existe. Elige otro.`,
              )
            }
            itemOfKey.set(key, decision.itemId)
            continue
          }
          if (!lines.some(canApplyLine)) {
            itemOfKey.set(key, null)
            continue
          }
          const sameNew = `${nameKey(decision.name)}|${decision.ownerId ?? ''}`
          let id = created.get(sameNew)
          if (!id) {
            const allLines = [...linesByKey.entries()]
              .filter(([k]) => {
                const d = input.decisions[k]
                return d?.kind === 'new' && `${nameKey(d.name)}|${d.ownerId ?? ''}` === sameNew
              })
              .flatMap(([, l]) => l)
              .filter(canApplyLine)
            const unit = newItemUnit(allLines)
            id = this.pantry.createItem({
              name: decision.name,
              ownerId: decision.ownerId,
              unit,
              tracking: 'compras',
              quantity: 0,
              target: 0,
              frequency: decision.frequency,
              priceCents: priceFromLines(allLines, unit),
              notes: '',
            }).id
            created.set(sameNew, id)
          }
          itemOfKey.set(key, id)
        }

        // Lo aprendido y lo que cambia en los productos que ya existían.
        for (const [key, itemId] of itemOfKey) {
          if (linesByKey.get(key)?.some(canApplyLine)) this.repository.upsertAlias(aliasStore, key, itemId, now)
        }
        const touched = new Map<string, TicketSaveLine[]>()
        for (const [key, itemId] of itemOfKey) {
          if (itemId === null || [...created.values()].includes(itemId)) continue
          touched.set(itemId, [...(touched.get(itemId) ?? []), ...(linesByKey.get(key) ?? []).filter(canApplyLine)])
        }
        for (const [itemId, lines] of touched) {
          if (!lines.length) continue
          // «Para una ocasión» no cuenta para el ritmo, pero lo comprado sí está en casa.
          const item = this.pantry.getItem(itemId) as PantryItem
          this.pantry.applyTicketPurchase(itemId, {
            priceCents: priceFromLines(lines, item.unit),
            addQuantity: quantityFromLines(lines, item.unit),
          })
        }

        const ticketId = this.ids.newId()
        this.repository.insertTicket({
          id: ticketId,
          store: input.store,
          storeName: input.storeName,
          address: input.address,
          date: input.date,
          time: input.time,
          totalCents: input.totalCents,
          fingerprint: ticketFingerprint(this.hasher, input),
          createdAt: now,
          adjustments: input.adjustments ?? [],
          issues: input.issues ?? [],
          importId: input.importId ?? null,
          sourceFingerprint: input.sourceFingerprint ?? null,
        })
        input.lines.forEach((line, position) => {
          this.repository.insertLine({
            id: this.ids.newId(),
            ticketId,
            position,
            rawName: line.rawName,
            nameKey: nameKey(line.rawName),
            quantity: line.quantity,
            unitPriceCents: line.unitPriceCents,
            amountCents: line.amountCents,
            discountCents: line.discountCents,
            weightKg: line.weightKg,
            pricePerKgCents: line.pricePerKgCents,
            taxCode: line.taxCode,
            itemId: itemOfKey.get(nameKey(line.rawName)) ?? null,
            occasional: line.occasional,
            reviewStatus: lineReviewStatus(line),
            confirmed: line.confirmed === true,
            evidence: line.evidence,
          })
        })
        return { ticket: this.queries.getTicket(ticketId), items: this.pantry.listItems() }
      },
      { immediate: true },
    )
  }
}
