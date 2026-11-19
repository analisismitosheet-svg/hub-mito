import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, Boxes, CalendarRange, ChevronDown, DollarSign, Filter, X, Hourglass, Loader2, Package, Receipt, RefreshCw, ShoppingBag,
  type LucideIcon,
} from 'lucide-react'
import {
  Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import FotoArticulo from '@/components/FotoArticulo'
import { supabase } from '@/lib/supabase'
import { leerVista, leerVistaFiltrada, type FilaSql } from '@/lib/sqlApi'
import { VISTA_ARTICULOS } from '@/lib/articulosConsulta'
import { cargarMapaFranquicias, type BaseFranquicia } from '@/lib/franquicias'
import { cargarStockSku, claveSku, stockArticuloDe, stockSkuDe, type StockSku } from '@/lib/stockSku'
import { coloresUnicos } from '@/lib/coloresUnicos'

/* ------------------------------------------------------------------ */
/*  Mayorista → Franquicias → Venta/stock franquicias.                  */
/*  Dashboard de solo lectura por franquicia (base de Dragon):          */
/*   - venta: VISTAS_CONSOLIDADAS.dbo.venta_franquicias (facturas       */
/*     suman, notas de crédito restan; importe = MNTPTOT, con descuento)*/
/*   - stock del local: vw_STOCK_SUCURSALES_REAL por BD_ORIGEN =        */
/*     sucursal de la base (Sistemas → Franquicias)                     */
/*   - stock MITO: vw_STOCK_SKU_MITO                                    */
/* ------------------------------------------------------------------ */

const VISTA_VENTAS = 'DESKTOP-OA4GU6I:VISTAS_CONSOLIDADAS.dbo.venta_franquicias'
const VISTA_STOCK_SUC = 'DESKTOP-OA4GU6I:VISTAS_CONSOLIDADAS.dbo.vw_STOCK_SUCURSALES_REAL'
const VISTA_MATERIALES = 'DWH.dbo.vw_DIM_MATERIAL'

const txt = (v: unknown) => String(v ?? '').trim()
const num = (v: unknown) => Number(v) || 0
const isoLocal = (d: Date) => d.toLocaleDateString('sv-SE')
const sumarDias = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return isoLocal(d) }
const diasEntre = (a: string, b: string) => Math.round((new Date(`${b}T12:00:00`).getTime() - new Date(`${a}T12:00:00`).getTime()) / 86400000) + 1
const fmt = (n: number) => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(n)
const fmt1 = (n: number) => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(n)
const fmtPesos = (n: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)
const fmtPesosCorto = (n: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', notation: 'compact', maximumFractionDigits: 1 }).format(n)
const fmtDia = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
const TALLES = ['XXXS', 'XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', 'XXXL', '3XL', 'U']
const ordenTalle = (t: string) => { const i = TALLES.indexOf(t); return i >= 0 ? i : 100 + (Number(t.split('/')[0]) || 0) }
/** Precio mayorista (PRECIO de vw_ARTICULOS_MITO) por artículo|color y por artículo; se pide por artículo y queda en memoria. */
const preciosMay = new Map<string, number>()
const preciosPedidos = new Set<string>()
const precioNum = (v: unknown) => Number(v) || 0
async function traerPrecios(arts: string[]) {
  const cola = arts.filter((a) => a && !preciosPedidos.has(a))
  for (const a of cola) preciosPedidos.add(a)
  async function trabajador() {
    for (let a = cola.shift(); a; a = cola.shift()) {
      try {
        const filas = await leerVistaFiltrada(VISTA_ARTICULOS, { donde: ['ID_ARTICULO'], valor: a, coincide: 'igual' })
        let max = 0
        for (const r of filas) {
          const p = precioNum(r.PRECIO)
          if (p <= 0) continue
          const k = `${a}|${txt(r.COLOR_CODIGO).toUpperCase()}`
          preciosMay.set(k, Math.max(preciosMay.get(k) ?? 0, p))
          max = Math.max(max, p)
        }
        preciosMay.set(a, max)
      } catch {
        preciosPedidos.delete(a)
      }
    }
  }
  await Promise.all(Array.from({ length: 6 }, trabajador))
}
const nombreBase = (b: BaseFranquicia) => b.nombre || b.base.replace(/^DRAGONFISH_/, '')

/** Tooltip con los colores del tema (el de recharts viene blanco). */
const TOOLTIP = {
  contentStyle: { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, fontSize: 12, color: 'var(--ink)', boxShadow: '0 8px 24px rgba(0,0,0,0.45)' },
  labelStyle: { color: 'var(--sub)', fontSize: 11, marginBottom: 2 },
  itemStyle: { color: 'var(--ink)' },
  cursor: { fill: 'rgba(148,163,184,0.12)' },
}

interface Venta { base: string; dia: string; comp: string; esFactura: boolean; art: string; color: string; colorTxt: string; talle: string; cant: number; importe: number; txt: string }
interface InfoArt { descripcion: string; material: string; prov: string; grupo: string; genero: string; temporada: string }

/* Filtros (arriba, valen para Stock y Venta). Género = primera letra del grupo. */
type Dim = 'prov' | 'material' | 'grupo' | 'genero' | 'temporada' | 'color' | 'talle'
const DIMS: { id: Dim; label: string }[] = [
  { id: 'prov', label: 'Proveedor' },
  { id: 'material', label: 'Material' },
  { id: 'grupo', label: 'Grupo' },
  { id: 'genero', label: 'Género' },
  { id: 'temporada', label: 'Temporada' },
  { id: 'color', label: 'Color' },
  { id: 'talle', label: 'Talle' },
]
const PROVEEDORES: Record<string, string> = { MOCF: 'Captain Fin', MOZH: 'Zimith' }
const GENEROS: Record<string, string> = { H: 'Hombre', M: 'Mujer', U: 'Unisex', N: 'Niño/Niña', B: 'Bebé' }
const TEMPORADAS: Record<string, string> = { '0': 'Sin temporada', '1': 'Verano', '2': 'Continuo', '3': 'Invierno', '4': 'Atemporal' }
const SIN = '(sin dato)'
type Filtros = Record<Dim, Set<string>>
const filtrosVacios = (): Filtros => ({ prov: new Set(), material: new Set(), grupo: new Set(), genero: new Set(), temporada: new Set(), color: new Set(), talle: new Set() })

const PRESETS = [
  { id: '7', label: '7 días', dias: 7 },
  { id: '30', label: '30 días', dias: 30 },
  { id: '90', label: '90 días', dias: 90 },
  { id: 'mes', label: 'Este mes', dias: 0 },
] as const

/** Panel estilo tablero: por cada valor, stock (amarillo) y venta en unidades (verde). Clic = filtrar. */
function PanelDim({ titulo, filas, activos, onClick, cargando, ancho }: {
  titulo: string; filas: { valor: string; stock: number; venta: number }[]; activos: Set<string>; onClick: (v: string) => void; cargando: boolean; ancho: string
}) {
  const max = Math.max(1, ...filas.map((f) => Math.max(f.stock, f.venta)))
  return (
    <section className={`rounded-2xl border border-line bg-paper p-4 ${ancho}`}>
      <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-ink">{titulo}</h3>
      <p className="mb-2 flex items-center gap-3 text-[11px] text-sub">
        <span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full" style={{ background: '#eab308' }} />Stock</span>
        <span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full" style={{ background: '#22c55e' }} />Venta (u.)</span>
      </p>
      {cargando && !filas.length ? (
        <p className="flex items-center gap-2 py-8 text-xs text-sub"><Loader2 size={13} className="animate-spin" aria-hidden /> Cargando…</p>
      ) : (
        <div className="max-h-[230px] space-y-1.5 overflow-y-auto pr-1">
          {filas.length === 0 && <p className="py-6 text-center text-xs text-sub">Sin datos.</p>}
          {filas.map((f) => {
            const on = activos.has(f.valor)
            const apagado = activos.size > 0 && !on
            return (
              <button key={f.valor} type="button" onClick={() => onClick(f.valor)} title={`${f.valor}: stock ${fmt(f.stock)} · venta ${fmt(f.venta)} u.`}
                className={`grid w-full grid-cols-[96px_1fr] items-center gap-2 rounded-lg px-1.5 py-1 text-left transition hover:bg-white/5 ${on ? 'bg-sky-500/10 ring-1 ring-sky-500/40' : ''} ${apagado ? 'opacity-40' : ''}`}>
                <span className="truncate text-[11px] font-semibold text-ink">{f.valor}</span>
                <span className="flex flex-col gap-0.5">
                  <span className="flex items-center gap-1.5"><span className="h-2.5 rounded-sm" style={{ width: `${(f.stock / max) * 85}%`, minWidth: f.stock ? 2 : 0, background: '#eab308' }} /><span className="text-[10px] tabular-nums text-sub">{fmt(f.stock)}</span></span>
                  <span className="flex items-center gap-1.5"><span className="h-2.5 rounded-sm" style={{ width: `${(Math.max(0, f.venta) / max) * 85}%`, minWidth: f.venta > 0 ? 2 : 0, background: '#22c55e' }} /><span className="text-[10px] tabular-nums text-sub">{fmt(f.venta)}</span></span>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}

export default function FranquiciasVentaStock() {
  const hoy = isoLocal(new Date())
  const [bases, setBases] = useState<BaseFranquicia[]>([])
  const [baseSel, setBaseSel] = useState('') // '' = todas
  const [desde, setDesde] = useState(() => sumarDias(hoy, -29))
  const [hasta, setHasta] = useState(hoy)

  const [ventas, setVentas] = useState<Venta[]>([])
  const [stockSuc, setStockSuc] = useState<Map<string, Map<string, number>>>(new Map())
  const [stockMito, setStockMito] = useState<StockSku | null>(null)
  const [info, setInfo] = useState<Map<string, InfoArt>>(new Map())
  const [cargando, setCargando] = useState(true)
  const [cargandoInfo, setCargandoInfo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recarga, setRecarga] = useState(0)
  const [pestana, setPestana] = useState<'stock' | 'venta'>('stock')
  const [busca, setBusca] = useState('')
  /** filtro por código de artículo (vale para Stock y Venta); varios separados por espacio o coma */
  const [codigo, setCodigo] = useState('')
  /** color elegido en «Artículos más vendidos» ('' = todos) */
  const [colorTop, setColorTop] = useState('')
  const [vistaStock, setVistaStock] = useState<'con' | 'agotados' | 'todo'>('con')
  const [ordenStock, setOrdenStock] = useState<'stock' | 'vendido'>('stock')
  const [filtros, setFiltros] = useState<Filtros>(filtrosVacios)
  const [abierto, setAbierto] = useState<Dim | null>(null)

  // Venta, stock de los locales, stock MITO y franquicias configuradas
  useEffect(() => {
    let vivo = true
    setCargando(true)
    setError(null)
    ;(async () => {
      try {
        const [mapa, filasV, filasS, sm] = await Promise.all([
          cargarMapaFranquicias(),
          leerVista(VISTA_VENTAS),
          leerVista(VISTA_STOCK_SUC),
          cargarStockSku({ refrescar: recarga > 0 }).catch(() => null),
        ])
        if (!vivo) return
        const activas = mapa.bases.filter((b) => b.activa && b.sucursal)
        const sucursales = new Set(activas.map((b) => txt(b.sucursal).toUpperCase()))

        const vs: Venta[] = []
        for (const f of filasV) {
          const tipo = txt(f.DESCFW).toUpperCase()
          const signo = /^(TICKET)?NOTADECREDITO/.test(tipo) ? -1 : /^(TICKET)?FACTURA/.test(tipo) ? 1 : 0
          if (!signo) continue
          vs.push({
            base: txt(f.BASE_DATOS).toUpperCase(),
            dia: txt(f.FFCH).slice(0, 10),
            comp: txt(f.CODIGO),
            esFactura: signo === 1,
            art: txt(f.FART).toUpperCase(),
            color: txt(f.CCOLOR).toUpperCase(),
            colorTxt: txt(f.FCOLTXT).toUpperCase(),
            talle: txt(f.TALLE).toUpperCase(),
            cant: signo * num(f.FCANT),
            importe: signo * num(f.MNTPTOT),
            txt: txt(f.FTXT),
          })
        }

        // Stock solo de las sucursales de franquicias: sucursal -> SKU -> unidades
        const sc = new Map<string, Map<string, number>>()
        for (const f of filasS) {
          const suc = txt(f.BD_ORIGEN).toUpperCase()
          if (!sucursales.has(suc)) continue
          let m = sc.get(suc)
          if (!m) { m = new Map(); sc.set(suc, m) }
          const k = claveSku(f.ARTICULO, f.COLOR, f.TALLE)
          m.set(k, (m.get(k) ?? 0) + num(f.CANTIDAD_REAL))
        }

        setBases(activas)
        setVentas(vs)
        setStockSuc(sc)
        setStockMito(sm)
      } catch (e) {
        if (vivo) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (vivo) setCargando(false)
      }
    })()
    return () => { vivo = false }
  }, [recarga])

  // Descripción y material de todo lo vendido y lo que hay en los locales
  useEffect(() => {
    if (cargando || !supabase) return
    const arts = new Set(ventas.map((v) => v.art))
    for (const m of stockSuc.values()) for (const k of m.keys()) arts.add(k.split('|')[0])
    const faltan = [...arts].filter((a) => a && !info.has(a))
    if (!faltan.length) return
    let vivo = true
    setCargandoInfo(true)
    ;(async () => {
      const filasM = await leerVista(VISTA_MATERIALES).catch(() => [] as FilaSql[])
      const nombresMat = new Map(filasM.map((m) => [txt(m.ID_MATERIAL).toUpperCase(), txt(m.MATERIAL)]))
      const nuevo = new Map(info)
      const lotes: string[][] = []
      for (let i = 0; i < faltan.length; i += 300) lotes.push(faltan.slice(i, i + 300))
      await Promise.all(lotes.map(async (lote) => {
        const { data } = await supabase!.from('articulos').select('id_art,descripcion,id_material,id_prov,id_grupo,id_temporada').in('id_art', lote)
        for (const a of (data as { id_art: string; descripcion: string | null; id_material: string | null; id_prov: string | null; id_grupo: string | null; id_temporada: string | null }[] | null) ?? []) {
          const cod = txt(a.id_material).toUpperCase()
          const prov = txt(a.id_prov).toUpperCase()
          const grupo = txt(a.id_grupo).toUpperCase()
          const tem = txt(a.id_temporada)
          nuevo.set(txt(a.id_art).toUpperCase(), {
            descripcion: txt(a.descripcion),
            material: nombresMat.get(cod) || cod || SIN,
            prov: PROVEEDORES[prov] || prov || SIN,
            grupo: grupo || SIN,
            genero: GENEROS[grupo.charAt(0)] || (grupo ? `Otro (${grupo.charAt(0)})` : SIN),
            temporada: TEMPORADAS[tem] || tem || SIN,
          })
        }
      }))
      for (const a of faltan) if (!nuevo.has(a)) nuevo.set(a, { descripcion: '', material: SIN, prov: SIN, grupo: SIN, genero: SIN, temporada: SIN })
      if (!vivo) return
      setInfo(nuevo)
      setCargandoInfo(false)
    })()
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cargando, ventas, stockSuc])

  // Nombre de cada color (código -> texto de la venta)
  const nombresColor = useMemo(() => {
    const m = new Map<string, string>()
    for (const v of ventas) if (v.colorTxt && !m.has(v.color)) m.set(v.color, v.colorTxt)
    return m
  }, [ventas])
  const valorDe = useCallback((dim: Dim, art: string, color: string, talle: string): string => {
    if (dim === 'color') return color ? `${color}${nombresColor.get(color) ? ` · ${nombresColor.get(color)}` : ''}` : SIN
    if (dim === 'talle') return talle || SIN
    return info.get(art)?.[dim] || SIN
  }, [info, nombresColor])
  const codigos = useMemo(() => codigo.toUpperCase().split(/[\s,;]+/).filter(Boolean), [codigo])
  const hayFiltros = codigos.length > 0 || DIMS.some((x) => filtros[x.id].size > 0)
  const okSku = useCallback((art: string, color: string, talle: string) =>
    (codigos.length === 0 || codigos.some((c) => art.includes(c))) &&
    DIMS.every((x) => !filtros[x.id].size || filtros[x.id].has(valorDe(x.id, art, color, talle))), [filtros, valorDe, codigos])
  function alternarFiltro(dim: Dim, valor: string) {
    setFiltros((f) => { const n = { ...f, [dim]: new Set(f[dim]) }; if (n[dim].has(valor)) n[dim].delete(valor); else n[dim].add(valor); return n })
  }

  // Venta y stock ya filtrados: todo lo de abajo (las dos pestañas) usa estos
  const ventasF = useMemo(() => (hayFiltros ? ventas.filter((v) => okSku(v.art, v.color, v.talle)) : ventas), [ventas, hayFiltros, okSku])
  const stockSucF = useMemo(() => {
    if (!hayFiltros) return stockSuc
    const r = new Map<string, Map<string, number>>()
    for (const [suc, m] of stockSuc) {
      const n = new Map<string, number>()
      for (const [k, q] of m) { const [a, c, t] = k.split('|'); if (okSku(a, c, t)) n.set(k, q) }
      r.set(suc, n)
    }
    return r
  }, [stockSuc, hayFiltros, okSku])

  const opciones = useMemo(() => {
    const r = {} as Record<Dim, string[]>
    for (const { id } of DIMS) {
      const set = new Set<string>()
      for (const v of ventas) set.add(valorDe(id, v.art, v.color, v.talle))
      for (const m of stockSuc.values()) for (const [k, q] of m) if (q > 0) { const [a, c, t] = k.split('|'); set.add(valorDe(id, a, c, t)) }
      r[id] = [...set].sort((a, b) => (id === 'talle' ? ordenTalle(a) - ordenTalle(b) : 0) || a.localeCompare(b))
    }
    return r
  }, [ventas, stockSuc, valorDe])

  const elegidas = useMemo(() => (baseSel ? bases.filter((b) => b.base.toUpperCase() === baseSel) : bases), [bases, baseSel])
  const basesSet = useMemo(() => new Set(elegidas.map((b) => b.base.toUpperCase())), [elegidas])

  function aplicarPreset(p: (typeof PRESETS)[number]) {
    if (p.id === 'mes') { setDesde(`${hoy.slice(0, 8)}01`); setHasta(hoy); return }
    setDesde(sumarDias(hoy, -(p.dias - 1)))
    setHasta(hoy)
  }
  const presetActivo = PRESETS.find((p) => (p.id === 'mes' ? desde === `${hoy.slice(0, 8)}01` : desde === sumarDias(hoy, -(p.dias - 1))) && hasta === hoy)?.id

  const d = useMemo(() => {
    const largo = diasEntre(desde, hasta)
    const antDesde = sumarDias(desde, -largo)
    const antHasta = sumarDias(desde, -1)
    const enBase = ventasF.filter((v) => basesSet.has(v.base))
    const actual = enBase.filter((v) => v.dia >= desde && v.dia <= hasta)
    const anterior = enBase.filter((v) => v.dia >= antDesde && v.dia <= antHasta)

    const resumen = (vs: Venta[]) => {
      const comps = new Set(vs.filter((v) => v.esFactura).map((v) => v.comp))
      const importe = vs.reduce((s, v) => s + v.importe, 0)
      const unidades = vs.reduce((s, v) => s + v.cant, 0)
      return { importe, unidades, tickets: comps.size, ticketProm: comps.size ? importe / comps.size : 0, upt: comps.size ? unidades / comps.size : 0 }
    }
    const r = resumen(actual)
    const ra = resumen(anterior)

    // Stock de los locales elegidos (sumado por SKU)
    const stockLocal = new Map<string, number>()
    for (const b of elegidas) {
      for (const [k, q] of stockSucF.get(txt(b.sucursal).toUpperCase()) ?? []) stockLocal.set(k, (stockLocal.get(k) ?? 0) + q)
    }
    const stockArt = new Map<string, number>()
    let stockTotal = 0
    for (const [k, q] of stockLocal) {
      if (q <= 0) continue
      stockTotal += q
      const a = k.split('|')[0]
      stockArt.set(a, (stockArt.get(a) ?? 0) + q)
    }
    const ventaDiaria = r.unidades / largo
    const cobertura = ventaDiaria > 0 ? stockTotal / ventaDiaria : null

    // Serie por día
    const porDia = new Map<string, { importe: number; unidades: number }>()
    for (let i = 0; i < largo; i++) porDia.set(sumarDias(desde, i), { importe: 0, unidades: 0 })
    for (const v of actual) { const x = porDia.get(v.dia); if (x) { x.importe += v.importe; x.unidades += v.cant } }
    const serie = [...porDia].map(([dia, x]) => ({ dia: fmtDia(dia), ...x }))

    // Por franquicia
    const porBase = bases.map((b) => {
      const vs = actual.filter((v) => v.base === b.base.toUpperCase())
      const rr = resumen(vs)
      let st = 0
      for (const q of (stockSucF.get(txt(b.sucursal).toUpperCase()) ?? new Map()).values()) if (q > 0) st += q
      const vd = rr.unidades / largo
      return { base: b.base, nombre: nombreBase(b), sucursal: txt(b.sucursal), ...rr, stock: st, cobertura: vd > 0 ? st / vd : null }
    }).sort((a, b) => b.importe - a.importe)

    // Por artículo
    const porArt = new Map<string, { art: string; txt: string; unidades: number; importe: number }>()
    for (const v of actual) {
      let x = porArt.get(v.art)
      if (!x) { x = { art: v.art, txt: v.txt, unidades: 0, importe: 0 }; porArt.set(v.art, x) }
      x.unidades += v.cant
      x.importe += v.importe
    }
    const topArts = [...porArt.values()].filter((x) => x.unidades > 0).sort((a, b) => b.importe - a.importe).map((x) => {
      const st = stockArt.get(x.art) ?? 0
      const vd = x.unidades / largo
      return { ...x, stock: st, cobertura: vd > 0 ? st / vd : null, stockMito: stockArticuloDe(stockMito, x.art) ?? 0 }
    })

    // Por material
    const porMat = new Map<string, { material: string; importe: number; unidades: number }>()
    for (const v of actual) {
      const m = info.get(v.art)?.material || 'Sin material'
      let x = porMat.get(m)
      if (!x) { x = { material: m, importe: 0, unidades: 0 }; porMat.set(m, x) }
      x.importe += v.importe
      x.unidades += v.cant
    }
    const materiales = [...porMat.values()].filter((x) => x.importe > 0).sort((a, b) => b.importe - a.importe).slice(0, 10)

    // Quiebres: SKU vendidos en el rango sin stock en el local
    const vendSku = new Map<string, { art: string; color: string; talle: string; txt: string; vendido: number }>()
    for (const v of actual) {
      const k = claveSku(v.art, v.color, v.talle)
      let x = vendSku.get(k)
      if (!x) { x = { art: v.art, color: v.color, talle: v.talle, txt: v.txt, vendido: 0 }; vendSku.set(k, x) }
      x.vendido += v.cant
    }
    const quiebres = [...vendSku].filter(([k, x]) => x.vendido > 0 && (stockLocal.get(k) ?? 0) <= 0)
      .map(([, x]) => ({ ...x, mito: stockSkuDe(stockMito, x.art, x.color, x.talle) ?? 0 }))
      .sort((a, b) => (b.mito > 0 ? 1 : 0) - (a.mito > 0 ? 1 : 0) || b.vendido - a.vendido)

    // Sin rotación: artículos con stock en el local y sin venta en el rango
    const vendidos = new Set([...porArt.values()].filter((x) => x.unidades > 0).map((x) => x.art))
    const quietos = [...stockArt].filter(([a]) => !vendidos.has(a)).map(([art, stock]) => ({ art, stock })).sort((a, b) => b.stock - a.stock)
    const unidadesQuietas = quietos.reduce((s, x) => s + x.stock, 0)

    // Stock y venta (unidades) por cada filtro, para los paneles estilo tablero
    const porDim = {} as Record<Dim, { valor: string; stock: number; venta: number }[]>
    for (const { id } of DIMS) {
      const m = new Map<string, { valor: string; stock: number; venta: number }>()
      const de = (v: string) => { let x = m.get(v); if (!x) { x = { valor: v, stock: 0, venta: 0 }; m.set(v, x) } return x }
      for (const [k, q] of stockLocal) { if (q <= 0) continue; const [a, c, t] = k.split('|'); de(valorDe(id, a, c, t)).stock += q }
      for (const v of actual) de(valorDe(id, v.art, v.color, v.talle)).venta += v.cant
      const l = [...m.values()].filter((x) => x.stock > 0 || x.venta > 0)
      porDim[id] = id === 'talle'
        ? l.sort((a, b) => ordenTalle(a.valor) - ordenTalle(b.valor) || a.valor.localeCompare(b.valor))
        : l.sort((a, b) => b.stock + b.venta - (a.stock + a.venta))
    }

    return { largo, antDesde, antHasta, r, ra, stockTotal, cobertura, serie, porBase, topArts, materiales, quiebres, quietos, unidadesQuietas, porDim, actual, stockLocal }
  }, [ventasF, stockSucF, stockMito, info, elegidas, bases, basesSet, desde, hasta, valorDe])

  // Artículos más vendidos por SKU (artículo + color). El selector de color deja solo ese color.
  // Sin filtros muestra los 15 primeros; con algún filtro (material, grupo, color…) muestra todos.
  const coloresTop = useMemo(() => {
    const m = new Map<string, number>()
    for (const v of d.actual) m.set(v.color, (m.get(v.color) ?? 0) + v.cant)
    for (const [k, q] of d.stockLocal) if (q > 0) { const c = k.split('|')[1]; m.set(c, (m.get(c) ?? 0) + q) }
    return [...m].filter(([, u]) => u > 0).map(([c]) => c).sort((a, b) => a.localeCompare(b))
  }, [d.actual, d.stockLocal])
  useEffect(() => { if (colorTop && !coloresTop.includes(colorTop)) setColorTop('') }, [coloresTop, colorTop])
  const todosTop = hayFiltros || colorTop !== ''
  const topArts = useMemo(() => {
    const porSku = new Map<string, { key: string; art: string; color: string; txt: string; unidades: number; importe: number }>()
    for (const v of d.actual) {
      if (colorTop && v.color !== colorTop) continue
      const key = `${v.art}|${v.color}`
      let x = porSku.get(key)
      if (!x) { x = { key, art: v.art, color: v.color, txt: v.txt, unidades: 0, importe: 0 }; porSku.set(key, x) }
      x.unidades += v.cant
      x.importe += v.importe
    }
    // Con filtro se suman también los que hay en el local aunque no se hayan vendido en el rango
    const stockLoc = new Map<string, number>()
    for (const [k, q] of d.stockLocal) {
      if (q <= 0) continue
      const [a, c] = k.split('|')
      if (colorTop && c !== colorTop) continue
      const key = `${a}|${c}`
      if (!porSku.has(key)) {
        if (!todosTop) continue
        porSku.set(key, { key, art: a, color: c, txt: '', unidades: 0, importe: 0 })
      }
      stockLoc.set(key, (stockLoc.get(key) ?? 0) + q)
    }
    // Stock MITO por artículo + color: la lib indexa UNICO también con talle vacío, no se cuenta dos veces
    const mito = new Map<string, number>()
    if (stockMito) {
      for (const [k, q] of stockMito.porSku) {
        const [a, c, t] = k.split('|')
        const key = `${a}|${c}`
        if (!porSku.has(key)) continue
        if (t === '' && stockMito.porSku.has(`${a}|${c}|UNICO`)) continue
        mito.set(key, (mito.get(key) ?? 0) + q)
      }
    }
    const lista = [...porSku.values()].filter((x) => x.unidades > 0 || (todosTop && (stockLoc.get(x.key) ?? 0) > 0))
      .sort((a, b) => b.importe - a.importe || (stockLoc.get(b.key) ?? 0) - (stockLoc.get(a.key) ?? 0) || a.key.localeCompare(b.key)).map((x) => {
      const st = stockLoc.get(x.key) ?? 0
      const vd = x.unidades / d.largo
      return { ...x, stock: st, cobertura: vd > 0 ? st / vd : null, stockMito: mito.get(x.key) ?? 0 }
    })
    return todosTop ? lista : lista.slice(0, 15)
  }, [d, colorTop, todosTop, stockMito])

  // Stock del local por artículo, con el detalle color/talle y lo vendido en el rango
  const stock = useMemo(() => {
    const porArt = new Map<string, { art: string; total: number; vendido: number; skus: Map<string, { color: string; talle: string; q: number; vendido: number }> }>()
    const fila = (art: string) => {
      let x = porArt.get(art)
      if (!x) { x = { art, total: 0, vendido: 0, skus: new Map() }; porArt.set(art, x) }
      return x
    }
    const sku = (x: ReturnType<typeof fila>, color: string, talle: string) => {
      const k = `${color}|${talle}`
      let s = x.skus.get(k)
      if (!s) { s = { color, talle, q: 0, vendido: 0 }; x.skus.set(k, s) }
      return s
    }
    for (const b of elegidas) {
      for (const [k, q] of stockSucF.get(txt(b.sucursal).toUpperCase()) ?? []) {
        if (q === 0) continue
        const [art, color, talle] = k.split('|')
        const x = fila(art)
        sku(x, color, talle).q += q
        if (q > 0) x.total += q
      }
    }
    for (const v of ventasF) {
      if (!basesSet.has(v.base) || v.dia < desde || v.dia > hasta) continue
      const x = fila(v.art)
      x.vendido += v.cant
      sku(x, v.color, v.talle).vendido += v.cant
    }
    return [...porArt.values()].filter((x) => x.total > 0 || x.vendido > 0).map((x) => {
      const skus = [...x.skus.values()].filter((s) => s.q !== 0 || s.vendido > 0)
      const porColor = new Map<string, typeof skus>()
      for (const s of skus) porColor.set(s.color, [...(porColor.get(s.color) ?? []), s])
      return {
        art: x.art, total: x.total, vendido: x.vendido,
        agotados: skus.filter((s) => s.q <= 0 && s.vendido > 0).length,
        colores: [...porColor].sort(([a], [b]) => a.localeCompare(b)).map(([color, ss]) => ({ color, talles: ss.sort((a, b) => ordenTalle(a.talle) - ordenTalle(b.talle) || a.talle.localeCompare(b.talle)) })),
        mito: stockArticuloDe(stockMito, x.art) ?? 0,
      }
    })
  }, [elegidas, stockSucF, ventasF, basesSet, desde, hasta, stockMito])

  const stockFiltrado = useMemo(() => {
    const q = busca.trim().toUpperCase()
    let l = stock
    if (q) l = l.filter((x) => x.art.includes(q) || (info.get(x.art)?.descripcion ?? '').toUpperCase().includes(q))
    if (vistaStock === 'con') l = l.filter((x) => x.total > 0)
    if (vistaStock === 'agotados') l = l.filter((x) => x.agotados > 0)
    return [...l].sort((a, b) => (ordenStock === 'vendido' ? b.vendido - a.vendido : 0) || b.total - a.total || a.art.localeCompare(b.art))
  }, [stock, busca, vistaStock, ordenStock, info])

  // Precio mayorista de lo que está a la vista (más vendidos + primeras 200 filas de stock)
  const [, setVerPrecios] = useState(0)
  const [cargandoPrecios, setCargandoPrecios] = useState(false)
  const artsVisibles = useMemo(() => [...new Set([...topArts.map((a) => a.art), ...stockFiltrado.slice(0, 200).map((x) => x.art)])].sort().join(','), [topArts, stockFiltrado])
  useEffect(() => {
    const faltan = artsVisibles.split(',').filter((a) => a && !preciosPedidos.has(a))
    if (!faltan.length) return
    let activo = true
    setCargandoPrecios(true)
    void traerPrecios(faltan).finally(() => { if (activo) { setCargandoPrecios(false); setVerPrecios((n) => n + 1) } })
    return () => { activo = false }
  }, [artsVisibles])
  const precioMay = (art: string, color?: string) => {
    const p = (color !== undefined ? preciosMay.get(`${art}|${color}`) : undefined) ?? preciosMay.get(art)
    return p ? fmtPesos(p) : preciosMay.has(art) ? '—' : cargandoPrecios ? '…' : '—'
  }

  /** Stock MITO de un SKU. El local escribe 'U' donde MITO dice 'UNICO' (o talle vacío). */
  const mitoSku = (art: string, color: string, talle: string) => {
    const v = stockSkuDe(stockMito, art, color, talle)
    if (v || !['U', 'UNICO', ''].includes(talle.toUpperCase())) return v ?? 0
    return stockSkuDe(stockMito, art, color, 'UNICO') || stockSkuDe(stockMito, art, color, '') || 0
  }

  const colores = useMemo(() => coloresUnicos(['#0ea5e9', '#22c55e', '#a855f7', '#eab308', '#14b8a6', '#ec4899']), [])
  const kpis: { label: string; valor: string; actual: number; anterior: number | null; Icon: LucideIcon; ayuda: string }[] = [
    { label: 'Venta neta', valor: fmtPesosCorto(d.r.importe), actual: d.r.importe, anterior: d.ra.importe, Icon: DollarSign, ayuda: fmtPesos(d.r.importe) },
    { label: 'Unidades', valor: fmt(d.r.unidades), actual: d.r.unidades, anterior: d.ra.unidades, Icon: ShoppingBag, ayuda: 'Facturas menos notas de crédito' },
    { label: 'Tickets', valor: fmt(d.r.tickets), actual: d.r.tickets, anterior: d.ra.tickets, Icon: Receipt, ayuda: 'Comprobantes de venta' },
    { label: 'Ticket promedio', valor: fmtPesosCorto(d.r.ticketProm), actual: d.r.ticketProm, anterior: d.ra.ticketProm, Icon: CalendarRange, ayuda: `${fmt1(d.r.upt)} unidades por ticket` },
    { label: 'Stock en locales', valor: fmt(d.stockTotal), actual: d.stockTotal, anterior: null, Icon: Boxes, ayuda: 'Unidades hoy' },
    { label: 'Cobertura', valor: d.cobertura == null ? '—' : `${fmt(d.cobertura)} días`, actual: 0, anterior: null, Icon: Hourglass, ayuda: 'Stock ÷ venta diaria del rango' },
  ]

  const card = 'rounded-2xl border border-line bg-paper p-4'
  const th = 'whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-sub'
  const chip = (activo: boolean) => `rounded-full border px-3 py-1 text-xs font-semibold transition ${activo ? 'border-sky-500/50 bg-sky-500/15 text-sky-400' : 'border-line bg-surface text-sub hover:text-ink'}`
  const coberturaCls = (c: number | null) => (c == null ? 'text-sub' : c < 15 ? 'text-red-400' : c < 45 ? 'text-amber-400' : c > 120 ? 'text-violet-400' : 'text-emerald-400')

  return (
    <Layout>
      <div className="px-3 pb-10 pt-3 md:px-4 md:pt-4">
        {/* Encabezado */}
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2">
            <BackButton />
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-sky-400">Mayorista · Franquicias</p>
              <h1 className="font-display text-xl font-semibold text-ink md:text-2xl">Venta/stock franquicias</h1>
              <p className="mt-1 max-w-2xl text-sm text-sub">Cuánto vende cada franquicia, qué tiene en el local, qué se quedó sin stock y lo que no rota.</p>
            </div>
          </div>
          <button type="button" onClick={() => setRecarga((n) => n + 1)} disabled={cargando} className="inline-flex items-center gap-1.5 rounded-full border border-line2 bg-surface px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface2 disabled:opacity-50">
            <RefreshCw size={13} className={cargando ? 'animate-spin' : ''} aria-hidden /> Actualizar
          </button>
        </div>

        {/* Pestañas */}
        <div role="tablist" aria-label="Vista" className="mb-3 inline-flex rounded-2xl border border-line bg-paper p-1">
          {([['stock', 'Stock', Boxes], ['venta', 'Venta', DollarSign]] as const).map(([id, label, Icon]) => (
            <button key={id} type="button" role="tab" aria-selected={pestana === id} onClick={() => setPestana(id)}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition ${pestana === id ? 'bg-surface2 text-ink ring-1 ring-sky-500/40' : 'text-sub hover:text-ink'}`}>
              <Icon size={15} aria-hidden /> {label}
            </button>
          ))}
        </div>

        {/* Filtros */}
        <div className={`${card} mb-4 flex flex-wrap items-center gap-3`}>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs text-sub">Franquicia</span>
            <button type="button" onClick={() => setBaseSel('')} className={chip(baseSel === '')}>Todas</button>
            {bases.map((b) => (
              <button key={b.base} type="button" onClick={() => setBaseSel(b.base.toUpperCase())} className={chip(baseSel === b.base.toUpperCase())}>{nombreBase(b)}</button>
            ))}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {PRESETS.map((p) => (
              <button key={p.id} type="button" onClick={() => aplicarPreset(p)} className={chip(presetActivo === p.id)}>{p.label}</button>
            ))}
            <input type="date" aria-label="Desde" value={desde} max={hasta} onChange={(e) => e.target.value && setDesde(e.target.value)} className="rounded-full border border-line2 bg-surface px-2 py-1 text-xs text-ink" />
            <span className="text-xs text-sub">al</span>
            <input type="date" aria-label="Hasta" value={hasta} min={desde} onChange={(e) => e.target.value && setHasta(e.target.value)} className="rounded-full border border-line2 bg-surface px-2 py-1 text-xs text-ink" />
          </div>

          {/* Filtros por atributo: valen para Stock y Venta */}
          <div className="flex w-full flex-wrap items-center gap-1.5 border-t border-line pt-3">
            <span className="mr-1 inline-flex items-center gap-1 text-xs text-sub"><Filter size={13} aria-hidden /> Filtros</span>
            <span className="relative">
              <input type="search" value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Código de artículo" aria-label="Filtrar por código de artículo"
                title="Uno o varios códigos (separados por espacio o coma). Vale para Stock y Venta."
                className={`w-44 rounded-full border px-3 py-1 text-xs text-ink outline-none placeholder:text-sub ${codigos.length ? 'border-sky-500/60 bg-sky-500/10' : 'border-line2 bg-surface'}`} />
            </span>
            {DIMS.map(({ id, label }) => (
              <div key={id} className="relative">
                <button type="button" onClick={() => setAbierto(abierto === id ? null : id)} aria-expanded={abierto === id}
                  className={`inline-flex items-center gap-1 ${chip(filtros[id].size > 0)}`}>
                  {label}{filtros[id].size > 0 && <span className="rounded-full bg-sky-500/25 px-1.5 text-[10px]">{filtros[id].size}</span>}
                  <ChevronDown size={12} aria-hidden />
                </button>
                {abierto === id && (
                  <>
                    <button type="button" aria-label="Cerrar" className="fixed inset-0 z-30 cursor-default" onClick={() => setAbierto(null)} />
                    <div className="absolute left-0 z-40 mt-1 w-60 rounded-xl border border-line2 bg-surface p-2 shadow-xl">
                      <div className="mb-1 flex items-center justify-between px-1">
                        <span className="text-[11px] font-semibold uppercase text-sub">{label}</span>
                        {filtros[id].size > 0 && <button type="button" onClick={() => setFiltros((f) => ({ ...f, [id]: new Set() }))} className="text-[11px] font-semibold text-sky-400">Limpiar</button>}
                      </div>
                      <div className="max-h-64 overflow-y-auto">
                        {opciones[id].length === 0 && <p className="px-2 py-3 text-xs text-sub">{cargandoInfo ? 'Cargando…' : 'Sin valores'}</p>}
                        {opciones[id].map((v) => (
                          <label key={v} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-xs text-ink hover:bg-white/5">
                            <input type="checkbox" checked={filtros[id].has(v)} onChange={() => alternarFiltro(id, v)} className="accent-sky-500" />
                            <span className="truncate">{v}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            ))}
            {hayFiltros && (
              <>
                {DIMS.flatMap(({ id, label }) => [...filtros[id]].map((v) => (
                  <button key={`${id}:${v}`} type="button" onClick={() => alternarFiltro(id, v)} title={`Sacar ${label}: ${v}`}
                    className="inline-flex items-center gap-1 rounded-full border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[11px] font-semibold text-sky-300">
                    {label}: {v} <X size={11} aria-hidden />
                  </button>
                )))}
                <button type="button" onClick={() => { setFiltros(filtrosVacios()); setCodigo('') }} className="text-xs font-semibold text-sub underline hover:text-ink">Limpiar todo</button>
              </>
            )}
          </div>
        </div>

        {error && (
          <p role="alert" className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">No se pudieron traer los datos: {error}</p>
        )}
        {!cargando && !error && bases.length === 0 && (
          <p className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-400">
            No hay franquicias activas con sucursal de stock. Configuralas en <Link to="/sistemas/franquicias" className="font-semibold underline">Sistemas → Franquicias</Link>.
          </p>
        )}

        {cargando ? (
          <p className="flex items-center justify-center gap-2 py-24 text-sm text-sub"><Loader2 size={16} className="animate-spin" aria-hidden /> Trayendo ventas y stock de las franquicias…</p>
        ) : pestana === 'stock' ? (
          <section className={card}>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="mr-auto">
                <h2 className="font-display text-base font-semibold text-ink">Stock en el local</h2>
                <p className="text-xs text-sub">
                  <b className="text-ink">{fmt(d.stockTotal)}</b> unidades en <b className="text-ink">{fmt(stock.filter((x) => x.total > 0).length)}</b> artículos ·{' '}
                  <span className="text-red-400">{fmt(stock.filter((x) => x.agotados > 0).length)} con talles agotados</span> (vendidos en el rango y hoy en 0)
                </p>
              </div>
              <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar código o descripción…" aria-label="Buscar artículo"
                className="w-full rounded-full border border-line2 bg-surface px-3 py-1.5 text-sm text-ink sm:w-64" />
              {([['con', 'Con stock'], ['agotados', 'Con agotados'], ['todo', 'Todo']] as const).map(([id, l]) => (
                <button key={id} type="button" onClick={() => setVistaStock(id)} className={chip(vistaStock === id)}>{l}</button>
              ))}
              <select value={ordenStock} onChange={(e) => setOrdenStock(e.target.value as 'stock' | 'vendido')} aria-label="Ordenar"
                className="rounded-full border border-line2 bg-surface px-2 py-1 text-xs text-ink">
                <option value="stock">Más stock primero</option>
                <option value="vendido">Más vendido primero</option>
              </select>
            </div>
            <div className="max-h-[70vh] overflow-auto rounded-xl border border-line">
              <table className="w-full border-collapse text-[12.5px]">
                <thead className="sticky top-0 z-10 bg-surface"><tr>
                  <th className={`text-left ${th}`}>Artículo</th>
                  <th className={`text-right ${th}`}>Stock</th>
                  <th className={`text-left ${th}`}>Color · talle <span className="normal-case">(stock local · <span className="text-amber-400">vendido</span> · <span className="text-violet-400">MITO</span> · rojo = vendido y en 0)</span></th>
                  <th className={`text-right ${th}`}>Vendido</th>
                  <th className={`text-right ${th}`}>Precio mayorista</th>
                  <th className={`text-right ${th}`}>Stock MITO</th>
                </tr></thead>
                <tbody className="divide-y divide-line/50">
                  {stockFiltrado.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-sub">No hay artículos con ese filtro.</td></tr>}
                  {stockFiltrado.slice(0, 200).map((x) => (
                    <tr key={x.art} className="align-top hover:bg-white/5">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2.5">
                          <FotoArticulo codigo={x.art} nombre={info.get(x.art)?.descripcion} size={40} />
                          <div className="min-w-0">
                            <p className="font-semibold text-ink">{x.art}</p>
                            <p className="max-w-[240px] truncate text-[11px] text-sub">{info.get(x.art)?.descripcion || (cargandoInfo ? '…' : '')}</p>
                          </div>
                        </div>
                      </td>
                      <td className={`px-3 py-2 text-right font-display text-lg font-semibold tabular-nums ${x.total > 0 ? 'text-ink' : 'text-red-400'}`}>{fmt(x.total)}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-col gap-1">
                          {x.colores.map((c) => (
                            <div key={c.color} className="flex flex-wrap items-center gap-1">
                              <span className="w-28 shrink-0 truncate text-[11px] font-semibold text-sub" title={nombresColor.get(c.color) || c.color}>
                                {c.color || 'U'}{nombresColor.get(c.color) ? ` · ${nombresColor.get(c.color)}` : ''}
                              </span>
                              {c.talles.map((t) => (
                                <span key={t.talle} title={`Talle ${t.talle || '—'} · stock local ${fmt(t.q)} · vendido en el rango ${fmt(t.vendido)} · stock MITO ${fmt(mitoSku(x.art, c.color, t.talle) ?? 0)}`}
                                  className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] tabular-nums ${t.q > 0 ? 'border-line bg-surface text-ink' : t.vendido > 0 ? 'border-red-500/40 bg-red-500/10 text-red-400' : 'border-line bg-surface text-sub'}`}>
                                  <span className="text-sub">{t.talle || '—'}</span><b>{fmt(t.q)}</b>
                                  {t.vendido > 0 && <span className="rounded bg-amber-500/15 px-1 font-semibold text-amber-400">vend. {fmt(t.vendido)}</span>}
                                  {stockMito && <span className={`rounded px-1 font-semibold ${(mitoSku(x.art, c.color, t.talle) ?? 0) > 0 ? 'bg-violet-500/15 text-violet-400' : 'text-sub'}`}>MITO {fmt(mitoSku(x.art, c.color, t.talle) ?? 0)}</span>}
                                </span>
                              ))}
                            </div>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-sub">{x.vendido ? fmt(x.vendido) : '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-ink">{precioMay(x.art)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${x.mito > 0 ? 'text-emerald-400' : 'text-sub'}`}>{fmt(x.mito)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {stockFiltrado.length > 200 && <p className="mt-2 text-[11px] text-sub">Mostrando 200 de {fmt(stockFiltrado.length)} artículos: usá el buscador para encontrar el resto.</p>}
          </section>
        ) : (
          <>
            {/* KPIs */}
            <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              {kpis.map((k, i) => {
                const delta = k.anterior ? (k.actual - k.anterior) / Math.abs(k.anterior) : null
                return (
                  <div key={k.label} className={card} title={k.ayuda}>
                    <div className="mb-2 flex items-center gap-2">
                      <span className="grid h-8 w-8 place-items-center rounded-xl" style={{ background: `${colores[i]}22`, color: colores[i] }}><k.Icon size={16} aria-hidden /></span>
                      <span className="text-xs text-sub">{k.label}</span>
                    </div>
                    <p className="font-display text-2xl font-semibold tabular-nums text-ink">{k.valor}</p>
                    <p className="mt-1 flex items-center gap-1 truncate text-[11px] text-sub">
                      {delta != null && Number.isFinite(delta) ? (
                        <span className={`inline-flex items-center font-semibold ${delta >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {delta >= 0 ? <ArrowUpRight size={12} aria-hidden /> : <ArrowDownRight size={12} aria-hidden />}
                          {fmt1(Math.abs(delta) * 100)}%
                        </span>
                      ) : null}
                      <span className="truncate">{delta != null && Number.isFinite(delta) ? 'vs. período anterior' : k.ayuda}</span>
                    </p>
                  </div>
                )
              })}
            </div>

            {/* Venta por día */}
            <section className={`${card} mb-4`}>
              <h2 className="font-display text-base font-semibold text-ink">Venta por día</h2>
              <p className="mb-3 text-xs text-sub">Barras: importe neto · línea: unidades. Comparado contra el {fmtDia(d.antDesde)} al {fmtDia(d.antHasta)}.</p>
              <ResponsiveContainer width="100%" height={240}>
                <ComposedChart data={d.serie} margin={{ left: 4, right: -4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" vertical={false} />
                  <XAxis dataKey="dia" tick={{ fontSize: 10 }} minTickGap={12} />
                  <YAxis yAxisId="izq" tick={{ fontSize: 10 }} tickFormatter={(v: number) => fmtPesosCorto(v)} width={64} />
                  <YAxis yAxisId="der" orientation="right" tick={{ fontSize: 10 }} allowDecimals={false} width={28} />
                  <Tooltip {...TOOLTIP} formatter={(v, n) => (n === 'Venta' ? fmtPesos(Number(v)) : fmt(Number(v)))} />
                  <Bar yAxisId="izq" dataKey="importe" name="Venta" fill="#0ea5e9" radius={[4, 4, 0, 0]} maxBarSize={28} />
                  <Line yAxisId="der" dataKey="unidades" name="Unidades" stroke="#22c55e" strokeWidth={2} dot={false} type="monotone" />
                </ComposedChart>
              </ResponsiveContainer>
            </section>

            {/* Stock y venta por cada filtro (tocá una barra para filtrar) */}
            <div className="mb-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {DIMS.map(({ id, label }) => (
                <PanelDim key={id} titulo={`Stock y venta x ${label.toLowerCase()}`} filas={d.porDim[id]} activos={filtros[id]} onClick={(v) => alternarFiltro(id, v)} cargando={cargandoInfo && id !== 'color' && id !== 'talle'} ancho={id === 'talle' ? 'xl:col-span-2' : ''} />
              ))}
            </div>

            {/* Ranking por franquicia */}
            <section className={`${card} mb-4`}>
              <h2 className="font-display text-base font-semibold text-ink">Por franquicia</h2>
              <p className="mb-3 text-xs text-sub">Tocá una fila para ver solo esa franquicia. Cobertura: <span className="text-red-400">menos de 15 días</span> · <span className="text-amber-400">15 a 45</span> · <span className="text-emerald-400">45 a 120</span> · <span className="text-violet-400">más de 120 (sobrestock)</span>.</p>
              <div className="overflow-x-auto rounded-xl border border-line">
                <table className="w-full border-collapse text-[13px]">
                  <thead className="bg-surface"><tr>
                    <th className={`text-left ${th}`}>Franquicia</th>
                    <th className={`text-left ${th}`}>Sucursal stock</th>
                    <th className={`text-right ${th}`}>Venta</th>
                    <th className={`text-right ${th}`}>Unidades</th>
                    <th className={`text-right ${th}`}>Tickets</th>
                    <th className={`text-right ${th}`}>Ticket prom.</th>
                    <th className={`text-right ${th}`}>Stock local</th>
                    <th className={`text-right ${th}`}>Cobertura</th>
                  </tr></thead>
                  <tbody className="divide-y divide-line/50">
                    {d.porBase.map((b) => (
                      <tr key={b.base} onClick={() => setBaseSel(baseSel === b.base.toUpperCase() ? '' : b.base.toUpperCase())} className={`cursor-pointer hover:bg-white/5 ${baseSel === b.base.toUpperCase() ? 'bg-sky-500/10' : ''}`}>
                        <td className="px-3 py-2 font-semibold text-ink">{b.nombre} <span className="text-[11px] font-normal text-sub">{b.base}</span></td>
                        <td className="px-3 py-2 text-sub">{b.sucursal}</td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums text-ink">{fmtPesos(b.importe)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-ink">{fmt(b.unidades)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-sub">{fmt(b.tickets)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-sub">{fmtPesos(b.ticketProm)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-ink">{fmt(b.stock)}</td>
                        <td className={`px-3 py-2 text-right font-semibold tabular-nums ${coberturaCls(b.cobertura)}`}>{b.cobertura == null ? '—' : `${fmt(b.cobertura)} d`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Top artículos */}
            <section className={`${card} mb-4`}>
              <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h2 className="font-display text-base font-semibold text-ink">Venta y stock por artículo</h2>
                  <p className="text-xs text-sub">
                    Por artículo y color.{' '}
                    {todosTop
                      ? `Todos los de ese filtro (${fmt(topArts.length)}): los que se vendieron en el rango y los que hay en el local aunque no se hayan vendido.`
                      : 'Los 15 que más facturan. Filtrá un material, grupo, código o color para ver todos, con y sin venta.'}
                  </p>
                </div>
                <label className="flex items-center gap-2 text-xs text-sub">
                  Color
                  <select value={colorTop} onChange={(e) => setColorTop(e.target.value)} className="max-w-[220px] rounded-full border border-line2 bg-surface px-3 py-1.5 text-xs text-ink">
                    <option value="">Todos los colores</option>
                    {coloresTop.map((c) => <option key={c} value={c}>{c ? `${c}${nombresColor.get(c) ? ` · ${nombresColor.get(c)}` : ''}` : 'Sin color'}</option>)}
                  </select>
                </label>
              </div>
              <div className="max-h-[70vh] overflow-auto rounded-xl border border-line">
                <table className="w-full border-collapse text-[12.5px]">
                  <thead className="sticky top-0 z-10 bg-surface"><tr>
                    <th className={`w-8 text-left ${th}`}>#</th>
                    <th className={`text-left ${th}`}>Artículo</th>
                    <th className={`text-left ${th}`}>Color</th>
                    <th className={`text-left ${th}`}>Material</th>
                    <th className={`text-right ${th}`}>Unidades</th>
                    <th className={`text-right ${th}`}>Venta</th>
                    <th className={`text-right ${th}`}>Stock local</th>
                    <th className={`text-right ${th}`}>Cobertura</th>
                    <th className={`text-right ${th}`}>Precio mayorista</th>
                    <th className={`text-right ${th}`}>Stock MITO</th>
                  </tr></thead>
                  <tbody className="divide-y divide-line/50">
                    {topArts.length === 0 && <tr><td colSpan={10} className="px-3 py-8 text-center text-sub">{todosTop ? 'Nada vendido ni en stock con ese filtro.' : 'Sin ventas en el rango.'}</td></tr>}
                    {topArts.map((a, i) => (
                      <tr key={a.key} className="hover:bg-white/5">
                        <td className="px-3 py-2 text-[11px] tabular-nums text-sub">{i + 1}</td>
                        <td className="px-3 py-1.5">
                          <div className="flex items-center gap-2.5">
                            <FotoArticulo codigo={a.art} nombre={info.get(a.art)?.descripcion || a.txt} size={36} />
                            <div className="min-w-0">
                              <p className="font-semibold text-ink">{a.art}</p>
                              <p className="truncate text-[11px] text-sub">{info.get(a.art)?.descripcion || a.txt}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-sub">{a.color ? `${a.color}${nombresColor.get(a.color) ? ` · ${nombresColor.get(a.color)}` : ''}` : 'Sin color'}</td>
                        <td className="px-3 py-2 text-sub">{info.get(a.art)?.material || (cargandoInfo ? '…' : '—')}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-ink">{fmt(a.unidades)}</td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums text-ink">{fmtPesos(a.importe)}</td>
                        <td className={`px-3 py-2 text-right tabular-nums ${a.stock <= 0 ? 'font-semibold text-red-400' : 'text-ink'}`}>{fmt(a.stock)}</td>
                        <td className={`px-3 py-2 text-right font-semibold tabular-nums ${coberturaCls(a.cobertura)}`}>{a.cobertura == null ? '—' : `${fmt(a.cobertura)} d`}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-ink">{precioMay(a.art, a.color)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-sub">{fmt(a.stockMito)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Quiebres + sin rotación */}
            <div className="grid gap-4 xl:grid-cols-2">
              <section className={card}>
                <h2 className="flex items-center gap-2 font-display text-base font-semibold text-ink"><AlertTriangle size={16} className="text-red-400" aria-hidden /> Quiebres de stock</h2>
                <p className="mb-3 text-xs text-sub">{fmt(d.quiebres.length)} SKU vendidos en el rango que hoy están en 0 en el local. Primero los que MITO puede reponer.</p>
                <div className="max-h-[380px] overflow-auto rounded-xl border border-line">
                  <table className="w-full border-collapse text-[12.5px]">
                    <thead className="sticky top-0 bg-surface"><tr>
                      <th className={`text-left ${th}`}>Artículo</th>
                      <th className={`text-center ${th}`}>Color</th>
                      <th className={`text-center ${th}`}>Talle</th>
                      <th className={`text-right ${th}`}>Vendido</th>
                      <th className={`text-right ${th}`}>Stock MITO</th>
                    </tr></thead>
                    <tbody className="divide-y divide-line/50">
                      {d.quiebres.length === 0 && <tr><td colSpan={5} className="px-3 py-8 text-center text-sub">Nada en quiebre. 👌</td></tr>}
                      {d.quiebres.slice(0, 60).map((q) => (
                        <tr key={`${q.art}|${q.color}|${q.talle}`} className="hover:bg-white/5">
                          <td className="px-3 py-2"><p className="font-semibold text-ink">{q.art}</p><p className="truncate text-[11px] text-sub">{info.get(q.art)?.descripcion || q.txt}</p></td>
                          <td className="px-3 py-2 text-center text-sub">{q.color || 'U'}</td>
                          <td className="px-3 py-2 text-center text-sub">{q.talle || '—'}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-ink">{fmt(q.vendido)}</td>
                          <td className={`px-3 py-2 text-right font-semibold tabular-nums ${q.mito > 0 ? 'text-emerald-400' : 'text-sub'}`}>{q.mito > 0 ? fmt(q.mito) : 'sin stock'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className={card}>
                <h2 className="flex items-center gap-2 font-display text-base font-semibold text-ink"><Package size={16} className="text-violet-400" aria-hidden /> Sin rotación</h2>
                <p className="mb-3 text-xs text-sub">{fmt(d.quietos.length)} artículos con stock en el local que no vendieron nada en el rango ({fmt(d.unidadesQuietas)} unidades, {d.stockTotal ? fmt1((d.unidadesQuietas / d.stockTotal) * 100) : 0}% del stock).</p>
                <div className="max-h-[380px] overflow-auto rounded-xl border border-line">
                  <table className="w-full border-collapse text-[12.5px]">
                    <thead className="sticky top-0 bg-surface"><tr>
                      <th className={`text-left ${th}`}>Artículo</th>
                      <th className={`text-left ${th}`}>Material</th>
                      <th className={`text-right ${th}`}>Stock local</th>
                    </tr></thead>
                    <tbody className="divide-y divide-line/50">
                      {d.quietos.length === 0 && <tr><td colSpan={3} className="px-3 py-8 text-center text-sub">Todo lo que hay en el local vendió algo.</td></tr>}
                      {d.quietos.slice(0, 60).map((q) => (
                        <tr key={q.art} className="hover:bg-white/5">
                          <td className="px-3 py-2"><p className="font-semibold text-ink">{q.art}</p><p className="truncate text-[11px] text-sub">{info.get(q.art)?.descripcion || (cargandoInfo ? '…' : '')}</p></td>
                          <td className="px-3 py-2 text-sub">{info.get(q.art)?.material || (cargandoInfo ? '…' : '—')}</td>
                          <td className="px-3 py-2 text-right font-semibold tabular-nums text-violet-400">{fmt(q.stock)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          </>
        )}
      </div>
    </Layout>
  )
}
