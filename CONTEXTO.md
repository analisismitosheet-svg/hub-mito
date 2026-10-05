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
- Pantalla: `src/pages/ConsultaArticulos.tsx` → `src/lib/articulosConsulta.ts` → `src/lib/sqlApi.ts` (`leerVistaFiltrada`) → `GET /api/sql/<vista>?where=&value=&match=` (`api/sql/[view].ts`) → Logic App → Puente → `VISTAS_CONSOLIDADAS` → servidor vinculado `MITO` → `DRAGONFISH_MITO`.
- Muestra `id articulo` (+ color/talle como chips), `nombre completo`, `material`, `grupo`, `stock en mito`, `ubicacion`, `precio`. Granularidad **por SKU (artículo + color + talle)**. Buscador por código o descripción con debounce de 400 ms + botón "Consultar"/Enter (inmediato) y export a Excel.
- La Logic App **ignora** los parámetros del filtro → la vista devuelve el TOP y la pantalla **vuelve a filtrar en el navegador**; si detecta que el SQL no aplicó el filtro muestra el aviso "el SQL no aplicó el filtro: se acotó en el navegador".
- Vista en el SQL Server: **`DESKTOP-OA4GU6I:VISTAS_CONSOLIDADAS.dbo.vw_ARTICULOS_MITO`**, creada con `node scripts/sql.mjs --alias -f sql/vw_ARTICULOS_MITO.sql`. `--alias` es obligatorio: sin él el script entra a `ZOOLOGIC`, que es donde **estaba antes** (en `DRAGONFISH_MITO.ZooLogic`, ya borrada) y donde no está ahora.
  - Vive en `VISTAS_CONSOLIDADAS` (instancia local `DESKTOP-OA4GU6I`, la de esta PC) junto a las demás vistas consolidadas del hub (`vw_STOCK_SUCURSALES_REAL`, `vw_comprobantes_*`, `vw_DETMSTOCK_UNIFICADA`).
  - Los datos de MITO **no** están en esa instancia: la vista los lee del servidor vinculado **`MITO`** (`192.168.0.222\ZOOLOGIC`, MSOLEDBSQL) con nombre de 4 partes: `MITO.DRAGONFISH_MITO.ZooLogic.COMB`. Ojo: sin el `MITO.` adelante, SQL Server busca `DRAGONFISH_MITO` entre las bases **locales**, no la encuentra y dice "Invalid object name".
  - **El nombre que pide el hub lleva el alias adelante** (`ALIAS:BASE.ESQUEMA.VISTA`) porque el puente tiene dos servidores: sin alias mira en el principal (`ZOOLOGIC`) y responde "No existe la vista".
  - Columnas canónicas `ID_ARTICULO, COLOR, TALLE, NOMBRE_COMPLETO, MATERIAL, GRUPO, STOCK_MITO, PRECIO` + de apoyo `SUCURSAL, STOCK_FISICO, EN_TRANSITO, EN_PEDIDO, PREPARADO, PRECIO_CONTADO, LISTAPRE_MAYOR, COLOR_CODIGO, TALLE_CODIGO`. Se cambia con `VITE_SQL_VISTA_ARTICULOS` y hay que **habilitarla en Configuraciones → Conexión SQL** (agregarla desde el explorador: servidor `DESKTOP-OA4GU6I` → base `VISTAS_CONSOLIDADAS` → esquema `dbo` → `vw_ARTICULOS_MITO`).
  - Leerla por el vínculo cuesta: el TOP con filtro tarda ~1,5-2,5 s contra los ~0,2 s de la vista local anterior.
- La capa TS tolera nombres alternativos de columna (`articulosConsulta.ts` resuelve por fila, no global) por si la vista tiene otra forma.
- Lo que no viene del SQL lo completa Supabase: `articulos` (descripcion/material/grupo/precio) y `mapeo_deposito` (ubicación: primero busca el SKU `articulo|color|talle`, si no cae al artículo base). Todo en tandas de 500/200 por el límite de 1000 filas.
- Permiso nuevo `mayorista.articulos.view` (área `mayorista`), otorgado al rol `mayorista` con `sql/consulta_articulos.sql` (crea el permiso + recrea las políticas RLS de `mapeo_deposito` y `articulos` para que el solo-select acepte el permiso).

### Fórmulas del SQL de MITO (importante: NO usar vw_PRODUCTOS_WEB)
Leyendo las definiciones reales (`INFORMATION_SCHEMA.VIEWS`):
- **Precio = lista `LISTA2` = "MAYOR"** (el nombre de la lista está en `ZooLogic.LPRECIO.LPR_NOMBRE`). Se toma el renglón con `FECHAVIG` más alta (desempatado por `HMODIFW`) para ese artículo+color; si el color no tiene, el general del artículo. `vw_PRODUCTOS_WEB` usa `LISTA1` ("Contado"), o sea precio de mostrador, **no** el de mayorista. `PRECIO_CONTADO` en la vista nueva deja el de `LISTA1` a la vista para comparar.
- **Stock = `COCANT - PEDIDO - PREPARADO`, piso 0.** Es la fórmula de `ZooLogic.VISTA_SKU_COMPLETA`, la vista que alimenta el Replicador (de ahí salen stock y ubicaciones). `vw_PRODUCTOS_WEB` usa otra (`+ ENTRANSITO`) y además **no filtra por sucursal**: como `COMB` tiene una fila por local, esa vista mezcla los locales (por eso devuelve 51 302 filas para 17 678 de MITO). Para "stock en MITO" hay que filtrar `BDALTAFW = 'MITO' AND BDMODIFW = 'MITO'`.
- Tablas maestras (`COL`, `TALLE`, `MAT`) vienen repetidas por cada sucursal: hay que agrupar por código (`MAX` de la descripción).
- `talles` usa `TALLE.DESCRIP` (el código está en `TALLE.CODIGO`, no `TALDES`). Sin talle cargado la vista devuelve `UNICO` para no perder el SKU.
- Estado actual de la vista: 17 678 filas / 2 408 artículos, 0 sin nombre, 0 sin material, 0 sin color/talle, 2 sin grupo, 281 sin precio, 30 con precio 0. Verificar con `node scripts/sql.mjs --alias -f sql/verificar_vw_ARTICULOS_MITO.sql` (todas las columnas `mal_*` tienen que dar 0). Al mudarla se comprobó que daba **exactamente lo mismo** que la versión local de `DRAGONFISH_MITO`: mismo `CHECKSUM` de las columnas canónicas (-120017878487), mismo stock (99 196) y mismo precio (486 652 691).

### Herramientas para hablar con el SQL de esta PC
- `node scripts/sql.mjs "SELECT ..."` — cualquier SQL con las credenciales de `puente-sql/.env` (el puente solo permite `SELECT TOP`; esto no). Opciones: `--json`, `--alias` (el otro servidor: `VISTAS_CONSOLIDADAS` en `localhost`, por driver ODBC + `mssql/msnodesqlv8` con usuario de Windows), `-f <archivo.sql>` (parte por `GO`), `-i` (interactivo), `--lote` (muestra los lotes). Timeout 120 s (`SQL_TIMEOUT_MS`).
- `node scripts/puente.mjs <health|servidores|bases|objetos|vista|filtro|raw>` — habla con el puente local (`localhost:3128`) igual que el hub, sin Credenciales a mano.
- El puente se reinicia solo (tarea programada "MITO - Puente SQL" → `puente-sql/scripts/servicio.ps1`, log en `puente-sql/data/servicio.log`): para que tome un cambio en `server.js` basta con `Stop-Process` del `node server.js` y espera ~15 s.

### El túnel: Tailscale Funnel (¡y por qué desde la oficina siempre "anda"!)
- Vercel no llega a `192.168.0.x`, así que el puente se publica con **Tailscale Funnel** en `https://desktop-oa4gu6i.tail8a2a01.ts.net/sql-bridge` → `http://127.0.0.1:3128`. Esa URL (con `/health` al final) está en `sql_conexion.logicapp_url`; `SQL_BRIDGE_TOKEN` en Vercel tiene que coincidir con `PUENTE_TOKEN`.
- **El Funnel queda "`Funnel on`" pero su ingreso público puede morirse solo**, y es muy difícil de ver desde la oficina: la tailnet intercepta `100.117.213.59` y enruta **por adentro**, así que desde esta PC el túnel responde siempre (3–150 ms). Solo desde internet falla. Síntoma: el panel Estado de *Configuraciones → Conexión SQL* queda en verde y el error aparece recién al **agregar una vista** ("No se pudo contactar el Puente SQL", 504) — igual que en Réplicas y en Consulta artículos, que usan el mismo puente.
- **Para diagnosticar hay que mirar desde afuera, nunca local.** Desde la PC: `Invoke-WebRequest https://.../sql-bridge/health` → siempre 200 (engaña). Desde internet: `https://check-host.net/check-http?host=<url>&max_nodes=6` (pedir JSON con `Accept: application/json`, pollar `check-result/<request_id>` a los ~20 s). Sana = `code=1 ... OK | 200`; caída = `code=0 | 0,4s | Broken pipe` (el TCP a :443 abre, lo que muere es el **handshake TLS**; si también pasa en el 8443, es el Funnel del nodo, no el puente ni los handlers).
- **Arreglo: reaplicar la config del Funnel** (no hace falta reiniciar Tailscale). Ojo con la sintaxis de **Tailscale 1.102**: es un solo target y el path va aparte — `tailscale serve --https=443 --set-path=/sql-bridge --bg http://127.0.0.1:3128`, y después `tailscale funnel` con **los mismos** target (no existe `funnel on`/`off` sin target). Sin `--bg` se queda en foreground y cuelga la consola. `serve --https=443 off` **borra los handlers de ese puerto**: hay que volver a declarar los tres (`/` → 4000, `/sql-bridge` → 3128, 8443 `/` → 8765). `serve set-config` no sirve para esto: ignora los campos del nodo (`AllowFunnel`, `TCP`, `Web`).
- `api/sql/status` hace un **GET real** al destino (`alcanzable`, timeout 6 s `SQL_PING_TIMEOUT_MS`, cacheado 15 s) para que "Estado" deje de mostrar todo verde con el túnel caído. Un 405 también cuenta como "responde": lo que importa es que haya respuesta HTTP.

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

## Pendientes F12 Consulta artículos
1. Supabase SQL Editor → correr **`sql/consulta_articulos.sql`** (permiso `mayorista.articulos.view` + políticas RLS de `mapeo_deposito` y `articulos` + checklist del hub). **Es lo único que no se puede hacer desde el código.**
2. Hub → Configuraciones → Conexión SQL: habilitar `DESKTOP-OA4GU6I:VISTAS_CONSOLIDADAS.dbo.vw_ARTICULOS_MITO` desde el explorador (servidor `DESKTOP-OA4GU6I` → base `VISTAS_CONSOLIDADAS` → esquema `dbo`).
3. Hub → Usuarios → Roles: granting de `mayorista.articulos.view` al rol `mayorista`.

Ya está hecho (no hay que repetirlo):
- La vista existe y está verificada en `VISTAS_CONSOLIDADAS` (`node scripts/sql.mjs --alias -f sql/vw_ARTICULOS_MITO.sql`).
- El puente con `PUENTE_FILTRO_COLS` que ya incluye `ID_ARTICULO` y `NOMBRE_COMPLETO`, y que ignora las columnas que la vista no tiene.
- Deploy.

## Archivos clave
- `src/config/areas.ts` — áreas + apps del menú (agregar app = AppDef aquí).
- `src/App.tsx` — rutas.
- `src/config/columnasEmpleados.ts` — columnas por categoría de empleado.
- `src/lib/importarListado.ts` — parseo del Excel "Listado - MITO" (4 hojas).
- `src/pages/Empleados.tsx` — ABM empleados + importación + sub-menú por estado.
- `src/pages/CargaNovedades.tsx` / `ResumenNovedades.tsx` — novedades con multifiltro/multisort.
- `src/pages/Transferencias.tsx` — reposiciones (carga por lote; envío de mails).
- `api/enviar-transferencia.ts` — envío de mails vía Microsoft Graph (paginado de ítems).
- `src/pages/EstadisticasTransferencias.tsx` - dashboard. Todo sale del RPC `estadisticas_transferencias` (una llamada); el refresco automático **tampoco toca la tabla cruda**: saca la huella de los KPIs del RPC (`huella()`), porque sondear `transfer_items` revienta por RLS.
- **RLS por fila = timeouts.** Las policies de `transfer_items` llaman `private.mi_local()`, `private.es_admin()` y `private.tiene_permiso()` por fila. Son STABLE (leen tablas), así que Postgres no las puede calcular una vez y no puede usar los índices → escaneo completo con 3 llamadas a función por fila. Medido: un `select hecho_at order by hecho_at desc limit 1` tarda >3 s y da "canceling statement due to statement timeout" **incluso con cero filas visibles**, así que agregar índices no lo arregla. La solución que ya se usó en el repo es `SECURITY DEFINER` validando permisos una sola vez al inicio (`sql/listar_transfer_items.sql`).
  - `estadisticas_transferencias` sigue siendo INVOKER (a propósito: es lo que hace que un local vea solo lo suyo), así que es la que paga el costo. `sql/fix_estadisticas_transferencias_timeout.sql` la destraba con un `statement_timeout` propio de 60 s + índices + un bloque de diagnóstico. El arreglo de fondo es reescribir la función como SECURITY DEFINER conservando el filtro por local, y para eso hace falta tener el cuerpo a mano.
- `src/pages/Cumpleanios.tsx` + `src/components/EditorCumple.tsx` — cumpleaños + editor de imagen (konva, plantilla por URL en `public/plantilla-cumpleanos.jpeg`).
- `src/pages/Rma.tsx` + `src/pages/ProveedoresPacho.tsx` + `src/pages/GuiaPacho.tsx` — RMA con proveedores/guía.
- `src/pages/Replicas.tsx` + `src/lib/replicas.ts` + `api/replicas.ts` — estado de las réplicas (Replicador SQL de la PC central); `puente-sql/sql/replicas.sql` + `scripts/mock-replicas.mjs`.
- `src/pages/ConsultaArticulos.tsx` + `src/lib/articulosConsulta.ts` — F12 Consulta artículos (Mayorista); `src/lib/sqlApi.ts` (`leerVistaFiltrada`) + `api/sql/[view].ts` + `puente-sql/server.js` (filtro del puente).
- `sql/consulta_articulos.sql` (Supabase: permiso + RLS) y `sql/vw_ARTICULOS_MITO.sql` (la vista, en `VISTAS_CONSOLIDADAS`; se corre con `--alias`).

## Dependencias extra instaladas
`konva@9`, `react-konva@18` (React 18), `webfontloader`, `jspdf`, `@types/webfontloader`. (`xlsx`, `recharts` ya estaban).

## Notas de estado
- Transferencias: se arregló la carga por lote (no corta a 1000). El backend envía mails a los 16 locales (pagina la lectura de ítems). Existe botón "Reenviar (N)" para los que fallaron.
- Empleados: importación del "Listado - MITO" cargada (1726 registros). RLS de edición habilitada.
- El archivo `260922 - W50OFF-XG GPAZ.xlsx` y `PROVEEDORES PACHO.xlsx` están en la raíz (pruebas).