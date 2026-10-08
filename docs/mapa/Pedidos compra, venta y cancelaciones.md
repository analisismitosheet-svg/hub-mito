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
