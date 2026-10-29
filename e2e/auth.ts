import { expect, type APIRequestContext } from '@playwright/test'

/**
 * Código de acceso del servidor de pruebas (playwright.config.ts lo pasa en
 * CUENTAS_CODIGO). Es solo para las pruebas: no tiene nada que ver con el .env personal.
 */
export const E2E_CODE = 'codigo-e2e-cuentas'

/**
 * Inicia sesión como lo haría el formulario: POST /api/auth/login. Con
 * page.request la cookie queda en el contexto del navegador; con request, en
 * ese cliente de API. No hay ningún atajo de autenticación para las pruebas.
 */
export async function signIn(request: APIRequestContext): Promise<void> {
  const response = await request.post('/api/auth/login', { data: { codigo: E2E_CODE } })
  expect(response.status()).toBe(200)
}

/** Vacía la base de datos de pruebas (finanzas y despensa). Exige sesión, como el resto de rutas de pruebas. */
export async function resetDatabase(request: APIRequestContext): Promise<void> {
  await signIn(request)
  const reset = await request.post('/api/test/reset')
  expect(reset.ok()).toBe(true)
}
