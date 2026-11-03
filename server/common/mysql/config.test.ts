import { describe, expect, it } from 'vitest'
import { DEFAULT_DATABASE, describeDatabase, isTestDatabaseName, readDatabaseConfig } from './config.ts'
import { DatabaseSetupError, duplicateKeyName, explainDatabaseError, isConstraintViolation, isDeadlock } from './errors.ts'

/** Configuración de MySQL y explicación de sus errores, sin conectar (los de verdad, en MysqlDatabase.test.ts). */

const CONFIG = { host: '127.0.0.1', port: 3306, user: 'cuentas', password: 'secreto-de-ensayo', database: 'cuentas_claras' }

describe('configuración de MySQL', () => {
  it('por defecto usa 127.0.0.1:3306 y la base cuentas_claras; solo exige el usuario', () => {
    expect(DEFAULT_DATABASE).toBe('cuentas_claras')
    expect(readDatabaseConfig({ CUENTAS_DB_USER: 'cuentas' })).toEqual({
      ok: true,
      config: { host: '127.0.0.1', port: 3306, user: 'cuentas', password: '', database: 'cuentas_claras' },
    })
    const missing = readDatabaseConfig({})
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.message).toMatch(/Falta CUENTAS_DB_USER/)
  })

  it('lee las cinco variables y conserva la contraseña tal cual', () => {
    expect(
      readDatabaseConfig({
        CUENTAS_DB_HOST: ' 192.168.1.20 ',
        CUENTAS_DB_PORT: '3307',
        CUENTAS_DB_USER: 'eloy',
        CUENTAS_DB_PASSWORD: ' con espacios ',
        CUENTAS_DB_NAME: 'cuentas_claras_e2e',
      }),
    ).toEqual({ ok: true, config: { host: '192.168.1.20', port: 3307, user: 'eloy', password: ' con espacios ', database: 'cuentas_claras_e2e' } })
  })

  it.each([
    ['un puerto que no es un número', { CUENTAS_DB_PORT: 'tres' }, /CUENTAS_DB_PORT/],
    ['un puerto fuera de rango', { CUENTAS_DB_PORT: '70000' }, /CUENTAS_DB_PORT/],
    ['un nombre de base con guiones', { CUENTAS_DB_NAME: 'cuentas-claras' }, /CUENTAS_DB_NAME/],
    ['un nombre de base con tildes', { CUENTAS_DB_NAME: 'cuentás' }, /CUENTAS_DB_NAME/],
  ])('rechaza %s con un mensaje en español', (_label, env, message) => {
    const result = readDatabaseConfig({ CUENTAS_DB_USER: 'cuentas', ...env })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toMatch(message)
  })

  it('en modo pruebas solo valen la base de las e2e o una cuentas_test_*', () => {
    expect(isTestDatabaseName('cuentas_claras_e2e')).toBe(true)
    expect(isTestDatabaseName('cuentas_test_0a1b2c')).toBe(true)
    for (const name of ['cuentas_claras', 'cuentas_test_', 'cuentas_TEST_x', 'otra', 'cuentas_claras_e2e_bis']) {
      expect(isTestDatabaseName(name), name).toBe(false)
    }
  })

  it('describe la conexión sin la contraseña', () => {
    expect(describeDatabase(CONFIG)).toBe('cuentas@127.0.0.1:3306/cuentas_claras')
    expect(describeDatabase(CONFIG)).not.toContain(CONFIG.password)
  })
})

describe('errores de MySQL', () => {
  const mysqlError = (errno: number, sqlMessage = '', code?: string) => Object.assign(new Error(sqlMessage), { errno, sqlMessage, code })

  it('las restricciones (como SQLITE_CONSTRAINT) son 1062, 1451, 1452, 3819 y 1048', () => {
    for (const errno of [1062, 1451, 1452, 3819, 1048]) expect(isConstraintViolation(mysqlError(errno)), String(errno)).toBe(true)
    for (const errno of [1213, 1205, 1406, 1292]) expect(isConstraintViolation(mysqlError(errno)), String(errno)).toBe(false)
    expect(isConstraintViolation(new Error('otro'))).toBe(false)
    expect(isDeadlock(mysqlError(1213))).toBe(true)
    expect(isDeadlock(mysqlError(1205))).toBe(false)
  })

  it('saca el índice de una clave repetida', () => {
    expect(duplicateKeyName(mysqlError(1062, "Duplicate entry 'r1-2026-11-01' for key 'movements.movements_occurrence'"))).toBe('movements_occurrence')
    expect(duplicateKeyName(mysqlError(1062, "Duplicate entry 'a' for key 'movements.PRIMARY'"))).toBe('PRIMARY')
    expect(duplicateKeyName(mysqlError(1062, "Duplicate entry 'a' for key 'PRIMARY'"))).toBe('PRIMARY')
    expect(duplicateKeyName(mysqlError(3819, 'x'))).toBeNull()
  })

  it('explica en español qué revisar y nunca muestra la contraseña', () => {
    const cases: [unknown, RegExp][] = [
      [Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }), /MySQL no responde en 127\.0\.0\.1:3306 \(ECONNREFUSED\)/],
      [mysqlError(1045, `Access denied for user 'cuentas'@'localhost' (using password: YES)`, 'ER_ACCESS_DENIED_ERROR'), /ha rechazado el usuario «cuentas»/],
      [mysqlError(1049, "Unknown database 'cuentas_claras'", 'ER_BAD_DB_ERROR'), /La base de datos «cuentas_claras» no existe/],
      [mysqlError(1044, 'Access denied', 'ER_DBACCESS_DENIED_ERROR'), /no tiene permiso sobre la base de datos «cuentas_claras»/],
      [new DatabaseSetupError('Mensaje ya preparado.'), /^Mensaje ya preparado\.$/],
      [new Error('algo raro'), /No se puede usar la base de datos MySQL cuentas@127\.0\.0\.1:3306\/cuentas_claras: algo raro/],
    ]
    for (const [error, message] of cases) {
      const text = explainDatabaseError(error, CONFIG)
      expect(text).toMatch(message)
      expect(text).not.toContain(CONFIG.password)
    }
  })
})
