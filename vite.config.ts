import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [
    react(),
    VitePWA({
      // 'prompt': la versión nueva queda lista y src/lib/actualizarApp.ts la aplica sola en un
      // momento seguro (al cambiar de pantalla). Con 'autoUpdate' la pantalla seguía vieja hasta recargar.
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Hub Mito',
        short_name: 'Hub Mito',
        description: 'Centro unificado de aplicaciones: transporte, control de locales, repo diaria, réplicas y más.',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // El bundle principal pasó los 2 MB (límite por defecto): sin esto el build falla
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // Avisos push (armado de pedidos): suenan con la app cerrada o el celular bloqueado
        importScripts: ['push-sw.js'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [
          /^\/api\//,
          // Nunca hacer fallback con el HTML de la app para llamadas a Supabase
          // (REST) ni a los endpoints de autenticación.
          /\/rest\/v1\//,
          /\/auth\/v1\//,
          /\/functions\/v1\//,
          /\.(?:js|css|png|jpg|jpeg|gif|svg|ico|woff2?|json)$/,
        ],
      },
    }),
  ],
  server: {
    port: 5175,
    // En dev no existe api/ (eso corre en Vercel): para previsualizar
    // Sistemas > Réplicas hay que levantar `node scripts/mock-replicas.mjs`
    // con el Puente SQL corriendo; Administradores > Tracking, con
    // `npx tsx scripts/dev-tracking.mts`; Administradores > Stock valorizado,
    // con `node scripts/mock-stock-valorizado.mjs`. El resto de /api/* sigue sin existir.
    proxy: {
      '/api/replicas': 'http://localhost:4173',
      '/api/tracking': 'http://localhost:4174',
      '/api/sql/stock-valorizado': 'http://localhost:4175',
    },
  },
})
