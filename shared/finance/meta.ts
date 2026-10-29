/**
 * Datos auxiliares que no forman parte de la copia de seguridad: la fecha de la
 * última copia descargada y la de la importación de los datos del navegador.
 * Los usan la web (FinanceRepository) y el servidor (GET y PUT /api/meta/:key).
 */
export const META_KEYS = ['lastBackupAt', 'browserImportAt'] as const
export type MetaKey = (typeof META_KEYS)[number]
