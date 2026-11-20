// Cliente mínimo de la API REST de Dragonfish (M1T0O1\ZOOLOGIC · DRAGONFISH_MITO).
// SOLO ALTAS de pedidos de venta: nunca modifica ni borra. Datos en puente-sql/.env:
//   DRAGON_API_URL, DRAGON_API_IDCLIENTE (MITO), DRAGON_API_TOKEN (JWT ya generado)
const fs = require('fs')
const path = require('path')

for (const l of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const URL_API = (process.env.DRAGON_API_URL || 'http://192.168.0.222:8015/api.Dragonfish').replace(/\/$/, '')
const ID = (process.env.DRAGON_API_IDCLIENTE || '').trim().toUpperCase()
const TOKEN = (process.env.DRAGON_API_TOKEN || '').trim()
const BASE = process.env.DRAGON_BASE || 'MITO'

/**
 * Da de alta un pedido de venta. items: [{ art, color, talle, cantidad }]. El precio no se manda:
 * Dragon pone el del artículo en la lista indicada.
 * Devuelve { ok, status, numero, codigo, detalle }.
 */
/** '2026-10-16' -> '/Date(1792119600000-0300)/' (medianoche de Argentina), el formato de fecha de WCF */
function fechaWcf(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return `/Date(${Date.UTC(y, m - 1, d, 3)}-0300)/`
}

async function crearPedido({ cliente, lista = 'LISTA2', obs = '', items, fecha, motivo = '', soloArmar = false }) {
  if (!soloArmar && (!ID || !TOKEN)) throw new Error('Faltan DRAGON_API_IDCLIENTE / DRAGON_API_TOKEN en puente-sql/.env')
  const cuerpo = {
    Cliente: cliente,
    ListaDePrecios: lista,
    ...(motivo ? { Motivo: motivo } : {}),
    Fecha: fechaWcf(fecha || new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)),
    Obs: obs.slice(0, 250),
    FacturaDetalle: items.map((i, n) => ({
      NroItem: n + 1,
      Articulo: String(i.art).trim().toUpperCase(),
      Color: String(i.color || '').trim().toUpperCase(),
      Talle: String(i.talle || '').trim().toUpperCase(),
      Cantidad: Number(i.cantidad),
    })),
  }
  // Prueba en seco: devuelve el cuerpo que se mandaría, sin tocar Dragon
  if (soloArmar) return { ok: true, status: 0, numero: null, codigo: null, detalle: 'en seco', cuerpo }
  const r = await fetch(`${URL_API}/Pedido/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', IdCliente: ID, Authorization: TOKEN, BaseDeDatos: BASE },
    // WCF exige las fechas escapadas: "\/Date(...)\/"
    body: JSON.stringify(cuerpo).replace(/"\/Date\(([^)]*)\)\/"/g, '"\\/Date($1)\\/"'),
  })
  const texto = await r.text()
  let j = null
  try { j = JSON.parse(texto) } catch { /* texto plano */ }
  const info = r.headers.get('InformacionAdicional') || ''
  return {
    ok: r.ok,
    status: r.status,
    numero: j?.Numero ?? null,
    codigo: j?.Codigo ?? null,
    detalle: r.ok ? `Pedido N° ${j?.Numero ?? '?'}` : `${r.status} ${r.statusText} ${info} ${texto.slice(0, 300)}`.trim(),
  }
}

/**
 * Alta de un pedido de compra (Órdenes de compras del hub) en DRAGONFISH_<base>.
 * Se manda el mismo N° de la OC (Letra X, punto de venta 164, como las OC de INDOD).
 * items: [{ articulo, color, talle, cantidad, precio, descuento }] (descuento = % del renglón -> Descuento);
 * descuento = % general del pedido (PorcentajeDescuento). Probado 05/11/2026 con X-0164-99001.
 */
async function crearPedidoCompra({ base = 'INDOD', numero, proveedor, motivo, condicion, lista = 'LISTA0', fecha, fechaEntrega, obs = '', items, descuento = 0 }) {
  if (!ID || !TOKEN) throw new Error('Faltan DRAGON_API_IDCLIENTE / DRAGON_API_TOKEN en puente-sql/.env')
  const cuerpo = {
    Letra: 'X',
    PuntoDeVenta: 164,
    Numero: Number(numero),
    Proveedor: String(proveedor).trim(),
    ListaDePrecios: lista,
    CondicionPagoPreferente: condicion || '',
    Motivo: motivo,
    Fecha: fechaWcf(fecha),
    FechaEntrega: fechaWcf(fechaEntrega || fecha),
    Obs: obs.slice(0, 250),
    ...(Number(descuento) > 0 ? { PorcentajeDescuento: Number(descuento) } : {}),
    FacturaDetalle: items.map((i, n) => ({
      NroItem: n + 1,
      Articulo: String(i.articulo).trim().toUpperCase(),
      Color: String(i.color || '').trim().toUpperCase(),
      Talle: String(i.talle || '').trim().toUpperCase(),
      Cantidad: Number(i.cantidad),
      Precio: Number(i.precio) || 0,
      ...(Number(i.descuento) > 0 ? { Descuento: Number(i.descuento) } : {}),
    })),
  }
  const r = await fetch(`${URL_API}/Pedidodecompra/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', IdCliente: ID, Authorization: TOKEN, BaseDeDatos: String(base).toUpperCase() },
    // WCF exige las fechas escapadas: "\/Date(...)\/"
    body: JSON.stringify(cuerpo).replace(/"\/Date\(([^)]*)\)\/"/g, '"\\/Date($1)\\/"'),
  })
  const texto = await r.text()
  let j = null
  try { j = JSON.parse(texto) } catch { /* texto plano */ }
  const info = r.headers.get('InformacionAdicional') || ''
  return {
    ok: r.ok,
    status: r.status,
    numero: j?.Numero ?? null,
    codigo: j?.Codigo ?? null,
    detalle: r.ok ? `Pedido de compra N° ${j?.Numero ?? '?'}` : `${r.status} ${r.statusText} ${info} ${texto.slice(0, 300)}`.trim(),
  }
}

/* ---------------------------------------------------------------------------
 * ALTA DE ARTÍCULOS (tienda mayorista cf-zimith-mayorista, 20/11/2026). Siempre en INDOD.
 * Carga como los artículos de temporada que ya están en Dragon (ej. CF264132): artículo con su
 * clasificación + un precio por lista a nivel artículo. Sin códigos de barras (esos artículos no tienen).
 * Solo ALTAS: si el código ya existe, no toca nada. Colores y talles nuevos se crean solo si no existen.
 * ------------------------------------------------------------------------- */
const BASE_ALTA = 'INDOD'
const LISTAS_ALTA = new Set(['LISTA2', 'LISTA3', 'EXPOR', 'LISTA1'])
const CLASIF_ALTA = ['Temporada', 'Linea', 'Material', 'Grupo', 'Familia', 'CategoriaDeArticulo', 'Clasificacion', 'TipodeArticulo', 'Proveedor']

async function llamarIndod(metodo, ruta, cuerpo) {
  const r = await fetch(`${URL_API}/${ruta}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', IdCliente: ID, Authorization: TOKEN, BaseDeDatos: BASE_ALTA },
    ...(cuerpo ? { body: JSON.stringify(cuerpo).replace(/"\/Date\(([^)]*)\)\/"/g, '"\\/Date($1)\\/"') } : {}),
    signal: AbortSignal.timeout(30_000),
  })
  const texto = await r.text()
  return { ok: r.ok, status: r.status, texto, info: r.headers.get('InformacionAdicional') || '' }
}
const existe = async (ruta) => {
  const r = await llamarIndod('GET', ruta)
  if (r.status === 404) return false
  if (r.ok) return true
  throw new Error(`Dragon no respondió bien (${r.status}) al consultar ${ruta}`)
}
const textoOk = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max
const codigoOk = (v, max) => typeof v === 'string' && new RegExp(`^[A-Z0-9]{1,${max}}$`).test(v)

/**
 * a: { codigo, descripcion, ano, Temporada, Linea, Material, Grupo, Familia, CategoriaDeArticulo, Clasificacion,
 *      TipodeArticulo, Proveedor, precios: [{ lista, precio }], colores: [{ codigo, descripcion }], talles: [codigo] }
 * colores/talles = SOLO los nuevos que hay que crear. Devuelve { ok, codigo, pasos: [{ paso, ok, detalle }] }.
 */
async function crearArticulo(a) {
  if (!ID || !TOKEN) throw new Error('Faltan DRAGON_API_IDCLIENTE / DRAGON_API_TOKEN en puente-sql/.env')
  const codigo = String(a?.codigo ?? '').trim().toUpperCase()
  if (!codigoOk(codigo, 15)) throw new Error('Código inválido (letras y números, hasta 15)')
  const descripcion = String(a?.descripcion ?? '').trim().toUpperCase()
  if (!textoOk(descripcion, 100)) throw new Error('Falta la descripción (hasta 100)')
  const ano = Number(a?.ano)
  if (!Number.isInteger(ano) || ano < 0 || ano > 99) throw new Error('Año inválido (2 dígitos)')
  const clasif = {}
  for (const c of CLASIF_ALTA) {
    const v = String(a?.[c] ?? '').trim()
    if (v.length > 10 || /[^\wÑñ .\-]/.test(v)) throw new Error(`${c} inválido`)
    if (v) clasif[c] = v
  }
  if (!clasif.Proveedor || !clasif.Grupo || !clasif.Temporada) throw new Error('Faltan proveedor, grupo o temporada')
  const precios = (Array.isArray(a?.precios) ? a.precios : []).map((p) => ({ lista: String(p?.lista ?? ''), precio: Number(p?.precio) }))
  if (!precios.length || precios.some((p) => !LISTAS_ALTA.has(p.lista) || !(p.precio > 0 && p.precio < 1e9))) throw new Error('Precios inválidos')
  if (!precios.some((p) => p.lista === 'LISTA2')) throw new Error('Falta el precio MAYOR (LISTA2)')
  const colores = (Array.isArray(a?.colores) ? a.colores : []).map((c) => ({ codigo: String(c?.codigo ?? '').trim().toUpperCase(), descripcion: String(c?.descripcion ?? '').trim().toUpperCase() }))
  if (colores.length > 30 || colores.some((c) => !codigoOk(c.codigo, 6) || !textoOk(c.descripcion, 50))) throw new Error('Colores nuevos inválidos')
  const talles = (Array.isArray(a?.talles) ? a.talles : []).map((t) => String(t ?? '').trim().toUpperCase())
  if (talles.length > 30 || talles.some((t) => !/^[A-Z0-9.\/]{1,5}$/.test(t))) throw new Error('Talles nuevos inválidos')

  const pasos = []
  // 1) el código tiene que estar libre (re-verificación justo antes de crear)
  if (await existe(`Articulo/${encodeURIComponent(codigo)}/`)) {
    return { ok: false, codigo, pasos: [{ paso: 'Verificar código', ok: false, detalle: `${codigo} ya existe en Dragon: no se tocó nada` }] }
  }
  pasos.push({ paso: 'Verificar código', ok: true, detalle: `${codigo} libre en INDOD` })

  // 2) colores y talles nuevos (si ya existen, se saltean)
  for (const c of colores) {
    if (await existe(`Color/${encodeURIComponent(c.codigo)}/`)) { pasos.push({ paso: `Color ${c.codigo}`, ok: true, detalle: 'ya existía' }); continue }
    const r = await llamarIndod('POST', 'Color/', { Codigo: c.codigo, Descripcion: c.descripcion })
    pasos.push({ paso: `Color ${c.codigo}`, ok: r.ok, detalle: r.ok ? 'creado' : `${r.status} ${r.info} ${r.texto.slice(0, 200)}`.trim() })
    if (!r.ok) return { ok: false, codigo, pasos }
  }
  for (const t of talles) {
    if (await existe(`Talle/${encodeURIComponent(t)}/`)) { pasos.push({ paso: `Talle ${t}`, ok: true, detalle: 'ya existía' }); continue }
    const r = await llamarIndod('POST', 'Talle/', { Codigo: t, Descripcion: t })
    pasos.push({ paso: `Talle ${t}`, ok: r.ok, detalle: r.ok ? 'creado' : `${r.status} ${r.info} ${r.texto.slice(0, 200)}`.trim() })
    if (!r.ok) return { ok: false, codigo, pasos }
  }

  // 3) el artículo, con los mismos datos fijos que los de temporada (IVA, imprime despacho)
  const art = {
    Codigo: codigo,
    Descripcion: descripcion,
    DescripcionAdicional: descripcion,
    Ano: ano,
    ...clasif,
    CondicionIvaVentas: 1,
    CondicionIvaCompras: 1,
    ImprimeDespacho: true,
  }
  const ra = await llamarIndod('POST', 'Articulo/', art)
  pasos.push({ paso: 'Artículo', ok: ra.ok, detalle: ra.ok ? `${codigo} · ${descripcion}` : `${ra.status} ${ra.info} ${ra.texto.slice(0, 300)}`.trim() })
  if (!ra.ok) return { ok: false, codigo, pasos }

  // 4) un precio por lista, vigente desde hoy
  const hoy = fechaWcf(new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10))
  for (const p of precios) {
    const r = await llamarIndod('POST', 'Preciodearticulo/', { Articulo: codigo, Color: '', Talle: '', ListaDePrecio: p.lista, PrecioDirecto: p.precio, FechaVigencia: hoy })
    pasos.push({ paso: `Precio ${p.lista}`, ok: r.ok, detalle: r.ok ? `$ ${p.precio}` : `${r.status} ${r.info} ${r.texto.slice(0, 200)}`.trim() })
  }
  return { ok: pasos.every((p) => p.ok), codigo, pasos }
}

/* -------------------------------------------------------------------------
 * Tienda mayorista: ficha de un cliente en DRAGONFISH_MITO. SOLO LECTURA (GET): nunca modifica.
 * Devuelve lo comercial que muestra el panel de la tienda, con los nombres de lista, condición de pago,
 * vendedor, transportista y clasificación ya resueltos (esas tablas se guardan 10 minutos).
 * ------------------------------------------------------------------------- */
async function llamarMito(ruta) {
  const r = await fetch(`${URL_API}/${ruta}`, { headers: { IdCliente: ID, Authorization: TOKEN, BaseDeDatos: BASE }, signal: AbortSignal.timeout(20_000) })
  const texto = await r.text()
  let json = null
  try { json = JSON.parse(texto) } catch { /* no era JSON */ }
  return { ok: r.ok, status: r.status, json, texto }
}
const nombresCache = new Map() // tabla -> { vence, mapa: Map(codigo -> nombre) }
async function nombres(tabla) {
  const c = nombresCache.get(tabla)
  if (c && c.vence > Date.now()) return c.mapa
  const mapa = new Map()
  for (let pag = 1; pag <= 10; pag++) {
    const r = await llamarMito(`${tabla}/?limit=500&page=${pag}`)
    const filas = (r.ok && r.json && r.json.Resultados) || []
    for (const f of filas) mapa.set(String(f.Codigo).trim(), String(f.Descripcion || f.Nombre || '').trim())
    if (filas.length < 500) break
  }
  nombresCache.set(tabla, { vence: Date.now() + 10 * 60_000, mapa })
  return mapa
}

async function leerCliente(codigo) {
  if (!ID || !TOKEN) throw new Error('Faltan DRAGON_API_IDCLIENTE / DRAGON_API_TOKEN en puente-sql/.env')
  const cod = String(codigo ?? '').trim()
  if (!/^[A-Za-z0-9]{1,10}$/.test(cod)) throw new Error('Código de cliente inválido')
  const r = await llamarMito(`Cliente/${encodeURIComponent(cod)}/`)
  if (r.status === 404 || (r.ok && !r.json)) return { existe: false, codigo: cod }
  if (!r.ok) throw new Error(`Dragon respondió ${r.status} al leer el cliente`)
  const c = r.json
  const [listas, condiciones, vendedores, transportes, clasif] = await Promise.all(
    ['Listadeprecios', 'Condiciondepago', 'Vendedor', 'Transportista', 'Clasificacioncliente'].map((t) => nombres(t).catch(() => new Map())),
  )
  const con = (mapa, v) => { const k = String(v ?? '').trim(); return k ? { codigo: k, nombre: mapa.get(k) || '' } : null }
  const t = (v) => String(v ?? '').trim()
  const direccion = [t(c.Calle), c.Numero ? String(c.Numero) : '', t(c.Piso) && `piso ${t(c.Piso)}`, t(c.Departamento) && `dto ${t(c.Departamento)}`].filter(Boolean).join(' ')
  return {
    existe: true,
    codigo: t(c.Codigo) || cod,
    razonSocial: t(c.Nombre),
    fantasia: t(c.CodNombreFantasia),
    cuit: t(c.CUIT),
    situacionFiscal: c.SituacionFiscal ?? null,
    mail: t(c.EMail),
    telefono: t(c.Telefono),
    movil: t(c.Movil),
    direccion,
    localidad: t(c.Localidad),
    codigoPostal: t(c.CodigoPostal),
    provincia: t(c.Provincia),
    lista: con(listas, c.ListaDePrecio),
    descuento: t(c.DescuentoPreferente),
    condicionPago: con(condiciones, c.CondicionDePago),
    vendedor: con(vendedores, c.Vendedor),
    transportista: con(transportes, c.Transportista),
    clasificacion: con(clasif, c.Clasificacion),
    limiteCredito: c.TopeCtaCte ?? null,
    inactivo: !!c.InactivoFW,
    otrasDirecciones: (c.OtrasDirecciones || []).length,
    observacion: t(c.Observacion).slice(0, 500),
  }
}

module.exports = { crearPedido, crearPedidoCompra, crearArticulo, leerCliente }

// Prueba manual: node scripts/dragon.js --prueba
if (require.main === module && process.argv.includes('--prueba')) {
  crearPedido({
    cliente: '01140',
    lista: 'LISTA2', // MAYOR
    obs: '01140 (CF Ushuaia · Argentina S.R.L.) · PRUEBA HUB - no preparar',
    items: [{ art: 'ZH060018', color: '02', talle: 'U', cantidad: 2 }],
  }).then((r) => console.log(JSON.stringify(r, null, 1))).catch((e) => { console.error('ERROR', e.message); process.exit(1) })
}
