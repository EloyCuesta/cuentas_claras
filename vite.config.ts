/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // «vite --mode dotnet» (npm run dev:dotnet y start:dotnet, CUT-PREP): la web va al host .NET, sin variables de entorno.
  const dotnet = mode === 'dotnet' || process.env.CUENTAS_BACKEND === 'dotnet'
  // Las peticiones a /api van al servidor: Express (server/index.ts, 3001) o .NET (3201). Las pruebas en navegador lo
  // cambian con CUENTAS_API_URL para usar un servidor de pruebas.
  // xfwd: el proxy añade la IP real de cada dispositivo (X-Forwarded-For), y así el
  // límite de intentos del código de acceso no trata a todos los móviles como uno.
  const apiProxy = {
    '/api': { target: process.env.CUENTAS_API_URL ?? (mode === 'dotnet' ? 'http://127.0.0.1:3201' : 'http://127.0.0.1:3001'), xfwd: true },
  }
  return {
    plugins: [react()],
    // El backend al que va la web. Con .NET (--mode dotnet o CUENTAS_BACKEND=dotnet) los resúmenes mensual y anual
    // los calcula el servidor (GET /api/summary/*, FIN-04); si no, la web los calcula como siempre contra Express.
    define: { __CUENTAS_BACKEND__: JSON.stringify(dotnet ? 'dotnet' : 'express') },
    // Rutas relativas: el resultado de "npm run build" funciona en cualquier carpeta del servidor.
    base: './',
    server: { proxy: apiProxy },
    // El análisis de las capturas de un ticket va en un Web Worker de tipo módulo (src/features/tickets/ticketPlan.worker.ts).
    worker: { format: 'es' },
    preview: { proxy: apiProxy },
    test: {
      include: ['src/**/*.test.ts', 'server/**/*.test.ts', 'shared/**/*.test.ts', 'tests/**/*.test.ts', 'tools/**/*.test.ts'],
      environment: 'node',
      // IndexedDB en memoria para probar el almacenamiento del navegador sin navegador.
      setupFiles: ['./src/test/setup.ts'],
      // Las pruebas usan MySQL real con las CUENTAS_DB_* del entorno o, si faltan, de .env
      // (solo esas variables; las bases son cuentas_test_*, nunca CUENTAS_DB_NAME).
      env: loadEnv('test', process.cwd(), 'CUENTAS_DB_'),
      // Crear y borrar una base MySQL por prueba tarda más que un archivo SQLite temporal.
      testTimeout: 20_000,
      hookTimeout: 30_000,
    },
  }
})
