import type { PantryItem, PantryItemInput, PantryPerson, PantryPurchaseChange, PantrySettings } from '../domain/types.ts'
import { apiRequest, segment } from './apiClient.ts'

/**
 * Cliente de la API de la despensa (/api/despensa). Es pública: funciona igual
 * para invitados y para quien ha escrito el código.
 */
export const pantryApi = {
  listPeople: () => apiRequest<PantryPerson[]>('GET', '/despensa/personas'),
  createPerson: (name: string) => apiRequest<PantryPerson>('POST', '/despensa/personas', { name }),
  renamePerson: (id: string, name: string) => apiRequest<PantryPerson>('PUT', `/despensa/personas/${segment(id)}`, { name }),
  deletePerson: (id: string) => apiRequest<null>('DELETE', `/despensa/personas/${segment(id)}`),

  listItems: () => apiRequest<PantryItem[]>('GET', '/despensa/productos'),
  createItem: (input: PantryItemInput) => apiRequest<PantryItem>('POST', '/despensa/productos', input),
  updateItem: (id: string, input: PantryItemInput) => apiRequest<PantryItem>('PUT', `/despensa/productos/${segment(id)}`, input),
  adjustItem: (id: string, delta: number) => apiRequest<PantryItem>('POST', `/despensa/productos/${segment(id)}/ajustar`, { delta }),
  deleteItem: (id: string) => apiRequest<null>('DELETE', `/despensa/productos/${segment(id)}`),

  getSettings: () => apiRequest<PantrySettings>('GET', '/despensa/presupuesto'),
  setBudget: (monthlyBudgetCents: number | null) => apiRequest<PantrySettings>('PUT', '/despensa/presupuesto', { monthlyBudgetCents }),

  markPurchased: (ids: readonly string[]) =>
    apiRequest<{ changes: PantryPurchaseChange[]; items: PantryItem[] }>('POST', '/despensa/comprado', { ids }),
  undoPurchase: (changes: readonly PantryPurchaseChange[]) => apiRequest<PantryItem[]>('POST', '/despensa/comprado/deshacer', { changes }),
}
