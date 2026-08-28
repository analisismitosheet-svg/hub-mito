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
      registerType: 'autoUpdate',
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
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
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
  },
})
