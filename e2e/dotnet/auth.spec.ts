import { expect, test } from '@playwright/test'
import { DOTNET_E2E_CODE } from './settings.ts'

/** Los componentes existentes envían peticiones reales a .NET mediante Vite, con cookies del mismo origen. */
for (const colorScheme of ['light', 'dark'] as const) {
  test(`acceso, error, recarga y cierre con el tema ${colorScheme === 'light' ? 'claro' : 'oscuro'}`, async ({ page, context }) => {
    await page.emulateMedia({ colorScheme })
    const apiRequests: string[] = []
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname
      if (path.startsWith('/api/')) apiRequests.push(`${request.method()} ${path}`)
    })
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Tengo el código' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toHaveCount(0)

    await page.getByRole('button', { name: 'Tengo el código' }).click()
    const dialog = page.getByRole('dialog', { name: 'Código de acceso' })
    const input = dialog.getByLabel('Código', { exact: true })
    await expect(input).toBeFocused()
    await expect(input).toHaveAttribute('type', 'password')
    await expect(input).toHaveAttribute('autocomplete', 'off')
    await input.fill('codigo-incorrecto-de-ensayo')
    await dialog.getByRole('button', { name: 'Entrar' }).click()
    await expect(dialog.getByRole('alert')).toHaveText('El código no es correcto.')
    await expect(input).toBeFocused()
    expect((await context.cookies()).filter((cookie) => cookie.name === 'cc_sesion')).toEqual([])

    await input.fill(DOTNET_E2E_CODE)
    await dialog.getByRole('button', { name: 'Entrar' }).click()
    await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible()
    await expect(dialog).toBeHidden()
    await expect(page).toHaveURL(/#resumen$/)
    const cookie = (await context.cookies()).find((entry) => entry.name === 'cc_sesion')
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/api', secure: false })
    expect(cookie?.value).toMatch(/^[a-f0-9]{64}$/)
    expect(cookie!.expires - Date.now() / 1000).toBeGreaterThan(43_190)
    expect(cookie!.expires - Date.now() / 1000).toBeLessThanOrEqual(43_200)

    await page.reload()
    await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Tengo el código' })).toHaveCount(0)
    expect((await context.cookies()).find((entry) => entry.name === 'cc_sesion')?.value).toBe(cookie?.value)

    await page.getByRole('button', { name: 'Cerrar sesión' }).click()
    await expect(page.getByRole('button', { name: 'Tengo el código' })).toBeVisible()
    expect((await context.cookies()).filter((entry) => entry.name === 'cc_sesion')).toEqual([])
    await page.reload()
    await expect(page.getByRole('button', { name: 'Tengo el código' })).toBeVisible()
    expect(apiRequests).toContain('POST /api/auth/login')
    expect(apiRequests).toContain('POST /api/auth/logout')
    expect(apiRequests.filter((request) => !/^\w+ \/api\/auth\/(me|login|logout)$/.test(request))).toEqual([])
  })
}
