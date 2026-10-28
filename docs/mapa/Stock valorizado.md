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

- La consulta recorre las bases una por una y tarda **entre 8 y 20 s**: el puente la **cachea 10 minutos** (`STOCK_VALORIZADO_CACHE_MS`) y comparte la corrida si llegan dos pedidos juntos. Vencido el cache **devuelve igual la foto anterior y recalcula por detrás**, así espera el primero que entra y nadie más. El botón **Actualizar** manda `forzar` y sí espera el recálculo.
- Corre con **conexión propia** (`conexionLarga()`, timeout `STOCK_VALORIZADO_TIMEOUT_MS`, 3 min por defecto). Los pools comunes del puente usan el requestTimeout de fábrica de mssql, 15 s, y la consulta se pasaba: *"Timeout: Request failed to complete in 15000ms"*. Se abre, se usa y se cierra, para no subirle el timeout a las vistas de todos los días.
- Es solo lectura: nada de DDL ni escrituras (las temporales `#costo`/`#bases`/`#art` son de la sesión).
- Devuelve cinco cosas: fila por base, **todos los artículos con stock** (~11.500, ya no un top 200: lo pidió entero el usuario el 28/10/2026 para la solapa «Por artículo»; son ~1,5 MB de JSON, bien lejos del tope de ~4,5 MB de Vercel), el contexto del costo, **todos los artículos con stock sin costo cargado** (`sin_costo`, sin tope) y **esos mismos abiertos por sucursal** (`sin_costo_detalle`, una fila por artículo y base, con `valoriza`). Los resultados se **agregan al final y nunca se mueven de lugar**: el puente los lee por posición, así que uno que todavía no conoce los últimos sigue encontrando los primeros donde siempre. Por eso el top 200 sigue viniendo aunque la pantalla ya no lo muestre (lo pidió sacar el usuario el 28/10/2026).
- `sin_costo` trae `unidades` (todas) y `unidades_val` (las que están en sucursales que valorizan): la pantalla usa `unidades_val` salvo que se aprete el botón ámbar, así el listado no arranca con miles de avíos de NOMED. En pantalla se dibujan las primeras 300 filas; las ~650 completas van en la hoja «Sin costo» del Excel.
- `sin_costo_detalle` es lo que se despliega al tocar la celda de sucursales de cada artículo y lo que baja a la hoja «Sin costo x sucursal». Se filtra con el mismo criterio que las unidades de la fila, así lo que se abre suma exactamente lo que dice arriba (comprobado el 28/10/2026 contra las 646 filas: cierran todas). Si el puente todavía no lo manda, la celda vuelve a ser texto y no se rompe nada.

## Detalles de la pantalla
- Tarjetas: valorizado total, unidades + SKUs, sucursales, unidades sin costo (con su %).
- Tabla por sucursal con costo promedio, % del total y barra; total al pie.
- Sección ámbar **«Artículos sin costo cargado»**: artículo, descripción, unidades y sucursales; la celda de sucursales se abre y muestra **cuántas unidades hay en cada una** (las que no valorizan quedan en gris con la aclaración).
- Excel completo, cuatro hojas: **Por sucursal**, **Por artículo**, **Sin costo** (con las dos cifras juntas: unidades totales y unidades en sucursales que valorizan) y **Sin costo x sucursal** (una fila por artículo y sucursal, con la columna ¿Valoriza?). Además, la sección ámbar tiene su **propio botón Excel** (`articulos_sin_costo_fecha.xlsx`, las dos hojas de sin costo) y la solapa «Por artículo» el suyo (`stock_valorizado_articulos_fecha.xlsx`, lo que esté filtrado).
- **Solapas**: «Por sucursal» (la tabla de siempre) y «Por artículo» (artículo, descripción, stock, precio costo y total valorizado, ordenada por plata, con su propio botón Excel y el buscador por código o descripción). El buscador se vacía al cambiar de solapa. En pantalla se dibujan 300 filas; el total del pie y el Excel llevan todas.
- **Bases sin costo cargado**: las que valorizan $0 quedan afuera del total de entrada (hoy `DRAGONFISH_NOMED`, ~1,67 M de unidades de insumos) y se suman con el botón ámbar, para que el total no engañe.
- Dev: `node scripts/mock-stock-valorizado.mjs` (vite proxyea `/api/sql/stock-valorizado` a `:4175`) con el Puente SQL corriendo.

> Al tocar `puente-sql/server.js` hay que **reiniciar el puente** de la PC central: la tarea "MITO - Puente SQL" lo relevanta sola cuando el puerto 3128 queda libre (chequea cada 60 s). Tocar solo `sql/stock-valorizado.sql` **no** necesita reinicio.

Relacionado: [[Puente SQL y syncs]] · [[Artículos y F12]] · [[Permisos y usuarios]]
