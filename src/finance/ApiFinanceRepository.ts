import type { ISODate } from '../../shared/core/types.ts'
import type { FinanceRepository, MetaKey, SaveRecurringOptions } from '../../shared/finance/FinanceRepository.ts'
import type { Category, FinanceData, Movement, RecurringRule } from '../../shared/finance/types.ts'
import { apiRequest, segment } from '../api/apiClient.ts'

/**
 * FinanceRepository que guarda en la base de datos SQLite del servidor a través
 * de la API REST. Es el mismo contrato que usaba la app con IndexedDB: la
 * interfaz no cambia. Cada método es una petición, y el servidor la ejecuta
 * entera en una transacción.
 */
export class ApiFinanceRepository implements FinanceRepository {
  loadAll(): Promise<FinanceData> {
    return apiRequest('GET', '/data')
  }

  async saveMovement(movement: Movement): Promise<void> {
    await apiRequest('PUT', `/movements/${segment(movement.id)}`, movement)
  }

  async deleteMovement(id: string): Promise<void> {
    await apiRequest('DELETE', `/movements/${segment(id)}`)
  }

  async saveCategory(category: Category): Promise<void> {
    await apiRequest('PUT', `/categories/${segment(category.id)}`, category)
  }

  async deleteCategory(id: string, replacementId: string | null): Promise<void> {
    const query = replacementId ? `?replacementId=${segment(replacementId)}` : ''
    await apiRequest('DELETE', `/categories/${segment(id)}${query}`)
  }

  async saveRecurring(rule: RecurringRule, options: SaveRecurringOptions): Promise<number> {
    const { created } = await apiRequest<{ created: number }>('PUT', `/recurring/${segment(rule.id)}`, {
      rule,
      horizon: options.horizon,
      markPaidBefore: options.markPaidBefore ?? null,
    })
    return created
  }

  async deleteRecurring(id: string): Promise<void> {
    await apiRequest('DELETE', `/recurring/${segment(id)}`)
  }

  async generateOccurrences(horizon: ISODate): Promise<number> {
    const { created } = await apiRequest<{ created: number }>('POST', '/occurrences/generate', { horizon })
    return created
  }

  async replaceAll(data: FinanceData): Promise<void> {
    await apiRequest('PUT', '/data', data)
  }

  async getMeta(key: MetaKey): Promise<string | null> {
    const { value } = await apiRequest<{ value: string | null }>('GET', `/meta/${segment(key)}`)
    return value
  }

  async setMeta(key: MetaKey, value: string): Promise<void> {
    await apiRequest('PUT', `/meta/${segment(key)}`, { value })
  }

}
