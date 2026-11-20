# Stock mayorista

Área **Mayorista** → **Stock** (`/mayorista/stock`, `MayoristaStock.tsx`, permiso `mayorista.stock.view`, dado al rol `mayorista` con `sql/mayorista_stock_permiso.sql`). Pedido del usuario el 20/11/2026 (maqueta: `mockups/stock-mayorista.html`). Solo lectura. Las dos solapas salen de **DRAGONFISH_MITO**.

## Solapas
- **Depósito**: stock por artículo + color con la curva de talles (`ZooLogic.COMB`, `COCANT > 0`) y lo que está en tránsito (`ENTRANSITO`). Al abrir una fila: detalle por talle y cuánto de ese artículo está en Tapera. Ese día: 97.605 unidades, 1.058 artículo + color.
- **Tapera**: lo **remitido a clientes que todavía no se facturó**. Vistas *Por artículo* (a quién se remitió, con antigüedad) y *Por cliente* (remitos, el más viejo, unidades y plata al precio del remito). Filtro **Cliente** (lo pidió el usuario el mismo día) además de Material y Proveedor, que valen en las dos solapas. Ese día: 52 remitos, 26 clientes, 291 unidades.

## Cómo se calcula Tapera
- Remitos de venta (`COMPROBANTEV.FACTTIPO = 11`) no anulados, **solo clientes con código numérico** (los locales propios y cuentas internas tipo `NCEND2`, `POLO52`, `REPOLOC`, `FABRICA` tienen letras: sus remitos son reposiciones y nunca se facturan; eran ~275.000 u. en 2026).
- Pendiente de cada línea = `FCANT` − lo que le descuentan las facturas y cancelaciones que la afectan (`COMPROBANTEVDET.AFE_COD`/`AFENROITEM` con `AFETIPOCOM = 11`).
- **El `AFESALDO` del remito no sirve**: Dragon no lo descuenta al facturar (en todos los remitos es igual a lo remitido).

## Flujo
`MayoristaStock.tsx` → `src/lib/stockMayorista.ts` → `GET /api/sql/stock-mayorista[?forzar=1]` → `src/lib/stockMayoristaApi.ts` (cuelga del router `api/sql/[ruta].ts`) → Puente SQL `{ accion: 'stock_mayorista' }` → `puente-sql/sql/stock-mayorista.sql` (4 resultados: depósito, tapera, artículos con material/proveedor, colores; se leen por posición). Tarda ~3 s, cache de 1 minuto en el puente; **Actualizar** lo saltea. Respuesta ~300 KB.

- Dev: `mock-stock-mayorista` en `.claude/launch.json` (`scripts/mock-stock-mayorista.mjs`, :4178, apunta a la copia del puente en :3199); vite proxyea `/api/sql/stock-mayorista`.
- Al tocar `server.js` hay que reiniciar el puente; tocar solo el `.sql` no.
