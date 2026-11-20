/* ============================================================
   Mayorista > Stock (hub /mayorista/stock). SOLO LECTURA.
   Lo corre el Puente SQL con { accion: 'stock_mayorista' } contra el servidor principal.
   Todo sale de DRAGONFISH_MITO.

   Resultado 1 — DEPÓSITO: stock por artículo + color + talle (ZooLogic.COMB, COCANT > 0)
                 y lo que está en tránsito (ENTRANSITO > 0).
   Resultado 2 — TAPERA: mercadería remitida a clientes que todavía no se facturó.
                 Remitos de venta (FACTTIPO 11) no anulados a clientes mayoristas (código
                 numérico: los locales propios y las cuentas internas tienen código con letras
                 y sus remitos nunca se facturan). Por línea: lo remitido menos lo que le
                 descontaron las facturas y cancelaciones que afectan esa línea
                 (COMPROBANTEVDET.AFE_COD / AFENROITEM con AFETIPOCOM = 11). OJO: el AFESALDO
                 del remito no sirve, Dragon no lo descuenta al facturar.
   Resultado 3 — artículos que aparecen arriba: descripción, material y proveedor (con nombres).
   Resultado 4 — nombres de los colores.
   Resultado 5 — lo que se descontó de Tapera por haber pasado a REPOLOC (ver más abajo).

   Los resultados se agregan al final y nunca se mueven: el puente los lee por posición.
   ============================================================ */
SET NOCOUNT ON;
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

/* 1) Depósito */
SELECT LTRIM(RTRIM(COART)) AS a, LTRIM(RTRIM(COCOL)) AS c, LTRIM(RTRIM(TALLE)) AS t,
       SUM(CASE WHEN COCANT > 0 THEN COCANT ELSE 0 END) AS u,
       SUM(CASE WHEN ENTRANSITO > 0 THEN ENTRANSITO ELSE 0 END) AS tr
  INTO #dep
  FROM DRAGONFISH_MITO.ZooLogic.COMB
 WHERE COCANT > 0 OR ENTRANSITO > 0
 GROUP BY LTRIM(RTRIM(COART)), LTRIM(RTRIM(COCOL)), LTRIM(RTRIM(TALLE));

SELECT a, c, t, CAST(u AS int) AS u, CAST(tr AS int) AS tr FROM #dep;

/* 2) Tapera */
SELECT d.AFE_COD, d.AFENROITEM, SUM(d.FCANT) AS u
  INTO #afe
  FROM DRAGONFISH_MITO.ZooLogic.COMPROBANTEVDET d
  JOIN DRAGONFISH_MITO.ZooLogic.COMPROBANTEV c ON c.CODIGO = d.CODIGO
 WHERE d.AFETIPOCOM = 11 AND c.ANULADO = 0
 GROUP BY d.AFE_COD, d.AFENROITEM;

SELECT c.FNUMCOMP AS remito, CONVERT(char(10), c.FFCH, 23) AS fecha, d.NROITEM AS item,
       LTRIM(RTRIM(c.FPERSON)) AS cli, LTRIM(RTRIM(ISNULL(cl.CLNOM, ''))) AS cli_nom,
       LTRIM(RTRIM(d.FART)) AS a, LTRIM(RTRIM(d.CCOLOR)) AS c, LTRIM(RTRIM(d.TALLE)) AS t,
       CAST(d.FCANT - ISNULL(af.u, 0) AS int) AS u, CAST(d.FPRECIO AS decimal(18, 2)) AS precio
  INTO #tap0
  FROM DRAGONFISH_MITO.ZooLogic.COMPROBANTEV c
  JOIN DRAGONFISH_MITO.ZooLogic.COMPROBANTEVDET d ON d.CODIGO = c.CODIGO
  LEFT JOIN #afe af ON af.AFE_COD = c.CODIGO AND af.AFENROITEM = d.NROITEM
  LEFT JOIN DRAGONFISH_MITO.ZooLogic.CLI cl ON cl.CLCOD = c.FPERSON
 WHERE c.FACTTIPO = 11 AND c.ANULADO = 0
   AND LTRIM(RTRIM(c.FPERSON)) <> '' AND c.FPERSON NOT LIKE '%[^0-9 ]%'
   AND d.FCANT - ISNULL(af.u, 0) > 0;

/* Lo que pasó a REPOLOC (20/11/2026, regla del usuario): cuando la mercadería de un cliente
   pasa a REPOLOC, el remito a REPOLOC lleva en la observación el código del cliente
   ("00891 Cuello Brian", "01054 - M&t", "PEDIDO 4746-01025 Lopez Zanini"). Se toma el primer
   número de la observación (en "PEDIDO nnnn-ccccc", el que va después del guion) y se lo
   compara como número con el código del cliente. Esas unidades se RESTAN de lo pendiente del
   cliente por artículo + color + talle, empezando por sus remitos más viejos, y solo contra
   remitos del cliente de la misma fecha o anteriores al remito a REPOLOC. */
SELECT c.CODIGO, c.FNUMCOMP AS rp_remito, c.FFCH AS rp_fecha, CAST(c.FOBS AS varchar(400)) AS obs
  INTO #rp0
  FROM DRAGONFISH_MITO.ZooLogic.COMPROBANTEV c
 WHERE c.FPERSON = 'REPOLOC' AND c.FACTTIPO = 11 AND c.ANULADO = 0;

SELECT CODIGO, rp_remito, rp_fecha,
       CASE WHEN obs LIKE '%PEDIDO%[0-9]-[0-9]%'
            THEN SUBSTRING(obs, PATINDEX('%[0-9]-[0-9]%', obs) + 2, 400) ELSE obs END AS obs2
  INTO #rp1 FROM #rp0;

SELECT CODIGO, rp_remito, rp_fecha,
       TRY_CAST(LEFT(SUBSTRING(obs2, PATINDEX('%[0-9]%', obs2), 400),
                     PATINDEX('%[^0-9]%', SUBSTRING(obs2, PATINDEX('%[0-9]%', obs2), 400) + 'x') - 1) AS int) AS cli_num
  INTO #rp
  FROM #rp1 WHERE PATINDEX('%[0-9]%', obs2) > 0;

/* Por cada línea pendiente: cuánto de lo mandado a REPOLOC para ese cliente/SKU (posterior o del
   mismo día) le toca, repartido de la más vieja a la más nueva. */
SELECT t.*, ROW_NUMBER() OVER (ORDER BY t.fecha, t.remito, t.item) AS orden,
       TRY_CAST(t.cli AS int) AS cli_num
  INTO #tap1 FROM #tap0 t;

SELECT t.remito, t.item, t.cli,
       ISNULL((SELECT SUM(d.FCANT) FROM #rp r
                 JOIN DRAGONFISH_MITO.ZooLogic.COMPROBANTEVDET d ON d.CODIGO = r.CODIGO
                WHERE r.cli_num = t.cli_num AND r.rp_fecha >= t.fecha
                  AND LTRIM(RTRIM(d.FART)) = t.a AND LTRIM(RTRIM(d.CCOLOR)) = t.c AND LTRIM(RTRIM(d.TALLE)) = t.t), 0) AS rep_disp,
       ISNULL((SELECT SUM(t2.u) FROM #tap1 t2
                WHERE t2.cli_num = t.cli_num AND t2.a = t.a AND t2.c = t.c AND t2.t = t.t AND t2.orden < t.orden), 0) AS antes
  INTO #asig FROM #tap1 t;

SELECT t.remito, t.fecha, t.cli, t.cli_nom, t.a, t.c, t.t,
       CAST(t.u - CASE WHEN x.rep_disp - x.antes <= 0 THEN 0
                       WHEN x.rep_disp - x.antes >= t.u THEN t.u
                       ELSE x.rep_disp - x.antes END AS int) AS u,
       t.precio,
       CAST(CASE WHEN x.rep_disp - x.antes <= 0 THEN 0
                 WHEN x.rep_disp - x.antes >= t.u THEN t.u
                 ELSE x.rep_disp - x.antes END AS int) AS rep
  INTO #tap
  FROM #tap1 t JOIN #asig x ON x.remito = t.remito AND x.item = t.item AND x.cli = t.cli;

SELECT remito, fecha, cli, cli_nom, a, c, t, u, precio FROM #tap WHERE u > 0 ORDER BY fecha, remito;

/* 3) Artículos */
SELECT DISTINCT a INTO #arts FROM (SELECT a FROM #dep UNION SELECT a FROM #tap) x;

SELECT x.a, LTRIM(RTRIM(ISNULL(ar.ARTDES, ''))) AS des,
       LTRIM(RTRIM(ISNULL(ar.MAT, ''))) AS mat, LTRIM(RTRIM(ISNULL(m.MATDES, ''))) AS mat_nom,
       LTRIM(RTRIM(ISNULL(ar.ARTFAB, ''))) AS prov, LTRIM(RTRIM(ISNULL(p.CLNOM, ''))) AS prov_nom
  FROM #arts x
  LEFT JOIN DRAGONFISH_MITO.ZooLogic.ART ar ON LTRIM(RTRIM(ar.ARTCOD)) = x.a
  LEFT JOIN DRAGONFISH_MITO.ZooLogic.MAT m ON m.MATCOD = ar.MAT
  LEFT JOIN DRAGONFISH_MITO.ZooLogic.PROV p ON p.CLCOD = ar.ARTFAB;

/* 4) Colores */
SELECT LTRIM(RTRIM(COLCOD)) AS c, LTRIM(RTRIM(ISNULL(COLDES, ''))) AS des
  FROM DRAGONFISH_MITO.ZooLogic.COL
 WHERE LTRIM(RTRIM(COLCOD)) IN (SELECT c FROM #dep UNION SELECT c FROM #tap);

/* 5) Lo descontado por haber pasado a REPOLOC (para mostrarlo en la pantalla) */
SELECT t.remito, t.fecha, t.cli, t.cli_nom, t.a, t.c, t.t, t.rep AS u, t.precio,
       STUFF((SELECT DISTINCT ',' + CAST(r.rp_remito AS varchar(12)) FROM #rp r
                JOIN DRAGONFISH_MITO.ZooLogic.COMPROBANTEVDET d ON d.CODIGO = r.CODIGO
               WHERE r.cli_num = TRY_CAST(t.cli AS int) AND r.rp_fecha >= t.fecha
                 AND LTRIM(RTRIM(d.FART)) = t.a AND LTRIM(RTRIM(d.CCOLOR)) = t.c AND LTRIM(RTRIM(d.TALLE)) = t.t
               FOR XML PATH('')), 1, 1, '') AS rp_remitos
  FROM #tap t WHERE t.rep > 0 ORDER BY t.fecha, t.remito;

DROP TABLE #dep; DROP TABLE #afe; DROP TABLE #tap; DROP TABLE #arts;
DROP TABLE #tap0; DROP TABLE #tap1; DROP TABLE #asig; DROP TABLE #rp0; DROP TABLE #rp1; DROP TABLE #rp;
