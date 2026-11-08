import { test as base } from '@playwright/test'
import { PENDING_DOTNET_ROUTES } from './dotnet/pending.ts'

export { expect, type Locator, type Page } from '@playwright/test'

/** true cuando la suite va contra el host .NET (playwright.dotnet.config.ts lo fija). */
export const againstDotnet = () => process.env.CUENTAS_E2E_BACKEND === 'dotnet'

/**
 * El `test` de las pruebas de la app. Contra Express es el de Playwright tal cual. Contra .NET, además, cada contexto
 * del navegador responde las rutas que .NET aún no tiene (e2e/dotnet/pending.ts) como lo haría el servidor con la base
 * vacía; todo lo demás va al host .NET de verdad.
 */
export const test = base.extend<{ pendingDotnetRoutes: void }>({
  pendingDotnetRoutes: [
    async ({ context }, use) => {
      if (againstDotnet()) {
        for (const pending of PENDING_DOTNET_ROUTES) {
          await context.route(
            (url) => url.pathname === pending.path,
            (route) =>
              route.request().method() === pending.method
                ? route.fulfill({
                    status: 200,
                    contentType: 'application/json; charset=utf-8',
                    headers: { 'cache-control': 'no-store' },
                    body: JSON.stringify({ ok: true, data: pending.data }),
                  })
                : route.fallback(),
          )
        }
      }
      await use()
    },
    { auto: true },
  ],
})
