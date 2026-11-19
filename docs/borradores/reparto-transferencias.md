# Borrador · Reparto de transferencias dentro del hub

> Estado: **borrador** (18/11/2026). Nada de esto está subido ni aplicado en la base.
> Maqueta: `mockups/reparto-transferencias.html` (se abre en el navegador, anda con datos de ejemplo).
> Origen: `pwa-reparto.rar` (PWA suelta «Reparto de Transferencias — INDONESIA»).

## 1. Qué es la app del rar

Una planilla tipo Excel en el navegador para **repartir stock entre locales a mano**:

- Filas = artículo · color · talle. Columnas = 20 locales (VCPD … DEPO, MAYORD, POLO52).
- Cada celda es el **stock del local**; se edita escribiendo el número (flechas, Enter, Tab, Shift+flechas para rango, Ctrl+C / Ctrl+V desde Excel, Supr borra, Ctrl+Z / Ctrl+Y).
- Columna **Rem.** = stock total original − stock repartido. Si da negativo (rojo) te pasaste.
- Colores: celda con relleno rojo = el local vendió ese SKU en el período; letra azul = tiene en tránsito; borde = celda movida.
- Arriba, por local y respetando los filtros: **Posturas** (cuántos artículo-color tiene), **Stock ideal** (stock total repartido según el % de venta de cada local) y **Dif. ideal/real** (verde sobra, rojo falta).
- Filtros: búsqueda, color, talle, grupo (sale del último paréntesis de la descripción). Orden por venta del artículo o por código.
- **Remitos**: compara stock original contra editado; lo que bajó en un local se manda a donde subió → movimientos origen → destino. Exporta `remitos.xlsx` con una hoja por local origen (formato «FECHA / Articulo / Descripcion adicional macro / Color / Talle / locales…», el mismo de `260724 - repo venta diaria 23-07.xlsx`).
- Datos: importar el crudo del Dragon (hoja «Export») o «Cargar del servidor» por una API **Data API Builder** sobre SQL Server.
- Todo queda en `localStorage` del navegador.

## 2. Lo que NO se puede traer tal cual

| Del rar | Problema en el hub | Cómo queda |
|---|---|---|
| `02-movimientos.sql`: crea esquema `reparto`, tabla `reparto.movimientos`, usuarios y GRANT en SQL Server | **Rompe la regla de oro: el SQL Server es solo lectura** | Los movimientos van a **Supabase** como un lote de Transferencias |
| `dab-config.json`: API con rol `anonymous` que **lee y escribe**, CORS a `SERVIDOR-INDO` | Sin login, cualquiera en la red escribe; otro servidor más que mantener | Se descarta. Los datos llegan por el **Puente** (`/api/sql` con sesión y token) |
| `01-vistas.sql` con `TU_TABLA_...` | Nunca se adaptaron a las tablas reales | Se usa `DWH.dbo.vw_FACT_VENTAS_STOCK`, la misma de Repo diaria / Cascada |
| `localStorage` como única memoria | Se pierde al cambiar de PC; nadie más ve el reparto | Borrador guardado en Supabase (fase 2) |
| Script de `xlsx-js-style` desde jsdelivr | El hub ya tiene `xlsx` empaquetado (CSP) | Se usa la librería del hub |

## 3. Cómo encaja en el hub

**Dónde:** cuarta tarjeta dentro de *Reposiciones / Transferencias* (`TransferenciasHub.tsx`, `/transferencias/inicio`), al lado de Reposición diaria y Transferencia diaria:

- Tarjeta **«Reparto manual»** → ruta `/transferencias/reparto`, pantalla `src/pages/RepartoTransferencias.tsx`.
- Permiso: `transferencias.import` (los mismos que hoy cargan lotes). Sin permiso nuevo en la fase 1.

**Flujo (definido el 18/11/2026): sin importar Excel. Los datos salen siempre de cada local y del depósito.**

1. **Filtrar** (paso 1, obligatorio): período de venta (desde/hasta o atajos 7/14/30 días) y los **mismos filtros que el tablero de Power BI**, en 3 columnas, cada uno una lista desplegable con selección múltiple, buscador y «Seleccionar todo» (vacío = «Todas»; varios = «Selección múltiple (n)»; si faltan 1 o 2 = «Todos menos …»):
   | Filtro | De dónde salen las opciones |
   |---|---|
   | Locales | tabla `locales` / lista fija de las 20 columnas (todos por defecto) |
   | ID proveedor descripción | `articulos.id_prov` + nombre del proveedor (`vw_DIM_PROVEEDOR`) |
   | Material | `articulos.id_material` + nombre (`vw_DIM_MATERIAL`) |
   | Temporada | `articulos.id_temporada` (1 Verano, 2 Continuo, 3 Invierno, 4 Primavera) |
   | Año | `articulos.anio` (ya se sincroniza) |
   | Línea | `articulos.id_linea` |
   | Familia | `articulos.id_flia` |
   | Género | **a confirmar**: `articulos` no lo tiene hoy. Hay que ver en `vw_DIM_ARTICULO` qué columna es y sumarla a `sync-articulos.js` |
   | Grupo | `articulos.id_grupo` + nombre |
   Más «Artículo» (texto, opcional). Hay que elegir **al menos un filtro de artículo** (cualquiera menos Locales) y 2 locales. Opción: ocultar SKU en tránsito. Las opciones salen del hub, así que aparecen al instante; el Puente recibe los mismos filtros.
2. **Armar**: el hub le pide al Puente el stock y la venta **solo de lo filtrado** y arma la grilla (artículo·color·talle × locales elegidos). Mientras calcula muestra «Calculando…». «← Cambiar filtros» vuelve al paso 1 (avisa si ya repartiste algo).
3. Repartir en la grilla (edición tipo Excel del rar) y revisar el panel de movimientos origen → destino. Si un SKU queda con Rem. negativo no deja cargar.
4. **Observación** (opcional, hasta 300 caracteres): se guarda en `transfer_lotes.motivo`, que Transferencias ya muestra al lado del nombre del lote (`Transferencias.tsx`), así que la ven los locales sin cambiar nada en la base.
   **Cargar en Transferencias** → crea el lote `AAMMDD - REPARTO <nombre>` en `transfer_lotes` + `transfer_items` (origen = local que bajó, destino = el que subió). A partir de ahí es un lote más: campana con sonido a los locales origen, marcar hecho / faltante, estadísticas, avisos a Depósito Indo si sale o llega a DEPO.
5. Excel de remitos: opcional, solo para descargar (una hoja por origen).

## 4. Piezas a construir

### 4.1 Puente (solo lectura) — acción `reparto_stock`
- `puente-sql/sql/reparto-stock.sql` + `puente-sql/reparto-stock.js`, acción nueva en `server.js` (hay que reiniciar el puente).
- Lee `vw_FACT_VENTAS_STOCK` una vez a una temporal (como `repo-diaria.sql`):
  - `STOCK` por tienda y SKU (`CANT`), con `ENTRANSITO` aparte.
  - `VENTA` por tienda y SKU sumada entre `@desde` y `@hasta`.
  - Maestro de artículos (descripción macro, proveedor, grupo, familia, material, línea, temporada) desde `vw_DIM_ARTICULO`.
- Tienda → código de columna con `baseDeTienda()` de `repo-diaria.js` + alias del rar (`RUTA9D2→RUTA9D`, `MITO→MAYORD`, `INDOD/INDO→DEPO`, `WALMART→WALMARTD`, `BUSTOS→BUSTOD`).
- La vista tarda ~50-80 s: mismo esquema de **foto por detrás** (`estado: 'calculando'`, la pantalla repregunta cada 4 s, la foto dura 5 min).
- Recibe los filtros del paso 1 (`desde`, `hasta`, `locales[]`, `prov[]`, `material[]`, `temporada[]`, `anio[]`, `linea[]`, `familia[]`, `genero[]`, `grupo[]`, `articulo`) y filtra **en el SQL** (join con `vw_DIM_ARTICULO`), así solo viaja lo pedido. Como el filtro de artículo es obligatorio, queda lejos de los 4,5 MB de Vercel; igual va un tope (si pasa N SKU pide afinar el filtro).
- Stock del depósito: DEPO sale de la misma vista (tienda INDOD). *A confirmar*: si para MAYORD hay que usar el stock real de la COMB de MITO (físico − comprometido), como hace la Repo diaria.
- Lado Vercel: `POST /api/sql/reparto-stock` colgado de `api/sql/[ruta].ts` (no suma funciones).

### 4.2 Supabase
- `sql/reparto_transferencias.sql`:
  - `reparto_cargar_transferencias(p_nombre text, p_obs text, p_items jsonb)` → reusa `private.cascada_crear_lote(p_nombre, p_obs, ...)` (su parámetro `p_motivo` ya escribe `transfer_lotes.motivo`; si no hay observación, queda «Reparto manual») con tipo `REPARTO` (hoy pone `'VENTA'` fijo: agregar parámetro de tipo o una función hermana). Permiso `transferencias.import`, no repite un lote con el mismo nombre en 7 días.
  - Estadísticas de Transferencias: decidir si `REPARTO` cuenta como «otras» (hoy diaria = nombre contiene «diaria»; un reparto cae en «otras» solo).
- Fase 2: `reparto_borradores` (id, nombre, filtros, `edits jsonb`, creado_por, actualizado_at) con RLS por `transferencias.import`, para guardar y retomar.

### 4.2 bis · Ruta del vehículo en la grilla (pedido del 18/11/2026)
Al pasar el mouse por una línea se marcan **solo los locales por los que el vehículo todavía tiene que pasar hoy** (decidido el 18/11/2026: nada de «ahora», «ya pasó» ni otros estados). **Los dos vehículos a la vez, un color cada uno** (18/11/2026): Master amarillo, Mercedes rosa; si a los dos les falta el mismo local, la celda va partida en diagonal con los dos colores. Se marcan las celdas de esa línea y el encabezado del local; el tooltip dice a quién le falta y la hora límite. Sin selector de vehículo.
- «Le falta pasar» = local de `tracking_recorridos` del vehículo para el día de la semana **sin entrada** en `tracking_controles_dia(hoy)`. Entran también los que ya tienen la hora límite vencida (siguen sin pasar).
- Arriba de la grilla: una fila por vehículo con su color, estado y hace cuánto mandó señal, y los locales que le faltan en fichas con su hora límite. Si ya pasó por todos: «ya pasó por todos los locales de hoy».
- Si la Master no manda GPS, un local por el que pasó puede seguir figurando como pendiente (no hay registro de que entró). Pasa seguido hoy por el problema de su celular (ver Tracking de transporte).
- **Supabase**: RPC nueva `reparto_rutas_vehiculos(p_fecha date)` (devuelve todos los vehículos de una) SECURITY DEFINER, permiso `transferencias.import` (el Tracking pide `tracking.view` y es del área Administradores; esta solo devuelve lo mínimo: estado, última señal y los locales que le faltan con su hora límite). Se relee cada 60 s con la pestaña visible.
- **A resolver**: los nombres de `tracking_bases` (vienen de las bases de Transporte, ej. «GENERAL PAZ») no son los códigos de las columnas (GRALPAZ). Hace falta una equivalencia base → código (columna nueva en `tracking_bases` o tabla chica), cargada una vez.
- Las fichas se ordenan por hora límite (los que no tienen, al final).

### 4.2 ter · Doble clic en el color: «Stock y venta x locales» (pedido del 18/11/2026)
- Doble clic en la celda **Color** de una línea abre un **panel chico, del ancho de la columna Descripción** (mínimo 140 px) y **del mismo alto que la tabla** (arranca y termina donde la grilla; si la tabla se sale de la pantalla, la parte visible), sin scroll adentro. Se reacomoda al hacer scroll, al cambiar el tamaño de la ventana y en pantalla completa: las filas de los locales se achican para entrar todas. Queda encima de la grilla (no la tapa entera ni oscurece la pantalla). Gráfico de barras horizontales del tablero de Power BI: por cada local, **Stock + tránsito** (amarillo) y **Cantidad venta** (verde), con el número al lado de cada barra.
- Es del **artículo + color, sumando todos los talles**, de los locales que entraron en el reparto y con el período de venta del paso 1.
- **Cabecera sin título** (18/11/2026): arriba, en grande, el **código** del artículo y el **color** (naranja), y abajo el **nombre** en negrita (la descripción sin los paréntesis de familia/grupo ni la línea: «()JORDAN JACKET ZIMITH - W26-I(H96)» → «JORDAN JACKET ZIMITH»). Las fechas de venta quedan en chiquito debajo.
- **Ordenado por venta** (de mayor a menor; empate por stock).
- Stock = el de la foto (antes de repartir), igual que el PBI. Si en el reparto ya le moviste algo a ese local, abajo del nombre dice «+3 rep.» / «−2 rep.».
- Abajo, el total de stock + tránsito y de vendidas. Se cierra **solo con la ✕** (ni Esc ni tocando afuera). Con el panel abierto se puede seguir trabajando en la grilla, y doble clic en otro color lo cambia a ese artículo.
- No pide nada al Puente: sale de la misma foto que ya está en pantalla.
- La celda Color queda subrayada punteada y con cursor de lupa para que se note que se puede tocar.

### 4.2 bis-b · Tildes arriba de la tabla (pedido del 18/11/2026)
Van arriba de la grilla, dentro de la zona que pasa a pantalla completa (se recuerdan por navegador en `localStorage`):
- **🚚 Ver transporte** (prendido por defecto): muestra u oculta la barra de la ruta de la Master y la Mercedes y el marcado de «le falta pasar» en la línea del mouse. Reemplaza al viejo tilde «Marcar siempre», que se sacó.
- **🚦 Días sin venta** (apagado por defecto): pinta cada celda **con stock** según cuántos días hace que **ese local no vende ese SKU** (artículo · color · talle):
  | Color | Cuándo (umbrales editables al lado del tilde) |
  |---|---|
  | Verde | vendió hace 15 días o menos |
  | Amarillo | entre 16 y 45 días |
  | Rojo | más de 45 días, o no vendió en los últimos 180 |
  - **Un tilde por color** (verde, amarillo, rojo), todos prendidos al arrancar: apagando uno, esas celdas dejan de pintarse (ej. dejar solo el rojo para ver lo que está clavado).
  - Las celdas sin stock no se pintan (no hay nada que vender). Al pasar el mouse: «Última venta hace N días» / «Sin venta en 180 días».
  - Mientras está prendido reemplaza el relleno rojo de «vendió en el período»; las celdas cambiadas pasan a borde violeta punteado para que se sigan viendo.
  - **Dato**: el Puente suma a `reparto_stock` la **última fecha de venta por local y SKU** (`MAX(dia)` de las filas `VENTA` de `vw_FACT_VENTAS_STOCK` en los últimos 180 días, solo de los artículos filtrados). La pantalla calcula los días contra hoy. *A medir*: 180 días de la vista puede tardar más que los ~50 s de la Repo diaria; si tarda mucho, bajar a 90 días o sacarlo de la memoria del puente (`D:\memoria ia`, venta por día cerrado).

### 4.2 quinquies · Sugerencia por artículo (pedido del 18/11/2026)
- **Va por código + color** (18/11/2026): tocar el código en una línea elige ese **artículo y color** (todos sus talles); esas líneas quedan marcadas en naranja y se habilita **«✨ Sugerencia CF166217 · color 02»** arriba de la tabla (también en pantalla completa). Tocarlo de nuevo lo suelta; tocar el código en una línea de otro color cambia a ese color.
- La sugerencia es **Repo diaria + Cascada, con las mismas reglas y en el mismo orden** (decidido el 18/11/2026), sobre lo que hay en la grilla en ese momento (respeta lo que ya moviste a mano). Lo vuelca en la grilla para revisar; no carga nada solo.
  1. **Etapa Repo MITO** (columna MAYORD = depósito MITO, stock real): cubre la **venta** de cada local por prioridad de local (CFD, CFPO, CFRA, CFR4, CFR9, NVOCED, ESPINOD, LIBERD, 9DEJULIO, BUSTOD, MUNOZ, RIVERAD, RUTA9D, DINOD, WALMARTD, VCPD, GRALPAZ). Solo artículos de **MOCF/MOZH/MOFR**, sin topes (`repo-diaria.js`).
  2. **Etapa Cascada** sobre lo que faltó (faltante = venta − lo que mandó MITO), `cascada.js`:
     - **pase 0 · INDOD (columna DEPO) y después POLO52**, donantes principales: por prioridad, todo su stock, sin topes.
     - **pase 1 · locales**: donan lo que les sobra del talle (se quedan con lo vendido, mínimo 1), sin GRALPAZ (orden: el que más le sobra según stock ideal, o el que más stock tiene del artículo); se quedan con 1 y dan hasta 2 por SKU. **No recibe** más de lo que le falta (venta − stock − tránsito), o si es CFR4/CFR9/CFD/CFPO/CFRA y el artículo no es de MOCF/MOZH/MOFR.
     - **pase extra NVOCED**: si no recibió nada, acepta donantes que tienen 1 sola.
     - **huecos**: 1 unidad de un talle **vendido** (por algún local) que el local no tiene ni en tránsito, **si tiene un talle de al lado** (completa la curva). No a GRALPAZ. Primero DEPO, después locales.
     - **Tilde «Tapar huecos de talles sin venta»** (18/11/2026, apagado de entrada = como la Cascada): prendido, también completa talles que **nadie vendió** en el período, con las mismas reglas (el local tiene el talle de al lado, no lo tiene ni en tránsito, alguien tiene de sobra). Caso ZH169603 color 02 talle M: nadie vendió M, CFRA tenía 3 y no se tapaba ningún hueco de M.
     - Aunque la sugerencia mande algo, si quedan huecos en talles sin venta (tilde apagado) el cartel lo avisa con los talles: «Quedan 9 huecos en talles que nadie vendió en el período (L)…» (caso CF235806 color 02 L).
     - **GRALPAZ no recibe huecos ni dona**, igual que la Cascada (decidido el 18/11/2026; en el hub sale de `cascada_params`: `huecos.no_reciben` y `no_donan`, así si se cambia allá cambia en los dos lados). Sí recibe para cubrir venta. El cartel lo avisa: «GRALPAZ no recibe huecos (regla de la Cascada): quedó sin L».
     - **Cartel cuando no se manda nada**: dice el motivo real — no queda venta ni huecos; o hay N huecos/venta sin tapar porque nadie tiene de sobra (y si MITO/Indo/Polo están apagados); o hay N huecos en talles sin venta y se tapan con el tilde. (Antes decía «ningún local tiene de sobra» aunque CFRA tuviera.)
     - **tránsito** (decidido el 18/11/2026): lo que ya viene en camino cuenta como stock; un talle en tránsito no es hueco y no se manda de nuevo. Para que se vea, **toda celda con algo en camino muestra 🚚 con la cantidad**: en una celda en 0 va centrado («🚚1», tooltip «no es hueco, ya le llega»); en una celda con stock va chiquito en la esquina de arriba a la derecha, así el número sigue entero (18/11/2026). Caso VCPD M de CF166217: parecía un hueco sin tapar pero le llegaba 1.
     - **mínimo por envío** (campo «Mín. por envío», 2 por defecto como la Cascada; 1 = sin mínimo): cada par local donante → receptor tiene que sumar al menos esa cantidad, **contando lo que ya está movido en la grilla** (si no, ese envío se descarta; MITO e INDOD no cuentan). En la cascada real el mínimo se mide sobre todos los artículos de la corrida; acá, sobre lo que ya hay en el reparto.
  - **Tilde «Según stock ideal»** (18/11/2026, prendido por defecto): la sugerencia usa la misma **Dif. ideal** de arriba de la grilla (stock real − stock ideal de cada local, sobre lo que se ve):
    - **Recibe primero el que más le falta** para llegar a su ideal (Dif. más negativa), en todas las etapas (Repo MITO, Indo/Polo, locales). Reemplaza el orden fijo de prioridad y el alfabético de la cascada; la prioridad de siempre solo desempata.
    - **Donantes: se mira el talle, no el total** (decidido el 18/11/2026, caso CF166217 XL: CFD con 3 XL sin venta pero Dif. −34 no donaba y RIVERAD quedaba con el hueco). Dona **cualquier local al que le sobre ese talle**: **se queda con lo que vendió en el período (mínimo 1) y dona el resto**, hasta 2 por SKU, sin importar su Dif. total. Ej. (caso RIVERAD L): tiene 2 y vendió 1 → se queda 1 y le da 1 a BUSTOS; si vendió 2 y tiene 2 → no dona (la venta supera o iguala lo que le sobraría). La Dif. solo ordena: dona primero el que más le sobra.
    - **El ideal solo ordena, no deja a nadie afuera** (18/11/2026, caso WALMART +18 sin la S de CF166217): los huecos y abrir colores se tapan también en locales arriba de su ideal; el ideal decide quién recibe primero y quién dona primero.
    - La Dif. se va actualizando con cada envío (el que recibe se acerca a su ideal y el que dona se aleja), así no se le carga todo al primero.
    - Apagando el tilde vuelve a las reglas de la Cascada tal cual (orden fijo de prioridad / alfabético; donan primero los que más stock tienen del artículo).
  - **Tildes «Donan: ☑ MITO ☑ Indo ☑ Polo»** (18/11/2026, al lado del botón, los tres prendidos al arrancar): prenden o apagan cada depósito como donante. MITO apagado = no corre la etapa Repo MITO; Indo o Polo apagados = no donan en el pase 0, en huecos ni al abrir colores. Con los tres apagados solo donan los locales. Los depósitos nunca reciben. El cartel muestra «apagado» en el que no dona.
  - **Huecos que no se tapaban (caso CF166217 color 02, 18/11/2026)**: con MITO, Indo y Polo apagados solo donan locales, y cada hueco sale con 1 unidad de un local distinto → el mínimo de 2 por envío los descartaba todos y el cartel decía «no hay nada para sugerir». Arreglos: (1) para cada receptor se prefiere el donante que ya le está mandando algo, así se juntan unidades por envío; (2) «Mín. por envío» editable; (3) si no se manda nada, el cartel dice por qué (descartadas por el mínimo, depósitos apagados, o de verdad no hay venta ni huecos).
  3. **Tilde «Abrir colores que el local no tiene»** (opcional, al final): curva entera, 1 por talle, a quien no tiene ese color.
  - **Solo lo que falta, sin topes fijos** (18/11/2026, para no sobrestockear): a cada local se le repone **venta − (su stock + tránsito)** de ese talle. Si ya tiene igual o más de lo que vendió, **no recibe nada en ninguna etapa** (Repo MITO, Indo, locales, pase extra). Ej.: vendió 2 y tiene 1 → recibe 1; vendió 1 y tiene 3 → nada. Antes la Repo MITO y el pase de Indo reponían toda la venta sin mirar el stock del local. Los huecos y «abrir colores» solo van a talles que el local tiene en 0. El cartel dice cuánto de la venta ya cubría el stock o el tránsito de cada local.
  - **Parámetros**: en el hub salen de los **guardados de la Cascada** (`repo_auto_config.cascada_params`, los que se editan en Cascada → Parámetros). No aplican «cerrados por día» ni feriados (eso es del día que corre la cascada automática).
  - El cartel separa: Repo MITO · Cascada (Indo / locales / pase extra / huecos) · abrir colores · descartadas por mínimo, y la venta sin cubrir por motivo (restricción de proveedor, sin stock de dónde sacar), como el «por qué quedó sin cubrir» de la Cascada.
- **Un clic = resultado final** (18/11/2026): había que apretar Sugerencia 2 veces porque, al recibir, un local empieza a tener «el talle de al lado» (aparecen huecos nuevos) o le cambia la Dif. ideal, y eso recién lo veía la segunda pasada. Ahora repite pasadas solas hasta que no aparezca nada nuevo (máximo 6) y apretar de nuevo no cambia nada. Un local **no dona lo que recibió en la misma sugerencia** (como mucho dona de lo que tenía antes de apretar).
- **El donante resta** (verificado el 18/11/2026: stock − lo que dio + lo que recibió, en todas las celdas). Ej.: BUSTOD S tenía 3, dona 2 → queda 1. Para que se vea quién dona y quién recibe, cada celda cambiada muestra arriba a la izquierda **+1** (verde, recibe) o **−2** (rojo, dona), además del violeta.
- Entra como **una sola acción**: «↶ Volver» la deshace entera. Las celdas cambiadas quedan en violeta y los movimientos aparecen en el panel de abajo, listos para «Cargar en Transferencias».
- Un cartel resume: «60 unidades — 18 por venta y 42 por huecos. Salen de DEPO 50, RUTA9D 2…» y, si algo no se pudo cubrir por falta de stock, cuánto.
- En el hub: mejor **reusar el motor de `puente-sql/cascada.js`** (pasarlo a un módulo compartido que corra en el navegador) que reescribirlo, así la sugerencia y la Cascada nunca se separan. Sin pedir nada al Puente: usa la foto que ya está en pantalla.

### 4.2 quater · Pantalla completa de la tabla (pedido del 18/11/2026)
- Botón **«⛶ Pantalla completa»** arriba de la tabla. Pasa a pantalla completa la ruta de los vehículos + la grilla (no los filtros ni el panel de movimientos); la grilla se estira a todo el alto que queda.
- Arriba se ve el resumen de lo armado (filtros, SKU, locales, período) y el botón cambia a **«✕ Salir de pantalla completa»**. También se sale con Esc.
- Usa la pantalla completa del navegador (`requestFullscreen`); si el navegador no la deja, ocupa toda la ventana igual.
- El gráfico del doble clic en el color se ve también en pantalla completa.
- **↶ Volver / ↷ Adelante** van en la cabecera de la tabla (junto a los tildes y la Sugerencia), así se ven y se usan también en pantalla completa (18/11/2026). Ctrl+Z / Ctrl+Y siguen andando.

### 4.3 Front
- `src/pages/RepartoTransferencias.tsx`: pantalla con los 3 pasos y el estado.
- `src/components/reparto/FiltrosReparto.tsx`: paso 1 (chips de proveedor/línea/grupo/material desde `articulos`, artículo, locales, período) y botón **Armar**.
- `src/components/reparto/GrillaReparto.tsx`: la grilla con scroll virtual (24 px por fila) y edición tipo Excel, portada del `app.js` del rar (copiar/pegar, selección, deshacer/rehacer).
  - **Sin desplazamiento horizontal** (pedido del 18/11/2026): tabla al 100 % del ancho con `table-layout: fixed`; artículo, descripción, color, talle y Rem. con ancho fijo en %, y los locales se reparten en partes iguales lo que queda. La letra se achica con el ancho (`clamp`) y los textos que no entran se cortan con «…» (descripción completa al pasar el mouse). Nombres cortos en el encabezado: WALMARTD→WALMRT, 9DEJULIO→9DEJUL, GRALPAZ→GPAZ. Solo queda el scroll vertical de las filas.
- `src/lib/reparto.ts`: modelo (`buildModel`), resumen (posturas / ideal / diferencia), `calcRemitos`, export Excel. Funciones puras, fáciles de probar.
- `src/lib/repartoApi.ts`: llamada al puente con repregunta.
- `TransferenciasHub.tsx`: tarjeta nueva con color que no repita (`coloresUnicos`).
- Estilo glass, claro/oscuro con los tokens del hub, 100 % del ancho.

## 5. Cosas del rar para revisar o corregir al portar

- **Stock ideal en números redondos** (pedido del 18/11/2026): `Math.round` del ideal de cada local; «Dif. ideal» = stock real − ideal redondeado, así las dos filas quedan enteras (el rar mostraba un decimal).
- **Stock ideal**: suma el stock de los locales **hasta DEPO** y la venta **hasta CFR4** por posición en la lista (`iD`, `iC`). Funciona por el orden fijo; en el hub conviene marcarlo explícito (qué locales cuentan para stock y cuáles para venta). ¿MAYORD y POLO52 quedan fuera a propósito?
- **Remitos**: el emparejado origen → destino es en el orden de las columnas (el primer local que bajó le manda al primero que subió). Se podría priorizar por cercanía o por prioridad de local, como la cascada. *Para charlar.*
- `guardarMovimientos` mandaba un POST por renglón y si se apretaba dos veces duplicaba todo. En el hub es una sola RPC y no repite el lote.
- Texto con acentos rotos («acciÃ³n») en `app.js`.
- Columnas `LOC1`/`LOC2` del Excel de remitos siempre vacías; `BUSTOS` en el Excel y `BUSTOD` en pantalla. Mantener solo si lo pide quien lo importa.
- El grupo para filtrar sale del último paréntesis de la descripción; con el maestro del DWH ya viene limpio (y se suman proveedor, material, temporada).

## 6. Fases

1. **Fase 1**: pantalla con los 3 pasos (filtrar → Armar → lote), acción `reparto_stock` en el Puente, grilla y **Cargar en Transferencias**. Sin import de Excel (descartado el 18/11/2026).
2. **Fase 2**: guardar repartos a medio hacer en Supabase (`reparto_borradores`).
3. **Fase 3** (opcional): sugerencia automática del reparto según stock ideal, usando el motor de la cascada.

## 7. Preguntas abiertas

1. ¿Quién lo usa? ¿Solo Compras/Análisis (`transferencias.import`) o también Depósito Indo?
2. ¿Los movimientos cargan directo como lote, o primero quedan «pendientes» para que alguien los apruebe?
3. Stock ideal: ¿qué locales entran en el cálculo (hoy hasta DEPO para stock, hasta CFR4 para venta)?
4. MAYORD: ¿stock de la vista del DWH o stock real de MITO (físico − comprometido)?
5. Género: ¿de qué columna sale en el tablero de Power BI? (no está en la tabla `articulos` del hub).

Resueltas: ~~importar Excel~~ → no se usa, siempre del Puente. ~~¿todo o filtrado?~~ → siempre se filtra primero.

## 8. Armado en el hub (18/11/2026, sin subir)

Probado en local con datos reales (copia del Puente en :3199 + `scripts/mock-reparto.mjs` en :4177 + `npm run dev`): pantalones MOCF S27 = 27 artículos, 309 SKU, ~65 s la primera lectura del DWH.

- **Puente (solo lectura)**: `puente-sql/reparto.js`, `sql/reparto-opciones.sql` (~6 s, se guarda 1 h) y `sql/reparto-stock.sql` (foto por filtro + fechas, 5 min, por detrás con «calculando»). Acciones `reparto_opciones` y `reparto_stock` en `server.js` (hay que reiniciar el puente al subir). Tope 600 artículos por filtro.
  - Tránsito: en el DWH es una marca 0/1 por SKU, no cantidad → la grilla muestra 🚚 sin número.
  - Venta neta (las devoluciones restan). MAYORD = stock real de MITO (COMB, físico − comprometido). DEPO = INDOD, POLO52 = Polo. CENTRALD/OUTLETD/NOMED/FABRICA no entran.
  - Género = categoría del artículo en Dragon (ART.CATEARTI → CATEGART).
- **API**: `src/lib/repartoApi.ts`, ruta `GET|POST /api/sql/reparto` en `api/sql/[ruta].ts` (no suma funciones).
- **Supabase** (`sql/reparto_transferencias.sql`, SIN aplicar): `reparto_cargar_transferencias(nombre, obs, items)` y `reparto_rutas_vehiculos(fecha)`. Mientras no esté, la ruta se arma con las tablas del Tracking (el admin las ve) y «Cargar» avisa que falta el SQL.
- **Front**: `src/pages/RepartoTransferencias.tsx`, `src/lib/reparto.ts` (motor y sugerencia), `src/components/reparto/{GrillaReparto,GraficoStockVenta,FiltroDesplegable}.tsx`. Tarjeta en `TransferenciasHub.tsx`, ruta `/transferencias/reparto` (permiso `transferencias.import`).
- **Tracking**: las bases son los códigos «CLIENTE REPO» (RIVED, GPAZD, NCEND2…) → `BASE_TRACKING` en `reparto.ts`. MAXD (Mariano Max) no está en el reparto.
- Dif. ideal vacía en MAYORD y POLO52 (no venden).
- Al subir: aplicar el SQL, reiniciar el puente, sacar la línea `/api/sql/reparto` del proxy de `vite.config.ts`, actualizar `docs/mapa`, commit y push.
