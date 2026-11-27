/**
 * TABLERO LOCALES (hub: Administración > Tablero locales). SOLO LECTURA.
 *
 * Las hojas CAJA y ERRORES DE CAJA del Tablero del local (D:\pbi a html\pwa-locales,
 * src/consultas/venta.js), pero para varios locales a la vez: cada local se lee de su base
 * DRAGONFISH_* en el servidor donde está al día (réplicas de esta PC o el principal), con la
 * misma lista que la consulta de precios (STOCK_PUBLICO_LOCALES de server.js).
 *
 *   accion 'tablero_locales' body:
 *     { hoja: 'caja',      desde, hasta, locales: [cod] }
 *         -> { locales: [{ local, ok, error?, dias, valores, vendedores, comprobantes, arqueos, cierres }] }
 *     { hoja: 'billetes',  local, arqueo }               -> { billetes }
 *     { hoja: 'errores',   desde, hasta, locales: [cod] } -> { filas, fallidos }
 *     { hoja: 'articulos', local, codigo }               -> { articulos }
 *
 * Criterios (los del tablero / PBI):
 *   venta   = renglones de comprobantes no anulados, sin remitos ni vendedores web (999, 992);
 *             las notas de crédito restan.
 *   caja    = cobros (VAL) de comprobantes no anulados, sin remitos (salvo DEVOLUCION) ni vendedor 999.
 *   errores = cobros por comprobante, no anulados y sin remitos.
 * Cache 60 s por pedido. Cada base tiene su tope de tiempo: si una falla, el resto responde igual.
 */

const FECHA = /^\d{4}-\d{2}-\d{2}$/
const CODIGO = /^[A-Za-z0-9 _.-]{1,40}$/
const SIGNO = `CASE WHEN c.DESCFW LIKE '%NOTADECREDITO%' THEN -1 ELSE 1 END`
const MAX_DIAS = 62
const TOPE_BASE_MS = 20_000
const CACHE_MS = 60_000

function crear({ locales, servidor, asegurarConexion, conTope }) {
  const porCodigo = new Map(locales.map(([cod, base, donde]) => [cod, { cod, base, donde }]))
  const cache = new Map()

  const localDe = (cod) => {
    const l = porCodigo.get(String(cod ?? '').trim().toUpperCase())
    if (!l) throw new Error(`Local no habilitado: ${cod}`)
    return l
  }
  const listaLocales = (arr) => {
    const cods = [...new Set((Array.isArray(arr) ? arr : []).map((c) => String(c ?? '').trim().toUpperCase()).filter(Boolean))]
    return (cods.length ? cods : [...porCodigo.keys()]).map(localDe)
  }
  function rango(body) {
    const desde = String(body?.desde ?? '').trim()
    const hasta = String(body?.hasta ?? '').trim()
    if (!FECHA.test(desde) || !FECHA.test(hasta) || desde > hasta) throw new Error('Fechas inválidas (AAAA-MM-DD)')
    const dias = (new Date(`${hasta}T12:00:00`) - new Date(`${desde}T12:00:00`)) / 86_400_000
    if (dias > MAX_DIAS) throw new Error(`Como mucho ${MAX_DIAS} días`)
    return { desde, hasta }
  }

  async function consultar(l, texto, params) {
    const srv = servidor(l.donde)
    await asegurarConexion(srv)
    const req = srv.pool.request()
    for (const [k, v] of Object.entries(params)) req.input(k, srv.sql.VarChar(40), v)
    const r = await conTope(req.query(`SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;\n${texto}`), TOPE_BASE_MS, l.cod)
    return r.recordsets ?? []
  }

  async function conCache(clave, fn) {
    const c = cache.get(clave)
    if (c && Date.now() - c.en < CACHE_MS) return c.datos
    const datos = await fn()
    cache.set(clave, { en: Date.now(), datos })
    if (cache.size > 300) cache.clear()
    return datos
  }

  /* ---------------- CAJA (un local) ---------------- */
  function sqlCaja(db) {
    const Z = `[${db}].[ZooLogic]`
    const VENTA_CAJA = `c.ANULADO = 0 AND (c.DESCFW NOT LIKE '%REMITO%' OR c.DESCFW LIKE 'DEVOLUCION%') AND CHARINDEX('999', c.FVEN) = 0`
    const ES_VENTA = `c.ANULADO = 0 AND c.DESCFW NOT LIKE '%REMITO%' AND RTRIM(c.FVEN) NOT IN ('999','992')`
    return `
DECLARE @d date = CONVERT(date, @desde, 23), @h date = DATEADD(day, 1, CONVERT(date, @hasta, 23));

-- 1) venta por día (como el tablero: renglones con signo)
SELECT CONVERT(char(10), c.FFCH, 23) AS fecha, SUM(d.MNTPTOT * ${SIGNO}) AS monto,
       SUM(d.FCANT * ${SIGNO}) AS unidades, COUNT(DISTINCT c.CODIGO) AS tickets
  FROM ${Z}.COMPROBANTEVDET d JOIN ${Z}.COMPROBANTEV c ON c.CODIGO = d.CODIGO
 WHERE c.FFCH >= @d AND c.FFCH < @h AND ${ES_VENTA}
 GROUP BY CONVERT(char(10), c.FFCH, 23) ORDER BY fecha;

-- 2) venta por valor (medio de pago) con su grupo
SELECT RTRIM(val.JJCO) AS id, MAX(RTRIM(x.CLNOM)) AS nombre, MAX(ISNULL(RTRIM(x.CLGRUP), '')) AS grupo,
       SUM(val.RECMONTO) AS recargo, SUM(val.JJRECIB * ${SIGNO}) AS monto
  FROM ${Z}.VAL val JOIN ${Z}.COMPROBANTEV c ON c.CODIGO = val.JJNUM
  LEFT JOIN ${Z}.XVAL x ON x.CLCOD = val.JJCO
 WHERE c.FFCH >= @d AND c.FFCH < @h AND ${VENTA_CAJA}
 GROUP BY RTRIM(val.JJCO);

-- 3) ventas por vendedor
SELECT RTRIM(c.FVEN) AS id, MAX(RTRIM(v.DESCFW)) AS nombre,
       COUNT(DISTINCT CASE WHEN c.DESCFW NOT LIKE '%NOTADECREDITO%' THEN c.CODIGO END) AS tickets,
       MIN(CONVERT(char(10), c.FFCH, 23) + ' ' + RTRIM(c.HALTAFW)) AS primeraVenta,
       MAX(CONVERT(char(10), c.FFCH, 23) + ' ' + RTRIM(c.HALTAFW)) AS ultimaVenta,
       SUM(d.FCANT * ${SIGNO}) AS unidades, SUM(d.MNTPTOT * ${SIGNO}) AS monto
  FROM ${Z}.COMPROBANTEVDET d JOIN ${Z}.COMPROBANTEV c ON c.CODIGO = d.CODIGO
  LEFT JOIN ${Z}.VEN v ON v.CLCOD = c.FVEN
 WHERE c.FFCH >= @d AND c.FFCH < @h AND ${VENTA_CAJA}
 GROUP BY RTRIM(c.FVEN);

-- 4) comprobantes de caja
SELECT CONVERT(char(10), cc.FECHA, 23) AS fecha, RTRIM(cc.HALTAFW) AS hora, cc.NUMERO AS numero, RTRIM(cc.ORIGDEST) AS origdest,
       RTRIM(cc.VENDEDOR) + ' - ' + ISNULL(RTRIM(v.DESCFW), '') AS vendedor, RTRIM(cc.CONCEPTO) AS concepto,
       RTRIM(k.DESCRIP) AS conceptoDesc, CASE WHEN cc.SIGNOMOV = -1 THEN 'SALIDA' ELSE 'ENTRADA' END AS tipo,
       RTRIM(CAST(cc.COBS AS varchar(500))) AS observaciones,
       (SELECT SUM(dd.MONTO) FROM ${Z}.COMPCAJADET dd WHERE dd.CODDETVAL = cc.CODIGO) * CASE WHEN cc.SIGNOMOV = -1 THEN -1 ELSE 1 END AS total
  FROM ${Z}.COMCAJ cc
  LEFT JOIN ${Z}.VEN v ON v.CLCOD = cc.VENDEDOR
  LEFT JOIN ${Z}.CONCECAJA k ON k.CODIGO = cc.CONCEPTO
 WHERE cc.FECHA >= @d AND cc.FECHA < @h
 ORDER BY cc.FECHA, cc.HALTAFW;

-- 5) arqueos
SELECT RTRIM(a.CODIGO) AS codigo, a.NUMERO AS numero, CONVERT(char(10), a.FALTAFW, 23) AS fecha, RTRIM(a.HALTAFW) AS hora,
       RTRIM(a.VENDEDOR) + ' - ' + ISNULL(RTRIM(v.DESCFW), '') AS vendedor,
       (SELECT SUM(t.DIFGRUPO) FROM ${Z}.ARQTOTDET t WHERE t.CODIGO = a.CODIGO) AS diferencia,
       (SELECT SUM(t.ARQUEADO) FROM ${Z}.ARQTOTDET t WHERE t.CODIGO = a.CODIGO) AS arqueado,
       (SELECT SUM(t.TOTGRUPO) FROM ${Z}.ARQTOTDET t WHERE t.CODIGO = a.CODIGO) AS sistema
  FROM ${Z}.ARQCAJA a LEFT JOIN ${Z}.VEN v ON v.CLCOD = a.VENDEDOR
 WHERE a.FALTAFW >= @d AND a.FALTAFW < @h
 ORDER BY a.FALTAFW, a.HALTAFW;

-- 6) cierre de caja por día (concepto CCC)
SELECT CONVERT(char(10), cc.FECHA, 23) AS fecha, MIN(RTRIM(cc.HALTAFW)) AS hora FROM ${Z}.COMCAJ cc
 WHERE cc.FECHA >= @d AND cc.FECHA < @h AND cc.CONCEPTO = 'CCC'
 GROUP BY CONVERT(char(10), cc.FECHA, 23) ORDER BY fecha;`
  }

  const num = (v) => (v == null ? 0 : Number(v) || 0)

  async function cajaLocal(l, desde, hasta) {
    const [dias = [], valores = [], vendedores = [], comprobantes = [], arqueos = [], cierres = []] = await consultar(l, sqlCaja(l.base), { desde, hasta })
    return {
      local: l.cod,
      ok: true,
      dias: dias.map((d) => ({ fecha: d.fecha, monto: num(d.monto), unidades: num(d.unidades), tickets: num(d.tickets) })),
      valores: valores.map((v) => ({ id: v.id, nombre: v.nombre ?? '', grupo: v.grupo ?? '', recargo: num(v.recargo), monto: num(v.monto) })),
      vendedores: vendedores.map((v) => ({ ...v, tickets: num(v.tickets), unidades: num(v.unidades), monto: num(v.monto) })),
      comprobantes: comprobantes.map((c) => ({ ...c, total: num(c.total) })),
      arqueos: arqueos.map((a) => ({ ...a, diferencia: num(a.diferencia), arqueado: num(a.arqueado), sistema: num(a.sistema) })),
      cierres,
    }
  }

  async function caja(body) {
    const { desde, hasta } = rango(body)
    const ls = listaLocales(body?.locales)
    const res = await Promise.allSettled(
      ls.map((l) => conCache(`caja|${l.cod}|${desde}|${hasta}`, () => cajaLocal(l, desde, hasta))),
    )
    return {
      desde,
      hasta,
      locales: res.map((r, i) => (r.status === 'fulfilled' ? r.value : { local: ls[i].cod, ok: false, error: String(r.reason?.message ?? r.reason).slice(0, 300) })),
    }
  }

  async function billetes(body) {
    const l = localDe(body?.local)
    const arqueo = String(body?.arqueo ?? '').trim()
    if (!CODIGO.test(arqueo)) throw new Error('Arqueo inválido')
    const [filas = []] = await consultar(
      l,
      `SELECT NROITEM AS orden, RTRIM(DESCRI) AS billete, CANT AS cantidad, TOT AS total
         FROM [${l.base}].[ZooLogic].ARQEFECTDET
        WHERE CODIGO = @arqueo AND RTRIM(MONEDADEN) = 'PESOS' AND TOT <> 0 ORDER BY NROITEM;`,
      { arqueo },
    )
    return { billetes: filas.map((f) => ({ billete: f.billete, cantidad: num(f.cantidad), total: num(f.total) })) }
  }

  /* ---------------- ERRORES DE CAJA ---------------- */
  async function erroresLocal(l, desde, hasta) {
    const Z = `[${l.base}].[ZooLogic]`
    const [filas = []] = await consultar(
      l,
      `DECLARE @d date = CONVERT(date, @desde, 23), @h date = DATEADD(day, 1, CONVERT(date, @hasta, 23));
       SELECT TOP 2000 RTRIM(c.CODIGO) AS codigo, CONVERT(char(10), c.FFCH, 23) AS fecha, RTRIM(c.HALTAFW) AS hora, RTRIM(c.DESCFW) AS factura,
              RTRIM(val.JJCO) AS valor, RTRIM(x.CLNOM) AS valorDesc,
              val.JJRECIB * ${SIGNO} AS recibi, val.RECMONTO * ${SIGNO} AS recargo, val.JJTOTFAC * ${SIGNO} AS totalFactura,
              RTRIM(c.FVEN) AS vendedor
         FROM ${Z}.VAL val
         JOIN ${Z}.COMPROBANTEV c ON c.CODIGO = val.JJNUM
         LEFT JOIN ${Z}.XVAL x ON x.CLCOD = val.JJCO
        WHERE c.FFCH >= @d AND c.FFCH < @h AND c.ANULADO = 0 AND c.DESCFW NOT LIKE '%REMITO%'
        ORDER BY c.FFCH DESC, c.HALTAFW DESC;`,
      { desde, hasta },
    )
    return filas.map((f) => ({ ...f, local: l.cod, recibi: num(f.recibi), recargo: num(f.recargo), totalFactura: num(f.totalFactura) }))
  }

  async function errores(body) {
    const { desde, hasta } = rango(body)
    const ls = listaLocales(body?.locales)
    const res = await Promise.allSettled(ls.map((l) => conCache(`err|${l.cod}|${desde}|${hasta}`, () => erroresLocal(l, desde, hasta))))
    const filas = []
    const fallidos = []
    res.forEach((r, i) => (r.status === 'fulfilled' ? filas.push(...r.value) : fallidos.push({ local: ls[i].cod, error: String(r.reason?.message ?? r.reason).slice(0, 300) })))
    filas.sort((a, b) => `${b.fecha} ${b.hora}`.localeCompare(`${a.fecha} ${a.hora}`))
    return { desde, hasta, filas: filas.slice(0, 8000), recortado: filas.length > 8000, fallidos }
  }

  async function articulos(body) {
    const l = localDe(body?.local)
    const codigo = String(body?.codigo ?? '').trim()
    if (!CODIGO.test(codigo)) throw new Error('Comprobante inválido')
    const Z = `[${l.base}].[ZooLogic]`
    const [filas = []] = await consultar(
      l,
      `SELECT RTRIM(d.FART) AS articulo, RTRIM(a.ARTDESADIC) AS descripcion, RTRIM(d.CCOLOR) AS color, RTRIM(d.TALLE) AS talle,
              d.FCANT AS unidades, d.FPRECIO AS precio, d.MNTPTOT AS monto, d.MNDESCI AS dtoPromo
         FROM ${Z}.COMPROBANTEVDET d LEFT JOIN ${Z}.ART a ON a.ARTCOD = d.FART
        WHERE d.CODIGO = @codigo ORDER BY d.FART;`,
      { codigo },
    )
    return { articulos: filas.map((f) => ({ ...f, unidades: num(f.unidades), precio: num(f.precio), monto: num(f.monto), dtoPromo: num(f.dtoPromo) })) }
  }

  async function accion(body) {
    const hoja = String(body?.hoja ?? '')
    if (hoja === 'caja') return caja(body)
    if (hoja === 'billetes') return billetes(body)
    if (hoja === 'errores') return errores(body)
    if (hoja === 'articulos') return articulos(body)
    throw new Error('Hoja inválida')
  }

  return { accion, locales: () => [...porCodigo.keys()] }
}

module.exports = { crear }
