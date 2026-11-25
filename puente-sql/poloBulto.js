/**
 * Polo 52 > Mapeo de bultos: artículos de un bulto que llegó a Polo 52 (SOLO LECTURA).
 *
 *   POST / { accion: 'polo_bulto', origen: 'MITO', numeros: [{ pv: 1|null, num: 16050 }] }
 *
 * Cuando un bulto llega, Dragon importa la transferencia en DRAGONFISH_POLO52 como un ingreso
 * (MTRANS con DIRMOV = 1): ORIGDEST = base de origen como la llama Dragon (GPAZD, NCEND2…),
 * BDALTAFW = nombre de la base (GRALPAZ, NVOCED2…), ORIGPVTA/ORIGNRO = punto de venta y número
 * del remito de origen (el «nro interno» del QR de Transporte). Los artículos están en DETMTRANS
 * (NUMR = MTRANS.CODIGO, que es el mismo CODIGO del remito en la base de origen).
 *
 * Primero busca por origen + número; si el origen del QR no coincide con ninguno (alias distinto),
 * acepta el número solo cuando hay un único origen posible y lo avisa.
 */

const ORIGEN = /^[A-Z0-9-]{1,20}$/
const sinGuion = (s) => String(s ?? '').replace(/[^A-Z0-9]/gi, '').toUpperCase()

async function accionPoloBulto(srv, asegurarConexion, body) {
  const origen = String(body?.origen ?? '').trim().toUpperCase()
  if (!ORIGEN.test(origen)) throw new Error('Origen inválido')
  const numeros = Array.isArray(body?.numeros) ? body.numeros.slice(0, 10) : []
  const lista = numeros
    .map((n) => ({ pv: Number.isInteger(n?.pv) && n.pv > 0 ? n.pv : null, num: Number(n?.num) }))
    .filter((n) => Number.isInteger(n.num) && n.num > 0 && n.num < 1e9)
  if (lista.length === 0) throw new Error('El bulto no trae número de remito')
  if (!srv) throw new Error('Falta el servidor principal')
  await asegurarConexion(srv)

  const req = srv.pool.request()
  const marcas = lista.map((n, i) => {
    req.input(`n${i}`, srv.sql.Int, n.num)
    return `@n${i}`
  })
  const db = '[DRAGONFISH_POLO52].[ZooLogic]'
  const r = await req.query(
    `SELECT M.CODIGO, RTRIM(M.REMITO) AS REMITO, RTRIM(M.ORIGDEST) AS ORIGDEST, RTRIM(M.BDALTAFW) AS BD,
            M.ORIGPVTA, M.ORIGNRO, M.FECHA,
            RTRIM(D.MART) AS MART, RTRIM(D.DESCRIP) AS DESCRIP, RTRIM(D.CCOLOR) AS CCOLOR,
            RTRIM(D.COLTXT) AS COLTXT, RTRIM(D.TALLE) AS TALLE, D.CANTI
       FROM ${db}.[MTRANS] M
       JOIN ${db}.[DETMTRANS] D ON D.NUMR = M.CODIGO
      WHERE M.DIRMOV = 1 AND ISNULL(M.ANULADO, 0) = 0
        AND M.FECHA >= DATEADD(day, -400, GETDATE())
        AND M.ORIGNRO IN (${marcas.join(',')})`,
  )
  const filas = (r.recordset ?? []).filter((f) => {
    const pedido = lista.find((n) => n.num === Number(f.ORIGNRO))
    return pedido && (pedido.pv == null || pedido.pv === Number(f.ORIGPVTA))
  })

  const o = sinGuion(origen)
  const delOrigen = filas.filter((f) => sinGuion(f.ORIGDEST) === o || sinGuion(f.BD) === o)
  let usadas = delOrigen
  let aviso = null
  if (usadas.length === 0 && filas.length > 0) {
    const origenes = [...new Set(filas.map((f) => f.ORIGDEST))]
    if (origenes.length === 1) {
      usadas = filas
      aviso = `En Dragon el origen figura como ${origenes[0]} (el QR dice ${origen})`
    } else {
      return { remitos: [], items: [], error: `Ese número llegó desde ${origenes.join(', ')}: el origen ${origen} no coincide` }
    }
  }
  if (usadas.length === 0) {
    return { remitos: [], items: [], error: 'Todavía no ingresó en Polo 52 en Dragon (o el número no es de un remito)' }
  }

  const txt = (v) => String(v ?? '').trim()
  const remitos = [...new Map(usadas.map((f) => [f.CODIGO, {
    remito: txt(f.REMITO), origen: txt(f.ORIGDEST), base: txt(f.BD),
    fecha: f.FECHA instanceof Date ? f.FECHA.toISOString().slice(0, 10) : txt(f.FECHA).slice(0, 10),
  }])).values()]
  const items = usadas.map((f) => ({
    remito: txt(f.REMITO),
    articulo: txt(f.MART).replace(/\s/g, '').toUpperCase(),
    descripcion: txt(f.DESCRIP) || null,
    color: txt(f.CCOLOR) || null,
    color_nombre: txt(f.COLTXT) || null,
    talle: txt(f.TALLE) || null,
    cantidad: Number(f.CANTI) || 0,
  })).filter((i) => i.articulo)
  return { remitos, items, aviso }
}

module.exports = { accionPoloBulto }
