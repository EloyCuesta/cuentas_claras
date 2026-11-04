import { createSqlite } from '../sqlite/openSqlite.ts'

/**
 * Una copia de cuentas.db inventada, para probar el importador: se crea con
 * las migraciones 001–005 de SQLite, como la creaba la app, y se rellena con
 * datos de ensayo que tocan las doce tablas y sus casos difíciles (ids que
 * solo se distinguen por mayúsculas, tildes o un espacio final, céntimos
 * máximos, milésimas, devoluciones, huellas antiguas, JSON con tildes,
 * vencimientos de un recurrente borrado…). Ningún dato es de nadie.
 */

export const SYNTHETIC = {
  /** Textos inventados que no deben aparecer en la consola ni en el informe. */
  privateTexts: ['Concepto inventado de ensayo', 'Nota inventada con «comillas»', 'Persona Inventada', 'Íñigo de Ensayo', 'Producto inventado'],
  movementIds: ['mov-a', 'MOV-A', 'mov-á', 'mov-a ', 'mov-cuota-1', 'mov-cuota-2', 'mov-huerfano', 'mov-max'],
  itemIds: ['item-compartido', 'item-persona', 'item-contado'],
} as const

const NOW = '2026-11-01T08:00:00.000Z'

/** Crea la copia en `path` y la cierra (sin -wal pendiente, como la app al pararse). */
export function createSyntheticCopy(path: string): void {
  const { db } = createSqlite(path)
  try {
    const run = (sql: string, ...params: unknown[]) => db.prepare(sql).run(...params)
    db.transaction(() => {
      // Categorías: las iniciales (sembradas por la 001) menos una, y dos propias con tildes y decimales en el orden.
      run("DELETE FROM categories WHERE id = 'g-ocio'")
      run("INSERT INTO categories VALUES ('cat-propia', 'Ñoño propio', 'gasto', NULL, 2.5, 12345)")
      run("INSERT INTO categories VALUES ('cat-propia-sub', 'Sub de ensayo', 'gasto', 'cat-propia', 0.125, NULL)")

      // Recurrentes: uno con cuotas y fin, otro con fechas excluidas.
      run(
        `INSERT INTO recurring_rules VALUES ('rule-cuotas', 'Préstamo inventado', 15000, 'gasto', 'cat-propia', 'mensual', '2026-09-15', '2027-08-15', 12,
          'Nota inventada con «comillas» y emoji 🧾', '2026-09-01T10:00:00.000Z', 'creado-a-mano')`,
      )
      run(
        `INSERT INTO recurring_rules VALUES ('rule-alquiler', 'Alquiler inventado', 65000, 'gasto', 'g-vivienda-alquiler', 'mensual', '2026-01-01', NULL, NULL,
          '', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
      )
      run("INSERT INTO recurring_excluded_dates VALUES ('rule-alquiler', '2026-08-01'), ('rule-alquiler', '2026-12-01')")

      // Movimientos: ids con mayúsculas, tildes y espacio final; vencimientos (también de un recurrente ya borrado); el importe máximo.
      const movement = db.prepare(
        `INSERT INTO movements (id, concept, amount_cents, type, category_id, status, paid_date, due_date, notes, recurring_id, occurrence_date,
           installment_number, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      movement.run('mov-a', 'Concepto inventado de ensayo', 4520, 'gasto', 'g-alimentacion-supermercado', 'realizado', '2026-10-12', null, '', null, null, null, NOW, NOW)
      movement.run('MOV-A', 'Nómina inventada', 185000, 'ingreso', 'i-nomina', 'realizado', '2026-10-28', null, 'x'.repeat(5000), null, null, null, NOW, NOW)
      movement.run('mov-á', 'Pendiente inventado', 7235, 'gasto', 'cat-propia-sub', 'pendiente', null, '2026-11-30', '', null, null, null, NOW, NOW)
      movement.run('mov-a ', 'Con espacio final', 1, 'gasto', 'cat-propia', 'realizado', '2026-10-01', null, '', null, null, null, 'importado', 'importado')
      movement.run('mov-cuota-1', 'Préstamo inventado', 15000, 'gasto', 'cat-propia', 'realizado', '2026-09-15', '2026-09-15', '', 'rule-cuotas', '2026-09-15', 1, NOW, NOW)
      movement.run('mov-cuota-2', 'Préstamo inventado', 15000, 'gasto', 'cat-propia', 'pendiente', null, '2026-10-15', '', 'rule-cuotas', '2026-10-15', 2, NOW, NOW)
      movement.run('mov-huerfano', 'De un recurrente borrado', 3000, 'gasto', 'g-vivienda', 'realizado', '2026-07-01', '2026-07-01', '', 'rule-borrado', '2026-07-01', null, NOW, NOW)
      movement.run('mov-max', 'Importe máximo', 99_999_999_999, 'ingreso', 'i-nomina', 'realizado', '2026-10-31', null, '', null, null, null, NOW, NOW)

      run("INSERT INTO meta (key, value) VALUES ('lastBackupAt', '2026-10-30T20:00:00.000Z'), ('browserImportAt', '2026-10-01T09:00:00.000Z')")

      // Despensa.
      run("INSERT INTO pantry_people VALUES ('persona-1', 'Persona Inventada', ?), ('persona-2', 'Íñigo de Ensayo', ?)", NOW, NOW)
      const item = db.prepare(
        `INSERT INTO pantry_items (id, name, owner_id, unit, quantity, target, frequency, price_cents, notes, version, created_at, updated_at, tracking)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      item.run('item-compartido', 'Producto inventado', null, 'kg', 1.234, 999999.999, 'semanal', 10_000_000, 'notas', 7, NOW, NOW, 'compras')
      item.run('item-persona', 'Leche de ensayo', 'persona-1', 'l', 0.5, 6, 'mensual', null, '', 1, NOW, NOW, 'cantidad')
      // Una cantidad que un REAL guarda con ruido: siguen siendo 300 milésimas.
      item.run('item-contado', 'Arroz de ensayo', 'persona-2', 'g', 0.1 + 0.2, 0, 'ocasional', 0, '', 3, NOW, NOW, 'cantidad')
      run("INSERT INTO pantry_settings (id, monthly_budget_cents, last_review_date) VALUES (1, 25000, '2026-10-26')")

      // Tickets: una huella antigua en claro, una devolución, uno sin total; con ajustes, avisos y evidencia.
      const ticket = db.prepare(
        `INSERT INTO pantry_tickets (id, store, store_name, address, purchase_date, purchase_time, total_cents, fingerprint, created_at, adjustments_json,
           issues_json, import_id, source_fingerprint) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      ticket.run('ticket-antiguo', 'lidl', 'Lidl', 'Calle Inventada 1', '2026-10-24', '19:24', 1234, 'lidl|2026-10-24|19:24|1234', NOW, '[]', '[]', null, null)
      ticket.run(
        'ticket-nuevo', 'otra', 'Tienda Inventada', '', '2026-10-25', null, -250, 'a'.repeat(64), NOW,
        JSON.stringify([{ id: 'a1', label: 'Cupón inventado', kind: 'coupon', amountCents: -10, needsReview: false }]),
        JSON.stringify(['Línea dudosa: «PAN»']), 'importacion-inventada', 'b'.repeat(64),
      )
      ticket.run('ticket-sin-total', 'otra', 'Otra Inventada', '', '2026-10-26', '08:05', null, 'c'.repeat(64), NOW, '[]', '[]', null, null)
      const line = db.prepare(
        `INSERT INTO pantry_ticket_lines (id, ticket_id, position, raw_name, name_key, quantity, unit_price_cents, amount_cents, discount_cents, weight_kg,
           price_per_kg_cents, tax_code, item_id, occasional, review_status, confirmed, evidence_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      line.run('linea-1', 'ticket-antiguo', 0, 'Leche entera', 'LECHE ENTERA', 2, 95, 190, 0, null, null, 'A', 'item-persona', 0, 'verified', 0, null)
      line.run('linea-2', 'ticket-antiguo', 1, 'Plátano', 'PLATANO', 1, null, 367, 20, 0.544, 675, 'B', 'item-compartido', 1, 'verified', 1, null)
      line.run(
        'linea-3', 'ticket-nuevo', 0, 'PAN', 'PAN', 1, 100, -250, 0, null, null, 'C', null, 0, 'pending', 0,
        JSON.stringify({ text: 'PAN -2,50 C', confidence: 0.71, words: [{ text: 'ñandú', confidence: 0.5 }] }),
      )
      run("INSERT INTO pantry_aliases VALUES ('lidl', 'LECHE ENTERA', 'item-persona', 0, ?), ('otra:TIENDA INVENTADA', 'BOLSA', NULL, 1, ?)", NOW, NOW)

      const event = db.prepare('INSERT INTO pantry_events VALUES (?, ?, ?, ?, ?)')
      event.run('evento-1', 'item-compartido', 'queda', '2026-10-20', NOW)
      event.run('evento-2', 'item-compartido', 'poco', '2026-10-21', NOW)
      event.run('evento-3', 'item-persona', 'se_acabo', '2026-10-22', NOW)
      event.run('evento-4', 'item-persona', 'comprado', '2026-10-23', NOW)
    })()
  } finally {
    db.close()
  }
}
