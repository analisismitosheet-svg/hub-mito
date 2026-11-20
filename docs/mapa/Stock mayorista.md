# Stock mayorista

Área **Mayorista** → **Stock** (`/mayorista/stock`, `MayoristaStock.tsx`, permiso `mayorista.stock.view`, dado al rol `mayorista` con `sql/mayorista_stock_permiso.sql`). Pedido del usuario el 20/11/2026 (maqueta: `mockups/stock-mayorista.html`). Solo lectura. Las dos solapas salen de **DRAGONFISH_MITO**.

## Solapas
- **Depósito**: stock por artículo + color con la curva de talles (`ZooLogic.COMB`, `COCANT > 0`) y lo que está en tránsito (`ENTRANSITO`). Al abrir una fila: detalle por talle y cuánto de ese artículo está en Tapera. Ese día: 97.605 unidades, 1.058 artículo + color.
- **Tapera**: lo **remitido a clientes que todavía no se facturó**. Vistas *Por artículo* (a quién se remitió, con antigüedad) y *Por cliente* (remitos, el más viejo, unidades y plata al precio del remito). Filtro **Cliente** (lo pidió el usuario el mismo día) además de Material y Proveedor, que valen en las dos solapas. Ese día: 52 remitos, 26 clientes, 291 unidades.

## Cómo se calcula Tapera
- Remitos de venta (`COMPROBANTEV.FACTTIPO = 11`) no anulados, **solo clientes con código numérico** (los locales propios y cuentas internas tipo `NCEND2`, `POLO52`, `REPOLOC`, `FABRICA` tienen letras: sus remitos son reposiciones y nunca se facturan; eran ~275.000 u. en 2026).
- Pendiente de cada línea = `FCANT` − lo que le descuentan las facturas y cancelaciones que la afectan (`COMPROBANTEVDET.AFE_COD`/`AFENROITEM` con `AFETIPOCOM = 11`).
- **Lo que pasó a REPOLOC se resta solo** (20/11/2026, decisión del usuario): cuando la mercadería de un cliente pasa a REPOLOC, el remito a REPOLOC lleva en la observación el código del cliente (`00891 Cuello Brian`, `01054 - M&t`, `PEDIDO 4746-01025 Lopez Zanini`; en el formato PEDIDO se toma el número de después del guion, y se compara como número: `708` = `00708`). Esas unidades se restan de lo pendiente de ese cliente por artículo + color + talle, de su remito más viejo al más nuevo, y solo contra remitos del cliente de la misma fecha o anteriores al de REPOLOC. Lo restado viaja como quinto resultado (`repoloc`, con los N° de remito a REPOLOC) y se ve abajo de Tapera en «Descontado porque pasó a REPOLOC». Ojo: REPOLOC mueve mucho más que lo pendiente (para 00891 eran 26 remitos y 1.063 u.); el día que se armó, la resta sacó 3 u. (las 2 CF264133 del remito 15466 de 00891, por el remito a REPOLOC 15505, y 1 de 01025).
- **Sacar líneas a mano** (20/11/2026): hay mercadería que Dragon sigue teniendo como remitida sin facturar pero ya no está en el cliente (caso: remito 2620 del cliente 00891, que pasó a REPOLOC sin ningún comprobante que lo vincule). Con `mayorista.stock.ajustar` (admin, o individual) aparecen botones **Sacar** por línea y **Sacar R n entero** en la vista por cliente; piden el motivo y van a la tabla `tapera_ocultos` (`sql/tapera_ocultos.sql`, clave remito + cliente + artículo + color + talle). Abajo de Tapera, «Sacados a mano» los lista con quién y cuándo, y **Volver a sumar**. Dragon no se toca.
- **El `AFESALDO` del remito no sirve**: Dragon no lo descuenta al facturar (en todos los remitos es igual a lo remitido).

## Flujo
`MayoristaStock.tsx` → `src/lib/stockMayorista.ts` → `GET /api/sql/stock-mayorista[?forzar=1]` → `src/lib/stockMayoristaApi.ts` (cuelga del router `api/sql/[ruta].ts`) → Puente SQL `{ accion: 'stock_mayorista' }` → `puente-sql/sql/stock-mayorista.sql` (4 resultados: depósito, tapera, artículos con material/proveedor, colores; se leen por posición). Tarda ~3 s, cache de 1 minuto en el puente; **Actualizar** lo saltea. Respuesta ~300 KB.

- Dev: `mock-stock-mayorista` en `.claude/launch.json` (`scripts/mock-stock-mayorista.mjs`, :4178, apunta a la copia del puente en :3199); vite proxyea `/api/sql/stock-mayorista`.
- Al tocar `server.js` hay que reiniciar el puente; tocar solo el `.sql` no.
