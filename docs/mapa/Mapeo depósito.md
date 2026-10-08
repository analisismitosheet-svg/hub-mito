# Mapeo depósito (`/mayorista/mapeo`)

- Pantallas `MapeoEscanear.tsx`, `MapeoOrden.tsx`, `MapeoUbicaciones.tsx`. Tabla `mapeo_deposito` (artículo + ubicación, sin color/talle).
- `MapeoOrden.tsx`: chip de stock total del artículo (`src/lib/stockArticulos.ts` → `vw_STOCK_ARTICULO_MITO`). Verde con unidades, rojo 0, "—" sin dato.
- **No se borra nada automáticamente por stock 0** (se sacó: el stock fallaba y borraba). Los de stock 0 se ocultan y aparecen con la tilde **«Ver sin stock»**. Se restauraron 38 códigos borrados (sin ubicación).
- Borrar a mano: `veBorrar = isAdmin || can('mayorista.mapeo.borrar')`. Ese permiso lo tiene solo puesto3indo@gmail.com (individual) además del admin.
- Permisos `mayorista.mapeo.view` / `.escanear` / `.borrar`. Ver [[Permisos y usuarios]].
