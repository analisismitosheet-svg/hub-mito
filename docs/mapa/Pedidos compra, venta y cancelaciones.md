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
- **Solo 120 días de renglones en Supabase** (`sql/pedidos_venta_items_ventana.sql`, 28/10/2026, para bajar la base del hub de 366 a 202 MB): `pedidos_venta_items` guarda los pedidos con fecha ≥ `private.pedidos_venta_items_limite()` (hoy − 120) o con armado activo; el sync descarta los viejos y la copia completa diaria purga. Las cabeceras siguen todas y `pedidos_venta.unidades` (lo llena el sync) alimenta `estadistica_vtd` / `avance_vtd_rep`. El detalle de un pedido viejo se lee en vivo de Dragonfish: `PedidosVenta.tsx` → `/api/sql/pedido-venta-items` (`src/lib/pedidoVentaItemsApi.ts`) → acción `items_pedido_venta` del puente. La búsqueda por artículo y el estado por línea solo cubren la ventana.
- Columna Stock por SKU (`src/lib/stockSku.ts`, ver [[Artículos y F12]]). Descripciones con `descripcionesMaestro`.
- Pedir armado → [[Armado de pedidos]]. Permiso `pedidos_venta.view`.
- **Período**: Hoy / semana / anterior / 4 semanas / todas; «Hoy» es una opción más del período (no se combina con las semanas). Si el motivo guardado no tiene pedidos en el período, se ven todos (`motivoActivo`).
- Lista: el cliente arriba y más grande, el N° de pedido abajo; se ve qué empleado aceptó el armado o hizo la repo, y en amarillo a quién le toca si todavía no empezó.
- **Pedidos VTD (venta diaria) = repo diaria**: `repos_de_pedidos_vtd(p_desde)` (`sql/repos_de_pedidos_vtd.sql`) cruza cada pedido VTD con la repo de la misma fecha que tiene ese local (cliente = local; 100 % de cruce). PedidosVenta lo muestra como un armado virtual (`Armado.repo = true`): «REPO EN CURSO x/y» / «REPO ✓» en verde y «Repo terminada por NOMBRE (#legajo)». Si además pidieron un armado real, manda el armado.
- **Cierre por única vez (08/10/2026)**: los VTD sin repo en el hub (anteriores a cargar repos) están en `pedidos_vtd_cerrados` y salen como «🏁 Repo terminada». La pantalla pide `repos_de_pedidos_vtd` de a 1000 (`.order('codigo').range`).
- **Detalle pintado por renglón**: `estado_lineas_pedido(p_codigo)` (`sql/estado_lineas_pedido.sql`) da por línea `enviadas` y `estado` (armado → `mayorista_armados_items`; VTD → repo del día por artículo+color+talle; cerrados → todo hecho). Verde = hecho (✓), verde suave = parcial (x/), rojo = faltante.
- **Tabla `pedidos_venta_estado`** (`sql/pedidos_venta_estado.sql`): una fila por pedido con armado/repo/cerrado → estado, legajo/nombre (quién lo tomó o a quién le toca) y avance. La mantienen triggers (armados, ítems de armados, `mayorista_items`, responsables, `pedidos_venta`, `pedidos_vtd_cerrados`) con `private.pve_recalcular(codigo)`. PedidosVenta solo lee esta tabla filtrada por la fecha del período (~100 ms). `repos_de_pedidos_vtd` quedó sin uso en la pantalla.
- **Pedidos completos** (`sql/pedidos_completos.sql`): si un pedido está completo (todo en verde: `pedidos_venta_estado.estado = 'hecho'` y sin faltantes) `pedir_armado` lo saltea; solo el admin lo puede volver a pedir. En pantalla el botón dice «Completo ✓». `pedidos_vtd_cerrados` ahora vale para cualquier motivo y manda antes que la repo. Cierre por única vez (09/10/2026): VTD y REP hasta el 08/10 → todos en verde (4.164 REP + 2.156 VTD).
- **Faltantes**: el detalle de un pedido terminado muestra la caja roja «Faltantes de stock: N u. — las líneas se cerraron solas» y cada línea `faltante` el chip **✕ Faltan N**. `?abrir=CODIGO` abre un pedido directo (lo usa la campana).
- **El admin da por «encontrada» una línea roja** (`sql/pedidos_venta_lineas_ok.sql`, 21/10/2026): en el detalle, cada línea `faltante` tiene el botón «Encontrado» (solo admin, validado en la base por `marcar_linea_pedido`). Pasa a verde con ✓ ámbar y «Deshacer». La marca vive en `pedidos_venta_lineas_ok` (quién, cuándo y las unidades) y la aplica `estado_lineas_pedido` con la columna `corregida`. **No toca `mayorista_items`, `mayorista_armados_items` ni `pedidos_venta_estado`**, que son las que alimentan [[Repos Mayorista y Mi repo]] y Eficiencia: el rendimiento del piso no cambia. En Eficiencia sale aparte, columna «Revisado admin» (`revisado_admin_por_local`).
- Si un legajo **soltó** el armado, el detalle muestra quién y el motivo ([[Armado de pedidos]]). La pantalla se actualiza por Realtime.
- Sync: `api/pedidos-sync.ts?tipo=compra|venta` (antes eran dos funciones).
