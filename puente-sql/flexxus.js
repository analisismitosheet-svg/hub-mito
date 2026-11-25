/**
 * Flexxus (Firebird 2.5 en M1T0O1) para el hub: Administración > Flexxus.
 *
 * Se lee por el servidor vinculado FLEXXUS del SQL local (DESKTOP-OA4GU6I):
 * MSDASQL + Firebird ODBC 3.0.1 x64 + cliente Firebird 5 en D:\firebird-cliente,
 * con READONLY=Yes. Ver docs/mapa «Puente SQL y syncs».
 *
 * SOLO LECTURA: todo es SELECT dentro de OPENQUERY. OPENQUERY no acepta
 * parámetros, así que lo único que se interpola son fechas validadas con regex
 * (YYYY-MM-DD) y nada que venga como texto libre.
 *
 *   { accion: 'flexxus', consulta: 'ventas',  desde, hasta } -> { comprobantes }
 *   { accion: 'flexxus', consulta: 'saldos' }                 -> { deuda, hoy }
 *   { accion: 'flexxus', consulta: 'asientos', desde, hasta } -> { lineas, cuentas }  (hasta 93 días)
 *   { accion: 'flexxus', consulta: 'balance',  desde, hasta } -> { cuentas, totales }  (sumas y saldos)
 */

const FECHA = /^\d{4}-\d{2}-\d{2}$/
const DIAS_MAX_ASIENTOS = 93
const CACHE_MS = 2 * 60_000

const cache = new Map()

function validarRango(desde, hasta, maxDias) {
  const d = String(desde ?? '')
  const h = String(hasta ?? '')
  if (!FECHA.test(d) || !FECHA.test(h)) throw new Error('Fechas inválidas (formato AAAA-MM-DD)')
  const t0 = Date.parse(`${d}T00:00:00Z`)
  const t1 = Date.parse(`${h}T00:00:00Z`)
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 < t0) throw new Error('Rango de fechas inválido')
  const dias = (t1 - t0) / 86_400_000 + 1
  if (maxDias && dias > maxDias) throw new Error(`El rango no puede pasar de ${maxDias} días`)
  return { d, h }
}

/** OPENQUERY con el SQL de Firebird adentro (las comillas simples se duplican). */
function oq(sqlFirebird) {
  return `OPENQUERY([FLEXXUS], '${sqlFirebird.replace(/'/g, "''")}')`
}

const txt = (v) => String(v ?? '').trim()
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

async function correr(srv, query) {
  const r = await srv.pool.request().query(query)
  return r.recordset ?? []
}

async function ventas(srv, desde, hasta) {
  const { d, h } = validarRango(desde, hasta, 400)
  // CLASECOMPROBANTE 0 = comprobantes de venta (FA, FB, FE, NC*, ND*); las NC ya vienen en negativo.
  const filas = await correr(
    srv,
    `SELECT CONVERT(char(10), F, 23) AS F, T, PV, N, CLI, RS, TOTAL, IVA, MON, COT
       FROM ${oq(`SELECT c.FECHACOMPROBANTE AS F, c.TIPOCOMPROBANTE AS T, c.NROPUNTODEVENTA AS PV,
                         c.NUMEROCOMPROBANTE AS N, c.CODIGOCLIENTE AS CLI, c.RAZONSOCIAL AS RS,
                         c.TOTAL AS TOTAL, COALESCE(c.IVA1, 0) + COALESCE(c.IVA2, 0) AS IVA,
                         c.CODIGOMONEDA AS MON, COALESCE(c.COTIZACION, 1) AS COT
                    FROM CABEZACOMPROBANTES c
                   WHERE c.CLASECOMPROBANTE = 0 AND COALESCE(c.ANULADA, 0) = 0
                     AND c.FECHACOMPROBANTE BETWEEN '${d}' AND '${h} 23:59:59'`)} q
      ORDER BY F, T, N`,
  )
  return {
    comprobantes: filas.map((f) => {
      const mon = txt(f.MON)
      const cot = num(f.COT) || 1
      const esPesos = !mon || /^PESOS?$/i.test(mon)
      return {
        fecha: txt(f.F),
        tipo: txt(f.T),
        pv: num(f.PV),
        numero: num(f.N),
        cliente: txt(f.CLI),
        razon: txt(f.RS),
        total: num(f.TOTAL),
        iva: num(f.IVA),
        moneda: mon || 'PESOS',
        // en pesos: si el comprobante es en otra moneda se pasa con su cotización
        pesos: esPesos ? num(f.TOTAL) : num(f.TOTAL) * cot,
      }
    }),
  }
}

async function saldos(srv) {
  const filas = await correr(
    srv,
    `SELECT CLI, RS, CUIT, LIM, T, N, CONVERT(char(10), F, 23) AS F, CONVERT(char(10), V, 23) AS V,
            DEBE, MON, COT
       FROM ${oq(`SELECT d.CODIGOCLIENTE AS CLI, cl.RAZONSOCIAL AS RS, cl.CUIT AS CUIT, cl.LIMITECREDITO AS LIM,
                         d.TIPOCOMPROBANTE AS T, d.NUMEROCOMPROBANTE AS N, d.FECHACOMPROBANTE AS F,
                         d.FECHAVENCIMIENTO AS V, d.DEBE AS DEBE, d.CODIGOMONEDA AS MON, COALESCE(d.COTIZACION, 1) AS COT
                    FROM VISTADEUDACLIENTES d
                    LEFT JOIN CLIENTES cl ON cl.CODIGOCLIENTE = d.CODIGOCLIENTE
                   WHERE d.DEBE <> 0`)} q
      ORDER BY CLI, F`,
  )
  return {
    hoy: new Date().toISOString().slice(0, 10),
    deuda: filas.map((f) => {
      const mon = txt(f.MON)
      const esPesos = !mon || /^PESOS?$/i.test(mon)
      return {
        cliente: txt(f.CLI),
        razon: txt(f.RS),
        cuit: txt(f.CUIT),
        limite: num(f.LIM),
        tipo: txt(f.T),
        numero: num(f.N),
        fecha: txt(f.F),
        vence: txt(f.V),
        saldo: esPesos ? num(f.DEBE) : num(f.DEBE) * (num(f.COT) || 1),
        moneda: mon || 'PESOS',
      }
    }),
  }
}

async function planDeCuentas(srv) {
  const filas = await correr(
    srv,
    `SELECT CUENTA, DESCRIPCION, MADRE, IMPUTABLE, PATRIMONIAL
       FROM ${oq(`SELECT p.CUENTA AS CUENTA, p.DESCRIPCION AS DESCRIPCION, p.CUENTAMADRE AS MADRE,
                         p.IMPUTABLE AS IMPUTABLE, p.PATRIMONIAL AS PATRIMONIAL
                    FROM PLANDECUENTAS p`)} q`,
  )
  return filas.map((f) => ({
    cuenta: txt(f.CUENTA),
    descripcion: txt(f.DESCRIPCION),
    madre: txt(f.MADRE),
    imputable: num(f.IMPUTABLE) === 1,
    patrimonial: num(f.PATRIMONIAL) === 1,
  }))
}

async function asientos(srv, desde, hasta) {
  const { d, h } = validarRango(desde, hasta, DIAS_MAX_ASIENTOS)
  const [filas, cuentas] = await Promise.all([
    correr(
      srv,
      `SELECT A, NUM, CONVERT(char(10), F, 23) AS F, OBS, L, CTA, MONTO, DEBE
         FROM ${oq(`SELECT c.CODIGOASIENTO AS A, c.NUMEROASIENTO AS NUM, c.FECHA AS F, c.OBSERVACIONES AS OBS,
                           d.LINEA AS L, d.CUENTA AS CTA, d.MONTO AS MONTO, d.ESDEBE AS DEBE
                      FROM CABEZAASIENTOS c
                      JOIN CUERPOASIENTOS d ON d.CODIGOASIENTO = c.CODIGOASIENTO
                     WHERE c.FECHA BETWEEN '${d}' AND '${h} 23:59:59'`)} q
        ORDER BY F, NUM, A, L`,
    ),
    planDeCuentas(srv),
  ])
  // Compacto: la observación va una vez por asiento, no por línea
  const cab = new Map()
  const lineas = []
  for (const f of filas) {
    const a = num(f.A)
    if (!cab.has(a)) cab.set(a, { asiento: a, numero: num(f.NUM), fecha: txt(f.F), obs: txt(f.OBS) })
    lineas.push([a, txt(f.CTA), num(f.MONTO), num(f.DEBE) === 1 ? 1 : 0])
  }
  return { asientos: [...cab.values()], lineas, cuentas }
}

async function balance(srv, desde, hasta) {
  const { d, h } = validarRango(desde, hasta, 800)
  const [filas, cuentas] = await Promise.all([
    correr(
      srv,
      `SELECT CTA, DEBE, HABER, N
         FROM ${oq(`SELECT d.CUENTA AS CTA,
                           SUM(CASE WHEN d.ESDEBE = 1 THEN d.MONTO ELSE 0 END) AS DEBE,
                           SUM(CASE WHEN d.ESDEBE = 1 THEN 0 ELSE d.MONTO END) AS HABER,
                           COUNT(*) AS N
                      FROM CABEZAASIENTOS c
                      JOIN CUERPOASIENTOS d ON d.CODIGOASIENTO = c.CODIGOASIENTO
                     WHERE c.FECHA BETWEEN '${d}' AND '${h} 23:59:59'
                     GROUP BY d.CUENTA`)} q`,
    ),
    planDeCuentas(srv),
  ])
  return {
    movimientos: filas.map((f) => ({ cuenta: txt(f.CTA), debe: num(f.DEBE), haber: num(f.HABER), lineas: num(f.N) })),
    cuentas,
  }
}

/**
 * @param srv servidor local (SQL2) con el servidor vinculado FLEXXUS
 * @param asegurarConexion la de server.js
 */
async function accionFlexxus(srv, asegurarConexion, body) {
  if (!srv) throw new Error('Falta el servidor local (SQL2_*) con el servidor vinculado FLEXXUS')
  const consulta = String(body?.consulta ?? '')
  if (!['ventas', 'saldos', 'asientos', 'balance'].includes(consulta)) throw new Error('Consulta de Flexxus inválida')
  const clave = `${consulta}|${body?.desde ?? ''}|${body?.hasta ?? ''}`
  const hay = cache.get(clave)
  if (!body?.forzar && hay && Date.now() - hay.en < CACHE_MS) return { ...hay.datos, calculado: new Date(hay.en).toISOString(), cacheado: true }

  await asegurarConexion(srv)
  const t0 = Date.now()
  let datos
  if (consulta === 'ventas') datos = await ventas(srv, body?.desde, body?.hasta)
  else if (consulta === 'saldos') datos = await saldos(srv)
  else if (consulta === 'asientos') datos = await asientos(srv, body?.desde, body?.hasta)
  else datos = await balance(srv, body?.desde, body?.hasta)

  const en = Date.now()
  cache.set(clave, { en, datos })
  // No dejar crecer el cache con rangos viejos
  for (const [k, v] of cache) if (en - v.en > CACHE_MS) cache.delete(k)
  return { ...datos, calculado: new Date(en).toISOString(), cacheado: false, segundos: Math.round((en - t0) / 100) / 10 }
}

module.exports = { accionFlexxus }
