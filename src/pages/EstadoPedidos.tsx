import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Loader2, Search, RefreshCw, Download, ClipboardList, PackageCheck, PackageOpen, PackageX, Percent, ChevronDown, ChevronRight,
} from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { supabase } from '@/lib/supabase'
import { descripcionesMaestro } from '@/lib/descripcionArticulos'

/* ------------------------------------------------------------------ */
/*  Estado de pedidos (Compras): cómo viene el ingreso de los pedidos  */
/*  de compra, en unidades. Pedido = copia de Dragonfish; ingresado =   */
/*  lo marcado en el Picking; cancelado = vw_FACT_CANCELADOS.          */
/*  (rpc estado_pedidos_compra, sql/estado_pedidos_compra.sql)         */
/*                                                                     */
/*  Proveedores: se agrupan por descripción (proveedor_nombre) y el    */
/*  filtro permite elegir la razón social (todos sus códigos) o un     */
/*  código suelto (proveedor). El detalle de un pedido se agrupa por   */
/*  artículo (con su total y la descripción adicional del maestro) y   */
/*  se despliega por color/talle.                                      */
/* ------------------------------------------------------------------ */

interface EstadoPedido {
  codigo: string
  numero: number | null
  comprobante: string | null
  fecha: string | null
  proveedor: string | null
  proveedor_nombre: string | null
  observacion: string | null
  unidades: number
  recibidas: number
  demas: number
  canceladas: number
  renglones: number
  renglones_completos: number
  ultimo_ingreso: string | null
}

interface Renglon {
  articulo: string
  color: string
  talle: string
  cantidad: number
  recibido: number
  cancelado: number
}

type Estado = 'todos' | 'sin' | 'parcial' | 'completo' | 'sobrante'
type Periodo = '90' | '180' | '365' | 'todo'

/** Proveedor elegido en el filtro: la etiqueta para mostrar y los códigos a filtrar. */
type FiltroProv = { label: string; codigos: string[] }

const n0 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })
const fechaCorta = (f: string | null) => (f ? f.slice(0, 10).split('-').reverse().join('/') : '—')
const diasDesde = (f: string | null) => (f ? Math.max(0, Math.floor((Date.now() - new Date(f + 'T00:00:00').getTime()) / 86400000)) : null)
const pct = (a: number, b: number) => (b > 0 ? Math.min(100, Math.round((a / b) * 100)) : 0)

/** Lo que todavía tiene que llegar: lo pedido menos lo ingresado y lo cancelado. */
const pendientes = (p: { unidades: number; recibidas: number; canceladas: number }) => Math.max(0, p.unidades - p.recibidas - p.canceladas)

function estadoDe(p: EstadoPedido): Exclude<Estado, 'todos'> {
  // Completo, pero llegaron unidades de más: se marca aparte
  if (p.unidades > 0 && pendientes(p) === 0) return p.demas > 0 ? 'sobrante' : 'completo'
  return p.recibidas > 0 ? 'parcial' : 'sin'
}

/** Ya no espera nada (completo, con o sin sobrante) */
const cerrado = (p: EstadoPedido) => {
  const e = estadoDe(p)
  return e === 'completo' || e === 'sobrante'
}

const ESTADOS: Record<Exclude<Estado, 'todos'>, { label: string; clase: string }> = {
  sin: { label: 'Sin ingresar', clase: 'border-rose-500/40 bg-rose-500/10 text-rose-400' },
  parcial: { label: 'Parcial', clase: 'border-amber-500/40 bg-amber-500/10 text-amber-400' },
  completo: { label: 'Completo', clase: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400' },
  sobrante: { label: 'Con sobrante', clase: 'border-sky-500/40 bg-sky-500/10 text-sky-400' },
}

/** "PEDIDODECOMPRA X 00001-00009787" -> "X 00001-00009787" */
const numeroComprobante = (p: EstadoPedido) => {
  const m = /([A-Z]\s+\d{4,5}-\d{8})\s*$/.exec(p.comprobante ?? '')
  return m ? m[1] : p.numero != null ? String(p.numero) : p.codigo
}

/** Estadísticas de un conjunto de pedidos (para el resumen por proveedor). */
type ProvStats = { pedidos: number; abiertos: number; unidades: number; recibidas: number; canceladas: number; pendientes: number }
const statsVacio = (): ProvStats => ({ pedidos: 0, abiertos: 0, unidades: 0, recibidas: 0, canceladas: 0, pendientes: 0 })
const statsSumar = (s: ProvStats, p: EstadoPedido) => {
  s.pedidos++
  if (!cerrado(p)) s.abiertos++
  s.unidades += p.unidades; s.recibidas += p.recibidas; s.canceladas += p.canceladas; s.pendientes += pendientes(p)
}

/**
 * Nombre del proveedor para AGRUPAR. En Dragonfish la misma razón social aparece
 * con variantes: "47 STREET" y "47 STREET - Midding S.R.L.", "REEF" y
 * "REEF - NEW ARRECIFE". La marca es lo que va antes del " - "; el resto
 * (razón social / importador) se descarta. Si no hay " - ", queda igual.
 * Aliases: para casos que la regla no cubre (misma empresa con otro nombre).
 */
const ALIAS_PROVEEDOR: Record<string, string> = {
  // 'VANS (GRIMOLDI S.A.)': 'GRIMOLDI SA (VANS)',
}
function proveedorGrupo(nombre: string): string {
  const limpio = nombre.replace(/\s+/g, ' ').trim()
  const alias = ALIAS_PROVEEDOR[limpio.toUpperCase()]
  if (alias) return alias
  return limpio.split(' - ')[0].trim() || limpio
}

/** Resumen por proveedor (misma marca junta todas sus variantes y códigos). */
type GrupoProv = { nombre: string; total: ProvStats; codigos: Map<string, ProvStats> }
function agruparProveedores(pedidos: EstadoPedido[]): GrupoProv[] {
  const m = new Map<string, GrupoProv>()
  for (const p of pedidos) {
    const nombre = proveedorGrupo(p.proveedor_nombre || p.proveedor || '—')
    const clave = nombre.toUpperCase()
    const cod = p.proveedor ?? ''
    const g = m.get(clave) ?? { nombre, total: statsVacio(), codigos: new Map<string, ProvStats>() }
    statsSumar(g.total, p)
    const s = g.codigos.get(cod) ?? statsVacio()
    statsSumar(s, p)
    g.codigos.set(cod, s)
    m.set(clave, g)
  }
  return [...m.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}

function Barra({ valor }: { valor: number }) {
  return (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-line/60">
      <span className={`block h-full rounded-full ${valor >= 100 ? 'bg-emerald-500' : valor > 0 ? 'bg-amber-500' : 'bg-transparent'}`} style={{ width: `${valor}%` }} />
    </span>
  )
}

function Kpi({ icono, label, valor, nota }: { icono: React.ReactNode; label: string; valor: string; nota?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-3.5">
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-sub">{icono} {label}</div>
      <div className="font-display text-2xl font-semibold tabular-nums text-ink">{valor}</div>
      {nota && <div className="mt-0.5 text-xs text-sub">{nota}</div>}
    </div>
  )
}

export default function EstadoPedidos() {
  const [datos, setDatos] = useState<EstadoPedido[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [periodo, setPeriodo] = useState<Periodo>('365')
  const [provSel, setProvSel] = useState<FiltroProv | null>(null)
  const [panelProv, setPanelProv] = useState(false)
  const [provAbierto, setProvAbierto] = useState<string | null>(null)
  const [provPanelAbierto, setProvPanelAbierto] = useState<string | null>(null)
  const [estado, setEstado] = useState<Estado>('todos')
  const [busqueda, setBusqueda] = useState('')
  const [abierto, setAbierto] = useState<string | null>(null)
  const [renglones, setRenglones] = useState<Renglon[]>([])
  const [descripciones, setDescripciones] = useState<Map<string, string>>(new Map())
  const [artAbierto, setArtAbierto] = useState<string | null>(null)
  const [cargandoRenglones, setCargandoRenglones] = useState(false)
  const provRef = useRef<HTMLDivElement>(null)

  const cargar = useCallback(async () => {
    if (!supabase) return
    setCargando(true)
    setError(null)
    const { data, error: e } = await supabase.rpc('estado_pedidos_compra')
    if (e) setError(e.message)
    setDatos(((data as EstadoPedido[] | null) ?? []).map((p) => ({
      ...p, unidades: Number(p.unidades), recibidas: Number(p.recibidas), demas: Number(p.demas), canceladas: Number(p.canceladas),
    })))
    setCargando(false)
  }, [])
  useEffect(() => { void cargar() }, [cargar])

  // Cerrar el desplegable de proveedores al hacer click afuera o con Escape
  useEffect(() => {
    if (!panelProv) return
    const onDown = (e: MouseEvent) => { if (provRef.current && !provRef.current.contains(e.target as Node)) setPanelProv(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPanelProv(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [panelProv])

  // Período (los KPI y el resumen por proveedor usan esto; el estado solo filtra la lista)
  const delPeriodo = useMemo(() => {
    const desde = periodo === 'todo' ? null : new Date(Date.now() - Number(periodo) * 86400000).toISOString().slice(0, 10)
    return datos.filter((p) => p.unidades > 0 && (!desde || (p.fecha ?? '') >= desde))
  }, [datos, periodo])

  // Filtro de proveedor: por razón social (todos sus códigos) o por un código suelto
  const base = useMemo(
    () => delPeriodo.filter((p) => !provSel || provSel.codigos.includes(p.proveedor ?? '')),
    [delPeriodo, provSel],
  )

  // Resumen por proveedor: respeta el filtro y va en orden alfabético (razón social)
  const gruposProv = useMemo(() => agruparProveedores(base), [base])

  // Filtro: TODOS los proveedores del período, en lista vertical alfabética
  const gruposProvAlfa = useMemo(() => agruparProveedores(delPeriodo), [delPeriodo])

  /** Elige un proveedor y cierra el panel. */
  function elegirProv(label: string, codigos: string[]) {
    setProvSel({ label, codigos })
    setPanelProv(false)
  }

  const tot = useMemo(() => base.reduce((a, p) => ({
    unidades: a.unidades + p.unidades, recibidas: a.recibidas + p.recibidas, canceladas: a.canceladas + p.canceladas, pendientes: a.pendientes + pendientes(p),
    abiertos: a.abiertos + (cerrado(p) ? 0 : 1), completos: a.completos + (cerrado(p) ? 1 : 0),
    sin: a.sin + (estadoDe(p) === 'sin' ? 1 : 0),
  }), { unidades: 0, recibidas: 0, canceladas: 0, pendientes: 0, abiertos: 0, completos: 0, sin: 0 }), [base])

  const q = busqueda.trim().toUpperCase()
  const lista = useMemo(() => base
    .filter((p) => (estado === 'todos' || estadoDe(p) === estado)
      && (!q || [numeroComprobante(p), p.proveedor_nombre ?? '', p.proveedor ?? '', p.observacion ?? '', String(p.numero ?? '')].some((v) => v.toUpperCase().includes(q))))
    .sort((a, b) => String(b.fecha ?? '').localeCompare(String(a.fecha ?? '')) || (b.numero ?? 0) - (a.numero ?? 0)),
  [base, estado, q])

  async function abrir(codigo: string) {
    if (abierto === codigo) { setAbierto(null); return }
    setAbierto(codigo)
    setRenglones([])
    setDescripciones(new Map())
    setArtAbierto(null)
    if (!supabase) return
    setCargandoRenglones(true)
    const [{ data }, { data: canc }] = await Promise.all([
      supabase.rpc('picking_items', { p_codigo: codigo }),
      supabase.from('cancelaciones').select('nro, cancelaciones_items(articulo,color,talle,cantidad)').eq('codigo_pedido', codigo),
    ])
    const rs: Renglon[] = ((data as Omit<Renglon, 'cancelado'>[] | null) ?? []).map((r) => ({ ...r, cantidad: Number(r.cantidad), recibido: Number(r.recibido), cancelado: 0 }))
    const its = ((canc as { cancelaciones_items: { articulo: string | null; color: string | null; talle: string | null; cantidad: number | null }[] }[] | null) ?? [])
      .flatMap((c) => c.cancelaciones_items)
    for (const ci of its) {
      const art = (ci.articulo ?? '').toUpperCase()
      const destino = rs.find((r) => r.articulo === art && r.color === (ci.color ?? '') && r.talle === (ci.talle ?? '')) ?? rs.find((r) => r.articulo === art)
      if (destino) destino.cancelado += Number(ci.cantidad ?? 0)
    }
    setRenglones(rs)
    setCargandoRenglones(false)
    // Descripción adicional (maestro) por artículo
    void descripcionesMaestro([...new Set(rs.map((r) => r.articulo))]).then(setDescripciones).catch(() => setDescripciones(new Map()))
  }

  // Detalle agrupado por artículo (con su total) para el desplegable color/talle
  const artGrupos = useMemo(() => {
    const m = new Map<string, { articulo: string; pedido: number; ingresado: number; cancelado: number; items: Renglon[] }>()
    for (const r of renglones) {
      const g = m.get(r.articulo) ?? { articulo: r.articulo, pedido: 0, ingresado: 0, cancelado: 0, items: [] }
      g.pedido += r.cantidad; g.ingresado += r.recibido; g.cancelado += r.cancelado; g.items.push(r)
      m.set(r.articulo, g)
    }
    return [...m.values()].sort((a, b) => Math.abs(b.pedido - b.ingresado - b.cancelado) - Math.abs(a.pedido - a.ingresado - a.cancelado))
  }, [renglones])

  async function exportar() {
    const XLSX = await import('xlsx')
    const filas = lista.map((p) => ({
      Pedido: numeroComprobante(p), Fecha: fechaCorta(p.fecha), Proveedor: p.proveedor_nombre ?? p.proveedor ?? '', Código: p.proveedor ?? '',
      Unidades: p.unidades, Ingresadas: p.recibidas, Canceladas: p.canceladas, Pendientes: pendientes(p),
      '% ingreso': pct(p.recibidas, p.unidades),
      Estado: ESTADOS[estadoDe(p)].label, 'Último ingreso': fechaCorta(p.ultimo_ingreso), Observación: p.observacion ?? '',
    }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas), 'Estado pedidos')
    XLSX.writeFile(wb, `estado_pedidos_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  const chip = 'rounded-full border px-3 py-1.5 text-xs font-medium transition'
  const opcion = 'flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-surface2'

  return (
    <Layout>
      <BackButton />
      <header className="mb-3 mt-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">Estado de pedidos</h1>
          <p className="text-sm text-sub">Cómo venimos con el ingreso de los pedidos de compra (lo marcado en el Picking).</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => void exportar()} disabled={!lista.length}
            className="btn-press inline-flex h-9 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-sm font-medium text-ink hover:bg-surface2 disabled:opacity-50">
            <Download size={15} className="text-emerald-500" aria-hidden /> Excel
          </button>
          <button onClick={() => void cargar()} disabled={cargando} aria-label="Actualizar"
            className="btn-press inline-flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-surface text-sub hover:text-ink disabled:opacity-50">
            <RefreshCw size={15} className={cargando ? 'animate-spin' : ''} aria-hidden />
          </button>
        </div>
      </header>

      {error && <p role="alert" className="mb-3 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>}

      {/* Filtros */}
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface p-3">
        <select value={periodo} onChange={(e) => setPeriodo(e.target.value as Periodo)}
          className="h-9 rounded-xl border border-line bg-surface2 px-3 text-sm text-ink">
          <option value="90">Últimos 90 días</option>
          <option value="180">Últimos 180 días</option>
          <option value="365">Último año</option>
          <option value="todo">Todo</option>
        </select>

        {/* Proveedor: desplegable ancho (columnas), agrupado por descripción */}
        <div ref={provRef} className="relative">
          <button type="button" onClick={() => setPanelProv((v) => !v)} aria-haspopup="listbox" aria-expanded={panelProv}
            className="btn-press inline-flex h-9 items-center gap-2 rounded-xl border border-line bg-surface px-3 text-sm font-medium text-ink hover:bg-surface2">
            <span className={provSel ? 'text-ink' : 'text-sub'}>{provSel ? provSel.label : 'Todos los proveedores'}</span>
            {provSel && provSel.codigos.length > 1 && (
              <span className="rounded-full bg-lime-500/15 px-2 py-0.5 text-[11px] font-semibold text-lime-500">{provSel.codigos.length} códigos</span>
            )}
            <ChevronDown size={15} className={`text-sub transition ${panelProv ? 'rotate-180' : ''}`} aria-hidden />
          </button>

          {panelProv && (
            <div className="absolute left-0 z-30 mt-2 max-h-[70vh] w-[min(92vw,420px)] overflow-auto rounded-2xl border border-line bg-paper p-2 shadow-2xl">
              <button type="button" onClick={() => { setProvSel(null); setPanelProv(false) }}
                className={`${opcion} ${!provSel ? 'bg-surface2 font-medium text-ink' : 'text-sub'}`}>
                <span>Todos los proveedores</span>
              </button>
              <div className="mt-1 border-t border-line pt-1">
                {gruposProvAlfa.map((g) => {
                  const multi = g.codigos.size > 1
                  const abiertoPanel = provPanelAbierto === g.nombre
                  return (
                    <Fragment key={g.nombre}>
                      <div className="flex items-center rounded-lg hover:bg-surface2">
                        <button type="button" onClick={() => elegirProv(g.nombre, [...g.codigos.keys()])}
                          className="flex flex-1 items-center justify-between gap-2 px-2 py-1.5 text-left text-[13px] text-ink">
                          <span className="truncate">{g.nombre}</span>
                          <span className="shrink-0 tabular-nums text-[12px] text-sub">{n0.format(g.total.pedidos)}</span>
                        </button>
                        {multi && (
                          <button type="button" onClick={() => setProvPanelAbierto(abiertoPanel ? null : g.nombre)}
                            aria-label={abiertoPanel ? 'Ocultar códigos' : 'Ver códigos'} className="shrink-0 px-2 py-1.5 text-sub hover:text-ink">
                            {abiertoPanel ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </button>
                        )}
                      </div>
                      {multi && abiertoPanel && (
                        <div className="mb-1 ml-2 border-l border-line pl-1">
                          {[...g.codigos.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es')).map(([cod, s]) => (
                            <button key={cod} type="button" onClick={() => elegirProv(cod, [cod])}
                              className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1 text-left text-[12.5px] text-sub hover:bg-surface2 hover:text-ink">
                              <span>{cod}</span>
                              <span className="tabular-nums text-[12px] text-sub">{n0.format(s.pedidos)}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </Fragment>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        <label className="relative flex h-9 flex-1 items-center gap-2 rounded-xl border border-line bg-surface2 px-3 text-sub sm:min-w-[240px]">
          <Search size={15} aria-hidden />
          <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar N° de pedido, proveedor o código…"
            className="h-full flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-sub" />
        </label>
      </div>

      {cargando ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sub"><Loader2 size={16} className="animate-spin" aria-hidden /> Cargando…</div>
      ) : (
        <>
          {/* KPIs */}
          <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Kpi icono={<Percent size={14} className="text-emerald-500" />} label="Ingresado" valor={`${pct(tot.recibidas, tot.unidades)}%`}
              nota={`${n0.format(tot.recibidas)} de ${n0.format(tot.unidades)} unidades`} />
            <Kpi icono={<PackageOpen size={14} className="text-amber-500" />} label="Unidades pendientes" valor={n0.format(tot.pendientes)} nota="pedidas − ingresadas − canceladas" />
            <Kpi icono={<PackageX size={14} className="text-sky-500" />} label="Unidades canceladas" valor={n0.format(tot.canceladas)} />
            <Kpi icono={<ClipboardList size={14} className="text-rose-500" />} label="Pedidos abiertos" valor={n0.format(tot.abiertos)} nota={`${n0.format(tot.sin)} sin ingresar`} />
            <Kpi icono={<PackageCheck size={14} className="text-emerald-500" />} label="Pedidos completos" valor={n0.format(tot.completos)} nota={`de ${n0.format(base.length)}`} />
          </div>

          {/* Resumen por proveedor (una fila por razón social; la flecha abre los códigos) */}
          <section className="mb-3 rounded-2xl border border-line bg-surface p-3">
            <h2 className="mb-2 text-sm font-semibold text-ink">
              Por proveedor
              <span className="ml-1.5 font-normal text-xs text-sub">unificado por proveedor · alfabético · tocá el nombre para filtrar, la flecha para ver los códigos</span>
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-sm">
                <thead className="text-left text-[11px] uppercase tracking-wide text-sub">
                  <tr>
                    <th className="w-6 py-1.5 pr-1" />
                    <th className="py-1.5 pr-3">Proveedor</th>
                    <th className="py-1.5 pr-3 text-right">Pedidos abiertos</th>
                    <th className="py-1.5 pr-3 text-right">Unidades</th>
                    <th className="py-1.5 pr-3 text-right">Pendientes</th>
                    <th className="py-1.5 pr-3 text-right">Canceladas</th>
                    <th className="w-40 py-1.5">Ingreso</th>
                  </tr>
                </thead>
                <tbody>
                  {gruposProv.map((g) => {
                    const v = pct(g.total.recibidas, g.total.unidades)
                    const multi = g.codigos.size > 1
                    const abiertoEste = provAbierto === g.nombre
                    return (
                      <Fragment key={g.nombre}>
                        <tr className="border-t border-line hover:bg-surface2/60">
                          <td className="py-1.5 pr-1 text-sub">
                            {multi && (
                              <button type="button" onClick={() => setProvAbierto(abiertoEste ? null : g.nombre)}
                                aria-label={abiertoEste ? 'Ocultar códigos' : 'Ver códigos'} className="inline-flex">
                                {abiertoEste ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                              </button>
                            )}
                          </td>
                          <td className="py-1.5 pr-3">
                            <button type="button" onClick={() => elegirProv(g.nombre, [...g.codigos.keys()])}
                              className="font-medium text-ink hover:text-lime-500">{g.nombre}</button>
                            {multi && <span className="ml-1.5 text-[11px] text-sub">{g.codigos.size} códigos</span>}
                          </td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{n0.format(g.total.abiertos)} <span className="text-sub">/ {n0.format(g.total.pedidos)}</span></td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{n0.format(g.total.unidades)}</td>
                          <td className="py-1.5 pr-3 text-right font-semibold tabular-nums text-ink">{n0.format(g.total.pendientes)}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums text-sub">{g.total.canceladas ? n0.format(g.total.canceladas) : '—'}</td>
                          <td className="py-1.5"><div className="flex items-center gap-2"><Barra valor={v} /><span className="w-9 text-right text-xs tabular-nums text-sub">{v}%</span></div></td>
                        </tr>
                        {multi && abiertoEste && (
                          <tr className="bg-surface2/40">
                            <td />
                            <td colSpan={6} className="py-1.5 pr-3">
                              <table className="w-full max-w-2xl text-xs">
                                <thead>
                                  <tr className="text-[10px] uppercase tracking-wide text-sub">
                                    <th className="py-1 pr-3 text-left">Código</th>
                                    <th className="py-1 pr-3 text-right">Pedidos abiertos</th>
                                    <th className="py-1 pr-3 text-right">Unidades</th>
                                    <th className="py-1 pr-3 text-right">Pendientes</th>
                                    <th className="py-1 pr-3 text-right">Canceladas</th>
                                    <th className="py-1 text-right">Ingreso</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {[...g.codigos.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es')).map(([cod, s]) => {
                                    const vc = pct(s.recibidas, s.unidades)
                                    return (
                                      <tr key={cod} className="border-t border-line/60">
                                        <td className="py-1 pr-3">
                                          <button type="button" onClick={() => elegirProv(cod, [cod])} className="text-ink hover:text-lime-500">{cod}</button>
                                        </td>
                                        <td className="py-1 pr-3 text-right tabular-nums">{n0.format(s.abiertos)} <span className="text-sub">/ {n0.format(s.pedidos)}</span></td>
                                        <td className="py-1 pr-3 text-right tabular-nums">{n0.format(s.unidades)}</td>
                                        <td className="py-1 pr-3 text-right tabular-nums">{n0.format(s.pendientes)}</td>
                                        <td className="py-1 pr-3 text-right tabular-nums text-sub">{s.canceladas ? n0.format(s.canceladas) : '—'}</td>
                                        <td className="py-1"><div className="flex items-center justify-end gap-2"><Barra valor={vc} /><span className="w-9 text-right text-xs tabular-nums text-sub">{vc}%</span></div></td>
                                      </tr>
                                    )
                                  })}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* Lista de pedidos */}
          <section className="rounded-2xl border border-line bg-surface p-3">
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <h2 className="mr-1 text-sm font-semibold text-ink">Pedidos <span className="font-normal text-sub">({n0.format(lista.length)})</span></h2>
              {(['todos', 'sin', 'parcial', 'completo', 'sobrante'] as const).map((e) => (
                <button key={e} onClick={() => setEstado(e)}
                  className={`${chip} ${estado === e ? 'border-lime-500/50 bg-lime-500/15 text-lime-500' : 'border-line text-sub hover:text-ink'}`}>
                  {e === 'todos' ? 'Todos' : ESTADOS[e].label}
                </button>
              ))}
              {provSel && (
                <span className="ml-auto flex items-center gap-2 text-xs text-sub">
                  Proveedor: <b className="text-ink">{provSel.label}</b>
                  <button type="button" onClick={() => setProvSel(null)} className="text-brand-400 hover:underline">Quitar</button>
                </span>
              )}
            </div>

            {lista.length === 0 ? (
              <p className="py-8 text-center text-sm text-sub">No hay pedidos para estos filtros.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[56rem] text-sm">
                  <thead className="text-left text-[11px] uppercase tracking-wide text-sub">
                    <tr>
                      <th className="py-1.5 pr-2" />
                      <th className="py-1.5 pr-3">Pedido</th>
                      <th className="py-1.5 pr-3">Fecha</th>
                      <th className="py-1.5 pr-3">Proveedor</th>
                      <th className="py-1.5 pr-3 text-right">Unidades</th>
                      <th className="py-1.5 pr-3 text-right">Canceladas</th>
                      <th className="py-1.5 pr-3 text-right">Pendientes</th>
                      <th className="w-36 py-1.5 pr-3">Ingreso</th>
                      <th className="py-1.5 pr-3">Último ingreso</th>
                      <th className="py-1.5">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lista.map((p) => {
                      const v = pct(p.recibidas, p.unidades)
                      const est = estadoDe(p)
                      const dias = diasDesde(p.fecha)
                      const abiertoEste = abierto === p.codigo
                      return (
                        <Fragment key={p.codigo}>
                          <tr onClick={() => void abrir(p.codigo)} className="cursor-pointer border-t border-line hover:bg-surface2/60">
                            <td className="py-2 pr-2 text-sub">{abiertoEste ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                            <td className="py-2 pr-3 font-medium text-ink">{numeroComprobante(p)}</td>
                            <td className="py-2 pr-3 tabular-nums">{fechaCorta(p.fecha)}
                              {dias != null && !cerrado(p) && <span className={`ml-1.5 text-xs ${dias > 60 ? 'text-rose-400' : 'text-sub'}`}>hace {dias} d</span>}
                            </td>
                            <td className="py-2 pr-3">
                              {p.proveedor_nombre ?? p.proveedor}
                              {provSel && provSel.codigos.length > 1 && <span className="ml-1.5 text-[11px] text-sub">{p.proveedor}</span>}
                            </td>
                            <td className="py-2 pr-3 text-right tabular-nums">{n0.format(p.unidades)}</td>
                            <td className="py-2 pr-3 text-right tabular-nums text-sub">{p.canceladas ? n0.format(p.canceladas) : '—'}</td>
                            <td className="py-2 pr-3 text-right font-semibold tabular-nums text-ink">{n0.format(pendientes(p))}</td>
                            <td className="py-2 pr-3"><div className="flex items-center gap-2"><Barra valor={v} /><span className="w-9 text-right text-xs tabular-nums text-sub">{v}%</span></div></td>
                            <td className="py-2 pr-3 tabular-nums text-sub">{fechaCorta(p.ultimo_ingreso)}</td>
                            <td className="py-2"><span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${ESTADOS[est].clase}`}>{ESTADOS[est].label}</span>
                              {p.demas > 0 && <span className="ml-1 text-[11px] text-sky-400">+{n0.format(p.demas)} de más</span>}
                            </td>
                          </tr>
                          {abiertoEste && (
                            <tr className="bg-surface2/40">
                              <td />
                              <td colSpan={9} className="py-2 pr-3">
                                {p.observacion && <p className="mb-2 text-xs text-sub">Obs.: {p.observacion}</p>}
                                {cargandoRenglones ? (
                                  <span className="inline-flex items-center gap-1.5 text-xs text-sub"><Loader2 size={13} className="animate-spin" /> Cargando artículos…</span>
                                ) : (
                                  <table className="w-full max-w-4xl text-xs">
                                    <thead className="text-left text-[10px] uppercase tracking-wide text-sub">
                                      <tr>
                                        <th className="w-5 py-1" />
                                        <th className="py-1 pr-3">Artículo</th>
                                        <th className="py-1 pr-3">Descripción adicional</th>
                                        <th className="py-1 pr-3 text-right">Pedido</th>
                                        <th className="py-1 pr-3 text-right">Ingresado</th>
                                        <th className="py-1 pr-3 text-right">Cancelado</th>
                                        <th className="py-1 text-right">Falta / Sobra</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {artGrupos.map((g) => {
                                        const dif = g.pedido - g.ingresado - g.cancelado
                                        const falta = Math.max(0, dif)
                                        const sobra = Math.max(0, -dif)
                                        const multi = g.items.length > 1
                                        const artAbiertoEste = artAbierto === g.articulo
                                        return (
                                          <Fragment key={g.articulo}>
                                            <tr className="border-t border-line/60 hover:bg-surface2/50">
                                              <td className="py-1 pr-1 text-sub">
                                                {multi && (
                                                  <button type="button" onClick={() => setArtAbierto(artAbiertoEste ? null : g.articulo)}
                                                    aria-label={artAbiertoEste ? 'Ocultar color y talle' : 'Ver color y talle'} className="inline-flex">
                                                    {artAbiertoEste ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                                  </button>
                                                )}
                                              </td>
                                              <td className="py-1 pr-3 font-medium text-ink">
                                                {g.articulo}
                                                {multi && <span className="ml-1.5 text-[10px] font-normal text-sub">{g.items.length} color/talle</span>}
                                              </td>
                                              <td className="py-1 pr-3 text-sub">{descripciones.get(g.articulo.trim().toUpperCase()) ?? '—'}</td>
                                              <td className="py-1 pr-3 text-right tabular-nums">{n0.format(g.pedido)}</td>
                                              <td className="py-1 pr-3 text-right tabular-nums">{n0.format(g.ingresado)}</td>
                                              <td className="py-1 pr-3 text-right tabular-nums text-sub">{g.cancelado ? n0.format(g.cancelado) : '—'}</td>
                                              <td className={`py-1 text-right font-semibold tabular-nums ${falta ? 'text-amber-400' : sobra ? 'text-sky-400' : 'text-emerald-400'}`}>
                                                {falta ? n0.format(falta) : sobra ? `Sobra +${n0.format(sobra)}` : '✓'}
                                              </td>
                                            </tr>
                                            {multi && artAbiertoEste && (
                                              <tr className="bg-surface2/30">
                                                <td />
                                                <td colSpan={6} className="py-1 pr-3">
                                                  <table className="w-full max-w-2xl text-[11px]">
                                                    <thead className="text-left text-[10px] uppercase tracking-wide text-sub">
                                                      <tr>
                                                        <th className="py-1 pr-3">Color</th>
                                                        <th className="py-1 pr-3">Talle</th>
                                                        <th className="py-1 pr-3 text-right">Pedido</th>
                                                        <th className="py-1 pr-3 text-right">Ingresado</th>
                                                        <th className="py-1 pr-3 text-right">Cancelado</th>
                                                        <th className="py-1 text-right">Falta / Sobra</th>
                                                      </tr>
                                                    </thead>
                                                    <tbody>
                                                      {[...g.items]
                                                        .sort((a, b) => Math.abs(b.cantidad - b.recibido - b.cancelado) - Math.abs(a.cantidad - a.recibido - a.cancelado))
                                                        .map((r) => {
                                                          const d = r.cantidad - r.recibido - r.cancelado
                                                          const f = Math.max(0, d)
                                                          const s = Math.max(0, -d)
                                                          return (
                                                            <tr key={`${r.color}|${r.talle}`} className="border-t border-line/60">
                                                              <td className="py-1 pr-3">{r.color || '—'}</td>
                                                              <td className="py-1 pr-3">{r.talle || '—'}</td>
                                                              <td className="py-1 pr-3 text-right tabular-nums">{n0.format(r.cantidad)}</td>
                                                              <td className="py-1 pr-3 text-right tabular-nums">{n0.format(r.recibido)}</td>
                                                              <td className="py-1 pr-3 text-right tabular-nums text-sub">{r.cancelado ? n0.format(r.cancelado) : '—'}</td>
                                                              <td className={`py-1 text-right font-semibold tabular-nums ${f ? 'text-amber-400' : s ? 'text-sky-400' : 'text-emerald-400'}`}>
                                                                {f ? n0.format(f) : s ? `Sobra +${n0.format(s)}` : '✓'}
                                                              </td>
                                                            </tr>
                                                          )
                                                        })}
                                                    </tbody>
                                                  </table>
                                                </td>
                                              </tr>
                                            )}
                                          </Fragment>
                                        )
                                      })}
                                    </tbody>
                                  </table>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </Layout>
  )
}
