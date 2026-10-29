import type { OwnerFilter } from '#shared/pantry/pantry.ts'
import type { PantryPerson } from '#shared/pantry/types.ts'

/** El filtro de dueño como texto para los controles: «compartido», «todo» o «p:<id>». */
export function encodeOwner(owner: OwnerFilter): string {
  return typeof owner === 'string' ? owner : `p:${owner.personId}`
}

export function parseOwner(value: string): OwnerFilter {
  if (value.startsWith('p:')) return { personId: value.slice(2) }
  return value === 'compartido' ? 'compartido' : 'todo'
}

export function ownerOptions(people: readonly PantryPerson[]): { value: string; label: string }[] {
  return [
    { value: 'compartido', label: 'Compartido' },
    ...people.map((person) => ({ value: `p:${person.id}`, label: person.name })),
    { value: 'todo', label: 'Todo' },
  ]
}

/** Nombre del filtro para los textos: «Compartido», «Eloy», «toda la casa». */
export function ownerName(owner: OwnerFilter, people: readonly PantryPerson[]): string {
  if (owner === 'compartido') return 'Compartido'
  if (owner === 'todo') return 'toda la casa'
  return people.find((p) => p.id === owner.personId)?.name ?? 'esta persona'
}
