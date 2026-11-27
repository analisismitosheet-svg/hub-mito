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
          // Consulta de precios para clientes (QR impreso en las remeras): siempre la versión
          // publicada, nunca la copia guardada en el celular. Con una copia vieja (de antes de que
          // existiera /precios) la app no conocía la ruta y mandaba al login.
          /^\/precios/,
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
      // Compras > Repo diaria y Cascada: `node scripts/mock-repo-diaria.mjs` (+ una copia del Puente en :3199)
      '/api/sql/repo-diaria': 'http://localhost:4176',
      // Mayorista > Stock: `node scripts/mock-stock-mayorista.mjs` (+ Puente en :3128 o una copia en :3199)
      '/api/sql/stock-mayorista': 'http://localhost:4178',
      // Administración > Flexxus: `node scripts/mock-flexxus.mjs` (+ Puente en :3128 o una copia en :3199)
      '/api/sql/flexxus': 'http://localhost:4179',
      // Polo 52 > Mapeo de bultos: `npx tsx scripts/mock-polo-bulto.mts` (+ Puente en :3128 o una copia en :3199)
      '/api/sql/polo-bulto': 'http://localhost:4180',
      // Reposiciones / Transferencias > Reparto manual: `node scripts/mock-reparto.mjs` (+ una copia del Puente en :3199)
      '/api/sql/reparto': 'http://localhost:4177',
      // Compras > Análisis ventas: `node scripts/mock-analisis-ventas.mjs` (+ Puente en :3128 o una copia en :3199)
      '/api/sql/analisis-ventas': 'http://localhost:4181',
      // Administración > Tablero locales: `node scripts/mock-tablero-locales.mjs` (+ Puente en :3128 o una copia en :3199)
      '/api/sql/tablero-locales': 'http://localhost:4182',
    },
  },
})
