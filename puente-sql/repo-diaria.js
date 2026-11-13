'use strict'
/**
 * REPO DIARIA — reposición desde MITO hacia los locales con la venta del día anterior.
 *
 * Es la misma cuenta que hacía `D:\analisis de datos indo\transfer\repo_diaria.py`
 * sobre TRANSFER.pbix, pero con los datos en vivo del DWH (sql/repo-diaria.sql),
 * así ya no hace falta actualizar el PBIX.
 *
 * Reglas (las de siempre):
 *   - Venta del último día con ventas (anterior a hoy), o los días que se pidan.
 *   - Solo locales receptores (CLIENTE REPO) y artículos de mercadería:
 *     material 0-9, sin BCF, sin INSUMOS / CODIGOS BASURA / DISCONTINUO - A FABRICA,
 *     sin las líneas W27-M / W27-I / X-W27.
 *   - A REPONER = mín(venta del local, stock MITO que queda). El stock MITO de un
 *     SKU se reparte por prioridad de local (COMPLETO / PARCIAL) y NUNCA se pasa.
 *
 * Funciones puras: no tocan el SQL. server.js les pasa los recordsets.
 */

// Locales receptores (CLIENTE REPO), en orden de prioridad
const RECEPTORES_ORDEN = [
  'CFD', 'CFPO', 'CFRA', 'CFR4', 'CFR9',
  'NCEND2', 'ESPID', 'LIBED', '9DEJU2',
  'BUSTD', 'MUNOD', 'RIVED', 'R9D', 'DINOD',
  'WALTD', 'VCPD', 'GPAZD',
]
const PRIO = new Map(RECEPTORES_ORDEN.map((r, i) => [r, i]))

const EXCL_LINEA = new Set(['W27-M', 'W27-I', 'X-W27'])
const EXCL_MATERIAL = new Set(['INSUMOS', 'CODIGOS BASURA', 'DISCONTINUO - A FABRICA'])
const MAYORISTA = new Set(['MITOD', 'DEPO2D', 'MAYORD'])

// Columna calculada "CLIENTE REPO" del PBIX
const CLIENTE_REPO = {
  LIBERD: 'LIBED', '9DEJULIO': '9DEJU2', BUSTOD: 'BUSTD', ESPINOD: 'ESPID',
  GRALPAZ: 'GPAZD', MUNOZ: 'MUNOD', NVOCED: 'NCEND2', RIVERAD: 'RIVED',
  RUTA9D2: 'R9D', WALMARTD: 'WALTD',
}

// Solo espacios comunes, como LTRIM/RTRIM del SQL (el PBIX conserva otros caracteres del final)
const txt = (v) => (v == null ? '' : String(v).replace(/^ +| +$/g, ''))

/** "DRAGONFISH_9DEJUL2" -> "9DEJULIO" (columna Locales de DIM_Tiendas del PBIX). */
function baseDeTienda(tienda) {
  let t = txt(tienda).replace(/^DRAGONFISH_/, '')
  if (MAYORISTA.has(t)) return 'MAYORISTA'
  return t.replace('NVOCED2', 'NVOCED').replace('9DEJUL2', '9DEJULIO')
}

const clienteDeBase = (base) => CLIENTE_REPO[base] ?? base

function articuloValido(a) {
  if (!a) return false
  if (!/^[0-9]$/.test(a.ID_MATERIAL)) return false
  if (a.ID_ART.toUpperCase() === 'BCF') return false
  if (EXCL_MATERIAL.has(a.MATERIAL)) return false
  if (EXCL_LINEA.has(a.ID_LINEA)) return false
  return true
}

/** Columna "Descripción adicional macro" del PBIX. */
const descMacro = (a) => `(${a.ID_FLIA})${a.ARTICULO_ADICIONAL} - ${a.ID_LINEA}(${a.ID_GRUPO})`

/** Orden de texto como Python/pandas (por código, no por idioma). */
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const ddmm = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
const ddmmaaaa = (iso) => `${ddmm(iso)}/${iso.slice(0, 4)}`

/** Normaliza los recordsets del SQL (una vez por foto). */
function prepararFoto(recordsets) {
  const [dias = [], ventas = [], stock = [], articulos = []] = recordsets ?? []
  const arts = new Map()
  for (const f of articulos) {
    const a = {
      ID_ART: txt(f.ID_ART), ARTICULO: txt(f.ARTICULO), ARTICULO_ADICIONAL: txt(f.ARTICULO_ADICIONAL),
      ID_PROV: txt(f.ID_PROV), PROVEEDOR: txt(f.PROVEEDOR), ID_GRUPO: txt(f.ID_GRUPO).toUpperCase(),
      ID_FLIA: txt(f.ID_FLIA), ID_MATERIAL: txt(f.ID_MATERIAL), MATERIAL: txt(f.MATERIAL), ID_LINEA: txt(f.ID_LINEA),
    }
    // El PBIX hace drop_duplicates: queda el primero
    if (a.ID_ART && !arts.has(a.ID_ART)) arts.set(a.ID_ART, a)
  }
  return {
    dias: dias.map((f) => ({ dia: txt(f.dia), unidades: Number(f.unidades) || 0 })).filter((d) => d.dia),
    ventas: ventas.map((f) => ({
      dia: txt(f.dia), tienda: txt(f.Tienda), art: txt(f.ID_ART), color: txt(f.ID_COLOR), talle: txt(f.ID_TALLE),
      cant: Number(f.cant) || 0,
    })),
    stock: stock.map((f) => ({
      art: txt(f.ID_ART), color: txt(f.ID_COLOR), talle: txt(f.ID_TALLE),
      cant: Number(f.cant) || 0, // stock real
      fisico: Number(f.fisico ?? f.cant) || 0,
      comprometido: Number(f.comprometido) || 0,
    })),
    arts,
  }
}

/**
 * Calcula la repo de los días pedidos (o del último día con venta antes de `hoy`).
 * @param foto  lo que devuelve prepararFoto
 * @param opts  { fechas?: string[] ('YYYY-MM-DD'), hoy: 'YYYY-MM-DD' }
 */
function calcularRepo(foto, opts) {
  const hoy = opts.hoy
  const totalDia = new Map(foto.dias.map((d) => [d.dia, d.unidades]))
  const disponibles = foto.dias.filter((d) => d.unidades > 0 && d.dia < hoy).map((d) => d.dia).sort()

  let targets
  if (Array.isArray(opts.fechas) && opts.fechas.length) {
    targets = [...new Set(opts.fechas.map(txt))].sort()
    const faltan = targets.filter((t) => !((totalDia.get(t) ?? 0) > 0))
    if (faltan.length) throw new Error(`Sin ventas para ${faltan.join(', ')}`)
  } else {
    if (!disponibles.length) throw new Error('No hay días con venta en la foto del DWH')
    targets = [disponibles[disponibles.length - 1]]
  }
  const tset = new Set(targets)
  const ultimo = targets[targets.length - 1]

  // Stock MITO por SKU = stock REAL (físico - comprometido), solo artículos válidos
  const stockSku = new Map()
  const detalleStock = new Map()
  for (const s of foto.stock) {
    if (s.cant <= 0 || !articuloValido(foto.arts.get(s.art))) continue
    const sku = `${s.art} ${s.color} ${s.talle}`
    stockSku.set(sku, (stockSku.get(sku) ?? 0) + s.cant)
    const d = detalleStock.get(sku) ?? { fisico: 0, comprometido: 0 }
    d.fisico += s.fisico
    d.comprometido += s.comprometido
    detalleStock.set(sku, d)
  }

  // Venta de los días pedidos, de locales receptores y artículos válidos
  const ventas = []
  for (const v of foto.ventas) {
    if (!tset.has(v.dia) || v.cant <= 0) continue
    const base = baseDeTienda(v.tienda)
    const cliente = clienteDeBase(base)
    if (!PRIO.has(cliente) || !articuloValido(foto.arts.get(v.art))) continue
    ventas.push({ ...v, base, cliente, sku: `${v.art} ${v.color} ${v.talle}` })
  }

  // SKUs pedidos por local (para el % de completitud), antes de mirar el stock
  const pedidos = new Map()
  for (const v of ventas) {
    if (!pedidos.has(v.cliente)) pedidos.set(v.cliente, new Set())
    pedidos.get(v.cliente).add(v.sku)
  }

  // Venta por (local, SKU) y venta total del SKU, solo SKUs con stock MITO
  const porPar = new Map()
  const ventaTotal = new Map()
  for (const v of ventas) {
    if (!stockSku.has(v.sku)) continue
    ventaTotal.set(v.sku, (ventaTotal.get(v.sku) ?? 0) + v.cant)
    const k = `${v.cliente}|${v.sku}`
    const p = porPar.get(k)
    if (p) p.venta += v.cant
    else porPar.set(k, { cliente: v.cliente, sku: v.sku, art: v.art, color: v.color, talle: v.talle, base: v.base, tienda: v.tienda, venta: v.cant })
  }

  // Reparto por prioridad: dentro de cada SKU, local de mayor prioridad primero
  const pares = [...porPar.values()].sort(
    (a, b) => cmp(a.sku, b.sku) || PRIO.get(a.cliente) - PRIO.get(b.cliente) || b.venta - a.venta,
  )
  const resto = new Map(stockSku)
  const filas = []
  for (const p of pares) {
    const disp = resto.get(p.sku) ?? 0
    const a = Math.min(p.venta, disp)
    resto.set(p.sku, disp - a)
    if (a <= 0) continue
    const art = foto.arts.get(p.art)
    filas.push({
      cliente: p.cliente,
      base: p.base,
      proveedor_id: art.ID_PROV,
      articulo: p.art,
      desc_adicional: descMacro(art),
      descripcion: `${art.ID_MATERIAL} ${art.MATERIAL}`,
      color: p.color,
      talle: p.talle,
      sku: p.sku,
      stock_mito: stockSku.get(p.sku),
      stock_fisico: detalleStock.get(p.sku)?.fisico ?? 0,
      comprometido: detalleStock.get(p.sku)?.comprometido ?? 0,
      venta_local: p.venta,
      venta_total: ventaTotal.get(p.sku),
      a_reponer: a,
      metodo: a >= p.venta ? 'COMPLETO' : 'PARCIAL',
      tienda: p.tienda,
      proveedor: art.PROVEEDOR,
      _disp: disp,
    })
  }

  filas.sort(
    (a, b) =>
      PRIO.get(a.cliente) - PRIO.get(b.cliente) ||
      cmp(a.descripcion, b.descripcion) || cmp(a.articulo, b.articulo) ||
      cmp(a.color, b.color) || cmp(a.talle, b.talle),
  )

  // Controles obligatorios (los mismos assert del script)
  const repartido = new Map()
  for (const f of filas) {
    if (f.a_reponer > f.venta_local || f.a_reponer > f._disp) throw new Error(`Reparto inválido en ${f.sku}`)
    repartido.set(f.sku, (repartido.get(f.sku) ?? 0) + f.a_reponer)
  }
  for (const [sku, tot] of repartido) {
    if (tot > stockSku.get(sku)) throw new Error(`El reparto de ${sku} supera el stock MITO`)
  }
  for (const f of filas) delete f._disp

  // Resumen por local
  const resumen = []
  let totSkus = 0, totU = 0, totPed = 0
  for (const cli of RECEPTORES_ORDEN) {
    const sub = filas.filter((f) => f.cliente === cli)
    const skusPed = pedidos.get(cli)?.size ?? 0
    totPed += skusPed
    if (!skusPed && !sub.length) continue
    const u = sub.reduce((s, f) => s + f.a_reponer, 0)
    totSkus += sub.length
    totU += u
    resumen.push({ cliente: cli, skus: sub.length, unidades: u, completitud: skusPed ? Math.round((sub.length / skusPed) * 1e4) / 1e4 : 0 })
  }
  resumen.push({ cliente: 'TOTAL', skus: totSkus, unidades: totU, completitud: totPed ? Math.round((totSkus / totPed) * 1e4) / 1e4 : 0 })

  const varios = targets.length > 1
  const [, m, d] = ultimo.split('-')
  return {
    dias: targets,
    fecha_iso: varios ? `${targets[0]} a ${ultimo}` : ultimo,
    fecha_str: varios ? `${ddmm(targets[0])} al ${ddmmaaaa(ultimo)}` : ddmmaaaa(ultimo),
    archivo: varios
      ? `REPO_POR_DIA_${targets[0].slice(8, 10)}a${d}${MES[Number(m) - 1]}.xlsx`
      : `REPO_POR_DIA_${d}${MES[Number(m) - 1]}.xlsx`,
    filas,
    resumen,
    unidades: totU,
    dias_disponibles: foto.dias.filter((x) => x.dia < hoy && x.unidades > 0),
  }
}

module.exports = { prepararFoto, calcularRepo, baseDeTienda, clienteDeBase, RECEPTORES_ORDEN }
