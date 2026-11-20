/**
 * Reposiciones / Transferencias > Reparto manual (/transferencias/reparto).
 *
 * Motor del reparto (funciones puras, sin React): modelo de la grilla, resumen (posturas, stock
 * ideal, diferencia), movimientos origen → destino y la SUGERENCIA por código + color.
 * Datos: Puente SQL (puente-sql/reparto.js), solo lectura. Los movimientos se cargan como lote de
 * Transferencias (RPC reparto_cargar_transferencias). Plan completo: docs/borradores/reparto-transferencias.md
 */
import { supabase } from './supabase'

/* ---------------------------------- tipos ---------------------------------- */

export interface OpcionFiltro { cod: string; nom: string }
export type ClaveFiltro = 'prov' | 'mat' | 'temp' | 'anio' | 'linea' | 'flia' | 'gen' | 'grupo'
/** art: artículos con stock o venta de la foto general del Puente (si ya está; si no, no viene) */
export type Opciones = Record<ClaveFiltro, OpcionFiltro[]> & { art?: (OpcionFiltro & { prov?: string })[] }
/** MITO = proveedores que empiezan con MO; MARCAS = el resto; '' = todos */
export type Origen = '' | 'MITO' | 'MARCAS'
export const esProvMito = (cod: string) => cod.trim().toUpperCase().startsWith('MO')
/** art = códigos o principios de código separados por «|» (el Puente busca cada uno con LIKE 'X%') */
export type Filtros = Record<ClaveFiltro, string[]> & { art: string; origen?: Origen }

export interface FilaPuente { a: string; c: string; t: string; s: number[]; v: number[]; tr: number[]; u: (number | null)[] }
export interface ArtPuente { nombre: string; desc: string; prov: string; grupo: string; material: string; linea: string; temporada: string; flia?: string }
export interface DatosReparto {
  estado: 'listo'
  locales: string[]
  filas: FilaPuente[]
  arts: Record<string, ArtPuente>
  desde: string
  hasta: string
  hoy: string
  articulos: number
  segundos?: number
  foto_en?: string
}

/** Una línea de la grilla: artículo · color · talle, con un valor por local (mismo orden que `locales`). */
export interface Fila {
  articulo: string
  color: string
  talle: string
  desc: string
  nombre: string
  grupo: string
  prov: string
  material: string
  linea: string
  flia: string
  base: number[] // stock al armar
  cur: number[] // stock después de repartir (lo que se edita)
  vend: number[] // venta del período
  trans: number[] // 1 = tiene algo en tránsito
  ult: (number | null)[] // días desde la última venta (null = sin venta en 180 días)
}

export interface Movimiento { articulo: string; color: string; talle: string; desc: string; material: string; desde: string; hacia: string; cantidad: number }

/* -------------------------------- constantes -------------------------------- */

export const FILTROS: { k: ClaveFiltro; titulo: string }[] = [
  { k: 'prov', titulo: 'ID proveedor descripción' },
  { k: 'mat', titulo: 'Material' },
  { k: 'temp', titulo: 'Temporada' },
  { k: 'anio', titulo: 'Año' },
  { k: 'linea', titulo: 'Línea' },
  { k: 'flia', titulo: 'Familia' },
  { k: 'gen', titulo: 'Género' },
  { k: 'grupo', titulo: 'Grupo' },
]
export const filtrosVacios = (): Filtros => ({ prov: [], mat: [], temp: [], anio: [], linea: [], flia: [], gen: [], grupo: [], art: '' })

/** Nombres cortos del encabezado para que entren los 20 locales sin scroll horizontal. */
export const CORTO: Record<string, string> = { MAYORD: 'MITO', WALMARTD: 'WALMRT', '9DEJULIO': '9DEJUL', GRALPAZ: 'GPAZ' }
export const DEPOSITOS = ['MAYORD', 'DEPO', 'POLO52'] // MITO, Indo, Polo: donan, nunca reciben

/** Prioridad de locales de la Repo diaria / Cascada (puente-sql/cascada.js PARAMS_DEFAULT). */
const PRIORIDAD = ['CFD', 'CFPO', 'CFRA', 'CFR4', 'CFR9', 'NVOCED', 'ESPINOD', 'LIBERD', '9DEJULIO', 'BUSTOD', 'MUNOZ', 'RIVERAD', 'RUTA9D', 'DINOD', 'WALMARTD', 'VCPD', 'GRALPAZ']
const CASC = {
  no_donan: ['GRALPAZ'],
  donante_queda: 1,
  tope_sku: 2,
  restriccion: { receptores: ['CFR4', 'CFR9', 'CFD', 'CFPO', 'CFRA'], proveedores: ['MOCF', 'MOZH', 'MOFR'] },
  pase_extra: ['NVOCED'],
  huecos_no_reciben: ['GRALPAZ'],
}

/** Bases del Tracking → columna del reparto (son los «CLIENTE REPO» de la Repo diaria). */
export const BASE_TRACKING: Record<string, string> = {
  RIVED: 'RIVERAD', GPAZD: 'GRALPAZ', LIBED: 'LIBERD', '9DEJU2': '9DEJULIO', BUSTD: 'BUSTOD', MUNOD: 'MUNOZ',
  ESPID: 'ESPINOD', R9D: 'RUTA9D', WALTD: 'WALMARTD', NCEND2: 'NVOCED',
}

/* ---------------------------------- talles ---------------------------------- */

const ESCALA = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL', 'XXXL', '4XL', 'XXXXL', 'U', 'UNICO']
function claveTalle(t: string): [number, number, string] {
  const u = String(t).trim().toUpperCase()
  const i = ESCALA.indexOf(u)
  if (i >= 0) return [0, i, '']
  const n = Number(u)
  return Number.isFinite(n) && u !== '' ? [1, n, ''] : [2, 0, u]
}
export function ordenTalle(a: string, b: string) {
  const x = claveTalle(a), y = claveTalle(b)
  return x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2])
}

/* ---------------------------------- modelo ---------------------------------- */

export function construirModelo(d: DatosReparto): Fila[] {
  const filas = d.filas.map((f) => {
    const a = d.arts[f.a]
    return {
      articulo: f.a, color: f.c, talle: f.t,
      desc: a?.desc ?? f.a, nombre: a?.nombre ?? f.a, grupo: a?.grupo ?? '', prov: a?.prov ?? '', material: a?.material ?? '',
      linea: a?.linea ?? '',
      // familia: la manda el Puente; los puentes viejos solo la traen dentro de desc «(FLIA)…»
      flia: a?.flia ?? /^\(([^)]*)\)/.exec(a?.desc ?? '')?.[1] ?? '',
      base: f.s.slice(), cur: f.s.slice(), vend: f.v.slice(), trans: f.tr.slice(), ult: f.u.slice(),
    }
  })
  return filas.sort((a, b) => a.articulo.localeCompare(b.articulo) || a.color.localeCompare(b.color) || ordenTalle(a.talle, b.talle))
}

export const suma = (xs: number[]) => xs.reduce((a, b) => a + (b || 0), 0)

/** Ordena las líneas: por venta total del artículo (el que más vende arriba) o por código. */
export function ordenar(filas: Fila[], orden: 'venta' | 'codigo'): Fila[] {
  const ventaArt = new Map<string, number>()
  if (orden === 'venta') for (const f of filas) ventaArt.set(f.articulo, (ventaArt.get(f.articulo) ?? 0) + suma(f.vend))
  return [...filas].sort(
    (a, b) =>
      (orden === 'venta' ? (ventaArt.get(b.articulo) ?? 0) - (ventaArt.get(a.articulo) ?? 0) : 0) ||
      a.articulo.localeCompare(b.articulo) || a.color.localeCompare(b.color) || ordenTalle(a.talle, b.talle),
  )
}

/**
 * Resumen de lo que se ve (como el SUBTOTAL del Excel de la PWA vieja):
 * posturas = artículo-color con stock; stock ideal = stock total repartido según el % de venta
 * (stock de los locales hasta DEPO, venta de los locales hasta CFR4, como el original), redondeado;
 * dif = stock real − ideal.
 */
export function resumen(filas: Fila[], locales: string[]) {
  const n = locales.length
  const posturas: number[] = Array(n).fill(0), stock: number[] = Array(n).fill(0), venta: number[] = Array(n).fill(0)
  const sets = locales.map(() => new Set<string>())
  for (const f of filas) for (let i = 0; i < n; i++) {
    stock[i] += f.cur[i] || 0
    venta[i] += f.vend[i] || 0
    if (f.cur[i] > 0) sets[i].add(`${f.articulo}|${f.color}`)
  }
  const iD = locales.indexOf('DEPO'), iC = locales.indexOf('CFR4')
  let tS = 0, tV = 0
  locales.forEach((_, i) => {
    if (iD < 0 || i <= iD) tS += stock[i]
    if (iC < 0 || i <= iC) tV += venta[i]
  })
  const ideal = locales.map((_, i) => (tV > 0 ? Math.round((venta[i] / tV) * tS) : 0))
  sets.forEach((s, i) => (posturas[i] = s.size))
  // MITO y Polo no tienen stock ideal (no venden): su diferencia queda vacía
  const sinIdeal = (i: number) => locales[i] === 'MAYORD' || locales[i] === 'POLO52'
  return { posturas, stock, venta, ideal, dif: stock.map((s, i) => (sinIdeal(i) ? 0 : s - ideal[i])) }
}

type EdicionCelda = { fila: Fila; i: number; antes: number; despues: number }

/** Movimientos por diferencia neta, emparejando en orden de columnas (respaldo). */
function movimientosNetos(f: Fila, locales: string[], out: Movimiento[]) {
  const src: [number, number][] = [], dst: [number, number][] = []
  f.cur.forEach((c, i) => {
    const d = c - f.base[i]
    if (d < 0) src.push([i, -d])
    else if (d > 0) dst.push([i, d])
  })
  let i = 0, j = 0
  while (i < src.length && j < dst.length) {
    const q = Math.min(src[i][1], dst[j][1])
    out.push({ articulo: f.articulo, color: f.color, talle: f.talle, desc: f.nombre, material: f.material, desde: locales[src[i][0]], hacia: locales[dst[j][0]], cantidad: q })
    src[i][1] -= q
    dst[j][1] -= q
    if (!src[i][1]) i++
    if (!dst[j][1]) j++
  }
}

/**
 * Reproduce las ediciones en el orden en que se hicieron y empareja cada baja con la suba que la
 * acompaña (lo que bajaste en DINOD y subiste en BUSTOD va DINOD → BUSTOD), sin cascada.
 * Si después corregís una celda, primero se deshace lo que esa celda ya tenía emparejado.
 */
function movimientosPorEdicion(historial: EdicionCelda[][]) {
  type Est = { movs: { de: number; a: number; n: number }[]; src: { i: number; n: number }[]; dst: { i: number; n: number }[] }
  const est = new Map<Fila, Est>()
  const mover = (e: Est, de: number, a: number, n: number) => {
    if (de === a || n <= 0) return
    const m = e.movs.find((x) => x.de === de && x.a === a)
    if (m) m.n += n
    else e.movs.push({ de, a, n })
  }
  const sumarPend = (l: { i: number; n: number }[], i: number, n: number) => {
    const p = l.find((x) => x.i === i)
    if (p) p.n += n
    else l.push({ i, n })
  }
  // origen nuevo: primero cubre subas que esperaban origen (en orden), el resto queda esperando destino
  const darDesde = (e: Est, i: number, n: number) => {
    while (n > 0 && e.dst.length) {
      const d = e.dst[0], q = Math.min(n, d.n)
      mover(e, i, d.i, q)
      n -= q
      if (!(d.n -= q)) e.dst.shift()
    }
    if (n > 0) sumarPend(e.src, i, n)
  }
  const recibirEn = (e: Est, i: number, n: number) => {
    while (n > 0 && e.src.length) {
      const s = e.src[0], q = Math.min(n, s.n)
      mover(e, s.i, i, q)
      n -= q
      if (!(s.n -= q)) e.src.shift()
    }
    if (n > 0) sumarPend(e.dst, i, n)
  }
  const sacarPend = (l: { i: number; n: number }[], i: number, n: number) => {
    const p = l.find((x) => x.i === i)
    if (!p) return n
    const q = Math.min(n, p.n)
    p.n -= q
    if (!p.n) l.splice(l.indexOf(p), 1)
    return n - q
  }
  for (const accion of historial)
    for (const c of accion) {
      const e = est.get(c.fila) ?? { movs: [], src: [], dst: [] }
      est.set(c.fila, e)
      let n = Math.abs(c.despues - c.antes)
      if (c.despues < c.antes) {
        // baja: deshace primero lo que esa celda había recibido
        n = sacarPend(e.dst, c.i, n)
        for (let k = e.movs.length - 1; k >= 0 && n > 0; k--) {
          const m = e.movs[k]
          if (m.a !== c.i) continue
          const q = Math.min(n, m.n)
          m.n -= q
          n -= q
          darDesde(e, m.de, q) // el origen de ese envío queda libre otra vez
        }
        if (n > 0) darDesde(e, c.i, n)
      } else {
        // suba: deshace primero lo que esa celda había dado
        n = sacarPend(e.src, c.i, n)
        for (let k = e.movs.length - 1; k >= 0 && n > 0; k--) {
          const m = e.movs[k]
          if (m.de !== c.i) continue
          const q = Math.min(n, m.n)
          m.n -= q
          n -= q
          recibirEn(e, m.a, q)
        }
        if (n > 0) recibirEn(e, c.i, n)
      }
      e.movs = e.movs.filter((m) => m.n > 0)
    }
  return est
}

/**
 * Movimientos origen → destino (mismo talle) tal como se movieron a mano: si bajaste en DINOD y
 * subiste en BUSTOD, sale DINOD → BUSTOD. Sin `historial` (o si no cierra con la grilla) empareja
 * por diferencia neta en orden de columnas.
 */
export function calcularMovimientos(filas: Fila[], locales: string[], historial: EdicionCelda[][] = []): Movimiento[] {
  const out: Movimiento[] = []
  const est = movimientosPorEdicion(historial)
  for (const f of filas) {
    const e = est.get(f)
    if (!e) {
      if (f.cur.some((c, i) => c !== f.base[i])) movimientosNetos(f, locales, out)
      continue
    }
    // control: lo emparejado + lo que quedó suelto tiene que dar la diferencia de cada local
    const neto = f.base.map(() => 0)
    for (const m of e.movs) { neto[m.de] -= m.n; neto[m.a] += m.n }
    for (const s of e.src) neto[s.i] -= s.n
    for (const d of e.dst) neto[d.i] += d.n
    if (neto.some((x, i) => x !== f.cur[i] - f.base[i])) {
      movimientosNetos(f, locales, out)
      continue
    }
    for (const m of e.movs)
      out.push({ articulo: f.articulo, color: f.color, talle: f.talle, desc: f.nombre, material: f.material, desde: locales[m.de], hacia: locales[m.a], cantidad: m.n })
  }
  return out
}

/* --------------------------------- sugerencia --------------------------------- */

export interface OpcionesSugerencia {
  donaMito: boolean
  donaIndo: boolean
  donaPolo: boolean
  segunIdeal: boolean
  minEnvio: number
  abrirColores: boolean
  huecosSinVenta: boolean
}
export const OPCIONES_SUGERENCIA: OpcionesSugerencia = {
  // todos los tildes arrancan sin tildar (pedido del usuario); el que quiera los prende
  donaMito: false, donaIndo: false, donaPolo: false, segunIdeal: false, minEnvio: 2, abrirColores: false, huecosSinVenta: false,
}

export interface ResultadoSugerencia {
  cambios: { fila: Fila; i: number; antes: number; despues: number }[]
  total: number
  repo: number
  indo: number
  polo: number
  locales: number
  extra: number
  huecos: number
  abre: number
  yaCubre: number
  descartadas: number
  sinCubrir: { restriccion: number; sin_donante: number }
  huecosPendientes: number
  huecosSinVentaPosibles: number
  tallesSinVenta: string[]
  noRecibenHuecos: Record<string, string[]>
  usaMito: boolean
  principales: string[]
  deMito: boolean
}

type Envio = { f: Fila; de: number; a: number; n: number; etapa: string }

/**
 * Sugerencia para un CÓDIGO + COLOR (todos sus talles) = Repo diaria + Cascada, con las reglas
 * acordadas el 18/11/2026 (ver el plan). Corre sobre lo que hay en la grilla (respeta lo movido a
 * mano), repite pasadas hasta que no aparece nada nuevo (máx. 6) y devuelve los cambios para
 * aplicarlos como UNA acción de deshacer. NO modifica las filas: trabaja sobre copias.
 */
export function sugerir(
  todas: Fila[],
  visibles: Fila[],
  locales: string[],
  art: string,
  col: string,
  op: OpcionesSugerencia,
): ResultadoSugerencia {
  const filas = todas.filter((f) => f.articulo === art && f.color === col).sort((a, b) => ordenTalle(a.talle, b.talle))
  const L = (s: string) => locales.indexOf(s)
  const prov = (filas[0]?.prov ?? '').toUpperCase()
  const deMito = CASC.restriccion.proveedores.includes(prov)
  const prio = PRIORIDAD.map(L).filter((i) => i >= 0)
  const PR = (i: number) => prio.indexOf(i)
  const usaMito = op.donaMito && L('MAYORD') >= 0
  const principales = [op.donaIndo && 'DEPO', op.donaPolo && 'POLO52'].filter((x): x is string => !!x && L(x) >= 0)
  const princIdx = principales.map(L)
  const esDeposito = (i: number) => DEPOSITOS.includes(locales[i])

  // Trabajo sobre copias del stock actual (cur); orig = antes de apretar (no se dona lo recibido)
  const cur = new Map(filas.map((f) => [f, f.cur.slice()]))
  const orig = new Map(filas.map((f) => [f, f.cur.slice()]))
  // Stock que ya está movido en la grilla (para el mínimo por envío entre locales)
  const yaMovido = new Map<string, number>()
  for (const m of calcularMovimientos(todas, locales)) yaMovido.set(`${m.desde}|${m.hacia}`, (yaMovido.get(`${m.desde}|${m.hacia}`) ?? 0) + m.cantidad)

  const R: ResultadoSugerencia = {
    cambios: [], total: 0, repo: 0, indo: 0, polo: 0, locales: 0, extra: 0, huecos: 0, abre: 0, yaCubre: 0, descartadas: 0,
    sinCubrir: { restriccion: 0, sin_donante: 0 }, huecosPendientes: 0, huecosSinVentaPosibles: 0, tallesSinVenta: [], noRecibenHuecos: {},
    usaMito, principales, deMito,
  }

  // Dif. ideal sobre lo que se ve, aplicando los cambios ya hechos en esta sugerencia
  const difBase = resumen(visibles, locales).dif

  for (let pasada = 0; pasada < 6; pasada++) {
    const ini = new Map(filas.map((f) => [f, cur.get(f)!.slice()]))
    const disp = new Map(
      filas.map((f) => [f, cur.get(f)!.map((v, i) => (esDeposito(i) ? v : Math.min(v, orig.get(f)![i])))]),
    )
    const envios: Envio[] = []
    const DIF = difBase.slice()
    // los cambios ya aplicados en pasadas anteriores mueven la dif
    for (const f of filas) cur.get(f)!.forEach((v, i) => (DIF[i] += v - f.cur[i]))
    const ordRec = (a: number, b: number) => (op.segunIdeal ? DIF[a] - DIF[b] || PR(a) - PR(b) : PR(a) - PR(b))
    const enviar = (f: Fila, de: number, a: number, n: number, etapa: string) => {
      disp.get(f)![de] -= n
      envios.push({ f, de, a, n, etapa })
      if (op.segunIdeal) {
        DIF[a] += n
        DIF[de] -= n
      }
    }
    const kA = (i: number, f: Fila) => `${i}|${f.talle}`
    const asignado = new Set<string>()
    const R2 = { yaCubre: 0, restriccion: 0, sin_donante: 0, huecosPend: 0, sinVentaPos: 0, talles: [] as string[], noRec: {} as Record<string, string[]> }

    // pares local-talle con venta: lo que necesita = vendió − (stock + tránsito)
    const pares: { f: Fila; s: number; venta: number; falta: number }[] = []
    for (const f of filas) for (const s of prio) if (f.vend[s] > 0) {
      const tiene = (ini.get(f)![s] || 0) + (f.trans[s] || 0)
      const falta = Math.max(0, f.vend[s] - tiene)
      R2.yaCubre += f.vend[s] - falta
      pares.push({ f, s, venta: f.vend[s], falta })
    }
    // ETAPA 1 · Repo MITO (solo artículos de proveedores MITO)
    if (deMito && usaMito) {
      const m = L('MAYORD')
      for (const p of [...pares].sort((a, b) => ordenTalle(a.f.talle, b.f.talle) || ordRec(a.s, b.s) || b.venta - a.venta)) {
        const n = Math.min(p.falta, disp.get(p.f)![m])
        if (n <= 0) continue
        enviar(p.f, m, p.s, n, 'repo')
        p.falta -= n
        asignado.add(kA(p.s, p.f))
      }
    }
    // ETAPA 2 · Cascada — pase 0: Indo y Polo (todo su stock, sin topes)
    for (const d of princIdx) {
      for (const p of [...pares].sort((a, b) => ordRec(a.s, b.s) || ordenTalle(a.f.talle, b.f.talle))) {
        const n = Math.min(p.falta, disp.get(p.f)![d])
        if (n <= 0) continue
        enviar(p.f, d, p.s, n, locales[d] === 'DEPO' ? 'indo' : 'polo')
        p.falta -= n
        asignado.add(kA(p.s, p.f))
      }
    }
    // Donantes locales: se quedan con lo que vendieron (mínimo 1), dan hasta 2 por talle.
    // La Dif. ideal solo ordena (el que más le sobra primero); sin ideal, el que más stock tiene del artículo.
    const stockArt = (i: number) => todas.filter((f) => f.articulo === art).reduce((x, f) => x + (f.cur[i] || 0), 0)
    const donantes = prio.filter((i) => !CASC.no_donan.includes(locales[i]))
    const donado = new Map<string, number>()
    const yaManda = (d: number, r: number) => envios.some((e) => e.de === d && e.a === r)
    const donantesPara = (r: number) =>
      [...donantes].sort((a, b) => Number(yaManda(b, r)) - Number(yaManda(a, r)) || (op.segunIdeal ? DIF[b] - DIF[a] : stockArt(b) - stockArt(a)) || PR(a) - PR(b))
    const puedeDar = (f: Fila, d: number, queda: number) => disp.get(f)![d] - Math.max(queda, f.vend[d] || 0)
    const dar = (p: { f: Fila; s: number; falta: number }, queda: number) => {
      let falta = p.falta
      for (const d of donantesPara(p.s)) {
        if (d === p.s) continue
        const k = `${d}|${p.f.talle}`, ya = donado.get(k) ?? 0
        if (ya >= CASC.tope_sku) continue
        const n = Math.min(puedeDar(p.f, d, queda), falta, CASC.tope_sku - ya)
        if (n <= 0) continue
        enviar(p.f, d, p.s, n, 'locales')
        donado.set(k, ya + n)
        asignado.add(kA(p.s, p.f))
        falta -= n
        if (falta <= 0) break
      }
      return falta
    }
    // pase 1: la venta que faltó
    const motivo = new Map<(typeof pares)[number], 'restriccion' | 'sin_donante'>()
    for (const p of [...pares].sort((a, b) => (op.segunIdeal ? ordRec(a.s, b.s) : locales[a.s].localeCompare(locales[b.s])) || ordenTalle(a.f.talle, b.f.talle))) {
      if (p.falta <= 0) continue
      const m = CASC.restriccion.receptores.includes(locales[p.s]) && !deMito ? 'restriccion' : 'sin_donante'
      motivo.set(p, m)
      if (m === 'sin_donante') p.falta = dar(p, CASC.donante_queda)
    }
    // pase extra NVOCED: si no recibió nada, acepta donantes con 1
    for (const p of pares) {
      if (!CASC.pase_extra.includes(locales[p.s]) || p.falta <= 0 || motivo.get(p) !== 'sin_donante' || asignado.has(kA(p.s, p.f))) continue
      p.falta = dar(p, 0)
    }
    for (const p of pares) if (p.falta > 0 && motivo.has(p)) R2[motivo.get(p)!] += p.falta
    // huecos: talle (vendido, o cualquiera con el tilde) que el local no tiene ni en tránsito, con un talle de al lado
    const vecinos = (f: Fila) => {
      const k = filas.indexOf(f)
      return [filas[k - 1], filas[k + 1]].filter(Boolean) as Fila[]
    }
    const vendido = (f: Fila) => f.vend.some((x) => x > 0)
    const huecoPosible = (f: Fila, r: number) => !(ini.get(f)![r] > 0 || f.trans[r] > 0) && vecinos(f).some((v) => ini.get(v)![r] > 0)
    for (const f of filas) {
      if (!vendido(f) && !op.huecosSinVenta) {
        const n = prio.filter((r) => !CASC.huecos_no_reciben.includes(locales[r]) && huecoPosible(f, r)).length
        if (n) {
          R2.sinVentaPos += n
          R2.talles.push(f.talle)
        }
        continue
      }
      for (const r of [...prio].sort(ordRec)) {
        if (CASC.huecos_no_reciben.includes(locales[r])) {
          if (huecoPosible(f, r)) (R2.noRec[locales[r]] ??= []).push(f.talle)
          continue
        }
        if (asignado.has(kA(r, f)) || !huecoPosible(f, r)) continue
        if (CASC.restriccion.receptores.includes(locales[r]) && !deMito) continue
        R2.huecosPend++
        let dio = false
        const pd = princIdx.find((d) => disp.get(f)![d] >= 1)
        if (pd !== undefined) {
          enviar(f, pd, r, 1, 'hueco-principal')
          dio = true
        } else {
          for (const d of donantesPara(r)) {
            if (d === r) continue
            const k = `${d}|${f.talle}`, ya = donado.get(k) ?? 0
            if (ya >= CASC.tope_sku || puedeDar(f, d, CASC.donante_queda) < 1) continue
            enviar(f, d, r, 1, 'hueco')
            donado.set(k, ya + 1)
            dio = true
            break
          }
        }
        if (dio) asignado.add(kA(r, f))
      }
    }
    // opcional: abrir el color en locales que no lo tienen
    if (op.abrirColores) {
      const ventaArt = (i: number) => todas.filter((f) => f.articulo === art).reduce((x, f) => x + (f.vend[i] || 0), 0)
      for (const r of prio.filter((i) => !CASC.huecos_no_reciben.includes(locales[i])).sort((a, b) => (op.segunIdeal ? ordRec(a, b) : ventaArt(b) - ventaArt(a)))) {
        if (filas.some((f) => ini.get(f)![r] > 0 || f.trans[r] > 0 || envios.some((e) => e.f === f && e.a === r))) continue
        for (const f of filas) {
          const pd = princIdx.find((d) => disp.get(f)![d] >= 1)
          if (pd !== undefined) {
            enviar(f, pd, r, 1, 'abre-principal')
            continue
          }
          for (const d of donantesPara(r)) {
            if (d === r) continue
            const k = `${d}|${f.talle}`, ya = donado.get(k) ?? 0
            if (ya >= CASC.tope_sku || puedeDar(f, d, CASC.donante_queda) < 1) continue
            enviar(f, d, r, 1, 'abre')
            donado.set(k, ya + 1)
            break
          }
        }
      }
    }
    // mínimo por envío entre locales (los depósitos no cuentan), sumando lo que ya está movido
    const porPar = new Map<string, number>()
    for (const e of envios) if (!esDeposito(e.de)) porPar.set(`${e.de}|${e.a}`, (porPar.get(`${e.de}|${e.a}`) ?? 0) + e.n)
    const vale = (e: Envio) =>
      esDeposito(e.de) || (porPar.get(`${e.de}|${e.a}`) ?? 0) + (yaMovido.get(`${locales[e.de]}|${locales[e.a]}`) ?? 0) >= Math.max(1, op.minEnvio)
    const finales = envios.filter(vale)
    for (const e of finales) {
      const c = cur.get(e.f)!
      c[e.de] -= e.n
      c[e.a] += e.n
    }
    const tot = finales.reduce((x, e) => x + e.n, 0)
    const sumar = (pred: (e: Envio) => boolean) => finales.filter(pred).reduce((x, e) => x + e.n, 0)
    R.repo += sumar((e) => e.etapa === 'repo')
    R.indo += sumar((e) => e.etapa === 'indo')
    R.polo += sumar((e) => e.etapa === 'polo')
    R.locales += sumar((e) => e.etapa === 'locales')
    R.huecos += sumar((e) => e.etapa.startsWith('hueco'))
    R.abre += sumar((e) => e.etapa.startsWith('abre'))
    R.total += tot
    if (pasada === 0) R.yaCubre = R2.yaCubre
    // de la última pasada (estado final)
    R.descartadas = envios.filter((e) => !vale(e)).reduce((x, e) => x + e.n, 0)
    R.sinCubrir = { restriccion: R2.restriccion, sin_donante: R2.sin_donante }
    R.huecosPendientes = R2.huecosPend
    R.huecosSinVentaPosibles = R2.sinVentaPos
    R.tallesSinVenta = R2.talles
    R.noRecibenHuecos = R2.noRec
    if (!tot) break
  }

  for (const f of filas) cur.get(f)!.forEach((v, i) => {
    if (v !== f.cur[i]) R.cambios.push({ fila: f, i, antes: f.cur[i], despues: v })
  })
  return R
}

/* ----------------------------------- API ----------------------------------- */

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function token(): Promise<string> {
  if (!supabase) throw new Error('Supabase no está configurado.')
  const { data } = await supabase.auth.getSession()
  const t = data.session?.access_token
  if (!t) throw new Error('Sesión vencida: volvé a entrar.')
  return t
}

export async function cargarOpciones(): Promise<Opciones> {
  const res = await fetch('/api/sql/reparto', { headers: { Authorization: `Bearer ${await token()}` } })
  const b = (await res.json().catch(() => null)) as { opciones?: Opciones; error?: string } | null
  if (!res.ok || !b?.opciones) throw new Error(b?.error ?? `Error ${res.status} leyendo los filtros`)
  return b.opciones
}

export type RespuestaStock = DatosReparto | { estado: 'demasiados'; articulos: number; max: number; motivo?: 'peso'; bytes?: number }

type FilaCompacta = [string, string, string, number[], number[] | 0, string | 0, number[] | 0]
/** El Puente manda las filas compactas (formato 2, puente-sql/reparto.js): se vuelven a armar. */
function desarmarFilas(filas: unknown[], n: number): FilaPuente[] {
  const ceros = () => Array(n).fill(0)
  return filas.map((x) => {
    if (!Array.isArray(x)) return x as FilaPuente // formato viejo (objetos)
    const [a, c, t, s, v, tr, u] = x as FilaCompacta
    return {
      a, c, t, s,
      v: v || ceros(),
      tr: tr ? tr.split('').map(Number) : ceros(),
      u: u ? u.map((d) => (d < 0 ? null : d)) : Array(n).fill(null),
    }
  })
}

/** Pide stock y venta al Puente; mientras lee el DWH repregunta cada 4 s (tope 5 minutos). */
export async function cargarStock(
  filtros: Filtros,
  desde: string,
  hasta: string,
  alEsperar?: (segundos: number) => void,
  cancelado?: () => boolean,
): Promise<RespuestaStock> {
  const t = await token()
  const inicio = Date.now()
  while (Date.now() - inicio < 300_000) {
    const res = await fetch('/api/sql/reparto', {
      method: 'POST',
      headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ filtros, desde, hasta }),
    })
    const b = (await res.json().catch(() => null)) as (RespuestaStock & { estado?: string; error?: string }) | { estado: 'calculando'; error?: string } | null
    if (!res.ok || !b) throw new Error((b as { error?: string } | null)?.error ?? `Error ${res.status} leyendo stock y venta`)
    if (b.estado === 'listo') {
      const d = b as DatosReparto
      return { ...d, filas: desarmarFilas(d.filas as unknown[], d.locales.length) }
    }
    if (b.estado === 'demasiados') return b as RespuestaStock
    if (cancelado?.()) throw new Error('cancelado')
    alEsperar?.(Math.round((Date.now() - inicio) / 1000))
    await espera(4000)
  }
  throw new Error('El Puente SQL tardó más de 5 minutos en leer el DWH. Probá de nuevo o achicá el filtro.')
}

/* ------------------------- MITO -> pedidos de venta en Dragon ------------------------- */

/** Lo que sale de MITO (MAYORD) no va al lote: va a Dragon como pedido de venta por local. */
export const esDeMito = (m: Movimiento) => m.desde === 'MAYORD'

export interface MotivoDragon { cod: string; pedidos: number }
export interface LocalCargaDragon {
  cliente: string
  local: string
  renglones: number
  unidades: number
  lista: string
  numero: number | string | null
  estado: 'pendiente' | 'ya_estaba' | 'cargando' | 'cargado' | 'en_seco' | 'error'
  error: string | null
}
export interface CargaDragon { motivo: string; obs: string; en_curso: boolean; en_seco: boolean; locales: LocalCargaDragon[] }

async function postDragon<T>(cuerpo: Record<string, unknown>): Promise<T> {
  const res = await fetch('/api/sql/reparto', {
    method: 'POST',
    headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ dragon: true, ...cuerpo }),
  })
  const b = (await res.json().catch(() => null)) as (T & { error?: string }) | null
  if (!res.ok || !b) throw new Error(b?.error ?? `Error ${res.status} hablando con Dragon`)
  return b
}

export const motivosDragon = () => postDragon<{ motivos: MotivoDragon[] }>({ modo: 'motivos' }).then((r) => r.motivos)

/** Un pedido por local destino con lo que MITO le da. */
export function pedidosDeMito(movs: Movimiento[]) {
  const por = new Map<string, { art: string; color: string; talle: string; cantidad: number }[]>()
  for (const m of movs.filter(esDeMito)) {
    if (!por.has(m.hacia)) por.set(m.hacia, [])
    por.get(m.hacia)!.push({ art: m.articulo, color: m.color, talle: m.talle, cantidad: m.cantidad })
  }
  return [...por].map(([local, items]) => ({ local, items }))
}

export function cargaDragon(modo: 'revisar' | 'cargar', motivo: string, obs: string, movs: Movimiento[]) {
  return postDragon<{ carga: CargaDragon }>({ modo, motivo, obs, pedidos: pedidosDeMito(movs), confirmo: modo === 'cargar' ? obs : undefined }).then((r) => r.carga)
}
export const estadoCargaDragon = () => postDragon<{ carga: CargaDragon | null }>({ modo: 'estado' }).then((r) => r.carga)

/** «Cargar en Transferencias»: un lote más (origen = local que bajó, destino = el que subió). */
export async function cargarEnTransferencias(nombre: string, obs: string, movs: Movimiento[]) {
  if (!supabase) throw new Error('Supabase no está configurado.')
  const items = movs.map((m) => ({
    origen: m.desde, destino: m.hacia, articulo: m.articulo, descripcion: m.desc, material: m.material,
    color: m.color, talle: m.talle, cantidad: m.cantidad, tipo: 'VENTA',
  }))
  const { data, error } = await supabase.rpc('reparto_cargar_transferencias', { p_nombre: nombre, p_obs: obs, p_items: items })
  if (error) {
    if (/reparto_cargar_transferencias|function .* does not exist|PGRST202/i.test(error.message)) {
      throw new Error('Falta aplicar sql/reparto_transferencias.sql en el hub (se hace al subir).')
    }
    throw new Error(error.message)
  }
  return data as { id: string; repetido: boolean; renglones: number; unidades: number }
}

export interface RutaVehiculo { vehiculo: string; color: string; ultima_at: string | null; pendientes: { base_id: string; hora_limite: string | null }[] }

/** Locales que cada vehículo todavía tiene que pasar hoy (Tracking). [] si no hay datos. */
export async function cargarRutas(): Promise<RutaVehiculo[]> {
  if (!supabase) return []
  const { data, error } = await supabase.rpc('reparto_rutas_vehiculos', {})
  if (!error) return (data as RutaVehiculo[]) ?? []
  // Sin la RPC todavía (antes de subir): se arma con las tablas del Tracking, que el admin ya puede leer
  const hoy = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Cordoba' })
  const [veh, ctrl] = await Promise.all([
    supabase.from('tracking_vehiculos').select('id,nombre,color,activo').eq('activo', true),
    supabase.rpc('tracking_controles_dia', { p_fecha: hoy }),
  ])
  if (veh.error || ctrl.error) return []
  const controles = (ctrl.data ?? []) as { vehiculo_id: string; base_id: string; hora_limite: string | null; paso_at: string | null }[]
  const out: RutaVehiculo[] = []
  for (const v of (veh.data ?? []) as { id: string; nombre: string; color: string }[]) {
    const mios = controles.filter((c) => c.vehiculo_id === v.id)
    if (!mios.length) continue
    const u = await supabase.from('tracking_ubicaciones').select('at').eq('vehiculo_id', v.id).order('at', { ascending: false }).limit(1)
    out.push({
      vehiculo: v.nombre, color: v.color, ultima_at: (u.data?.[0] as { at?: string } | undefined)?.at ?? null,
      pendientes: mios.filter((c) => !c.paso_at).map((c) => ({ base_id: c.base_id, hora_limite: c.hora_limite?.slice(0, 5) ?? null })),
    })
  }
  return out.sort((a, b) => a.vehiculo.localeCompare(b.vehiculo))
}

/** Excel de remitos (opcional): una hoja por local origen, como el de la PWA vieja. */
export async function bajarExcelRemitos(movs: Movimiento[], locales: string[]) {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  const hoy = new Date().toLocaleDateString('es-AR')
  for (const origen of locales) {
    const mios = movs.filter((m) => m.desde === origen)
    if (!mios.length) continue
    const filas = new Map<string, { m: Movimiento; q: Record<string, number> }>()
    for (const m of mios) {
      const k = `${m.articulo}|${m.color}|${m.talle}`
      const x = filas.get(k) ?? { m, q: {} }
      x.q[m.hacia] = (x.q[m.hacia] ?? 0) + m.cantidad
      filas.set(k, x)
    }
    const aoa: (string | number)[][] = [['FECHA', hoy], ['Articulo', 'Descripcion', 'Color', 'Talle', ...locales]]
    for (const { m, q } of [...filas.values()].sort((a, b) => a.m.articulo.localeCompare(b.m.articulo) || a.m.color.localeCompare(b.m.color) || ordenTalle(a.m.talle, b.m.talle))) {
      aoa.push([m.articulo, m.desc, m.color, m.talle, ...locales.map((l) => q[l] ?? '')])
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), origen.slice(0, 31))
  }
  XLSX.writeFile(wb, `remitos_reparto_${new Date().toISOString().slice(0, 10)}.xlsx`)
}
