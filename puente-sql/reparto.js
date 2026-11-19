/**
 * REPARTO MANUAL (hub: Reposiciones / Transferencias > Reparto manual). SOLO LECTURA.
 *
 *   accion 'reparto_opciones' -> { opciones: { prov:[{cod,nom}], mat, temp, anio, linea, flia, grupo, gen } }
 *       sql/reparto-opciones.sql (~6 s), se guarda 1 hora.
 *   accion 'reparto_stock' body: { filtros:{prov[],mat[],temp[],anio[],linea[],flia[],grupo[],gen[],art,origen:'MITO'|'MARCAS'|''}, desde, hasta }
 *       -> { estado:'calculando', desde } mientras lee el DWH (~1-2 min, por detrás)
 *       -> { estado:'listo', locales:[20 códigos], filas:[{a,c,t,s,v,tr,u}], arts:{ID_ART:{...}}, ... }
 *       -> { estado:'demasiados', articulos, motivo? } si el filtro trae más de MAX_ARTICULOS o la respuesta pasa ~4 MB
 *       sql/reparto-stock.sql. Cada foto (por filtro + fechas) dura 5 minutos.
 *
 * Columnas = los 20 locales del reparto (mismos que la PWA vieja y que el Excel de remitos).
 * DEPO = INDOD (Indo), MAYORD = MITO (stock REAL = físico − comprometido de la COMB, como la
 * Repo diaria), POLO52 = Polo 52. Las demás tiendas del DWH (CENTRALD, OUTLETD, NOMED, FABRICA…)
 * no entran.
 */
const fs = require('fs')
const path = require('path')

const LOCALES = [
  'VCPD', 'WALMARTD', 'DINOD', 'RIVERAD', 'CFRA', 'RUTA9D', 'CFR9', 'BUSTOD', 'CFD', 'CFPO', 'GRALPAZ',
  'MUNOZ', '9DEJULIO', 'LIBERD', 'ESPINOD', 'NVOCED', 'CFR4', 'DEPO', 'MAYORD', 'POLO52',
]
const IDX = new Map(LOCALES.map((l, i) => [l, i]))
// "DRAGONFISH_X" -> columna del reparto
const ALIAS = { NVOCED2: 'NVOCED', '9DEJUL2': '9DEJULIO', RUTA9D2: 'RUTA9D', INDOD: 'DEPO', INDO: 'DEPO', WALMART: 'WALMARTD', BUSTOS: 'BUSTOD', GPAZD: 'GRALPAZ' }
const columna = (tienda) => {
  const b = String(tienda ?? '').trim().toUpperCase().replace(/^DRAGONFISH_/, '')
  return ALIAS[b] ?? b
}
const TEMPORADA = { 1: 'Verano', 2: 'Continuo', 3: 'Invierno', 4: 'Primavera' }
const txt = (v) => (v == null ? '' : String(v).trim())

const MAX_ARTICULOS = 6000 // el maestro trae muchos artículos viejos sin stock ni venta: el corte real es MAX_BYTES
// La respuesta pasa por una función de Vercel (tope ~4,5 MB): si el JSON se pasa de esto, se pide achicar
const MAX_BYTES = 4_000_000
const DIAS_ULTIMA_VENTA = 180
const CACHE_MS = 5 * 60_000
const OPCIONES_MS = 60 * 60_000
const SQL_STOCK = path.join(__dirname, 'sql', 'reparto-stock.sql')
const SQL_OPCIONES = path.join(__dirname, 'sql', 'reparto-opciones.sql')

function diaLocal(menos = 0) {
  const d = new Date()
  d.setDate(d.getDate() - menos)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const esDia = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ''))

/** Normaliza los filtros que llegan del hub (solo letras, números y - . _ / espacio). */
function limpiarFiltros(f) {
  const lista = (v) =>
    (Array.isArray(v) ? v : [])
      .map((x) => txt(x).toUpperCase())
      .filter((x) => /^[A-Z0-9 ._\-/]{1,30}$/.test(x))
      .slice(0, 200)
      .sort()
  const art = txt(f?.art).toUpperCase()
  return {
    prov: lista(f?.prov), mat: lista(f?.mat), temp: lista(f?.temp), anio: lista(f?.anio),
    linea: lista(f?.linea), flia: lista(f?.flia), grupo: lista(f?.grupo), gen: lista(f?.gen),
    art: /^[A-Z0-9]{1,20}$/.test(art) ? art : '',
    origen: ['MITO', 'MARCAS'].includes(txt(f?.origen).toUpperCase()) ? txt(f?.origen).toUpperCase() : '',
  }
}
const hayFiltroDeArticulo = (f) => !!f.art || !!f.origen || ['prov', 'mat', 'temp', 'anio', 'linea', 'flia', 'grupo', 'gen'].some((k) => f[k].length)

function crear(deps) {
  // deps.sql se lee en cada uso: el puente puede cambiar de driver (tedious / msnodesqlv8) al arrancar
  const conexionLarga = () => deps.conexionLarga()
  let opciones = { en: 0, datos: null, enCurso: null }
  const fotos = new Map() // clave -> { en, datos, error, enCurso, inicio }

  async function leerOpciones() {
    const pool = await conexionLarga()
    try {
      const r = await pool.request().query(fs.readFileSync(SQL_OPCIONES, 'utf8'))
      const out = { prov: [], mat: [], temp: [], anio: [], linea: [], flia: [], grupo: [], gen: [] }
      for (const f of r.recordset ?? []) {
        const k = txt(f.k), cod = txt(f.cod).toUpperCase()
        if (!out[k] || !cod) continue
        const nom = k === 'temp' ? TEMPORADA[Number(cod)] ?? '' : txt(f.nom)
        out[k].push({ cod, nom: nom && nom.toUpperCase() !== cod ? nom : '' })
      }
      for (const k of Object.keys(out)) {
        out[k].sort((a, b) => (k === 'anio' ? Number(b.cod) - Number(a.cod) : a.cod.localeCompare(b.cod, 'es', { numeric: true })))
      }
      return out
    } finally {
      await pool.close().catch(() => {})
    }
  }

  async function accionOpciones() {
    if (opciones.datos && Date.now() - opciones.en < OPCIONES_MS) return { opciones: opciones.datos }
    if (!opciones.enCurso) {
      opciones.enCurso = leerOpciones()
        .then((datos) => { opciones = { en: Date.now(), datos, enCurso: null } })
        .catch((e) => { opciones = { ...opciones, enCurso: null }; throw e })
    }
    await opciones.enCurso
    return { opciones: opciones.datos }
  }

  /** Arma la respuesta compacta (arrays alineados con LOCALES). */
  function procesar(recordsets, hoy) {
    const [cuenta = [], stock = [], venta = [], ultima = [], mito = [], maestro = []] = recordsets ?? []
    const articulos = Number(cuenta[0]?.articulos) || 0
    const filas = new Map()
    const fila = (a, c, t) => {
      const k = `${a}|${c}|${t}`
      let f = filas.get(k)
      if (!f) {
        f = { a, c, t, s: Array(LOCALES.length).fill(0), v: Array(LOCALES.length).fill(0), tr: Array(LOCALES.length).fill(0), u: Array(LOCALES.length).fill(null) }
        filas.set(k, f)
      }
      return f
    }
    const hoyMs = new Date(`${hoy}T12:00:00`).getTime()
    for (const r of stock) {
      const col = columna(r.Tienda)
      if (!IDX.has(col) || col === 'MAYORD') continue // MITO sale de la COMB (stock real)
      const f = fila(txt(r.ID_ART), txt(r.ID_COLOR), txt(r.ID_TALLE))
      f.s[IDX.get(col)] += Math.max(0, Number(r.stock) || 0)
      if (Number(r.transito) >= 1) f.tr[IDX.get(col)] = 1
    }
    for (const r of venta) {
      const col = columna(r.Tienda)
      if (!IDX.has(col)) continue
      fila(txt(r.ID_ART), txt(r.ID_COLOR), txt(r.ID_TALLE)).v[IDX.get(col)] += Math.max(0, Number(r.venta) || 0)
    }
    for (const r of mito) {
      const n = Number(r.stock) || 0
      if (n > 0) fila(txt(r.ID_ART), txt(r.ID_COLOR), txt(r.ID_TALLE)).s[IDX.get('MAYORD')] += n
    }
    for (const r of ultima) {
      const col = columna(r.Tienda)
      if (!IDX.has(col)) continue
      const k = `${txt(r.ID_ART)}|${txt(r.ID_COLOR)}|${txt(r.ID_TALLE)}`
      const f = filas.get(k)
      if (!f) continue // sin stock ni venta: no aparece en la grilla
      const d = Math.max(0, Math.round((hoyMs - new Date(`${txt(r.ultima)}T12:00:00`).getTime()) / 86_400_000))
      f.u[IDX.get(col)] = d
    }
    const arts = {}
    for (const r of maestro) {
      const a = txt(r.ID_ART)
      if (!a || arts[a]) continue
      const adic = txt(r.ARTICULO_ADICIONAL) || txt(r.ARTICULO)
      arts[a] = {
        nombre: adic,
        // "Descripción adicional macro" del PBIX: (familia)adicional - línea(grupo)
        desc: `(${txt(r.ID_FLIA)})${adic} - ${txt(r.ID_LINEA)}(${txt(r.ID_GRUPO)})`,
        prov: txt(r.ID_PROV).toUpperCase(),
        grupo: txt(r.ID_GRUPO),
        material: txt(r.ID_MATERIAL),
        linea: txt(r.ID_LINEA),
        temporada: TEMPORADA[Number(txt(r.ID_TEMPORADA))] ?? txt(r.ID_TEMPORADA),
      }
    }
    // Solo SKUs con algo: stock, venta o tránsito en algún local
    const lista = [...filas.values()].filter((f) => f.s.some((x) => x > 0) || f.v.some((x) => x > 0) || f.tr.some((x) => x > 0))
    // Formato compacto (18/11): [art, color, talle, stock[], venta[] | 0, tránsito "0101…" | 0, últimaVenta[] (-1 = sin venta) | 0]
    // 0 = toda la fila vacía. El hub lo vuelve a armar en src/lib/reparto.ts (desarmarFilas).
    const compactas = lista.map((f) => [
      f.a, f.c, f.t, f.s,
      f.v.some((x) => x > 0) ? f.v : 0,
      f.tr.some((x) => x > 0) ? f.tr.join('') : 0,
      f.u.some((x) => x != null) ? f.u.map((x) => (x == null ? -1 : x)) : 0,
    ])
    return { articulos, locales: LOCALES, filas: compactas, formato: 2, arts }
  }

  function lanzar(clave, f, desde, hasta) {
    const hoy = diaLocal(0)
    const foto = { en: 0, datos: null, error: null, enCurso: null, inicio: Date.now() }
    fotos.set(clave, foto)
    foto.enCurso = (async () => {
      const t0 = Date.now()
      const pool = await conexionLarga()
      try {
        const req = pool.request()
        const sql = deps.sql
        const V = sql.VarChar(sql.MAX)
        for (const k of ['prov', 'mat', 'temp', 'anio', 'linea', 'flia', 'grupo', 'gen']) req.input(k, V, f[k].join('|'))
        req.input('art', V, f.art)
        req.input('desde', V, desde)
        req.input('hasta', V, hasta)
        req.input('desde_ult', V, diaLocal(DIAS_ULTIMA_VENTA))
        req.input('max', V, String(MAX_ARTICULOS))
        // origen ya viene validado ('MITO' | 'MARCAS' | ''): texto fijo, nada del usuario
        const origen =
          f.origen === 'MITO' ? "AND LTRIM(a.ID_PROV) LIKE 'MO%'"
          : f.origen === 'MARCAS' ? "AND LTRIM(ISNULL(a.ID_PROV, '')) NOT LIKE 'MO%'"
          : ''
        const r = await req.query(fs.readFileSync(SQL_STOCK, 'utf8').replace('/*ORIGEN*/', origen))
        const articulos = Number(r.recordsets?.[0]?.[0]?.articulos) || 0
        if (articulos > MAX_ARTICULOS) foto.datos = { estado: 'demasiados', articulos, max: MAX_ARTICULOS }
        else {
          const datos = { estado: 'listo', ...procesar(r.recordsets, hoy), desde, hasta, hoy, segundos: Math.round((Date.now() - t0) / 100) / 10 }
          const bytes = JSON.stringify(datos).length
          foto.datos = bytes > MAX_BYTES ? { estado: 'demasiados', articulos, max: MAX_ARTICULOS, motivo: 'peso', bytes } : datos
        }
        foto.en = Date.now()
      } finally {
        await pool.close().catch(() => {})
      }
    })()
      .catch((e) => {
        console.error('[puente] reparto:', e.message)
        foto.error = e.message
        foto.en = Date.now()
      })
      .finally(() => {
        foto.enCurso = null
      })
  }

  /** body: { filtros, desde, hasta, forzar? } */
  function accionStock(body) {
    const f = limpiarFiltros(body?.filtros ?? {})
    if (!hayFiltroDeArticulo(f)) throw new Error('Elegí al menos un filtro de artículo')
    const hasta = esDia(body?.hasta) ? body.hasta : diaLocal(1)
    const desde = esDia(body?.desde) ? body.desde : diaLocal(14)
    if (desde > hasta) throw new Error('La fecha «desde» es posterior a «hasta»')
    const clave = JSON.stringify({ f, desde, hasta })
    // limpieza: fotos vencidas
    for (const [k, v] of fotos) if (!v.enCurso && Date.now() - v.en > CACHE_MS) fotos.delete(k)
    const actual = fotos.get(clave)
    if (actual?.enCurso) return { estado: 'calculando', desde: new Date(actual.inicio).toISOString() }
    if (actual && !body?.forzar && Date.now() - actual.en < CACHE_MS) {
      if (actual.error) {
        fotos.delete(clave)
        throw new Error(actual.error)
      }
      return { ...actual.datos, foto_en: new Date(actual.en).toISOString() }
    }
    if ([...fotos.values()].filter((v) => v.enCurso).length >= 3) throw new Error('Hay 3 repartos leyendo el DWH: probá en un minuto')
    lanzar(clave, f, desde, hasta)
    return { estado: 'calculando', desde: new Date().toISOString() }
  }

  return { accionOpciones, accionStock, LOCALES }
}

module.exports = { crear, LOCALES, columna, limpiarFiltros }
