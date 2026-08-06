# Hub Mito

PWA "central" que unifica el acceso a todas tus aplicaciones desde un solo menú.
Cada módulo es una tarjeta: algunos abren PWAs existentes (Transporte, Control de
Locales) y otros son módulos internos que se irán construyendo (Repo Diaria, Réplicas).

## Stack

Vite + React 18 + TypeScript + Tailwind + vite-plugin-pwa + Supabase.

## Puesta en marcha

1. Instalar dependencias:

   ```bash
   npm install
   ```

2. Copiar `.env.example` a `.env` y completar:

   - `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`: el proyecto Supabase que uses
     para el login del hub (el usuario compartido que ya usás en las otras PWAs).
   - `VITE_URL_TRANSPORTE`: URL de la PWA de transporte ya desplegada.
   - `VITE_URL_CONTROL_LOCALES`: URL de la PWA de control de locales ya desplegada.

   Si dejás una URL vacía, esa tarjeta aparece como "Próximamente".

3. Levantar en desarrollo:

   ```bash
   npm run dev
   ```

4. Build de producción:

   ```bash
   npm run build && npm run preview
   ```

## Cómo agregar un módulo nuevo

Todo el menú se maneja desde `src/config/modules.ts`. Para sumar un módulo:

- **Externo** (abre otra PWA/URL): agregá un objeto con `kind: 'external'` y su
  `target` (o una variable de entorno como las existentes).
- **Interno** (vive dentro de este hub): agregá un objeto con `kind: 'internal'` y
  una ruta (ej. `/mi-modulo`), luego creá la página y su `<Route>` en `src/App.tsx`.

## Estructura

```
src/
  config/modules.ts     -> registro de módulos (el menú se arma desde acá)
  context/AuthContext    -> sesión con Supabase
  components/            -> Layout, ModuleCard, ProtectedRoute
  pages/                 -> Login, Menu, ComingSoon (placeholders)
  lib/supabase.ts        -> cliente Supabase
```

## Notas

- Los módulos Repo Diaria y Réplicas están como placeholders ("Próximamente")
  hasta que definamos sus datos.
- El login es opcional en desarrollo: si no configurás Supabase, podés ver la UI
  igual (las rutas no se bloquean hasta que Supabase esté configurado).
