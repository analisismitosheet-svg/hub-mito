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

SELECT c.FNUMCOMP AS remito, CONVERT(char(10), c.FFCH, 23) AS fecha,
       LTRIM(RTRIM(c.FPERSON)) AS cli, LTRIM(RTRIM(ISNULL(cl.CLNOM, ''))) AS cli_nom,
       LTRIM(RTRIM(d.FART)) AS a, LTRIM(RTRIM(d.CCOLOR)) AS c, LTRIM(RTRIM(d.TALLE)) AS t,
       CAST(d.FCANT - ISNULL(af.u, 0) AS int) AS u, CAST(d.FPRECIO AS decimal(18, 2)) AS precio
  INTO #tap
  FROM DRAGONFISH_MITO.ZooLogic.COMPROBANTEV c
  JOIN DRAGONFISH_MITO.ZooLogic.COMPROBANTEVDET d ON d.CODIGO = c.CODIGO
  LEFT JOIN #afe af ON af.AFE_COD = c.CODIGO AND af.AFENROITEM = d.NROITEM
  LEFT JOIN DRAGONFISH_MITO.ZooLogic.CLI cl ON cl.CLCOD = c.FPERSON
 WHERE c.FACTTIPO = 11 AND c.ANULADO = 0
   AND LTRIM(RTRIM(c.FPERSON)) <> '' AND c.FPERSON NOT LIKE '%[^0-9 ]%'
   AND d.FCANT - ISNULL(af.u, 0) > 0;

SELECT * FROM #tap ORDER BY fecha, remito;

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

DROP TABLE #dep; DROP TABLE #afe; DROP TABLE #tap; DROP TABLE #arts;
