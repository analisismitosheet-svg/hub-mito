# Franquicias

Área Mayorista. Permiso `mayorista.franquicias.view` (rol `mayorista`, ver [[Permisos y usuarios]]). Tres solapas (`src/components/FranquiciasTabs.tsx`); lógica común en `src/lib/franquicias.ts`.

## Solapas
- **Propuestas de reposición** — `/mayorista/franquicias`, `MayoristaFranquicias.tsx`.
  - Se elige el **cliente** (solo los que tienen base asignada; por defecto `01140`). La base y la sucursal de stock salen de *Clientes y bases* (antes estaba fijo CF Ushuaia en el código).
  - Ventas de `VISTAS_CONSOLIDADAS.dbo.venta_franquicias` filtradas por `BASE_DATOS` = base del cliente; stock del cliente de `vw_STOCK_SUCURSALES_REAL` por `BD_ORIGEN` = sucursal de la base; stock MITO de `vw_STOCK_SKU_MITO`. Detalle de fuentes en [[Puente SQL y syncs]].
  - Sugerido = máx(0, mín(vendido − stock cliente, stock MITO)). La columna **Estado** (Urgente/Normal) va al lado del artículo.
- **Pedido de venta de calzado** — `/mayorista/franquicias/calzado`, `MayoristaFranquiciasCalzado.tsx`.
  - Pedido por **curva de talles**: un modelo por artículo + color con el stock de cada talle (`vw_STOCK_SKU_MITO`), precio de `vw_ARTICULOS_MITO`. Solo materiales que `DWH.dbo.vw_DIM_MATERIAL` llama CALZADO (en `articulos`: `1` y `CALZADO`).
  - Pestañas talle simple (40) / doble (38/39, chanclas y slippers). Filtros por grupo, **temporada** (`articulos.id_temporada`: 0 sin temporada, 1 verano, 2 continuo, 3 invierno, 4 atemporal) y texto.
  - Mismo circuito que la reposición: se manda el link y el cliente confirma. La propuesta queda con `tipo = 'calzado'`.
- **Clientes y bases** — `/mayorista/franquicias/clientes`, `MayoristaFranquiciasClientes.tsx`.
  - Cada cliente activo de `clientes` apunta a una base de Dragon. Tablas `franquicias_bases` (base, sucursal = `BD_ORIGEN`, nombre, activa) y `franquicias_clientes` (cliente_id → base). RPC `franquicias_bases_mapa()` y `franquicias_asignar_base(p_cliente, p_base)` (base vacía = sacar la asignación). SQL: `sql/franquicias_clientes_bases.sql`, `sql/franquicias_asignar_base_permiso.sql`.
  - Código de cliente: en `clientes` va sin ceros (`1140`), Dragon y la asignación lo usan con 5 dígitos (`01140`, `claveCliente`). Clave de franquicia = base sin `DRAGONFISH_` (`CFU`).

## Propuestas y link público
- Tablas `franquicias_propuestas` (estado `borrador` → `enviada` → `confirmada` → `en_dragon`, o `anulada`; vence a los 7 días), `franquicias_propuesta_items`, `franquicias_contactos`. SQL: `sql/franquicias_propuestas.sql`.
- Multi-cliente (`sql/franquicias_multicliente.sql`, 21/10/2026): la propuesta guarda `cliente_id`, `cliente_nombre` (destino del pedido en Dragon) y `tipo` (`reposicion` / `calzado`).
- Link sin usuario `/p/:token` (`PropuestaFranquicia.tsx`): RPC `propuesta_franquicia_publica` y `confirmar_propuesta_franquicia`.

## Alta en Dragon
- `puente-sql/scripts/sync-franquicias-dragon.js` (tarea "MITO - Pedidos franquicias", cada 1 min): toma las confirmadas con `franquicias_tomar_para_dragon` y crea el pedido de venta en `DRAGONFISH_MITO` por la API REST (solo altas).
- Cliente = el `cliente_id` de la propuesta (si es vieja y no lo trae, el fijo de la franquicia). Lista siempre `LISTA2`. Observación: "cliente (nombre) - Propuesta|Pedido de calzado N - comentario". Hasta 5 reintentos.
