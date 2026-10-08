# Recepción INDO (`/deposito/recepcion-indo`)

- `src/pages/RecepcionIndo.tsx` + `src/lib/recepcionIndo.ts` + `src/lib/proveedoresIndo.ts` + `src/lib/ocPedidosCompra.ts`.
- Tabla `recepcion_indo` (+ `recepcion_indo_proveedores`), SQL `sql/recepcion_indo.sql`. RPC `recepcion_indo_importar` (merge que no pisa el control cargado a mano). `dias_atraso` es GENERATED.
- Import del Excel "Recepción de Mercadería"; reimportar actualiza en el lugar (clave natural `claveRecepcion`).
- Nuevo registro manual: **sin campos obligatorios**.
- Columna "N° OC": cada OC (se parte por `/`) linkea a `/compras/pedidos-compra?numero=N` si existe en `pedidos_compra`; las que no existen van como texto.
- Botón verde **Picking** por OC existente → `/deposito/picking?oc=..&prov=..` (visible con `isAdmin || can('picking.view')`). Ver [[Picking]].
- Permiso: `deposito.view`.
- **Orden de la tabla**: primero «Listo para controlar», después «En depósito», después el resto (por fecha de ingreso). Lo hace `recepcion_indo_filas` con `private.recepcion_indo_orden_estado`.
- **Buscador de N° OC** (`src/components/SelectorOc.tsx`, el lápiz de la columna y «Nuevo registro»): RPC `buscar_oc(p_texto)` (`sql/buscar_oc.sql`, índices trigram). Cada palabra tiene que coincidir con N°, proveedor o artículo (código o descripción); orden N° exacto > empieza igual > proveedor > artículo; primero las del proveedor de la recepción. Estado Pendiente / Parcial % / Completa con `pedidos_compra_oc_avance()`. ↑ ↓ + Enter tilda; pegar «15183/15347» tilda todas.
