# Picking (`/deposito/picking`)

Pantalla `src/pages/Picking.tsx`. Permiso `picking.view`. Se abre directo con `?oc=<numero>&prov=<proveedor>` (botón verde "Picking" en [[Recepción INDO]]).

## Cómo funciona
- Se elige proveedor + pedido de compra (de `pedidos_compra`). Cada carga es un **picking registrado** (#1, #2…), no una edición del total.
- Tabla del pedido: Artículo, Descripción, Color, Talle, **Pedido** ("de X · Y cancel."), **Recibido**, **Saldo**, **Picking (#N)** (lo que se cuenta ahora, borrador), ✓. Botón "Registrar picking #N". Chips de historial con detalle y "Anular este picking".
- `cantidad` a recibir = pedido − cancelado. Cancelaciones cruzadas con `picking_cancelaciones`.
- Colores: llegó de más → **verde flúor** (`bg-lime-400/20`, "150 +6"); rojo solo si está cancelado; totalmente cancelado → rojo.
- Modo por artículo: busca por código **o descripción** (`picking_articulo`), subtotal, marca por total o desplegable color/talle; "Registrar" reparte un picking por pedido, completando primero el más viejo.
- Excel de ingresos: un picking por pedido con `p_origen = 'excel'`. Desde el 13/11/2026 el botón lo ve **solo el admin** (queda afuera de la regla de la factura).
- **Factura obligatoria** (13/11/2026, `sql/picking_factura.sql`): todo picking va contra una factura de [[Recepción INDO]] que tenga N° de factura y traiga esa OC en «N° OC». Selector «Factura del picking» arriba de la tabla (`?rec=<clave>` la preelige). **Una factura = un solo picking vivo por OC** (índice único `picking_entregas_factura_pedido_uq`); para rehacerlo hay que anularlo. En modo por artículo se elige la factura, se reparte solo entre sus OC y se **suma** al picking de esa factura (`p_sumar`). Al registrar, la factura pasa a estado «LISTO PARA CONTROLAR»; al anular su último picking vuelve a «En deposito».

## Base (`sql/picking_entregas.sql`, `picking_cancelaciones.sql`, `picking_articulo_descripcion.sql`, `picking_compra.sql`)
- `picking_compra` (codigo, articulo, color, talle, recibido) = total recibido (suma de pickings no anulados). Lo usan Estado de pedidos y el avance.
- `picking_entregas` (codigo, nro, origen picking|excel|inicial, anulado_at) + `picking_entregas_items`. RLS solo select con `picking.view`.
- `picking_entregas` suma `recepcion_clave`, `factura_clave` (proveedor|factura compactos) y `n_factura`.
- RPC: `picking_items`, `registrar_picking(p_codigo, p_items jsonb, p_origen, p_recepcion, p_sumar)`, `picking_facturas(p_numero)` (lock por pedido, suma a recibido), `anular_picking(p_entrega)` (resta), `picking_entregas_de(p_codigo)`, `picking_cancelaciones(p_codigos text[])`, `picking_articulo`.
- Lo marcado antes del cambio quedó como Picking #1 `inicial` (396 pedidos).

Ver también [[Pedidos compra, venta y cancelaciones]].
