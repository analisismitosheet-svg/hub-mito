# Puente SQL y syncs

**Regla de oro: el SQL Server es SOLO LECTURA. Nunca INSERT/UPDATE/DELETE/DROP ahí.** ("Borrar del hub" = ocultar en el hub.)

## Servidores
- **ZOOLOGIC** (principal / DWH, auth SQL): `DRAGONFISH_*`, `DWH` (`vw_DIM_ARTICULO`).
- **DESKTOP-OA4GU6I** (local, auth Windows): `VISTAS_CONSOLIDADAS` (`vw_ARTICULOS_MITO`, `vw_STOCK_*`, `vw_comprobantes_PEDIDO_VENTA`, `PEDIDO_COMPRA`…). El hub la pide con alias: `DESKTOP-OA4GU6I:VISTAS_CONSOLIDADAS.dbo.vista`.
- Servidor vinculado `MITO` = `192.168.0.222\ZOOLOGIC` (nombre de 4 partes `MITO.DRAGONFISH_MITO.ZooLogic.X`).

## Puente (`puente-sql/`)
- `server.js` en :3128, token `PUENTE_TOKEN` (= `SQL_BRIDGE_TOKEN` en Vercel). Filtro por lista blanca de columnas.
- Publicado con Tailscale Funnel: `https://desktop-oa4gu6i.tail8a2a01.ts.net/sql-bridge`. **No renombrar la PC.** Si desde afuera falla y desde la oficina anda → reaplicar el funnel (ver `CONTEXTO.md`, sección del túnel).
- Se reinicia solo: tarea "MITO - Puente SQL" (`scripts/servicio.ps1`, log `puente-sql/data/servicio.log`).
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
