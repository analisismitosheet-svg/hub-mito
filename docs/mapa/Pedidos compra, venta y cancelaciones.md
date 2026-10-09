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
- **Período**: Hoy / semana / anterior / 4 semanas / todas; «Hoy» es una opción más del período (no se combina con las semanas). Si el motivo guardado no tiene pedidos en el período, se ven todos (`motivoActivo`).
- Lista: el cliente arriba y más grande, el N° de pedido abajo; se ve qué empleado aceptó el armado o hizo la repo, y en amarillo a quién le toca si todavía no empezó.
- **Pedidos VTD (venta diaria) = repo diaria**: `repos_de_pedidos_vtd(p_desde)` (`sql/repos_de_pedidos_vtd.sql`) cruza cada pedido VTD con la repo de la misma fecha que tiene ese local (cliente = local; 100 % de cruce). PedidosVenta lo muestra como un armado virtual (`Armado.repo = true`): «REPO EN CURSO x/y» / «REPO ✓» en verde y «Repo terminada por NOMBRE (#legajo)». Si además pidieron un armado real, manda el armado.
- **Cierre por única vez (08/10/2026)**: los VTD sin repo en el hub (anteriores a cargar repos) están en `pedidos_vtd_cerrados` y salen como «🏁 Repo terminada». La pantalla pide `repos_de_pedidos_vtd` de a 1000 (`.order('codigo').range`).
- **Detalle pintado por renglón**: `estado_lineas_pedido(p_codigo)` (`sql/estado_lineas_pedido.sql`) da por línea `enviadas` y `estado` (armado → `mayorista_armados_items`; VTD → repo del día por artículo+color+talle; cerrados → todo hecho). Verde = hecho (✓), verde suave = parcial (x/), rojo = faltante.
- **Tabla `pedidos_venta_estado`** (`sql/pedidos_venta_estado.sql`): una fila por pedido con armado/repo/cerrado → estado, legajo/nombre (quién lo tomó o a quién le toca) y avance. La mantienen triggers (armados, ítems de armados, `mayorista_items`, responsables, `pedidos_venta`, `pedidos_vtd_cerrados`) con `private.pve_recalcular(codigo)`. PedidosVenta solo lee esta tabla filtrada por la fecha del período (~100 ms). `repos_de_pedidos_vtd` quedó sin uso en la pantalla.
- **Pedidos completos** (`sql/pedidos_completos.sql`): si un pedido está completo (todo en verde: `pedidos_venta_estado.estado = 'hecho'` y sin faltantes) `pedir_armado` lo saltea; solo el admin lo puede volver a pedir. En pantalla el botón dice «Completo ✓». `pedidos_vtd_cerrados` ahora vale para cualquier motivo y manda antes que la repo. Cierre por única vez (09/10/2026): VTD y REP hasta el 08/10 → todos en verde (4.164 REP + 2.156 VTD).
