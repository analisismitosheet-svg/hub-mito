# Puente SQL y syncs

**Regla de oro: el SQL Server es SOLO LECTURA. Nunca INSERT/UPDATE/DELETE/DROP ahí.** ("Borrar del hub" = ocultar en el hub.)

## Servidores
- **ZOOLOGIC** (principal / DWH, auth SQL): `DRAGONFISH_*`, `DWH` (`vw_DIM_ARTICULO`).
- **DESKTOP-OA4GU6I** (local, auth Windows): `VISTAS_CONSOLIDADAS` (`vw_ARTICULOS_MITO`, `vw_STOCK_*`, `vw_comprobantes_PEDIDO_VENTA`, `vw_comprobantes_DEVOLUCION`, `vw_ventas_TICKET`, `PEDIDO_COMPRA`…). El hub la pide con alias: `DESKTOP-OA4GU6I:VISTAS_CONSOLIDADAS.dbo.vista`.
- Servidor vinculado `MITO` = `192.168.0.222\ZOOLOGIC` (nombre de 4 partes `MITO.DRAGONFISH_MITO.ZooLogic.X`).
- **Comprobantes DEVOLUCION** — `DESKTOP-OA4GU6I:VISTAS_CONSOLIDADAS.dbo.vw_comprobantes_DEVOLUCION` (`sql/sqlserver/vw_comprobantes_DEVOLUCION.sql`, se aplica con `--alias DESKTOP-OA4GU6I`): comprobantes con `DESCFW` que arranca con `DEVOLUCION`, **por ahora solo de `DRAGONFISH_MITO`** (servidor vinculado `[MITO]`, 3 partes dentro del `OPENQUERY`). Mismas 47 columnas que `vw_comprobantes_PEDIDO_VENTA`. Antes juntaba 5 bases (CFU, INDOD, MITO, NVOCED2, VCPD) sin `OPENQUERY`: el filtro y el join corrían en esta PC y bajaban las `COMPROBANTEV`/`COMPROBANTEVDET` enteras por red (la consulta completa daba timeout); ahora se resuelve en MITO con `OPENQUERY`. Se sacaron `DRAGONFISH_INDOD` y `DRAGONFISH_FALLASD` (no tenían devoluciones útiles). Respaldo: `vw_comprobantes_DEVOLUCION_original.sql`. **Ojo:** no es la fuente de RMA (RMA es otra área: nada de MITO ahí); RMA usará otra vista.
- **Ventas del contador** — `DESKTOP-OA4GU6I:VISTAS_CONSOLIDADAS.dbo.vw_ventas_TICKET` (`sql/sqlserver/vw_ventas_TICKET.sql`, se aplica con `--alias DESKTOP-OA4GU6I`; respaldo de la versión anterior en `vw_ventas_TICKET_original.sql`): venta por local, día y hora de las bases DRAGONFISH_* **replicadas en esta PC** (MUNOZ, VCPD, NVOCED2→`NVOCED`, 9DEJUL2→`9DEJULIO`, ESPINOD, RIVERAD; Ruta 9 todavía por `OPENQUERY([MITO])`). Sale de `COMPROBANTEV` (cabecera; **no** se une `COMPROBANTEVDET`, que multiplica las filas). **Criterio desde 02/11/2026 = el de Objetivos** (`ventas_locales_dia`): `TICKET%` + `FACTURAELECTRONICA%` + `NOTADECREDITOELECTRONICA%`, `ANULADO = 0`, sin remitos, en 9 de Julio sin el punto de venta 39 (WEB); `TICKETS` = `TICKETFACTURA` + `FACTURAELECTRONICA`; `TOTAL` = suma de `FTOTAL × SIGNOMOV`. **Ojo: las notas de crédito (también `TICKETNOTADECREDITO`) vienen con `FTOTAL` positivo y `SIGNOMOV = -1`**: sumar `FTOTAL` a secas las suma en vez de restarlas (era el error hasta el 02/11: Espinosa 31/10 daba $ 9.775.823 en Tasa de conversión contra $ 10.284.317,85 en Objetivos = +$ 207.796 de 2 NC sumadas y −$ 924.087 de 3 facturas A que no entraban). Ventana de 180 días. Las dos pantallas pueden diferir todavía por **réplica**: Objetivos lee el servidor principal y la vista las bases de esta PC; si un día no coincide, comparar la cantidad de comprobantes en los dos servidores (el 02/11 pasaba con Muñoz 31/10: 57 en el principal, 49 acá). Se habilita en `sql_vistas` y la lee el contador por `config_app.contador_vista_ventas` ([[Otros módulos]]).

- **Franquicias** (`/mayorista/franquicias`, `MayoristaFranquicias.tsx`): ventas de `VISTAS_CONSOLIDADAS.dbo.venta_franquicias` (líneas de `DRAGONFISH_CFU`, la armó el usuario; facturas suman, notas de crédito restan; **no trae `ANULADO`**), stock del cliente de `vw_STOCK_SUCURSALES_REAL` (`BD_ORIGEN = 'CAPTAIN FIN USHUAIA'`), stock MITO de `vw_STOCK_SKU_MITO`, material de `DWH.dbo.vw_DIM_MATERIAL` + `articulos` (Supabase). Sugerido = máx(0, mín(vendido − stock cliente, stock MITO)).

## Puente (`puente-sql/`)
- `server.js` en :3128, token `PUENTE_TOKEN` (= `SQL_BRIDGE_TOKEN` en Vercel). Filtro por lista blanca de columnas.
- Publicado con Tailscale Funnel: `https://desktop-oa4gu6i.tail8a2a01.ts.net/sql-bridge`. **No renombrar la PC.** Si desde afuera falla y desde la oficina anda → reaplicar el funnel (ver `CONTEXTO.md`, sección del túnel).
- Se reinicia solo: tarea "MITO - Puente SQL" (`scripts/servicio.ps1`, log `puente-sql/data/servicio.log`).
- Del lado de Vercel entra por `api/sql/[ruta].ts` (vista / `status` / `catalogo` / `stock-valorizado`, lógica en `src/lib/sqlVista.ts`, `sqlStatus.ts`, `sqlCatalogo.ts`, `stockValorizadoApi.ts`). Respuesta máx. ~4,5 MB: ver [[Arquitectura]].
- `src/lib/sqlApi.ts`: si el servidor responde 401 (sesión cerrada en Supabase con token local vigente) renueva la sesión y reintenta; si no puede, pide volver a entrar.
- Vistas habilitadas: Configuraciones → Conexión SQL, o fijas en env `SQL_VIEWS` de Vercel (`vw_STOCK_SKU_MITO`, `vw_STOCK_ARTICULO_MITO`).
- **Acciones propias** (no son vistas): `replicas` (Sistemas → Réplicas), `sync_pedidos_compra` / `sync_pedidos_venta`, `servidores` / `bases` / `objetos` (explorador) y `stock_valorizado` (`sql/stock-valorizado.sql`, cache 10 min → [[Stock valorizado]]), `items_pedido_venta` (renglones de un pedido de venta viejo, por el servidor local → [[Pedidos compra, venta y cancelaciones]]). Al tocar `server.js` hay que reiniciar el puente: la tarea lo relevanta cuando el 3128 queda libre.

## Syncs a Supabase (`puente-sql/scripts/`, tareas en `instalar-tarea.ps1`)
| Tarea | Script | Cuándo | Escribe en |
|---|---|---|---|
| MITO - Sync equivalencias | sync-equivalencias.js | diario 07:00 | equivalencias |
| MITO - Sync articulos | sync-articulos.js | diario 07:15 | `articulos` (de `DWH.vw_DIM_ARTICULO`) |
| MITO - Sync pedidos compra | sync-pedidos-compra.js | cada hora | `pedidos_compra` (+items) |
| MITO - Sync pedidos venta | sync-pedidos-venta.js | cada 15 min, últimos 7 días | `pedidos_venta` (+items, motivo); al final `sync-cancelaciones-venta.js` → `cancelaciones_venta` (+items) (2 días; 120 con `--todo`) y `sync-estado-pedidos.js` → `estado_pedidos` (+items, solo los que cambiaron) |
| MITO - Sync pedidos venta completo | sync-pedidos-venta.js | diario 06:30 | idem, todo |
| MITO - Sync Tiendanube | sync-tiendanube.js | cada 20 min, modificados desde la última corrida | `tn_pedidos` (+items) desde la API de Tiendanube, ver [[Ventas web (Tiendanube)]] |
| (cancelaciones) | sync-cancelaciones.js | ver instalar-tarea.ps1 | `cancelaciones`, `cancelaciones_items` |

Los scripts leen del SQL Server y hacen upsert en Supabase con la service role (en `puente-sql/.env`).
