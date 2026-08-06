/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_URL_TRANSPORTE: string
  readonly VITE_URL_CONTROL_LOCALES: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
