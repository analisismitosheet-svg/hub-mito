# Picking (`/deposito/picking`)

Pantalla `src/pages/Picking.tsx`. Permiso `picking.view`. Se abre directo con `?oc=<numero>&prov=<proveedor>` (botón verde "Picking" en [[Recepción INDO]]).

## Cómo funciona
- Se elige proveedor + pedido de compra (de `pedidos_compra`). Cada carga es un **picking registrado** (#1, #2…), no una edición del total.
- Tabla del pedido: Artículo, Descripción, Color, Talle, **Pedido** ("de X · Y cancel."), **Recibido**, **Saldo**, **Picking (#N)** (lo que se cuenta ahora, borrador), ✓. Botón "Registrar picking #N". Chips de historial con detalle y "Anular este picking".
- `cantidad` a recibir = pedido − cancelado. Cancelaciones cruzadas con `picking_cancelaciones`.
- Colores: llegó de más → **verde flúor** (`bg-lime-400/20`, "150 +6"); rojo solo si está cancelado; totalmente cancelado → rojo.
- Modo por artículo: busca por código **o descripción** (`picking_articulo`), subtotal, marca por total o desplegable color/talle; "Registrar" reparte un picking por pedido, completando primero el más viejo.
- Excel de ingresos: un picking por pedido con `p_origen = 'excel'`.

## Base (`sql/picking_entregas.sql`, `picking_cancelaciones.sql`, `picking_articulo_descripcion.sql`, `picking_compra.sql`)
- `picking_compra` (codigo, articulo, color, talle, recibido) = total recibido (suma de pickings no anulados). Lo usan Estado de pedidos y el avance.
- `picking_entregas` (codigo, nro, origen picking|excel|inicial, anulado_at) + `picking_entregas_items`. RLS solo select con `picking.view`.
- RPC: `picking_items`, `registrar_picking(p_codigo, p_items jsonb, p_origen)` (lock por pedido, suma a recibido), `anular_picking(p_entrega)` (resta), `picking_entregas_de(p_codigo)`, `picking_cancelaciones(p_codigos text[])`, `picking_articulo`.
- Lo marcado antes del cambio quedó como Picking #1 `inicial` (396 pedidos).

Ver también [[Pedidos compra, venta y cancelaciones]].
