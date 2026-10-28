# Stock valorizado

Área **Administradores** → `/administradores/stock-valorizado` (`StockValorizado.tsx`, permiso `stock_valorizado.view`).
Cuántas unidades hay y cuánta plata es, **a costo**, sucursal por sucursal.

## De dónde salen los números
- **Stock**: `ZooLogic.COMB` (una fila por SKU: `COART`, `COCOL`, `TALLE`, `COCANT`) de **cada base `DRAGONFISH_*`** del SQL Server principal (M1T0O1\ZOOLOGIC). Se recorren todas las que el usuario del puente puede leer; solo cuenta `COCANT > 0`.
- **Bases excluidas** (tabla `#fuera` arriba de `sql/stock-valorizado.sql`, las pidió sacar el usuario el 27/10/2026): DRAGON, TEMPOD, CAPACITA, SHOWROOM, CHILE, REPOLOC, ROBOD y CONSIGNA. No se recorren ni entran en el total, el detalle o el top. Para volver a sumar una, se borra su línea del `.sql` y se aprieta **Actualizar** (el archivo se lee en cada corrida: no hace falta reiniciar el puente).
- **Costo**: lista de precios **«Compra» = `LISTA0`** de **`DRAGONFISH_INDOD.ZooLogic.PRECIOAR`** (la base de costos es INDO, lo marcó el usuario el 28/10/2026: tiene 99.025 artículos con costo contra 18.614 de MITO), tomando la `FECHAVIG` más nueva de cada artículo. En Dragon el costo está cargado **por artículo** (`CCOLOR`/`TALLE` vienen vacíos salvo un puñado), así que se valoriza por artículo, no por SKU.
- Las unidades de artículos **sin costo** cargado se cuentan en "Unidades" pero suman $0 (la pantalla las muestra aparte, en ámbar).
- **Descripciones**: temporal `#desc` con `ZooLogic.ART` de MITO y, lo que falta ahí, de INDO. Se arma una sola vez: repetir los dos joins en cada agregación del final llevaba la consulta de 10 a 30 s.
- Nombres de sucursal: `NOMBRES_BASE` de `src/lib/stockValorizado.ts` y, de respaldo, la tabla `NOMBRES` de `src/lib/replicas.ts`. Hacen falta las dos porque el Replicador usa otros códigos que el nombre de la base (`BUSTD` vs `DRAGONFISH_BUSTOD`).

## Camino
`StockValorizado.tsx` → `src/lib/stockValorizado.ts` → `GET /api/sql/stock-valorizado[?forzar=1]` → `src/lib/stockValorizadoApi.ts` (cuelga del router `api/sql/[ruta].ts`, igual que `status` y `catalogo`, por el tope de 12 funciones de Vercel) → Puente SQL `{ accion: 'stock_valorizado' }` → `puente-sql/sql/stock-valorizado.sql`.

- La consulta recorre ~40 bases y tarda **~12 s**: el puente la **cachea 10 minutos** y comparte la corrida si llegan dos pedidos juntos. El botón **Actualizar** manda `forzar` y recalcula de cero.
- Es solo lectura: nada de DDL ni escrituras (las temporales `#costo`/`#bases`/`#art` son de la sesión).
- Devuelve cuatro cosas: fila por base, top 200 artículos por valorizado, el contexto del costo y **todos los artículos con stock sin costo cargado** (`sin_costo`, sin tope). Ese cuarto resultado va último en el `.sql` a propósito, para que un puente que todavía no lo lee encuentre los tres primeros en el mismo orden.
- `sin_costo` trae `unidades` (todas) y `unidades_val` (las que están en sucursales que valorizan): la pantalla usa `unidades_val` salvo que se aprete el botón ámbar, así el listado no arranca con miles de avíos de NOMED. En pantalla se dibujan las primeras 300 filas; las ~4.300 completas van en la hoja «Sin costo» del Excel.

## Detalles de la pantalla
- Tarjetas: valorizado total, unidades + SKUs, sucursales, unidades sin costo (con su %).
- Tabla por sucursal con costo promedio, % del total y barra; total al pie. Excel con dos hojas (Por sucursal / Top artículos).
- **Bases sin costo cargado**: las que valorizan $0 quedan afuera del total de entrada (hoy `DRAGONFISH_NOMED`, ~1,67 M de unidades de insumos) y se suman con el botón ámbar, para que el total no engañe.
- Dev: `node scripts/mock-stock-valorizado.mjs` (vite proxyea `/api/sql/stock-valorizado` a `:4175`) con el Puente SQL corriendo.

> Al tocar `puente-sql/server.js` hay que **reiniciar el puente** de la PC central: la tarea "MITO - Puente SQL" lo relevanta sola cuando el puerto 3128 queda libre (chequea cada 60 s). Tocar solo `sql/stock-valorizado.sql` **no** necesita reinicio.

Relacionado: [[Puente SQL y syncs]] · [[Artículos y F12]] · [[Permisos y usuarios]]
