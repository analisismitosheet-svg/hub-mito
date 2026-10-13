# Comparativa de precios

Compras > **Comparativa de precios** (`/compras/comparativa-precios`, permiso `compras_precios.view`). Mi **precio público** (`articulos.precio_publico`) contra el **precio de lista** de la web de la marca (antes de la oferta). El precio vigente y el % OFF se muestran como dato. Por ahora solo Vans (vans.com.ar).

- Pantalla: `src/pages/ComparativaPrecios.tsx`. Lee `vw_comparativa_precios` y `precios_web_sync`. Contadores clickeables, filtros (stock web, búsqueda, solo publicados), tabla ordenable de a 60. Botón **Actualizar ahora** solo admin.
- Base: `sql/precios_web.sql` → `precios_web` (PK marca+cod), `precios_web_sync` (última lectura + `proximo` = por dónde va la lectura en curso), vista `vw_comparativa_precios` (código `VN0[A-Z0-9]{6,10}` sacado de la descripción; `dif`, `dif_pct`, `estado`: sin_precio / revisar (<$10.000) / igual (±2%) / mas_caro / mas_barato). RPC `precios_web_codigos` y `precios_web_guardar`: aceptan admin logueado o la clave de sync `precios` (`private.sync_claves`, valor en el Vault como `precios_sync_token`).
- Lectura de la web: `src/lib/preciosWeb.ts` (6 en paralelo, 1 reintento en 5xx; existe si el JSON-LD trae `"sku"`; si no, prueba sin sufijo CA/SM/CS/…; precios del bloque `productData` a nivel producto, nunca del array por talle).
- Sync: `api/precios-sync.ts?marca=vans&desde=N` **por tandas** (~42 s cada una; una corrida completa son ~1700 códigos y ~3 min). El botón encadena tandas desde el navegador. Corrida completa desde una PC: `PRECIOS_SYNC_TOKEN=… node scripts/precios-sync.ts vans`.
- Semanal: `sql/precios_web_cron.sql` (pg_cron + pg_net, lunes 03:00 AR cada 2 min hasta terminar). Vercel Cron no sirve (Hobby: 1 por día y 60 s).
- Primera lectura (13/10/2026): 1704 códigos, 392 encontrados (27 por código sin sufijo), 3 errores. `VN0A3TKN6BT1` = 129000, 32% OFF, lista 189900.
