/**
 * ANÁLISIS VENTAS (hub: Compras > Análisis ventas, solo admin). SOLO LECTURA.
 *
 *   accion 'analisis_ventas' body: {
 *     desde, hasta ('YYYY-MM-DD'; hasta como mucho ayer), comparar: 'anio' | 'anterior' | 'nada',
 *     gran: 'dia' | 'sem' | 'mes' | 'anio', dim: 'prov' | 'linea' | ... | 'local' | 'art',
 *     camino: [{ dim, cod }] (apertura: fila tocada en la tabla), corte: 'dia' | 'anio' (cuadro por año),
 *     filtros: { prov[], mat[], temp[], anio[], linea[], flia[], gen[], grupo[], locales[], excluir[] (locales que no entran),
 *                origen: ''|'MITO'|'MARCAS', art: 'A|B' },
 *     opciones: true (también manda las opciones de los filtros) }
 *   -> { estado: 'listo', kpis, serie, dow, tabla, anio, marcas, faltan, carga, ... }
 *
 * De dónde sale: sql/analisis-ventas.sql lee COMPROBANTEV/DET de cada base Dragon (las mismas que
 * vw_FACT_VENTAS_STOCK y que la venta del Chat IA) agrupado por comprobante y artículo. Cada día
 * cerrado queda guardado en D:\memoria ia\analisis\AAAA-MM-DD.json y no se vuelve a pedir al SQL.
 * Por detrás se completa el historial desde PUENTE_ANALISIS_DESDE (2024-01-01) de a 14 días.
 *
 * Criterios (los de la vista del DWH):
 *   monto    = MNTPTOT * SIGNOMOV (con IVA, devoluciones restan)
 *   unidades = FCANT * SIGNOMOV (0 si el SKU no existe en la COMB de la base)
 *   ticket   = comprobante de venta distinto (TFC/FEN/FCV); una devolución no suma ticket.
 *              Al abrir por proveedor/línea/etc. un ticket cuenta en cada valor que tenga.
 *   MITO (Zimith / Captain Fin) = proveedores que empiezan con MO; Marcas = el resto.
 */
const fs = require('fs')
const path = require('path')
const memoria = require('./memoria-ia')

const SQL_VENTAS = path.join(__dirname, 'sql', 'analisis-ventas.sql')
const SQL_ARTS = path.join(__dirname, 'sql', 'analisis-articulos.sql')
const DESDE_MIN = /^\d{4}-\d{2}-\d{2}$/.test(process.env.PUENTE_ANALISIS_DESDE ?? '') ? process.env.PUENTE_ANALISIS_DESDE : '2024-01-01'
const TRAMO_DIAS = 14 // si un tramo pasa el tiempo del SQL (15 s), se reintenta con la mitad de días
const MAESTRO_MS = 6 * 3_600_000
const ABIERTO_MS = 10 * 60_000 // un día todavía no cerrado se relee después de 10 minutos
const ERROR_MS = 30 * 60_000 // un día leído con bases en error se reintenta a la media hora
const DIMS = ['prov', 'mat', 'temp', 'anio', 'linea', 'flia', 'gen', 'grupo']
const DIMS_TABLA = [...DIMS, 'local', 'art']
const MAX_FILAS_TABLA = 2000
const LOCAL_ALIAS = { NVOCED2: 'NVOCED', '9DEJUL2': '9DEJULIO', RUTA9D2: 'RUTA9D' }
const NOMBRE_LOCAL = { MITO: 'MITO (mayorista)', INDOD: 'INDOD (Indo)', INDO: 'INDO', POLO52: 'POLO 52' }

const txt = (v) => (v == null ? '' : String(v).trim())
const esDia = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ''))
const localDe = (tienda) => {
  const b = txt(tienda).toUpperCase().replace(/^DRAGONFISH_/, '')
  return LOCAL_ALIAS[b] ?? b
}
const esMito = (prov) => txt(prov).toUpperCase().startsWith('MO')

function fecha(dia) {
  return new Date(`${dia}T12:00:00`)
}
function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function sumarDia(dia, n) {
  const d = fecha(dia)
  d.setDate(d.getDate() + n)
  return iso(d)
}
function sumarAnios(dia, n) {
  const [y, m, d] = dia.split('-').map(Number)
  const ult = new Date(y + n, m, 0).getDate() // 29/02 -> 28/02
  return `${y + n}-${String(m).padStart(2, '0')}-${String(Math.min(d, ult)).padStart(2, '0')}`
}
function sumarMeses(dia, n) {
  const [y, m, d] = dia.split('-').map(Number)
  const t = new Date(y, m - 1 + n, 1)
  const ult = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate()
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(Math.min(d, ult)).padStart(2, '0')}`
}
const diasEntre = (a, b) => Math.round((fecha(b) - fecha(a)) / 86_400_000)
const mesesEntre = (a, b) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7))
function* rango(desde, hasta) {
  for (let d = desde; d <= hasta; d = sumarDia(d, 1)) yield d
}
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

function crear(deps) {
  /* ------------------------------ diccionarios ------------------------------ */
  const locales = [] // idx -> código de local
  const localIdx = new Map()
  const arts = [] // idx -> código de artículo
  const artIdx = new Map()
  const idxLocal = (l) => {
    let i = localIdx.get(l)
    if (i == null) { i = locales.length; locales.push(l); localIdx.set(l, i) }
    return i
  }
  const idxArt = (a) => {
    let i = artIdx.get(a)
    if (i == null) { i = arts.length; arts.push(a); artIdx.set(a, i) }
    return i
  }

  /**
   * dia -> { fijo, en, error?, n, l: Int16Array, k: Int32Array (ticket del día), v: Uint8Array, a: Int32Array, c: Int32Array, m: Float64Array }
   */
  const dias = new Map()

  function armarDia(dia, filas, fijo, error) {
    const n = filas.length
    const r = { dia, fijo, en: Date.now(), error: error || null, n,
      l: new Int16Array(n), k: new Int32Array(n), v: new Uint8Array(n), a: new Int32Array(n), c: new Int32Array(n), m: new Float64Array(n) }
    filas.forEach((f, i) => {
      r.l[i] = idxLocal(f[0]); r.k[i] = f[1]; r.v[i] = f[2]; r.a[i] = idxArt(f[3]); r.c[i] = f[4]; r.m[i] = f[5]
    })
    return r
  }

  /** Disco: { dia, locales:[...], arts:[...], r:[[li, tk, v, ai, cant, monto], ...] } con diccionarios del día. */
  function guardarDia(dia, filas) {
    const ls = [], li = new Map(), as = [], ai = new Map()
    const ix = (lista, mapa, x) => { let i = mapa.get(x); if (i == null) { i = lista.length; lista.push(x); mapa.set(x, i) } return i }
    const r = filas.map((f) => [ix(ls, li, f[0]), f[1], f[2], ix(as, ai, f[3]), f[4], Math.round(f[5] * 100) / 100])
    return memoria.guardar(`analisis/${dia}`, { dia, locales: ls, arts: as, r, guardado: new Date().toISOString() })
  }

  function leerDiaDisco(dia) {
    const d = memoria.leer(`analisis/${dia}`)
    if (d?.dia !== dia || !Array.isArray(d.r)) return null
    return armarDia(dia, d.r.map((x) => [d.locales[x[0]], x[1], x[2], d.arts[x[3]], x[4], x[5]]), true)
  }

  // Al arrancar se cargan del disco los días ya guardados (por detrás, para no frenar el puente)
  let cargadoDisco = false
  let cargandoDisco = null
  function cargarDisco() {
    if (cargadoDisco) return Promise.resolve()
    if (!cargandoDisco) {
      cargandoDisco = (async () => {
        let nombres = []
        try { nombres = fs.readdirSync(path.join(memoria.DIR, 'analisis')).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)) } catch { /* todavía no hay nada */ }
        let i = 0
        for (const f of nombres) {
          const dia = f.slice(0, 10)
          if (!dias.get(dia)?.fijo) {
            const r = leerDiaDisco(dia)
            if (r) dias.set(dia, r)
          }
          if (++i % 40 === 0) await new Promise((ok) => setImmediate(ok))
        }
        cargadoDisco = true
      })().finally(() => { cargandoDisco = null })
    }
    return cargandoDisco
  }

  /* ------------------------------ lectura del SQL ------------------------------ */

  const ayer = () => deps.diaLocal(1)
  /** ¿Hay que (re)leer ese día? */
  function falta(dia) {
    const r = dias.get(dia)
    if (!r) return true
    if (r.fijo) return false
    if (r.error) return Date.now() - r.en > ERROR_MS
    return Date.now() - r.en > ABIERTO_MS
  }

  async function leerTramo(desde, hasta) {
    const partes = await Promise.all(deps.servidores().map(async ({ srv, bases }) => {
      if (!bases.length) return { filas: [], estado: [] }
      await deps.asegurarConexion(srv)
      const r = await srv.pool
        .request()
        .input('desde', srv.sql.VarChar(10), desde)
        .input('hasta', srv.sql.VarChar(10), hasta)
        .input('bases', srv.sql.NVarChar(4000), bases.join(','))
        .query(fs.readFileSync(SQL_VENTAS, 'utf8'))
      const [filas = [], estado = []] = r.recordsets ?? []
      return { filas, estado }
    }))
    const fallidas = partes.flatMap((p) => p.estado.filter((e) => !e.ok).map((e) => `${txt(e.base)}: ${txt(e.error)}`))
    if (partes.every((p) => !p.estado.some((e) => e.ok))) throw new Error(`no se leyó ninguna base: ${fallidas.slice(0, 3).join('; ')}`)
    // por día: tickets numerados dentro del día
    const porDia = new Map()
    for (const d of rango(desde, hasta)) porDia.set(d, { filas: [], tks: new Map() })
    for (const p of partes) {
      for (const f of p.filas) {
        const x = porDia.get(txt(f.dia))
        if (!x) continue
        const loc = localDe(f.Tienda)
        const clave = `${loc}|${txt(f.tk)}`
        let tk = x.tks.get(clave)
        if (tk == null) { tk = x.tks.size; x.tks.set(clave, tk) }
        x.filas.push([loc, tk, f.v ? 1 : 0, txt(f.art), Number(f.cant) || 0, Number(f.monto) || 0])
      }
    }
    for (const [dia, x] of porDia) {
      const cerrado = deps.diaCerrado(dia)
      const fijo = cerrado && !fallidas.length && guardarDia(dia, x.filas)
      dias.set(dia, armarDia(dia, x.filas, !!fijo, fallidas.length ? fallidas.join('; ') : null))
    }
  }

  /* Cola de lectura: primero lo que pidió la pantalla, después el historial (del más nuevo al más viejo) */
  const prioridad = new Set()
  const carga = { leyendo: false, desde: null, hasta: null, error: null, ultimo: null }
  let corriendo = null

  function pendientes() {
    const out = []
    for (let d = ayer(); d >= DESDE_MIN; d = sumarDia(d, -1)) if (falta(d)) out.push(d)
    return out
  }

  /** El próximo tramo a leer: días consecutivos que faltan (hasta TRAMO_DIAS). */
  let tramoDias = TRAMO_DIAS
  function proximoTramo() {
    const lista = [...prioridad].filter(falta).sort()
    const base = lista.length ? lista : pendientes().reverse()
    if (!base.length) return null
    // del pedido, el tramo empieza en el primero que falta; del historial, en el más nuevo hacia atrás
    if (lista.length) {
      const desde = lista[0]
      let hasta = desde
      while (hasta < ayer() && diasEntre(desde, sumarDia(hasta, 1)) < tramoDias && falta(sumarDia(hasta, 1))) hasta = sumarDia(hasta, 1)
      return [desde, hasta]
    }
    const hasta = base[base.length - 1]
    let desde = hasta
    while (desde > DESDE_MIN && diasEntre(sumarDia(desde, -1), hasta) < tramoDias && falta(sumarDia(desde, -1))) desde = sumarDia(desde, -1)
    return [desde, hasta]
  }

  function completar() {
    if (corriendo) return corriendo
    corriendo = (async () => {
      await cargarDisco()
      let errores = 0
      for (;;) {
        const t = proximoTramo()
        if (!t) break
        carga.leyendo = true; carga.desde = t[0]; carga.hasta = t[1]
        try {
          await leerTramo(t[0], t[1])
          for (const d of rango(t[0], t[1])) prioridad.delete(d)
          carga.error = null
          errores = 0
          tramoDias = TRAMO_DIAS
        } catch (e) {
          carga.error = e.message
          console.error('[puente] análisis ventas:', e.message)
          tramoDias = Math.max(1, Math.floor(tramoDias / 2))
          if (++errores >= 5) break
          await new Promise((ok) => setTimeout(ok, 10_000))
        }
        await new Promise((ok) => setTimeout(ok, 800))
      }
      carga.leyendo = false; carga.ultimo = new Date().toISOString()
    })().finally(() => { corriendo = null })
    return corriendo
  }

  function iniciar() {
    setTimeout(() => completar().catch(() => {}), 90_000).unref?.()
    setInterval(() => completar().catch(() => {}), 3 * 3_600_000).unref?.()
  }

  /* ------------------------------ maestro de artículos ------------------------------ */

  let maestro = { en: 0, mapa: null, enCurso: null }
  try {
    const g = memoria.leer('analisis-articulos')
    if (g?.arts) maestro = { en: Number(g.en) || 0, mapa: new Map(Object.entries(g.arts)), enCurso: null }
  } catch { /* se lee del SQL */ }

  async function leerMaestro() {
    const pool = await deps.conexionLarga()
    try {
      const r = await pool.request().query(fs.readFileSync(SQL_ARTS, 'utf8'))
      const mapa = new Map()
      for (const f of r.recordset ?? []) {
        // [nombre, prov, mat, temp, anio, linea, flia, gen, grupo]
        mapa.set(txt(f.ID_ART), [txt(f.ARTICULO), txt(f.ID_PROV), txt(f.ID_MATERIAL), txt(f.ID_TEMPORADA), txt(f.ANIO) === '0' ? '' : txt(f.ANIO),
          txt(f.ID_LINEA), txt(f.ID_FLIA), txt(f.GEN), txt(f.ID_GRUPO)])
      }
      return mapa
    } finally {
      await pool.close().catch(() => {})
    }
  }
  function refrescarMaestro() {
    if (!maestro.enCurso) {
      maestro.enCurso = leerMaestro()
        .then((mapa) => {
          maestro = { en: Date.now(), mapa, enCurso: null }
          infoArt.length = 0
          memoria.guardar('analisis-articulos', { en: maestro.en, arts: Object.fromEntries(mapa) })
        })
        .catch((e) => { maestro.enCurso = null; throw e })
    }
    return maestro.enCurso
  }
  async function asegurarMaestro() {
    if (!maestro.mapa) await refrescarMaestro()
    else if (Date.now() - maestro.en > MAESTRO_MS) refrescarMaestro().catch((e) => console.error('[puente] análisis ventas maestro:', e.message))
  }
  const POS = { nombre: 0, prov: 1, mat: 2, temp: 3, anio: 4, linea: 5, flia: 6, gen: 7, grupo: 8 }
  const infoArt = [] // idx de artículo -> fila del maestro (o vacía)
  const VACIO = ['', '', '', '', '', '', '', '', '']
  const info = (ai) => infoArt[ai] ?? (infoArt[ai] = maestro.mapa?.get(arts[ai]) ?? VACIO)

  /* ------------------------------ cálculo ------------------------------ */

  function normalizar(body) {
    const hoyMenos1 = ayer()
    let hasta = esDia(body?.hasta) ? body.hasta : hoyMenos1
    if (hasta > hoyMenos1) hasta = hoyMenos1
    let desde = esDia(body?.desde) ? body.desde : `${hasta.slice(0, 8)}01`
    if (desde > hasta) desde = hasta
    if (desde < DESDE_MIN) desde = DESDE_MIN
    const f = body?.filtros ?? {}
    const lista = (x) => (Array.isArray(x) ? x.map((v) => txt(v).toUpperCase()).filter((v) => /^[A-Z0-9 ._/-]{1,40}$/.test(v)) : [])
    const filtros = {}
    for (const k of DIMS) { const l = lista(f[k]); if (l.length) filtros[k] = new Set(l) }
    const loc = lista(f.locales)
    const excluir = lista(f.excluir)
    const camino = (Array.isArray(body?.camino) ? body.camino : [])
      .filter((c) => DIMS_TABLA.includes(c?.dim) && txt(c?.cod).length <= 60)
      .slice(0, 6)
      .map((c) => ({ dim: c.dim, cod: txt(c.cod).toUpperCase() }))
    return {
      desde, hasta,
      comparar: ['anio', 'anterior', 'nada'].includes(body?.comparar) ? body.comparar : 'anio',
      gran: ['dia', 'sem', 'mes', 'anio'].includes(body?.gran) ? body.gran : 'dia',
      dim: DIMS_TABLA.includes(body?.dim) ? body.dim : 'prov',
      corte: body?.corte === 'anio' ? 'anio' : 'dia',
      filtros,
      locales: loc.length ? new Set(loc) : null,
      excluir: new Set(excluir),
      origen: ['MITO', 'MARCAS'].includes(f.origen) ? f.origen : '',
      art: txt(f.art).toUpperCase().split('|').map((s) => s.trim()).filter((s) => /^[A-Z0-9._/-]{1,40}$/.test(s)).slice(0, 50),
      camino,
    }
  }

  /** Prueba de artículo (filtros de tipificación, origen, artículo y apertura); cache por idx. */
  function pruebaArt(q, { conOrigen = true, conCamino = true } = {}) {
    const cache = new Int8Array(arts.length + 1024) // 0 = sin ver, 1 = pasa, -1 = no
    return (ai) => {
      if (ai < cache.length && cache[ai]) return cache[ai] > 0
      const x = info(ai)
      let ok = true
      for (const k in q.filtros) if (!q.filtros[k].has(x[POS[k]])) { ok = false; break }
      if (ok && conOrigen && q.origen) ok = (q.origen === 'MITO') === esMito(x[POS.prov])
      if (ok && q.art.length) ok = q.art.some((p) => arts[ai].toUpperCase().startsWith(p))
      if (ok && conCamino) {
        for (const c of q.camino) {
          if (c.dim === 'local') continue
          const v = c.dim === 'art' ? arts[ai].toUpperCase() : x[POS[c.dim]]
          if (v !== c.cod) { ok = false; break }
        }
      }
      if (ai < cache.length) cache[ai] = ok ? 1 : -1
      return ok
    }
  }
  function pruebaLocal(q, { conCamino = true } = {}) {
    const caminoLocal = conCamino ? q.camino.find((c) => c.dim === 'local')?.cod : null
    return locales.map((l) => (!q.locales || q.locales.has(l)) && !q.excluir.has(l) && (!caminoLocal || caminoLocal === l))
  }

  /** Recorre los renglones de los días [desde..hasta] que pasan los filtros. cb(r, i, dia, ordinal) */
  function recorrer(desde, hasta, artOk, locOk, cb) {
    let faltan = 0
    for (const d of rango(desde, hasta)) {
      const r = dias.get(d)
      if (!r) { faltan++; continue }
      for (let i = 0; i < r.n; i++) if (locOk[r.l[i]] && artOk(r.a[i])) cb(r, i, d)
    }
    return faltan
  }

  /** Totales de un rango: monto, unidades, tickets (distintos). */
  function totales(desde, hasta, artOk, locOk) {
    const t = { monto: 0, unid: 0, tickets: 0 }
    let actual = null, vistos = null
    const faltan = recorrer(desde, hasta, artOk, locOk, (r, i) => {
      if (r !== actual) { actual = r; vistos = new Set() }
      t.monto += r.m[i]; t.unid += r.c[i]
      if (r.v[i] && !vistos.has(r.k[i])) { vistos.add(r.k[i]); t.tickets++ }
    })
    return { ...t, faltan }
  }

  /** Períodos de la serie: [{desde, hasta, lab}] según la granularidad. */
  function cubetas(q) {
    const out = []
    if (q.gran === 'anio') {
      for (let y = Number(DESDE_MIN.slice(0, 4)); y <= Number(q.hasta.slice(0, 4)); y++) {
        const h = `${y}-12-31` < q.hasta ? `${y}-12-31` : q.hasta
        out.push({ desde: `${y}-01-01` < DESDE_MIN ? DESDE_MIN : `${y}-01-01`, hasta: h, lab: h === q.hasta && h.slice(5) !== '12-31' ? `${y} (al ${h.slice(8)}/${h.slice(5, 7)})` : String(y) })
      }
      return out
    }
    if (q.gran === 'mes') {
      // período corto: se muestran los últimos 12 meses hasta el mes de «hasta»
      let ini = q.desde
      if (mesesEntre(q.desde, q.hasta) < 2) ini = sumarMeses(`${q.hasta.slice(0, 8)}01`, -11)
      if (ini < DESDE_MIN) ini = DESDE_MIN
      for (let m = `${ini.slice(0, 8)}01`; m <= q.hasta; m = sumarMeses(m, 1)) {
        const fin = sumarDia(sumarMeses(m, 1), -1)
        out.push({ desde: m < ini ? ini : m, hasta: fin > q.hasta ? q.hasta : fin, lab: `${MESES[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}` })
      }
      return out
    }
    const paso = q.gran === 'sem' ? 7 : 1
    for (let d = q.desde; d <= q.hasta; d = sumarDia(d, paso)) {
      const fin = sumarDia(d, paso - 1)
      out.push({ desde: d, hasta: fin > q.hasta ? q.hasta : fin, lab: `${d.slice(8)}/${d.slice(5, 7)}`, dow: fecha(d).getDay() })
    }
    return out
  }

  /** Rango comparado de un rango. */
  function comparado(q, desde, hasta) {
    if (q.comparar === 'anio') return [sumarAnios(desde, -1), sumarAnios(hasta, -1)]
    if (q.comparar === 'anterior') {
      const n = diasEntre(desde, hasta) + 1
      return [sumarDia(desde, -n), sumarDia(desde, -1)]
    }
    return null
  }

  function claveDim(dim, r, i) {
    if (dim === 'local') return locales[r.l[i]]
    if (dim === 'art') return arts[r.a[i]]
    return info(r.a[i])[POS[dim]]
  }

  /** Tabla «Abrir por»: una fila por valor de la tipificación. */
  function tabla(q, artOk, locOk, cmp) {
    const filas = new Map()
    const fila = (k) => {
      let f = filas.get(k)
      if (!f) { f = { cod: k, monto: 0, unid: 0, tickets: 0, comp: 0, artsSet: new Set() }; filas.set(k, f) }
      return f
    }
    let actual = null, vistos = null
    recorrer(q.desde, q.hasta, artOk, locOk, (r, i) => {
      if (r !== actual) { actual = r; vistos = new Set() }
      const k = claveDim(q.dim, r, i)
      const f = fila(k)
      f.monto += r.m[i]; f.unid += r.c[i]
      f.artsSet.add(r.a[i])
      const kt = `${k}|${r.k[i]}`
      if (r.v[i] && !vistos.has(kt)) { vistos.add(kt); f.tickets++ }
    })
    if (cmp) recorrer(cmp[0], cmp[1], artOk, locOk, (r, i) => {
      const f = filas.get(claveDim(q.dim, r, i))
      if (f) f.comp += r.m[i]
    })
    const stock = q.dim === 'local' ? null : deps.stock()
    const lista = [...filas.values()].sort((a, b) => b.monto - a.monto).slice(0, MAX_FILAS_TABLA)
    return lista.map((f) => {
      let st = null
      if (stock) { st = 0; for (const ai of f.artsSet) st += stock.get(arts[ai]) ?? 0 }
      const nom = q.dim === 'art' ? info(artIdx.get(f.cod) ?? -1)?.[0] ?? '' : q.dim === 'local' ? NOMBRE_LOCAL[f.cod] ?? '' : ''
      return { cod: f.cod, nom, monto: Math.round(f.monto), unid: f.unid, tickets: f.tickets, comp: cmp ? Math.round(f.comp) : null, stock: st }
    })
  }

  async function accion(body) {
    await cargarDisco()
    await asegurarMaestro()
    const q = normalizar(body)
    const artOk = pruebaArt(q)
    const locOk = pruebaLocal(q)
    const cmp = comparado(q, q.desde, q.hasta)

    // días que hacen falta para esta pantalla: se piden primero
    const necesarios = [[q.desde, q.hasta]]
    if (cmp) necesarios.push(cmp)
    const pedir = (a, b) => { for (const d of rango(a < DESDE_MIN ? DESDE_MIN : a, b)) if (falta(d)) prioridad.add(d) }
    for (const [a, b] of necesarios) pedir(a, b)
    const faltanPeriodo = [...rango(q.desde, q.hasta)].filter((d) => !dias.has(d)).length
    const faltanComp = cmp ? [...rango(cmp[0] < DESDE_MIN ? DESDE_MIN : cmp[0], cmp[1])].filter((d) => !dias.has(d)).length : 0
    if (prioridad.size || pendientes().length) completar().catch(() => {})

    // KPIs
    const act = totales(q.desde, q.hasta, artOk, locOk)
    const ant = cmp ? totales(cmp[0], cmp[1], artOk, locOk) : null

    // Serie
    const serie = cubetas(q).map((c) => {
      const a = totales(c.desde, c.hasta, artOk, locOk)
      const cc = q.gran === 'anio' ? null : comparado(q, c.desde, c.hasta)
      const b = cc ? totales(cc[0], cc[1], artOk, locOk) : null
      return { lab: c.lab, desde: c.desde, hasta: c.hasta, dow: c.dow, monto: Math.round(a.monto), unid: a.unid, tickets: a.tickets,
        comp: b ? { monto: Math.round(b.monto), unid: b.unid, tickets: b.tickets } : null }
    })

    // Día de la semana (promedio por día calendario del período)
    const dow = Array.from({ length: 7 }, () => ({ monto: 0, tickets: 0, unid: 0, dias: 0 }))
    for (const d of rango(q.desde, q.hasta)) {
      const t = totales(d, d, artOk, locOk)
      const w = dow[fecha(d).getDay()]
      w.monto += t.monto; w.tickets += t.tickets; w.unid += t.unid; w.dias++
    }

    // Ticket promedio del año (1/1 hasta «hasta») contra el año anterior al mismo día. Sin apertura.
    const artSinCamino = pruebaArt(q, { conCamino: false })
    const locSinCamino = pruebaLocal(q, { conCamino: false })
    const y = q.hasta.slice(0, 4)
    const iniAnio = `${y}-01-01` < DESDE_MIN ? DESDE_MIN : `${y}-01-01`
    const anioAct = totales(iniAnio, q.hasta, artSinCamino, locSinCamino)
    const anioAnt = `${Number(y) - 1}-01-01` >= DESDE_MIN ? totales(`${Number(y) - 1}-01-01`, sumarAnios(q.hasta, -1), artSinCamino, locSinCamino) : null

    // Marcas vs Zimith / Captain Fin por año (sin período, sin origen, sin apertura)
    const artMarcas = pruebaArt(q, { conOrigen: false, conCamino: false })
    const marcas = []
    for (let yy = Number(DESDE_MIN.slice(0, 4)); yy <= Number(y); yy++) {
      let h = q.corte === 'dia' ? sumarAnios(q.hasta, yy - Number(y)) : `${yy}-12-31`
      if (h > q.hasta) h = q.hasta
      const ini = `${yy}-01-01` < DESDE_MIN ? DESDE_MIN : `${yy}-01-01`
      const x = { anio: yy, hasta: h, MITO: { unid: 0, monto: 0 }, MARCAS: { unid: 0, monto: 0 } }
      const falt = recorrer(ini, h, artMarcas, locSinCamino, (r, i) => {
        const g = esMito(info(r.a[i])[POS.prov]) ? x.MITO : x.MARCAS
        g.unid += r.c[i]; g.monto += r.m[i]
      })
      x.MITO.monto = Math.round(x.MITO.monto); x.MARCAS.monto = Math.round(x.MARCAS.monto)
      x.faltan = falt
      marcas.push(x)
    }

    const redondo = (t) => (t ? { monto: Math.round(t.monto), unid: t.unid, tickets: t.tickets } : null)
    const out = {
      estado: 'listo',
      desde: q.desde, hasta: q.hasta, ayer: ayer(), desde_min: DESDE_MIN,
      comparado: cmp ? { desde: cmp[0], hasta: cmp[1] } : null,
      kpis: { actual: redondo(act), comp: redondo(ant) },
      serie,
      dow: dow.map((w) => ({ monto: w.dias ? Math.round(w.monto / w.dias) : 0, tickets: w.dias ? Math.round(w.tickets / w.dias) : 0, unid: w.dias ? Math.round(w.unid / w.dias) : 0, dias: w.dias })),
      tabla: { dim: q.dim, filas: tabla(q, artOk, locOk, cmp), stock: !!deps.stock() && q.dim !== 'local' },
      anio: { desde: iniAnio, hasta: q.hasta, actual: redondo(anioAct), comp: anioAnt ? redondo(anioAnt) : null },
      marcas,
      faltan: { periodo: faltanPeriodo, comparado: faltanComp },
      carga: { ...carga, pendientes: pendientes().length },
      maestro: maestro.en ? new Date(maestro.en).toISOString() : null,
      locales: [...locales].sort().map((l) => ({ cod: l, nom: NOMBRE_LOCAL[l] ?? '' })),
    }
    if (body?.opciones) out.opciones = await deps.opciones().catch(() => null)
    return out
  }

  return { accion, iniciar, completar }
}

module.exports = { crear }
