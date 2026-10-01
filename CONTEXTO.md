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
- Typecheck de las funciones de Vercel: `node node_modules/typescript/bin/tsc -p tsconfig.api.json --noEmit`.
- Build local: `node node_modules/vite/bin/vite.js build`
- Tests: `node scripts/test-consulta-articulos.mjs` (o `npm.cmd test`) — assertions de `src/lib/articulosConsulta.ts`, sin navegador.
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
- **Mayorista** (area mayorista): FacturacionFabrica (`FacturacionFabrica.tsx`), Guias, NotasCredito, Clientes, Transportes, Estadisticas, **F12 Consulta artículos** (`/mayorista/consulta-articulos`).
- **RR.HH.** (area rrhh): Empleados (con sub-menú por estado de legajo: nomina activa / planes activos / bajas mito / bajas planes, columnas por hoja en `config/columnasEmpleados.ts`), Cumpleaños (calendario + editor de imagen con plantilla), CargaNovedades, ResumenNovedades (multifiltro por columna + multisort).
- **Compras**: Transferencias + Estadísticas Transferencias (dashboard recharts, filtros fecha/local).
- **Depósito**: RMA (menú con sub-pantallas Proveedores y Guía).
- **Sistemas**: DatosSql, Réplicas (`/replicas`: tarjeta por base réplica con su última actualización).

## Réplicas (Sistemas)
- **La fuente es la PC central del Replicador SQL, `DESKTOP-OA4GU6I`** (es la máquina donde corre el Puente). Ahí está `C:\ReplicadorSQL`: `config.json` (nombre de cada sucursal + servidor origen), `historial.csv` (última corrida: estado y ultimo_error) y `agent_heartbeat.txt`.
- Cadena: `src/pages/Replicas.tsx` → `GET /api/replicas` (`api/replicas.ts`, JWT Supabase) → Puente SQL con `POST {accion:'replicas'}` → `puente-sql/sql/replicas.sql` contra la instancia local (sqlcmd, Windows auth): `MAX(actualizado)` de `dbo._sync_estado` por base copiada.
- Cada tarjeta muestra: local (del config.json), código, última actualización + "hace X", tablas, servidor origen, corrida y el error si la última corrida fue "CON ERRORES". Semáforo: < 15 min ok · < 60 min atraso · más viejo desactualizada (el agente corre un ciclo cada pocos minutos).
- Fechas del SQL: llegan "naive" (hora de la PC central); `src/lib/replicas.ts` las lee campo por campo (`formatearFecha` → `25/09/26 15.27`) y `instanteReal()` re-offsetea para "hace X". `consultado`/`ultimo_latido` sí son instantes reales → `formatearInstante`.
- Variables del Puente opcionales: `REPLICADOR_DIR` (default `C:\ReplicadorSQL`), `REPLICADOR_SQLSERVER` (default `localhost`), `SQLCMD_PATH`.
- Desarrollo local: `api/*` no existe fuera de Vercel → levantar `node scripts/mock-replicas.mjs` (puente en :3128); vite proxea `/api/replicas` a :4173.

## Puente SQL y el tótem F12 (scan-stock)
- `puente-sql/server.js` acepta filtro: `POST {vista, top, donde, valor, coincide}`. `donde` contra la lista blanca `PUENTE_FILTRO_COLS` (default `ARTCOD,ID_ARTICULO,ARTICULO,NOMBRE_COMPLETO,DESCRIPCION`) y el valor siempre parametrizado.
- `coincide` (opcional): `igual` (default, `=`) o `contiene` (`LIKE %valor%` con wildcards escapados). Si se mandan varias columnas en `donde` (separadas por `,`), se combinan con OR entre sí.
- De las columnas pedidas se usan **solo las que la vista tiene**: el puente cachea 10 min las columnas reales del objeto (`INFORMATION_SCHEMA.COLUMNS`, `columnasDe()`) y las descarta. Así el cliente puede mandar la lista completa y no se rompe con vistas que nombran las columnas distinto (`ID_ARTICULO` vs `ARTCOD`).
- Lo usa el tótem F12 (`D:\F12 Totems\scan-stock`) para traer solo el artículo escaneado de `ZooLogic.vw_STOCK_TODAS_LAS_SUCURSALES`: SQL local para su sucursal + este puente para las demás. Se configura en la rueda del tótem → *Tipo de conexión: Puente SQL del Hub MITO* (URL `http://IP:3128/` + `PUENTE_TOKEN`).

## F12 Consulta artículos (Mayorista)
- Pantalla: `src/pages/ConsultaArticulos.tsx` → `src/lib/articulosConsulta.ts` → `src/lib/sqlApi.ts` (`leerVistaFiltrada`) → `GET /api/sql/<vista>?where=&value=&match=` (`api/sql/[view].ts`) → Logic App → Puente → SQL Server `DRAGONFISH_MITO`.
- Muestra `id articulo` (+ color/talle como chips), `nombre completo`, `material`, `grupo`, `stock en mito`, `ubicacion`, `precio`. Granularidad **por SKU (artículo + color + talle)**. Buscador por código o descripción con debounce de 400 ms + botón "Consultar"/Enter (inmediato) y export a Excel.
- La Logic App **ignora** los parámetros del filtro → la vista devuelve el TOP y la pantalla **vuelve a filtrar en el navegador**; si detecta que el SQL no aplicó el filtro muestra el aviso "el SQL no aplicó el filtro: se acotó en el navegador".
- Vista en el SQL Server: `ZooLogic.vw_ARTICULOS_MITO` en `DRAGONFISH_MITO`, creada con `sql/vw_ARTICULOS_MITO.sql` (o `node scripts/sql.mjs -f sql/vw_ARTICULOS_MITO.sql`, que corre en esta misma PC). Columnas canónicas `ID_ARTICULO, COLOR, TALLE, NOMBRE_COMPLETO, MATERIAL, GRUPO, STOCK_MITO, PRECIO` + de apoyo `SUCURSAL, STOCK_FISICO, EN_TRANSITO, EN_PEDIDO, PREPARADO, PRECIO_CONTADO, LISTAPRE_MAYOR, COLOR_CODIGO, TALLE_CODIGO`. Se cambia con `VITE_SQL_VISTA_ARTICULOS` y hay que **habilitarla en Configuraciones → Conexión SQL** (o `api/sql/catalogo.ts`).
- La capa TS tolera nombres alternativos de columna (`articulosConsulta.ts` resuelve por fila, no global) por si la vista tiene otra forma.
- Lo que no viene del SQL lo completa Supabase: `articulos` (descripcion/material/grupo/precio) y `mapeo_deposito` (ubicación: primero busca el SKU `articulo|color|talle`, si no cae al artículo base). Todo en tandas de 500/200 por el límite de 1000 filas.
- Permiso nuevo `mayorista.articulos.view` (área `mayorista`), otorgado al rol `mayorista` con `sql/consulta_articulos.sql` (crea el permiso + recrea las políticas RLS de `mapeo_deposito` y `articulos` para que el solo-select acepte el permiso).

### Fórmulas del SQL de MITO (importante: NO usar vw_PRODUCTOS_WEB)
Leyendo las definiciones reales (`INFORMATION_SCHEMA.VIEWS`):
- **Precio = lista `LISTA2` = "MAYOR"** (el nombre de la lista está en `ZooLogic.LPRECIO.LPR_NOMBRE`). Se toma el renglón con `FECHAVIG` más alta (desempatado por `HMODIFW`) para ese artículo+color; si el color no tiene, el general del artículo. `vw_PRODUCTOS_WEB` usa `LISTA1` ("Contado"), o sea precio de mostrador, **no** el de mayorista. `PRECIO_CONTADO` en la vista nueva deja el de `LISTA1` a la vista para comparar.
- **Stock = `COCANT - PEDIDO - PREPARADO`, piso 0.** Es la fórmula de `ZooLogic.VISTA_SKU_COMPLETA`, la vista que alimenta el Replicador (de ahí salen stock y ubicaciones). `vw_PRODUCTOS_WEB` usa otra (`+ ENTRANSITO`) y además **no filtra por sucursal**: como `COMB` tiene una fila por local, esa vista mezcla los locales (por eso devuelve 51 302 filas para 17 678 de MITO). Para "stock en MITO" hay que filtrar `BDALTAFW = 'MITO' AND BDMODIFW = 'MITO'`.
- Tablas maestras (`COL`, `TALLE`, `MAT`) vienen repetidas por cada sucursal: hay que agrupar por código (`MAX` de la descripción).
- `talles` usa `TALLE.DESCRIP` (el código está en `TALLE.CODIGO`, no `TALDES`). Sin talle cargado la vista devuelve `UNICO` para no perder el SKU.
- Estado actual de la vista: 17 678 filas / 2 408 artículos, 0 sin nombre, 0 sin material, 0 sin color/talle, 2 sin grupo, 281 sin precio, 30 con precio 0. Verificar con `sql/verificar_vw_ARTICULOS_MITO.sql` (todas las columnas `mal_*` tienen que dar 0).

### Herramientas para hablar con el SQL de esta PC
- `node scripts/sql.mjs "SELECT ..."` — cualquier SQL con las credenciales de `puente-sql/.env` (el puente solo permite `SELECT TOP`; esto no). Opciones: `--json`, `--alias <srv>` (otro servidor), `-f <archivo.sql>` (parte por `GO`), `-i` (interactivo), `--lote` (muestra los lotes). Timeout 120 s (`SQL_TIMEOUT_MS`).
- `node scripts/puente.mjs <health|servidores|bases|objetos|vista|filtro|raw>` — habla con el puente local (`localhost:3128`) igual que el hub, sin Credenciales a mano.
- El puente se reinicia solo (tarea programada "MITO - Puente SQL" → `puente-sql/scripts/servicio.ps1`, log en `puente-sql/data/servicio.log`): para que tome un cambio en `server.js` basta con `Stop-Process` del `node server.js` y espera ~15 s.

### Pruebas del módulo
- `npm test` → `scripts/test-consulta-articulos.mjs`: mapeo de columnas, parseo de números, filtro y ubicaciones. No toca la red.
- `npm run test:sql` → `scripts/test-puente-filtro.mjs` (filtro del puente, wildcard escapado, lista blanca, token) + `scripts/test-consulta-articulos-sql.mjs` (filas **reales** de la vista recurridas por la lib, de punta a punta). Necesitan el puente levantado.

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

## Pendientes F12 Consulta artículos (aún NO ejecutado)
1. Supabase SQL Editor → correr **`sql/consulta_articulos.sql`** (permiso `mayorista.articulos.view` + políticas RLS de `mapeo_deposito` y `articulos` + checklist del hub).
2. SQL Server de MITO (`DRAGONFISH_MITO`) → correr **`sql/vw_ARTICULOS_MITO.sql`** (crea `ZooLogic.vw_ARTICULOS_MITO`) y grant de SELECT al login del puente.
3. Hub → Configuraciones → Conexión SQL: habilitar la vista `ZooLogic.vw_ARTICULOS_MITO` (o `api/sql/catalogo.ts` si no aparece).
4. Reiniciar `puente-sql/server.js` para que tome el `PUENTE_FILTRO_COLS` nuevo (si se sobreescribe por variable de entorno, agregarle `ID_ARTICULO,NOMBRE_COMPLETO`).
5. Hub → Usuarios → Roles: granting de `mayorista.articulos.view` al rol `mayorista`.
6. Deploy.

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
- `src/pages/Replicas.tsx` + `src/lib/replicas.ts` + `api/replicas.ts` — estado de las réplicas (Replicador SQL de la PC central); `puente-sql/sql/replicas.sql` + `scripts/mock-replicas.mjs`.
- `src/pages/ConsultaArticulos.tsx` + `src/lib/articulosConsulta.ts` — F12 Consulta artículos (Mayorista); `src/lib/sqlApi.ts` (`leerVistaFiltrada`) + `api/sql/[view].ts` + `puente-sql/server.js` (filtro del puente).
- `sql/consulta_articulos.sql` (Supabase: permiso + RLS) y `sql/vw_ARTICULOS_MITO.sql` (vista en el SQL Server de MITO).

## Dependencias extra instaladas
`konva@9`, `react-konva@18` (React 18), `webfontloader`, `jspdf`, `@types/webfontloader`. (`xlsx`, `recharts` ya estaban).

## Notas de estado
- Transferencias: se arregló la carga por lote (no corta a 1000). El backend envía mails a los 16 locales (pagina la lectura de ítems). Existe botón "Reenviar (N)" para los que fallaron.
- Empleados: importación del "Listado - MITO" cargada (1726 registros). RLS de edición habilitada.
- El archivo `260922 - W50OFF-XG GPAZ.xlsx` y `PROVEEDORES PACHO.xlsx` están en la raíz (pruebas).