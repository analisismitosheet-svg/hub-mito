# Hub Mito — Contexto del proyecto

Documento para retomar el trabajo en otra PC. El código está en GitHub (`main`).

## Repo y entorno
- Repo: `https://github.com/analisismitosheet-svg/hub-mito.git`
- Stack: React 18 + TypeScript + Vite + Tailwind + Supabase + Vercel (PWA).
- Deploy: `https://hub-mito.vercel.app`
- Ruta local (Windows): `D:\pwa mito` (tiene espacio → siempre usar `"D:\pwa mito\..."`).
- Clonar: `git clone https://github.com/analisismitosheet-svg/hub-mito.git` → `npm install` → copiar `.env.example` a `.env` con credenciales de Supabase (url + anon key).

## Comandos útiles
- Typecheck: `node node_modules/typescript/bin/tsc --noEmit` (NO usar `npx tsc` → crashea el shell).
- Build local: `node node_modules/vite/bin/vite.js build`
- Instalar deps: `npm.cmd install ...` (PowerShell bloquea `npm.ps1`).
- Deploy: `npx vercel --prod --scope mito-srl --yes` (o `& "C:\Program Files\nodejs\npx.cmd" ...`).
- Git: usar `git -C "D:\pwa mito" ...`. Mensajes de commit **sin tildes** (encodig ParserError con caracteres especiales).
- Scripts node one-shot con ESM: `node --input-type=module -e "..."` + `createRequire` para resolver `@supabase/supabase-js` desde el repo.
- Service role key (si hace falta tocar BD desde script): preguntar al dueño; no está en el repo.

## Convenciones
- Supabase limita a 1000 filas por request → paginar con `.range()` o `traerTodo`.
- No commitear archivos ajenos (pueden aparecer en el working tree: `plantilla cumpleaños.jpeg`, `Libro1.csv`).
- Las tablas nuevas necesitan SQL + políticas RLS (ver pendientes).
- `usePermisosArea('<area>')` para permisos de acción por área.

## Módulos principales
- **Mayorista** (area mayorista): FacturacionFabrica (`FacturacionFabrica.tsx`), Guias, NotasCredito, Clientes, Transportes, Estadisticas.
- **RR.HH.** (area rrhh): Empleados (con sub-menú por estado de legajo: nomina activa / planes activos / bajas mito / bajas planes, columnas por hoja en `config/columnasEmpleados.ts`), Cumpleaños (calendario + editor de imagen con plantilla), CargaNovedades, ResumenNovedades (multifiltro por columna + multisort).
- **Compras**: Transferencias + Estadísticas Transferencias (dashboard recharts, filtros fecha/local).
- **Depósito**: RMA (menú con sub-pantallas Proveedores y Guía).
- **Sistemas**: DatosSql.

## Puente SQL y el tótem F12 (scan-stock)
- `puente-sql/server.js` ahora acepta filtro: `POST {vista, top, donde, valor}` → `SELECT TOP(n) * FROM vista WHERE [donde] = @valor`. `donde` contra la lista blanca `PUENTE_FILTRO_COLS` (default `ARTCOD`) y el valor siempre parametrizado.
- Lo usa el tótem F12 (`D:\F12 Totems\scan-stock`) para traer solo el artículo escaneado de `ZooLogic.vw_STOCK_TODAS_LAS_SUCURSALES`: SQL local para su sucursal + este puente para las demás. Se configura en la rueda del tótem → *Tipo de conexión: Puente SQL del Hub MITO* (URL `http://IP:3128/` + `PUENTE_TOKEN`).

## Pendientes SQL (ejecutar en Supabase SQL Editor)
```sql
-- Novedades: tabla de tipos (si no existe)
-- (pendiente de definición de seed por el usuario)

-- Proveedores Pacho (RMA)
CREATE TABLE IF NOT EXISTS public.proveedores_pacho (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo_flexus text, codigo_dragon text, razon_social text, cuit text,
  direccion text, telefono text, mail text, provincia text, localidad text,
  tipo_proveedor text, created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.proveedores_pacho_guia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha text, n_dragon text, n_flexus text, planilla_excel text, mail text,
  numero_gestion text, despacho text, nc text, created_at timestamptz DEFAULT now()
);
ALTER TABLE public.proveedores_pacho ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proveedores_pacho_guia ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pacho_auth_all" ON public.proveedores_pacho FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "pacho_guia_auth_all" ON public.proveedores_pacho_guia FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Empleados: columna estado_legajo
ALTER TABLE public.empleados ADD COLUMN IF NOT EXISTS estado_legajo text;
-- RLS edición empleados (si hace falta):
CREATE POLICY "empleados_auth_edicion" ON public.empleados FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Índices Transferencias (evita timeouts)
CREATE INDEX IF NOT EXISTS transfer_lotes_created_at_idx ON public.transfer_lotes (created_at DESC);
CREATE INDEX IF NOT EXISTS transfer_items_lote_id_idx ON public.transfer_items (lote_id);
CREATE INDEX IF NOT EXISTS transfer_items_created_at_idx ON public.transfer_items (created_at DESC);
```

## Archivos clave
- `src/config/areas.ts` — áreas + apps del menú (agregar app = AppDef aquí).
- `src/App.tsx` — rutas.
- `src/config/columnasEmpleados.ts` — columnas por categoría de empleado.
- `src/lib/importarListado.ts` — parseo del Excel "Listado - MITO" (4 hojas).
- `src/pages/Empleados.tsx` — ABM empleados + importación + sub-menú por estado.
- `src/pages/CargaNovedades.tsx` / `ResumenNovedades.tsx` — novedades con multifiltro/multisort.
- `src/pages/Transferencias.tsx` — reposiciones (carga por lote; envío de mails).
- `api/enviar-transferencia.ts` — envío de mails vía Microsoft Graph (paginado de ítems).
- `src/pages/EstadisticasTransferencias.tsx` — dashboard.
- `src/pages/Cumpleanios.tsx` + `src/components/EditorCumple.tsx` — cumpleaños + editor de imagen (konva, plantilla por URL en `public/plantilla-cumpleanos.jpeg`).
- `src/pages/Rma.tsx` + `src/pages/ProveedoresPacho.tsx` + `src/pages/GuiaPacho.tsx` — RMA con proveedores/guía.

## Dependencias extra instaladas
`konva@9`, `react-konva@18` (React 18), `webfontloader`, `jspdf`, `@types/webfontloader`. (`xlsx`, `recharts` ya estaban).

## Notas de estado
- Transferencias: se arregló la carga por lote (no corta a 1000). El backend envía mails a los 16 locales (pagina la lectura de ítems). Existe botón "Reenviar (N)" para los que fallaron.
- Empleados: importación del "Listado - MITO" cargada (1726 registros). RLS de edición habilitada.
- El archivo `260922 - W50OFF-XG GPAZ.xlsx` y `PROVEEDORES PACHO.xlsx` están en la raíz (pruebas).