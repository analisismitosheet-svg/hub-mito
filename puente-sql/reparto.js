/**
 * REPARTO MANUAL (hub: Reposiciones / Transferencias > Reparto manual). SOLO LECTURA.
 *
 *   accion 'reparto_opciones' -> { opciones: { prov:[{cod,nom}], mat, temp, anio, linea, flia, grupo, gen } }
 *       sql/reparto-opciones.sql (~6 s), se guarda 1 hora.
 *   accion 'reparto_stock' body: { filtros:{prov[],mat[],temp[],anio[],linea[],flia[],grupo[],gen[],art,origen:'MITO'|'MARCAS'|''}, desde, hasta }
 *       -> { estado:'calculando', desde } mientras lee el DWH (~1-2 min, por detrás)
 *       -> { estado:'listo', locales:[20 códigos], filas:[{a,c,t,s,v,tr,u}], arts:{ID_ART:{...}}, ... }
 *       -> { estado:'demasiados', articulos, motivo? } si el filtro trae más de MAX_ARTICULOS o la respuesta pasa ~4 MB
 *       Sale de la FOTO GENERAL (sql/reparto-foto.sql: todos los artículos, se lee una vez y se
 *       renueva cada 15 min mientras alguien usa el reparto): el armado tarda segundos. Si la foto
 *       no cubre las fechas pedidas (venta de hace más de ~60 días) o no se pudo leer, se lee solo
 *       lo filtrado con sql/reparto-stock.sql (~1-2 min, cada foto por filtro dura 5 minutos).
 *       filtros.art = uno o varios códigos (o principios de código) separados por «|».
 *       filtros.x = 'CON' (solo líneas que contienen X: X, XG, XU60, W50OFF-XG…) | 'SIN' (línea sin X) | ''.
 *       tránsito = CANTIDAD en camino por local (ENTRANSITO), no una marca.
 *
 * Columnas = los 20 locales del reparto (mismos que la PWA vieja y que el Excel de remitos).
 * DEPO = INDOD (Indo), MAYORD = MITO (stock REAL = físico − comprometido de la COMB, como la
 * Repo diaria), POLO52 = Polo 52. Las demás tiendas del DWH (CENTRALD, OUTLETD, NOMED, FABRICA…)
 * no entran.
 */
const fs = require('fs')
const memoria = require('./memoria-ia')
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
const SQL_FOTO = path.join(__dirname, 'sql', 'reparto-foto.sql')
// Foto general: nueva = menos de 15 min; hasta 30 min se usa igual (y se renueva por detrás);
// más vieja, el armado espera la nueva. Se mantiene al día sola en horario de trabajo (lunes a
// sábado de 8 a 20, también recién arrancado el puente) y fuera de horario mientras alguien usó
// el reparto en las últimas 3 horas (abrir la pantalla ya la pide).
const FOTO_NUEVA_MS = 15 * 60_000
const FOTO_USABLE_MS = 30 * 60_000
const FOTO_USO_MS = 3 * 60 * 60_000
const FOTO_VENTA_DIAS = 62

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
  const art = (Array.isArray(f?.art) ? f.art : txt(f?.art).split('|'))
    .map((x) => txt(x).toUpperCase())
    .filter((x) => /^[A-Z0-9]{1,20}$/.test(x))
    .slice(0, 200)
    .sort()
  return {
    prov: lista(f?.prov), mat: lista(f?.mat), temp: lista(f?.temp), anio: lista(f?.anio),
    linea: lista(f?.linea), flia: lista(f?.flia), grupo: lista(f?.grupo), gen: lista(f?.gen),
    art,
    x: ['CON', 'SIN'].includes(txt(f?.x).toUpperCase()) ? txt(f?.x).toUpperCase() : '',
    origen: ['MITO', 'MARCAS'].includes(txt(f?.origen).toUpperCase()) ? txt(f?.origen).toUpperCase() : '',
  }
}
const hayFiltroDeArticulo = (f) => f.art.length > 0 || !!f.x || !!f.origen || ['prov', 'mat', 'temp', 'anio', 'linea', 'flia', 'grupo', 'gen'].some((k) => f[k].length)

/** Datos del artículo para el hub (desc = «Descripción adicional macro» del PBIX). */
function artInfo(r) {
  const adic = txt(r.ARTICULO_ADICIONAL) || txt(r.ARTICULO)
  return {
    nombre: adic,
    // "Descripción adicional macro" del PBIX: (familia)adicional - línea(grupo)
    desc: `(${txt(r.ID_FLIA)})${adic} - ${txt(r.ID_LINEA)}(${txt(r.ID_GRUPO)})`,
    prov: txt(r.ID_PROV).toUpperCase(),
    grupo: txt(r.ID_GRUPO),
    material: txt(r.ID_MATERIAL),
    linea: txt(r.ID_LINEA),
    flia: txt(r.ID_FLIA),
    temporada: TEMPORADA[Number(txt(r.ID_TEMPORADA))] ?? txt(r.ID_TEMPORADA),
  }
}

/** Solo SKUs con algo (stock, venta o tránsito) y en el formato compacto que espera el hub. */
function compactar(filas) {
  // Formato compacto (20/11): [art, color, talle, stock[], venta[] | 0, tránsito[] (cantidad en camino) | 0, últimaVenta[] (-1 = sin venta) | 0]
  // (hasta el 20/11 el tránsito iba como texto "0101…" = solo si había algo; el hub entiende los dos)
  // 0 = toda la fila vacía. El hub lo vuelve a armar en src/lib/reparto.ts (desarmarFilas).
  return filas
    .filter((f) => f.s.some((x) => x > 0) || f.v.some((x) => x > 0) || f.tr.some((x) => x > 0))
    .map((f) => [
      f.a, f.c, f.t, f.s,
      f.v.some((x) => x > 0) ? f.v : 0,
      f.tr.some((x) => x > 0) ? f.tr : 0,
      f.u.some((x) => x != null) ? f.u.map((x) => (x == null ? -1 : x)) : 0,
    ])
}

const diasDesde = (hoyMs, dia) => Math.max(0, Math.round((hoyMs - new Date(`${dia}T12:00:00`).getTime()) / 86_400_000))

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

  // Las opciones se guardan en disco (D:\memoria ia): después de reiniciar el puente se contestan al
  // instante. Con la lectura en frío + la foto general a la vez, la primera apertura llegó a tardar
  // más de un minuto y Vercel cortaba con 504 (20/11).
  try {
    const guardadas = memoria.leer('reparto-opciones')
    if (guardadas?.datos) opciones = { en: Number(guardadas.en) || 0, datos: guardadas.datos, enCurso: null }
  } catch { /* sin memoria: se leen del SQL */ }

  function refrescarOpciones() {
    if (!opciones.enCurso) {
      opciones.enCurso = leerOpciones()
        .then((datos) => {
          opciones = { en: Date.now(), datos, enCurso: null }
          memoria.guardar('reparto-opciones', { en: opciones.en, datos })
        })
        .catch((e) => { opciones = { ...opciones, enCurso: null }; throw e })
    }
    return opciones.enCurso
  }

  /** body.articulos: solo la lista del buscador de artículos (~650 KB: va aparte para que la
   *  pantalla abra con los filtros solos, ~75 KB). */
  async function accionOpciones(body) {
    if (body?.articulos) {
      ultimoUso = Date.now()
      return { art: general.datos?.listaArts ?? null, foto: estadoGeneral() }
    }
    // abrir la pantalla ya pide la foto general: cuando terminan de elegir filtros suele estar lista
    ultimoUso = Date.now()
    const pedirFoto = () => { if (!general.enCurso && edadGeneral() > FOTO_NUEVA_MS) lanzarGeneral() }
    if (!opciones.datos) {
      // primera vez (sin nada guardado): primero las opciones y recién después la foto, para que no
      // compitan por el SQL
      try { await refrescarOpciones() } finally { pedirFoto() }
    } else {
      // hay opciones (aunque sean viejas): se contestan ya y, si pasó la hora, se renuevan por detrás
      if (Date.now() - opciones.en > OPCIONES_MS) refrescarOpciones().catch((e) => console.error('[puente] reparto opciones:', e.message))
      pedirFoto()
    }
    return { opciones: opciones.datos, foto: estadoGeneral() }
  }

  /* ------------------------------ foto general ------------------------------ */

  let general = { en: 0, datos: null, error: null, enCurso: null, inicio: 0, segundos: null }
  let ultimoUso = 0
  const edadGeneral = () => (general.datos ? Date.now() - general.en : Infinity)
  const estadoGeneral = () => ({
    en: general.datos ? new Date(general.en).toISOString() : null,
    leyendo: !!general.enCurso,
    segundos: general.segundos,
    error: general.error,
  })

  /** Lee el DWH entero una vez y lo deja en memoria, indexado por artículo. */
  async function leerGeneral() {
    const t0 = Date.now()
    const desdeVenta = diaLocal(FOTO_VENTA_DIAS - 1)
    const pool = await conexionLarga()
    let r
    try {
      const req = pool.request()
      const V = deps.sql.VarChar(deps.sql.MAX)
      req.input('desde_ult', V, diaLocal(DIAS_ULTIMA_VENTA))
      req.input('desde_venta', V, desdeVenta)
      r = await req.query(fs.readFileSync(SQL_FOTO, 'utf8'))
    } finally {
      await pool.close().catch(() => {})
    }
    const [stock = [], venta = [], ultima = [], mito = [], maestro = []] = r.recordsets ?? []
    const n = LOCALES.length
    const skus = new Map() // 'a|c|t' -> { a, c, t, s[], tr[], v: [[dia, tienda, cant]], u: [día | null] | null }
    const porArt = new Map() // a -> [sku]
    const sku = (a, c, t) => {
      const k = `${a}|${c}|${t}`
      let x = skus.get(k)
      if (!x) {
        x = { a, c, t, s: Array(n).fill(0), tr: Array(n).fill(0), v: [], u: null }
        skus.set(k, x)
        if (!porArt.has(a)) porArt.set(a, [])
        porArt.get(a).push(x)
      }
      return x
    }
    // la venta se suma por tienda y recién después se recorta a > 0 (como reparto-stock.sql)
    const tiendas = [] // id -> columna
    const idTienda = new Map()
    const tid = (t) => {
      if (!idTienda.has(t)) { idTienda.set(t, tiendas.length); tiendas.push(IDX.get(columna(t))) }
      return idTienda.get(t)
    }
    for (const x of stock) {
      const col = columna(x.Tienda)
      if (!IDX.has(col) || col === 'MAYORD') continue // MITO sale de la COMB (stock real)
      const f = sku(txt(x.ID_ART), txt(x.ID_COLOR), txt(x.ID_TALLE))
      f.s[IDX.get(col)] += Math.max(0, Number(x.stock) || 0)
      f.tr[IDX.get(col)] += Math.max(0, Number(x.transito) || 0) // cantidad en camino
    }
    for (const x of venta) {
      if (!IDX.has(columna(x.Tienda))) continue
      sku(txt(x.ID_ART), txt(x.ID_COLOR), txt(x.ID_TALLE)).v.push([txt(x.dia), tid(txt(x.Tienda)), Number(x.venta) || 0])
    }
    for (const x of mito) {
      const q = Number(x.stock) || 0
      if (q > 0) sku(txt(x.ID_ART), txt(x.ID_COLOR), txt(x.ID_TALLE)).s[IDX.get('MAYORD')] += q
    }
    for (const x of ultima) {
      const col = columna(x.Tienda)
      if (!IDX.has(col)) continue
      const f = skus.get(`${txt(x.ID_ART)}|${txt(x.ID_COLOR)}|${txt(x.ID_TALLE)}`)
      if (!f) continue // sin stock ni venta reciente: no aparece en la grilla
      const i = IDX.get(col), d = txt(x.ultima)
      if (!f.u) f.u = Array(n).fill(null)
      if (!f.u[i] || d > f.u[i]) f.u[i] = d
    }
    const arts = new Map()
    for (const x of maestro) {
      const a = txt(x.ID_ART)
      if (!a || arts.has(a)) continue
      arts.set(a, {
        info: artInfo(x),
        // para filtrar igual que reparto-stock.sql (los filtros llegan en mayúsculas)
        prov: txt(x.ID_PROV).toUpperCase(), mat: txt(x.ID_MATERIAL).toUpperCase(), temp: txt(x.ID_TEMPORADA).toUpperCase(),
        anio: txt(x.ANIO), linea: txt(x.ID_LINEA).toUpperCase(), flia: txt(x.ID_FLIA).toUpperCase(),
        grupo: txt(x.ID_GRUPO).toUpperCase(), gen: txt(x.GEN).toUpperCase(),
      })
    }
    // lista para el buscador de artículos del hub: solo los que tienen stock o venta
    const listaArts = [...porArt.keys()]
      .filter((a) => arts.has(a) && porArt.get(a).some((f) => f.s.some((q) => q > 0) || f.v.length))
      .sort()
      .map((a) => [a, arts.get(a).info.nombre, arts.get(a).prov]) // compacto: [código, nombre, proveedor]
    return { skus: skus.size, porArt, arts, tiendas, desdeVenta, listaArts, segundos: Math.round((Date.now() - t0) / 100) / 10 }
  }

  function lanzarGeneral() {
    if (general.enCurso) return general.enCurso
    general.inicio = Date.now()
    general.enCurso = leerGeneral()
      .then((datos) => {
        general = { en: Date.now(), datos, error: null, enCurso: null, inicio: general.inicio, segundos: datos.segundos }
        console.log(`[puente] reparto: foto general lista (${datos.skus} SKU, ${datos.arts.size} artículos, ${datos.segundos} s)`)
      })
      .catch((e) => {
        console.error('[puente] reparto: foto general:', e.message)
        general = { ...general, error: e.message, enCurso: null }
      })
    return general.enCurso
  }

  // Se mantiene al día sola: en horario de trabajo siempre (así el primer «Armar» del día no espera
  // la foto entera) y fuera de horario solo si alguien usó el reparto en las últimas 3 horas
  const horarioDeTrabajo = () => {
    const d = new Date()
    return d.getDay() >= 1 && d.getDay() <= 6 && d.getHours() >= 8 && d.getHours() < 20
  }
  const mantener = () => {
    if ((horarioDeTrabajo() || Date.now() - ultimoUso < FOTO_USO_MS) && !general.enCurso && edadGeneral() > FOTO_NUEVA_MS) lanzarGeneral()
  }
  const reloj = setInterval(mantener, 60_000)
  // recién arrancado el puente: a los 20 s (que termine de levantar) si es horario de trabajo
  const arranque = setTimeout(() => { if (horarioDeTrabajo()) mantener() }, 20_000)
  if (arranque.unref) arranque.unref()
  if (reloj.unref) reloj.unref()

  const cumple = (lista, v) => !lista.length || lista.includes(v)
  /** El reparto de un filtro sacado de la foto general (mismo resultado que reparto-stock.sql). */
  function armarDesdeGeneral(f, desde, hasta) {
    const g = general.datos
    const elegidos = []
    for (const [a, x] of g.arts) {
      if (
        cumple(f.prov, x.prov) && cumple(f.mat, x.mat) && cumple(f.temp, x.temp) && cumple(f.anio, x.anio) &&
        cumple(f.linea, x.linea) && cumple(f.flia, x.flia) && cumple(f.grupo, x.grupo) && cumple(f.gen, x.gen) &&
        (!f.art.length || f.art.some((p) => a.startsWith(p))) &&
        (f.x === 'CON' ? /X/i.test(x.linea || '') : f.x === 'SIN' ? !/X/i.test(x.linea || '') : true) &&
        (f.origen === 'MITO' ? x.prov.startsWith('MO') : f.origen === 'MARCAS' ? !x.prov.startsWith('MO') : true)
      ) elegidos.push(a)
    }
    if (elegidos.length > MAX_ARTICULOS) return { estado: 'demasiados', articulos: elegidos.length, max: MAX_ARTICULOS }
    const n = LOCALES.length
    const hoy = diaLocal(0)
    const hoyMs = new Date(`${hoy}T12:00:00`).getTime()
    const filas = []
    const arts = {}
    for (const a of elegidos) {
      const lista = g.porArt.get(a)
      if (!lista) continue
      for (const x of lista) {
        const porTienda = new Map()
        for (const [dia, t, q] of x.v) if (dia >= desde && dia <= hasta) porTienda.set(t, (porTienda.get(t) ?? 0) + q)
        const v = Array(n).fill(0)
        for (const [t, q] of porTienda) if (q > 0) v[g.tiendas[t]] += q
        filas.push({ a: x.a, c: x.c, t: x.t, s: x.s.slice(), v, tr: x.tr.slice(), u: x.u ? x.u.map((d) => (d ? diasDesde(hoyMs, d) : null)) : Array(n).fill(null) })
      }
      arts[a] = g.arts.get(a).info
    }
    const compactas = compactar(filas)
    const usados = new Set(compactas.map((c) => c[0]))
    for (const a of Object.keys(arts)) if (!usados.has(a)) delete arts[a]
    const datos = { estado: 'listo', articulos: elegidos.length, locales: LOCALES, filas: compactas, formato: 2, arts, desde, hasta, hoy, segundos: general.segundos }
    const bytes = JSON.stringify(datos).length
    if (bytes > MAX_BYTES) return { estado: 'demasiados', articulos: elegidos.length, max: MAX_ARTICULOS, motivo: 'peso', bytes }
    return { ...datos, foto_en: new Date(general.en).toISOString(), foto_general: true }
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
      f.tr[IDX.get(col)] += Math.max(0, Number(r.transito) || 0) // cantidad en camino
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
      f.u[IDX.get(col)] = diasDesde(hoyMs, txt(r.ultima))
    }
    const arts = {}
    for (const r of maestro) {
      const a = txt(r.ID_ART)
      if (!a || arts[a]) continue
      arts[a] = artInfo(r)
    }
    const compactas = compactar([...filas.values()])
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
        req.input('art', V, f.art.join('|'))
        req.input('x', V, f.x)
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
    ultimoUso = Date.now()

    // 1) Foto general: si cubre las fechas, el armado sale de memoria en segundos
    const cubre = desde >= diaLocal(FOTO_VENTA_DIAS - 1)
    if (cubre && !general.error) {
      // «Foto nueva»: se pide otra salvo que la que hay tenga menos de 1 minuto
      if (body?.forzar && !general.enCurso && edadGeneral() > 60_000) lanzarGeneral()
      const edad = edadGeneral()
      if (general.datos && desde >= general.datos.desdeVenta && edad < FOTO_USABLE_MS && !(body?.forzar && general.enCurso)) {
        if (edad > FOTO_NUEVA_MS) lanzarGeneral() // se usa igual y se renueva por detrás
        return armarDesdeGeneral(f, desde, hasta)
      }
      lanzarGeneral()
      return { estado: 'calculando', desde: new Date(general.inicio).toISOString() }
    }
    // la foto general falló: este armado va por el camino de siempre y la próxima vez se reintenta
    if (general.error) general.error = null

    // 2) Solo lo filtrado (venta de hace más de ~60 días, o la foto general no se pudo leer)
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
