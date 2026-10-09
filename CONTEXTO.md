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
- Deploy: **automático** — el repo `analisismitosheet-svg/hub-mito` está conectado a Vercel, así que cada push a `main` despliega solo (verificado 2026-10-08: `vercel git connect` responde "already connected" y el deploy de producción tiene el alias `hub-mito-git-main-mito-srl.vercel.app`). Fallback manual: `npx vercel --prod --scope mito-srl --yes` (o `& "C:\Program Files\nodejs\npx.cmd" ...`), que exige `vercel login` una vez en la PC.
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
- `node scripts/test-recepcion-indo.mjs "Recepcion Indo.xlsx"` → parseo del Excel de Recepción INDO (casteo tolerante, encabezados con tildes, clave natural, KPIs contra el archivo real). No toca la red ni la base.

## Mapeo depósito · Orden mapeado (stock)
- Pantalla `src/pages/MapeoOrden.tsx` → `src/lib/stockArticulos.ts` → `src/lib/sqlApi.ts` (`leerVista` + `estadoConexion`) → `GET /api/sql/<vista>` → Puente → `vw_STOCK_ARTICULO_MITO`.
- El mapeo guarda solo el artículo (sin color ni talle), así que el chip al lado del código es el **stock total del artículo**: suma del `STOCK_MITO` de todos sus SKUs (`sql/vw_STOCK_ARTICULO_MITO.sql`, armada sobre `vw_ARTICULOS_MITO` para que sea idéntico al de F12). Verde = con unidades, rojo = 0, "—" = sin dato.
- Al cargar (y con *Actualizar*) los artículos en stock 0 **se borran de `mapeo_deposito`**, de todas sus ubicaciones, en tandas de 150 códigos por `.in()` y solo si hay permiso `mayorista.mapeo.borrar`; en pantalla ya desaparecen apenas llega el stock. Si la vista falla, viene vacía o no se pudo saber el tope de filas **no se borra ni se oculta nada**; si vino cortada se quita solo lo que la vista marcó en 0. Los que quedaron en 0 sin poder quitarse (sin permiso o con error) se ocultan y se revelan con la tilde «Ver sin stock». El tacho de la lista —borrado manual con confirmación— lo ve solo el admin.
- Tests: `node scripts/test-stock-articulos.mjs` (entra en `npm test`).

## Pedidos de venta · columna Stock
- Pantalla `src/pages/PedidosVenta.tsx` → `src/lib/stockSku.ts` → `src/lib/sqlApi.ts` (`leerVista`) → `GET /api/sql/<vista>` → Puente → `vw_STOCK_SKU_MITO`.
- Cada línea de un pedido es un **SKU** (artículo + color + talle), así que la columna muestra el stock de **ese color y ese talle**, no el del artículo entero: rojo = 0, ámbar = no alcanza para la cantidad pedida, verde = alcanza, "—" = sin dato. El total del artículo y el faltante van en el título de la celda. Va después de *Cantidad* y también en el Excel.
- La clave es `ARTICULO|COLOR|TALLE` (mayúsculas, sin espacios), con el alias `UNICO` ↔ talle vacío que arma la vista. Verificado contra Dragonfish: de 192 308 líneas de pedido de 2026, **192 299 (99,995 %)** encuentran su SKU exacto.
- Vista `sql/vw_STOCK_SKU_MITO.sql`: 17 691 SKUs x 4 columnas = **1,45 MB**, armada sobre `vw_ARTICULOS_MITO` (mismo número que F12). No se lee `vw_ARTICULOS_MITO` directamente porque trae 14 columnas y 6,8 MB, que no entra en la respuesta de una función serverless.
- La lib baja la vista **una vez por sesión** (caché en memoria, `limpiarCacheStockSku()` la resetea); si falla no cachea el error y la columna queda en "—" con un aviso ámbar.
- Semántica de `stockSkuDe()`: SKU presente → su número; ausente + vista entera → 0; ausente + vista cortada o tope desconocido → `null`; vista vacía o sin columnas reconocibles → tira error.
- **`vw_STOCK_SKU_MITO` y `vw_STOCK_ARTICULO_MITO` están fijas en el env `SQL_VIEWS` de Vercel** (coma): no hay que habilitarlas a mano en Configuraciones → Conexión SQL. Cambian con `vercel env add/rm SQL_VIEWS production` + redeploy.
- Tests: `node scripts/test-stock-sku.mjs` (entra en `npm test`).

## Armado de pedidos (Mayorista pide · el piso lo arma en Mi repo)
- **SQL aplicado** (`34/34` OK): `node scripts/supabase-sql.mjs qwlugajzxrrwckrqlrjp sql/mayorista_armados.sql`. Idempotente y aditivo: no toca ninguna tabla existente.
  - Tablas nuevas: `mayorista_armados` (una fila por pedido pedido a armar: prioridad, estado, quién lo tomó, cuándo terminó, faltantes) y `mayorista_armados_items` (copia de los renglones del pedido con `escaneadas` por línea). Índice único parcial: **un solo armado activo por pedido**.
  - RLS: sólo SELECT, para quien tiene `pedidos_venta.view` (mayorista) o `mayorista.repos_piso` (piso); el admin entra por `es_admin()`. Todo lo que escribe pasa por funciones `SECURITY DEFINER`. Verificado en la base: el legajo 4004 ve los armados (`scripts/test-armados-rls.sql`) y un usuario sin esos permisos no.
  - Funciones: `pedir_armado(codigos[], prioridad, obs)` (bulk, saltea anulados y los que ya tienen armado activo), `armado_aceptar(id, legajo, nombre)` (**carrera resuelta en la base**: `update … where estado='pendiente'`, gana el primero), `armado_escanear(id, codigo)` (+1 unidad, igual que `escanear_codigo`), `armado_marcar_item(id, linea)` (tilde manual: marca la línea entera), `armado_deshacer(id, linea)` (−1), `armado_finalizar(id)` (lo que falta pasa a faltante) y `private.armado_cerrar_si_listo` (cierra el armado cuando no queda ninguna línea pendiente).
- **Mayorista** — `src/pages/PedidosVenta.tsx`: botón **Pedir armado** en el detalle y barra flotante con la selección múltiple ("Tildar todo (N)" + checkbox por fila), chip **📅 Hoy** al lado del período, modal de prioridad (urgente / normal / baja) con observación, y el pedido **se pone en verde** en la lista y en el detalle: `EN CURSO ✓ x/y unidades` cuando alguien lo acepta, `ARMADO 🏁` cuando terminó. Se refresca cada 12 s.
- **Piso** — `src/pages/MiRepo.tsx` + `src/components/ArmadoPedido.tsx`: sección *Armados pedidos* arriba de los repos (tarjetas por prioridad, `Acepto` / `Omitir`, barra de avance) y *Armados en curso* con los que tomé; al tocar una se abre `ArmadoPedido`, con el mismo mecánico del repo: cronómetro, escáner inalámrico/teclado, cámara (`ScannerCamara` con `conQr` → lee **QR, Code 39, Code 128 (EAN-128) y EAN**), lista "Faltan escanear" con la **✓ manual al lado de cada artículo** (para cuando la cámara no lee y no se quiere tipear) + `↺ Deshacer`, y Finalizar con confirmación.
- **Aviso** — `src/lib/alarma.ts` + `src/components/CampanaNotificaciones.tsx`: la campana del header sigue `mayorista_armados` **en vivo** (Realtime + respaldo cada 60 s con la pestaña visible; el piso sólo los pendientes, el mayorista además los en curso) y con cada tarea **nueva** suena el celular (`sonarArmado`: Web Audio + `navigator.vibrate`, sin archivos de audio) y, si la app está en segundo plano, tira la notificación del sistema. El sonido va en la campana y no en Mi repo, así suena aunque estés en otra pantalla. **Si nadie lo toma, el pedido repica con backoff: 1, 2, 4, 8 min y después cada 8 min** hasta que alguien lo acepte (`REPIQUES` / `esperaRepique` en la campana); si se libera (alguien lo cerró o rechazó) vuelve a empezar como nuevo. Al abrir la app no suena por arrancar, pero queda programado el primer repique.
- **Tipos y helpers compartidos** — `src/lib/armados.ts` (`Armado`, `ArmadoItem`, `PRIORIDADES`, `ordenArmados` = urgente → normal → baja y después el más viejo, `avanceDeArmados`).
- **Pruebas en la base** (dejan todo como estaba): `node scripts/supabase-sql.mjs qwlugajzxrrwckrqlrjp scripts/test-armados.sql --raw` — pide el armado, evita el duplicado, acepta, escanea, deshace, tilda a mano, finaliza y comprueba la carrera entre dos legajos (14 pasos). `scripts/test-armados-rls.sql` comprueba que un legajo del piso ve los armados.
- **Mockups** (sólo HTML, el diseño original): `mockups/pedir-armado.html` y `mockups/mi-repo.html`.
- **Cambios en vivo (Realtime)** — `src/lib/realtime.ts` (`suscribirCambios(tablas, cb, {espera})`) reemplaza el refresco por temporizador de Pedidos de venta, Mi repo y la campana: la base avisa cuando algo cambia y recién ahí se recarga (600 ms de debounce, una vez por ráfaga). Si las tablas no están publicadas o el navegador no soporta Realtime, **no rompe**: cada pantalla conserva su refresco de respaldo (60 s, sólo con la pestaña visible). Requiere `sql/pedidos_realtime.sql` (publica las tablas en `supabase_realtime`).
- **Tiempo muerto y faltantes** — `sql/armado_tiempos_muertos.sql` (guarda `iniciado_at` del armado y la sección *Tiempo muerto* en `EstadisticasRendimiento`: huecos entre tareas cerradas del mismo día) y `sql/armado_faltantes_unidades.sql` (los faltantes del armado se cuentan en **unidades**, no en líneas).
- **Web Push (app cerrada)**: ya está. `src/lib/push.ts` (`activarAvisos` con la clave VAPID de `/api/push-armado`, `avisarArmados`, `avisarPausa`, `avisarFaltantes`) + `api/push-armado.ts` / `api/push-pausa.ts` / `api/push-faltantes.ts` (Vercel, `web-push`, service role) mandan el aviso aunque el celular esté bloqueado. Requiere `sql/push_suscripciones.sql` y las variables `VAPID_PUBLIC_KEY/PRIVATE_KEY/SUBJECT` en Vercel. En iOS sólo anda con la PWA instalada en la pantalla de inicio.
- **Soltar un armado (el legajo lo suelta)** — `sql/armado_rechazar.sql` (+ `armado_rechazar(p_id, p_motivo)`): si el legajo que está armando no lo puede hacer, toca **Soltar** en el panel del armado (`ArmadoPedido.tsx`), cuenta el porqué (≥ 3 caracteres) y la tarea **vuelve a `pendiente` para todo el piso**. Se conserva lo escaneado y se resetea el cronómetro; se registra `liberado_motivo/nombre/at/veces` en `mayorista_armados` y se copia a `pedidos_venta_estado`. Mi repo muestra "Lo soltó …" en la tarjeta pendiente y Pedidos de venta avisa con el motivo en el detalle del pedido. La pausa que estuviera pedida/corriendo se cancela. Lo puede soltar el legajo que lo aceptó o el admin.

## Pausas del piso con autorización (Mi repo · el puesto autoriza)
- **SQL aplicado** (`48/48` OK): `node scripts/supabase-sql.mjs qwlugajzxrrwckrqlrjp sql/pausas_autorizacion.sql` (idempotente). Antes el legajo tocaba Pausar y la pausa arrancaba al toque; ahora **pide la pausa y sigue trabajando** (el cronómetro no frena) hasta que alguien con el permiso la autoriza. Si la rechazan o nadie la autoriza, la pausa se anula y el legajo siguió igual.
- `piso_pausas` suma `estado` (`pendiente` | `autorizada` | `rechazada` | `cancelada`; default `autorizada` para las viejas y las automáticas), `solicitada_at`, `autorizada_por`, `autorizada_at`, `motivo_rechazo`, `push_at`; `desde` pasó a **nullable** (se llena recién al autorizar). CHECK `piso_pausas_estado_check`, índice parcial de pendientes y publicación en `supabase_realtime`.
- RPC nuevas: `repo_solicitar_pausa(sesion, motivo, detalle)` y `armado_solicitar_pausa(id, motivo, detalle)` (el legajo pide), `pausa_cancelar(pausa)`, `pausa_autorizar(pausa)` / `pausa_rechazar(pausa, motivo)` y `pausas_pendientes()` (lista para la pantalla del autorizador). Las viejas `repo_pausar` / `armado_pausar` ya **no pausan**: tiran "Actualizá la app…".
- Permiso nuevo **`mayorista.pausas.autorizar`** (área mayorista), otorgado a la cuenta **puesto3** (`puesto3indo@gmail.com`). Se puede dar o sacar desde Usuarios. La RLS de SELECT de `piso_pausas` deja al autorizador ver las de todos (el legajo ve sólo las suyas, y por eso el Realtime también respeta esa RLS).
- **Legajo** — `src/pages/MiRepo.tsx` y `src/components/ArmadoPedido.tsx`: el botón Pausar abre el motivo y llama a `*_solicitar_pausa`; queda un banner ámbar "Pausa pedida (motivo) · esperando que la autoricen" con **Cancelar**, y el cronómetro sigue. Cuando el puesto autoriza (lo ve por Realtime) la sesión/armado pasa a pausada; si la rechaza, sigue como estaba y le avisa el motivo.
- **Autorizador** — `src/pages/PausasPendientes.tsx` (ruta `/mayorista/pausas`, `PermissionRoute` con el permiso nuevo): lista los pedidos pendientes (quién, repo/armado, motivo, hace cuánto) con **Autorizar** / **Rechazar** (motivo opcional). Realtime + respaldo cada 30 s y el bloque *AvisosCelular* para activar el push.
- **Aviso en la campana** — `src/components/CampanaNotificaciones.tsx` suma el tipo `pausas` (sólo para quien tiene el permiso) y `src/lib/push.ts` → `avisarPausa()` → `POST /api/push-pausa`, que con la service role resuelve los autorizadores (**admin** + permiso directo en `usuario_permisos` o por rol) y les manda push web (`api/push-pausa.ts`, mismo patrón que `api/push-armado.ts`). Para recibirlo hay que activar los avisos en el celular.
- **Motivos** — se sacó **`comida` (almuerzo / merienda)** de los seleccionables. Quedan `bano | otra_tarea | falta_mercaderia | equipo | otro` (`otro` pide detalle ≥ 3 caracteres). Las pausas viejas con `comida` siguen existiendo para el historial y se muestran como "Almuerzo / merienda" (mapa `MOTIVOS_VIEJOS` en `src/components/MotivoPausa.tsx`).
- `estadistica_pausas` y los triggers de cierre cuentan **sólo** las `autorizada`; el cooldown de 15 min corre desde `coalesce(desde, solicitada_at)` y no cuenta las `cancelada` ni las automáticas `otra_tarea`.

## Avisos de faltantes de stock (al cerrar el armado)
- Cuando el legajo toca **Finalizar** y quedan faltantes, `armado_finalizar` deja los renglones que faltaron en `faltante` (**la línea se cierra sola**, como se decidió) y el aviso llega solo: nada de botón "Avisar" manual.
- **Lo recibe puesto3** — permiso nuevo **`mayorista.faltantes.ver`** (`sql/armado_faltantes_aviso.sql`, aplicado), otorgado a `puesto3indo@gmail.com`; los administradores siempre lo ven. Se puede dar/sacar desde Usuarios.
- **Campana** (`src/components/CampanaNotificaciones.tsx`): nuevo tipo `faltantes` (triángulo rojo). Sale en vivo de `mayorista_armados` (`estado='hecho'` con `faltantes > 0`, Realtime ya publicado): "Faltantes de stock · Pedido N° … · faltan N u. · armado por …". Toque → abre el pedido directo (`/mayorista/pedidos-venta?abrir=…`).
- **Push al celular** — `src/lib/push.ts` → `avisarFaltantes(armadoId)` se llama en `ArmadoPedido` apenas se finaliza con faltantes; `POST /api/push-faltantes` (mismo patrón que `api/push-pausa.ts`) resuelve los receptores (admin + permiso directo o por rol) y manda el detalle de los renglones que faltaron por web-push.
- **Pedidos de venta** (`src/pages/PedidosVenta.tsx`): caja roja "Faltantes de stock: N u. — las líneas se cerraron solas" en el detalle del pedido terminado, y cada línea `faltante` lleva el chip **✕ Faltan N**. Además acepta `?abrir=CODIGO` para abrir un pedido desde la campana.
- Pruebas en vivo: no hay armados en la base hoy; para probar alcanza con finalizar un armado con líneas sin escanear y mirar la campana de puesto3.

## Informes y reportes por WhatsApp (Sistemas)
- **SQL aplicado** (`25/25` OK): `node scripts/supabase-sql.mjs qwlugajzxrrwckrqlrjp sql/informes.sql` (idempotente y aditivo). Crea `public.informes` (definición) y `public.informes_envios` (historial). El historial sólo lo escribe el servidor (service role); el cliente lee y edita informes.
- Permisos nuevos: **`sistemas.informes.view` / `.create` / `.edit` / `.delete`**. La app se registra en `src/config/areas.ts` (área Sistemas, ruta `/informes`) y la ruta va con `PermissionRoute`.
- **Creador** — `src/pages/Informes.tsx`: lista + formulario. Cada informe tiene nombre, destinatarios de WhatsApp (varios), programación (`manual` o `diario` a una hora + días) y activo. Botones: **Enviar ahora**, historial, editar, activar/desactivar, borrar y **Vista previa** (arma el texto sin enviar).
- **Fuente del cuerpo** (elegís una): `vista` (una vista habilitada en Datos SQL, con filtro/columnas/tope), `app` (Recepción INDO pendientes, Armados de pedidos, Pedidos de compra de los últimos 7 días) o `texto` (libre, con `{fecha}`, `{hora}`, `{dia}`). Encabezado y pie opcionales, también con variables.
- **Motor** — `src/lib/informesServidor.ts` (sólo server: `process.env`, nunca `import.meta.env`; mismo criterio que `puenteRetry.ts`). Arma el cuerpo y manda por **WhatsApp Cloud API (Meta)** con `graph.facebook.com`. La fuente `vista` reusa el Puente SQL / Logic App (`postAlPuente`, misma whitelist que `api/sql/[view].ts`).
- **Endpoints** — `api/informe-enviar.ts` (envío manual o vista previa; valida JWT + `sistemas.informes.edit`) y `api/informe-cron.ts` (envía los diarios vencidos; acepta `CRON_SECRET` **o** un JWT con permiso, como respaldo cuando se abre la pantalla). El “ya se mandó hoy” se resuelve con un **PATCH condicional** (reclamo atómico), así no se duplica.
- **Variables de entorno en Vercel** (sin `VITE_`): `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_VERSION` (opcional, default `v21.0`), `CRON_SECRET`. Si faltan las de WhatsApp, el envío queda registrado con el motivo **“WhatsApp no configurado”** y la pantalla lo muestra en rojo (sirve para probar sin credenciales).
- **Cron** — `vercel.json`: `0 11 * * *` (08:00 de Argentina). **Ojo plan Hobby:** un cron se puede programar como máximo **1 vez por día**; expresiones como `*/10 * * * *` **hacen fallar el deploy**. Por eso los horarios exactos se apoyan también en el procesado al abrir la pantalla. Con plan Pro se puede bajar la expresión a `*/10 * * * *` para más precisión.
- Mockup: `mockups/creador-informes.html`.

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

## Pendientes Recepción INDO (Depósito)
1. ~~Supabase SQL Editor → `sql/recepcion_indo.sql`~~ **Ya está**: 52/52 sentencias OK (tabla `recepcion_indo`, RLS, trigger y los 5 RPC). Se aplicó con `node scripts/supabase-sql.mjs qwlugajzxrrwckrqlrjp sql/recepcion_indo.sql`.
2. ~~Supabase SQL Editor → `sql/recepcion_indo_proveedores.sql`~~ **Ya está**: 1.518 proveedores, verificados contra la vista (0 faltantes, 0 sobrantes, 0 nombres distintos).
3. ~~Hub → Depósito → Recepción INDO → "Subir Excel"~~ **Ya está**: 1.605 filas importadas. A partir de ahí no hace falta volver a subirlo: el control queda guardado en la base.
4. **Deploy**: la columna "N° OC" linkeable y el deep-link de `PedidosCompra` son código de frontend, así que hay que desplegar para verlos en el navegador.

Opcional, solo para el botón "Catálogo": habilitar `DRAGONFISH_INDOD.dbo.PROVEEDORES_INDO` en Configuraciones → Conexión SQL. Con el tope de filas actual (29 900 000) no hay que tocar nada: son 1.518 filas y llegan enteras.

Lo que **no** va a mejorar: la cobertura de la columna "N° OC". Las 246 OC sin pedido no se arregla desde el hub (ver la nota de "N° OC" en Archivos clave); si el negocio las necesita, el lugar es la vista `VISTAS_CONSOLIDADAS.dbo.PEDIDO_COMPRA`, que hoy tiene `WHERE FFCH >= '20250101'` y baja de `DRAGONFISH_INDOD`.

## Pendientes F12 Consulta artículos
1. Supabase SQL Editor → correr **`sql/consulta_articulos.sql`** (permiso `mayorista.articulos.view` + políticas RLS de `mapeo_deposito` y `articulos` + checklist del hub). **Es lo único que no se puede hacer desde el código.**
2. Hub → Configuraciones → Conexión SQL: habilitar `DESKTOP-OA4GU6I:VISTAS_CONSOLIDADAS.dbo.vw_ARTICULOS_MITO` desde el explorador (servidor `DESKTOP-OA4GU6I` → base `VISTAS_CONSOLIDADAS` → esquema `dbo`).
3. Hub → Usuarios → Roles: granting de `mayorista.articulos.view` al rol `mayorista`.

Ya está hecho (no hay que repetirlo):
- La vista existe y está verificada en `VISTAS_CONSOLIDADAS` (`node scripts/sql.mjs --alias -f sql/vw_ARTICULOS_MITO.sql`).
- El puente con `PUENTE_FILTRO_COLS` que ya incluye `ID_ARTICULO` y `NOMBRE_COMPLETO`, y que ignora las columnas que la vista no tiene.
- Deploy.

## Pendientes Mapeo depósito (stock al lado del código)
1. ~~Hub → Configuraciones → Conexión SQL: habilitar `DESKTOP-OA4GU6I:VISTAS_CONSOLIDADAS.dbo.vw_STOCK_ARTICULO_MITO`~~ **Ya no hace falta**: las dos vistas de stock (`vw_STOCK_ARTICULO_MITO` y `vw_STOCK_SKU_MITO`) están fijas en el env `SQL_VIEWS` de Vercel. **Nada más**: el tope de filas ya está en 29 900 000, así que la vista (2 409 filas) llega entera.

Hecho:
- Vista creada y verificada en `VISTAS_CONSOLIDADAS` (`node scripts/sql.mjs --alias -f sql/vw_STOCK_ARTICULO_MITO.sql`): 2 409 artículos / 97 604 unidades, idéntico a `vw_ARTICULOS_MITO`.
- Pantalla, lib y tests en el repo (ver "Mapeo depósito · stock" arriba).

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
- `src/pages/RecepcionIndo.tsx` + `src/lib/recepcionIndo.ts` — Recepción INDO (Depósito): import del Excel "Recepción de Mercadería" + marcado de control.
  - `src/lib/proveedoresIndo.ts` — catálogo de proveedores del desplegable, sembrado en `recepcion_indo_proveedores` para que ande sin el Puente SQL; se refresca con la vista `DRAGONFISH_INDOD.dbo.PROVEEDORES_INDO`.
  - La **clave natural** la arma el hub (`claveRecepcion`: guía + depósito + proveedor + remito + fechas, en mayúsculas y sin tildes). No incluye estado/IVA/detalle/control, así que **reimportar el mismo Excel actualiza en el lugar en vez de duplicar**. El merge vive en el RPC `recepcion_indo_importar` (no es un upsert llano del navegador) para que un Excel que viene sin fecha de controlada **no borre** el control que alguien cargó a mano.
  - `dias_atraso` es columna GENERATED (`greatest(0, fecha_controlada - fecha_ingreso)`), nunca se escribe a mano.
  - Permiso: reusa `deposito.view` para ver, importar y marcar (no se agregó permiso nuevo). Para separar duties después: SELECT → `deposito.view`, INSERT → `deposito.import`, UPDATE → `deposito.mark` (los tres ya existen).
  - Los KPIs **no** clavan con la hoja "Seguimiento" del Excel y está a propósito: `bultos sin controlar` = 1534 (igual), `recepciones sin controlar` = 97 contra 75 porque el Excel cuenta solo las que tienen OC **numérica** (75), y `días de atraso` = 7,80 contra 9,04 porque el Excel promedia también las no controladas con `hoy - ingreso` (que envejece solo).
  - **Columna "N° OC"**: cada OC es un link a `/compras/pedidos-compra?numero=N` (el detalle del pedido de compra: cabecera + artículos + totales). Varias OC pueden venir en una celda (`"15183/15347/15329"`), así que se parte por `/` y cada una es su propio link.
    - Solo se linkea si el número existe en `public.pedidos_compra`. De las **480 OC distintas** del Excel, **234 linkean**; las otras 246 no, y no es un bug: la copia sincronizada tiene 601 pedidos y arranca en 2025-01-13 (la vista `VISTAS_CONSOLIDADAS.dbo.PEDIDO_COMPRA` filtra `WHERE FFCH >= '20250101'`), mientras el Excel entra en 2024-08. Se verificó que las OC huérfanas **no existen** en `DRAGONFISH_INDOD.ZooLogic.PEDCOMPRA` ni en ninguna otra base `DRAGONFISH_*` del ERP — hay que poner "Pedido N° X" (nunca "Cargado en Dragon"). 89 caen en 2024 (fuera de la cobertura del sync) y 157 están dentro del rango pero sin pedido.
    - Las OC no linkeables se muestran como texto normal con tooltip explicativo, y las no numéricas (8) tal cual.
    - El deep-link vive en `src/pages/PedidosCompra.tsx`: lee `?numero=` **sin escribirlo** (es una pantalla de dos panes, así que siempre queda la lista al lado; escribir el URL en cada selección es la forma fácil de armar un ciclo con el efecto que lo lee). Si no encuentra el pedido avisa, y si el número está repetido (24 números repetidos en la base; solo 3 OC caen ahí: 11, 10713, 11901) abre el más reciente y lo dice.
    - La lista de números se pide una vez por sesión desde `src/lib/ocPedidosCompra.ts` (`select('numero')`, 601 filas). Si la consulta falla, casi siempre es que falta `pedidos_compra.view` — que es lo que exige la RLS de la tabla y el `PermissionRoute` de la ruta — y ahí la columna queda sin links, que es lo correcto.
    - Diagnóstico: `node scripts/supabase-sql.mjs qwlugajzxrrwckrqlrjp sql/check-oc-pedidos.sql --raw`.

## Dependencias extra instaladas
`konva@9`, `react-konva@18` (React 18), `webfontloader`, `jspdf`, `@types/webfontloader`. (`xlsx`, `recharts` ya estaban).

## Notas de estado
- Transferencias: se arregló la carga por lote (no corta a 1000). El backend envía mails a los 16 locales (pagina la lectura de ítems). Existe botón "Reenviar (N)" para los que fallaron.
- Empleados: importación del "Listado - MITO" cargada (1726 registros). RLS de edición habilitada.
- Recepción INDO: módulo terminado y andando (SQL aplicado, Excel importado con 1.605 filas, smoke test en verde). Falta el deploy para que se vea la columna "N° OC" linkeable.
- El archivo `260922 - W50OFF-XG GPAZ.xlsx` y `PROVEEDORES PACHO.xlsx` están en la raíz (pruebas).