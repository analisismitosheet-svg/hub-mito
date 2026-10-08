# Recepción INDO (`/deposito/recepcion-indo`)

- `src/pages/RecepcionIndo.tsx` + `src/lib/recepcionIndo.ts` + `src/lib/proveedoresIndo.ts` + `src/lib/ocPedidosCompra.ts`.
- Tabla `recepcion_indo` (+ `recepcion_indo_proveedores`), SQL `sql/recepcion_indo.sql`. RPC `recepcion_indo_importar` (merge que no pisa el control cargado a mano). `dias_atraso` es GENERATED.
- Import del Excel "Recepción de Mercadería"; reimportar actualiza en el lugar (clave natural `claveRecepcion`).
- Nuevo registro manual: **sin campos obligatorios**.
- Columna "N° OC": cada OC (se parte por `/`) linkea a `/compras/pedidos-compra?numero=N` si existe en `pedidos_compra`; las que no existen van como texto.
- Botón verde **Picking** por OC existente → `/deposito/picking?oc=..&prov=..` (visible con `isAdmin || can('picking.view')`). Ver [[Picking]].
- Permiso: `deposito.view`.
