/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Las peticiones a /api van al servidor de Express (server/index.ts). Las pruebas
// en navegador lo cambian con CUENTAS_API_URL para usar un servidor de pruebas.
// xfwd: el proxy añade la IP real de cada dispositivo (X-Forwarded-For), y así el
// límite de intentos del código de acceso no trata a todos los móviles como uno.
const apiProxy = {
  '/api': { target: process.env.CUENTAS_API_URL ?? 'http://127.0.0.1:3001', xfwd: true },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Rutas relativas: el resultado de "npm run build" funciona en cualquier carpeta del servidor.
  base: './',
  server: { proxy: apiProxy },
  preview: { proxy: apiProxy },
  test: {
    include: ['src/**/*.test.ts', 'server/**/*.test.ts', 'shared/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
    // IndexedDB en memoria para probar el almacenamiento del navegador sin navegador.
    setupFiles: ['./src/test/setup.ts'],
  },
})
