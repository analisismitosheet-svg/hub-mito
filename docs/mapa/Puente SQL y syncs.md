# Puente SQL y syncs

**Regla de oro: el SQL Server es SOLO LECTURA. Nunca INSERT/UPDATE/DELETE/DROP ahí.** ("Borrar del hub" = ocultar en el hub.)

## Servidores
- **ZOOLOGIC** (principal / DWH, auth SQL): `DRAGONFISH_*`, `DWH` (`vw_DIM_ARTICULO`).
- **DESKTOP-OA4GU6I** (local, auth Windows): `VISTAS_CONSOLIDADAS` (`vw_ARTICULOS_MITO`, `vw_STOCK_*`, `vw_comprobantes_PEDIDO_VENTA`, `vw_comprobantes_DEVOLUCION`, `vw_ventas_TICKET`, `PEDIDO_COMPRA`…). El hub la pide con alias: `DESKTOP-OA4GU6I:VISTAS_CONSOLIDADAS.dbo.vista`.
- Servidor vinculado `MITO` = `192.168.0.222\ZOOLOGIC` (nombre de 4 partes `MITO.DRAGONFISH_MITO.ZooLogic.X`).
- **Comprobantes DEVOLUCION** — `DESKTOP-OA4GU6I:VISTAS_CONSOLIDADAS.dbo.vw_comprobantes_DEVOLUCION` (`sql/sqlserver/vw_comprobantes_DEVOLUCION.sql`, se aplica con `--alias DESKTOP-OA4GU6I`): comprobantes con `DESCFW` que arranca con `DEVOLUCION`, **por ahora solo de `DRAGONFISH_MITO`** (servidor vinculado `[MITO]`, 3 partes dentro del `OPENQUERY`). Mismas 47 columnas que `vw_comprobantes_PEDIDO_VENTA`. Antes juntaba 5 bases (CFU, INDOD, MITO, NVOCED2, VCPD) sin `OPENQUERY`: el filtro y el join corrían en esta PC y bajaban las `COMPROBANTEV`/`COMPROBANTEVDET` enteras por red (la consulta completa daba timeout); ahora se resuelve en MITO con `OPENQUERY`. Se sacaron `DRAGONFISH_INDOD` y `DRAGONFISH_FALLASD` (no tenían devoluciones útiles). Respaldo: `vw_comprobantes_DEVOLUCION_original.sql`. **Ojo:** no es la fuente de RMA (RMA es otra área: nada de MITO ahí); RMA usará otra vista.
- **Ventas del contador** — `DESKTOP-OA4GU6I:VISTAS_CONSOLIDADAS.dbo.vw_ventas_TICKET` (`sql/sqlserver/vw_ventas_TICKET.sql`, se aplica con `--alias DESKTOP-OA4GU6I`): tickets por local y día de `DRAGONFISH_MUNOZ`, `DRAGONFISH_VCPD`, `DRAGONFISH_NVOCED2` y `DRAGONFISH_9DEJUL2` (locales `MUNOZ`, `VCPD`, `NVOCED`, `9DEJULIO`). Sale de `COMPROBANTEV` (cabecera; **no** se une `COMPROBANTEVDET`, que multiplica las filas) con `DESCFW LIKE 'TICKET%'` y `ANULADO = 0`: `TICKETS` = cantidad de `TICKETFACTURA` y `TOTAL` = suma de `FTOTAL` (las `TICKETNOTADECREDITO` vienen negativas, así que resta). Ventana de 180 días. Como el resto de las consolidadas, usa `OPENQUERY([MITO], ...)` para que el filtro, la unión y la agrupación corran en el servidor principal y por la red vuelvan solo las ~500 filas agrupadas; si no, esta PC bajaría las `COMPROBANTEV` enteras. Se habilita en `sql_vistas` y la lee el contador por `config_app.contador_vista_ventas` ([[Otros módulos]]).

- **Franquicias** (`/mayorista/franquicias`, `MayoristaFranquicias.tsx`): ventas de `VISTAS_CONSOLIDADAS.dbo.venta_franquicias` (líneas de `DRAGONFISH_CFU`, la armó el usuario; facturas suman, notas de crédito restan; **no trae `ANULADO`**), stock del cliente de `vw_STOCK_SUCURSALES_REAL` (`BD_ORIGEN = 'CAPTAIN FIN USHUAIA'`), stock MITO de `vw_STOCK_SKU_MITO`, material de `DWH.dbo.vw_DIM_MATERIAL` + `articulos` (Supabase). Sugerido = máx(0, mín(vendido − stock cliente, stock MITO)).

## Puente (`puente-sql/`)
- `server.js` en :3128, token `PUENTE_TOKEN` (= `SQL_BRIDGE_TOKEN` en Vercel). Filtro por lista blanca de columnas.
- Publicado con Tailscale Funnel: `https://desktop-oa4gu6i.tail8a2a01.ts.net/sql-bridge`. **No renombrar la PC.** Si desde afuera falla y desde la oficina anda → reaplicar el funnel (ver `CONTEXTO.md`, sección del túnel).
- Se reinicia solo: tarea "MITO - Puente SQL" (`scripts/servicio.ps1`, log `puente-sql/data/servicio.log`).
- Del lado de Vercel entra por `api/sql/[ruta].ts` (vista / `status` / `catalogo`, lógica en `src/lib/sqlVista.ts`, `sqlStatus.ts`, `sqlCatalogo.ts`). Respuesta máx. ~4,5 MB: ver [[Arquitectura]].
- `src/lib/sqlApi.ts`: si el servidor responde 401 (sesión cerrada en Supabase con token local vigente) renueva la sesión y reintenta; si no puede, pide volver a entrar.
- Vistas habilitadas: Configuraciones → Conexión SQL, o fijas en env `SQL_VIEWS` de Vercel (`vw_STOCK_SKU_MITO`, `vw_STOCK_ARTICULO_MITO`).

## Syncs a Supabase (`puente-sql/scripts/`, tareas en `instalar-tarea.ps1`)
| Tarea | Script | Cuándo | Escribe en |
|---|---|---|---|
| MITO - Sync equivalencias | sync-equivalencias.js | diario 07:00 | equivalencias |
| MITO - Sync articulos | sync-articulos.js | diario 07:15 | `articulos` (de `DWH.vw_DIM_ARTICULO`) |
| MITO - Sync pedidos compra | sync-pedidos-compra.js | cada hora | `pedidos_compra` (+items) |
| MITO - Sync pedidos venta | sync-pedidos-venta.js | cada 15 min, últimos 7 días | `pedidos_venta` (+items, motivo) |
| MITO - Sync pedidos venta completo | sync-pedidos-venta.js | diario 06:30 | idem, todo |
| (cancelaciones) | sync-cancelaciones.js | ver instalar-tarea.ps1 | `cancelaciones`, `cancelaciones_items` |

Los scripts leen del SQL Server y hacen upsert en Supabase con la service role (en `puente-sql/.env`).
