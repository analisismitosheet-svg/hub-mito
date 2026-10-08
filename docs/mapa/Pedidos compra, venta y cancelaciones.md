# Pedidos de compra, venta y cancelaciones

Todo es copia de Dragonfish sincronizada por el puente ([[Puente SQL y syncs]]). El hub no escribe en el ERP.

## Compra
- `PedidosHub.tsx` (`/compras/pedidos`), `PedidosCompra.tsx` (`?numero=` deep-link, lista + detalle), `EstadoPedidos.tsx` (avance con `picking_compra`).
- Tablas `pedidos_compra` + items. Permiso `pedidos_compra.view`. Origen: `VISTAS_CONSOLIDADAS.dbo.PEDIDO_COMPRA` (desde 2025-01-01).

## Cancelaciones
- `Cancelaciones.tsx`. Tablas `cancelaciones`, `cancelaciones_items` (por `codigo_pedido`). Se cruzan con la OC en [[Picking]] (`picking_cancelaciones`); lo cancelado resta de lo a recibir y sugiere OC nueva.

## Venta (`/mayorista/pedidos-venta`)
- `PedidosVenta.tsx`. Tablas `pedidos_venta` + items, con **motivo** (de `vw_comprobantes_PEDIDO_VENTA`, `sql/pedidos_venta_motivo.sql`): la lista se separa por motivo.
- Buscador también por artículo código/descripción: RPC `pedidos_venta_por_articulo` (devuelve `text[]` por el límite de 1000, `sql/pedidos_venta_buscar_articulo.sql`).
- Columna Stock por SKU (`src/lib/stockSku.ts`, ver [[Artículos y F12]]). Descripciones con `descripcionesMaestro`.
- Pedir armado → [[Armado de pedidos]]. Permiso `pedidos_venta.view`.
- **Pedidos VTD (venta diaria) = repo diaria**: `repos_de_pedidos_vtd(p_desde)` (`sql/repos_de_pedidos_vtd.sql`) cruza cada pedido VTD con la repo de la misma fecha que tiene ese local (cliente = local; 100 % de cruce). PedidosVenta lo muestra como un armado virtual (`Armado.repo = true`): «REPO EN CURSO x/y» / «REPO ✓» en verde y «Repo terminada por NOMBRE (#legajo)». Si además pidieron un armado real, manda el armado.
- **Cierre por única vez (08/10/2026)**: los VTD sin repo en el hub (anteriores a cargar repos) están en `pedidos_vtd_cerrados` y salen como «🏁 Repo terminada». La pantalla pide `repos_de_pedidos_vtd` de a 1000 (`.order('codigo').range`).
