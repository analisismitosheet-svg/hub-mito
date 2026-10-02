import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import {
  Loader2, Search, RefreshCw, Download, ClipboardList, PackageCheck, PackageOpen, PackageX, Percent, ChevronDown, ChevronRight,
} from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { supabase } from '@/lib/supabase'

/* ------------------------------------------------------------------ */
/*  Estado de pedidos (Compras): cómo viene el ingreso de los pedidos  */
/*  de compra, en unidades. Pedido = copia de Dragonfish; ingresado =  */
/*  lo marcado en el Picking; cancelado = vw_FACT_CANCELADOS.          */
/*  (rpc estado_pedidos_compra, sql/estado_pedidos_compra.sql)         */
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

type Estado = 'todos' | 'sin' | 'parcial' | 'completo'
type Periodo = '90' | '180' | '365' | 'todo'

const n0 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })
const fechaCorta = (f: string | null) => (f ? f.slice(0, 10).split('-').reverse().join('/') : '—')
const diasDesde = (f: string | null) => (f ? Math.max(0, Math.floor((Date.now() - new Date(f + 'T00:00:00').getTime()) / 86400000)) : null)
const pct = (a: number, b: number) => (b > 0 ? Math.min(100, Math.round((a / b) * 100)) : 0)

/** Lo que todavía tiene que llegar: lo pedido menos lo ingresado y lo cancelado. */
const pendientes = (p: { unidades: number; recibidas: number; canceladas: number }) => Math.max(0, p.unidades - p.recibidas - p.canceladas)

function estadoDe(p: EstadoPedido): Exclude<Estado, 'todos'> {
  if (p.unidades > 0 && pendientes(p) === 0) return 'completo'
  return p.recibidas > 0 ? 'parcial' : 'sin'
}

const ESTADOS: Record<Exclude<Estado, 'todos'>, { label: string; clase: string }> = {
  sin: { label: 'Sin ingresar', clase: 'border-rose-500/40 bg-rose-500/10 text-rose-400' },
  parcial: { label: 'Parcial', clase: 'border-amber-500/40 bg-amber-500/10 text-amber-400' },
  completo: { label: 'Completo', clase: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400' },
}

/** "PEDIDODECOMPRA X 00001-00009787" -> "X 00001-00009787" */
const numeroComprobante = (p: EstadoPedido) => {
  const m = /([A-Z]\s+\d{4,5}-\d{8})\s*$/.exec(p.comprobante ?? '')
  return m ? m[1] : p.numero != null ? String(p.numero) : p.codigo
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
  const [proveedor, setProveedor] = useState('')
  const [estado, setEstado] = useState<Estado>('todos')
  const [busqueda, setBusqueda] = useState('')
  const [abierto, setAbierto] = useState<string | null>(null)
  const [renglones, setRenglones] = useState<Renglon[]>([])
  const [cargandoRenglones, setCargandoRenglones] = useState(false)

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

  // Período + proveedor (los KPI y el resumen por proveedor usan esto; el estado solo filtra la lista)
  const delPeriodo = useMemo(() => {
    const desde = periodo === 'todo' ? null : new Date(Date.now() - Number(periodo) * 86400000).toISOString().slice(0, 10)
    return datos.filter((p) => p.unidades > 0 && (!desde || (p.fecha ?? '') >= desde))
  }, [datos, periodo])
  const base = useMemo(() => delPeriodo.filter((p) => !proveedor || p.proveedor === proveedor), [delPeriodo, proveedor])

  const proveedores = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of delPeriodo) m.set(p.proveedor ?? '', p.proveedor_nombre || p.proveedor || '—')
    return [...m].sort((a, b) => a[1].localeCompare(b[1], 'es'))
  }, [delPeriodo])

  const tot = useMemo(() => base.reduce((a, p) => ({
    unidades: a.unidades + p.unidades, recibidas: a.recibidas + p.recibidas, canceladas: a.canceladas + p.canceladas, pendientes: a.pendientes + pendientes(p),
    abiertos: a.abiertos + (estadoDe(p) !== 'completo' ? 1 : 0), completos: a.completos + (estadoDe(p) === 'completo' ? 1 : 0),
    sin: a.sin + (estadoDe(p) === 'sin' ? 1 : 0),
  }), { unidades: 0, recibidas: 0, canceladas: 0, pendientes: 0, abiertos: 0, completos: 0, sin: 0 }), [base])

  const porProveedor = useMemo(() => {
    const m = new Map<string, { codigo: string; nombre: string; pedidos: number; abiertos: number; unidades: number; recibidas: number; canceladas: number; pendientes: number }>()
    for (const p of delPeriodo) {
      const k = p.proveedor ?? ''
      const g = m.get(k) ?? { codigo: k, nombre: p.proveedor_nombre || k || '—', pedidos: 0, abiertos: 0, unidades: 0, recibidas: 0, canceladas: 0, pendientes: 0 }
      g.pedidos++
      if (estadoDe(p) !== 'completo') g.abiertos++
      g.unidades += p.unidades; g.recibidas += p.recibidas; g.canceladas += p.canceladas; g.pendientes += pendientes(p)
      m.set(k, g)
    }
    return [...m.values()].sort((a, b) => b.pendientes - a.pendientes)
  }, [delPeriodo])

  const q = busqueda.trim().toUpperCase()
  const lista = useMemo(() => base
    .filter((p) => (estado === 'todos' || estadoDe(p) === estado)
      && (!q || [numeroComprobante(p), p.proveedor_nombre ?? '', p.observacion ?? '', String(p.numero ?? '')].some((v) => v.toUpperCase().includes(q))))
    .sort((a, b) => String(b.fecha ?? '').localeCompare(String(a.fecha ?? '')) || (b.numero ?? 0) - (a.numero ?? 0)),
  [base, estado, q])

  async function abrir(codigo: string) {
    if (abierto === codigo) { setAbierto(null); return }
    setAbierto(codigo)
    setRenglones([])
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
  }

  async function exportar() {
    const XLSX = await import('xlsx')
    const filas = lista.map((p) => ({
      Pedido: numeroComprobante(p), Fecha: fechaCorta(p.fecha), Proveedor: p.proveedor_nombre ?? p.proveedor ?? '',
      Unidades: p.unidades, Ingresadas: p.recibidas, Canceladas: p.canceladas, Pendientes: pendientes(p),
      '% ingreso': pct(p.recibidas, p.unidades),
      Estado: ESTADOS[estadoDe(p)].label, 'Último ingreso': fechaCorta(p.ultimo_ingreso), Observación: p.observacion ?? '',
    }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas), 'Estado pedidos')
    XLSX.writeFile(wb, `estado_pedidos_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  const chip = 'rounded-full border px-3 py-1.5 text-xs font-medium transition'

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
        <select value={periodo} onChange={(e) => setPeriodo(e.target.value as Periodo)} aria-label="Período"
          className="h-9 rounded-xl border border-line bg-surface2 px-2.5 text-sm text-ink">
          <option value="90">Últimos 3 meses</option>
          <option value="180">Últimos 6 meses</option>
          <option value="365">Último año</option>
          <option value="todo">Todos</option>
        </select>
        <select value={proveedor} onChange={(e) => setProveedor(e.target.value)} aria-label="Proveedor"
          className="h-9 max-w-[16rem] rounded-xl border border-line bg-surface2 px-2.5 text-sm text-ink">
          <option value="">Todos los proveedores</option>
          {proveedores.map(([c, nom]) => <option key={c} value={c}>{nom}</option>)}
        </select>
        <div className="relative min-w-[200px] flex-1">
          <Search size={15} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub" />
          <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar N° de pedido, proveedor u observación"
            className="h-9 w-full rounded-xl border border-line bg-surface2 pl-9 pr-3 text-sm text-ink outline-none placeholder:text-sub/70" />
        </div>
      </div>

      {cargando ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sub"><Loader2 size={18} className="animate-spin" aria-hidden /> Cargando pedidos…</div>
      ) : (
        <div className="space-y-4 pb-6">
          {/* KPI */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Kpi icono={<Percent size={14} className="text-emerald-500" />} label="Ingresado" valor={`${pct(tot.recibidas, tot.unidades)}%`}
              nota={`${n0.format(tot.recibidas)} de ${n0.format(tot.unidades)} unidades`} />
            <Kpi icono={<PackageOpen size={14} className="text-amber-500" />} label="Unidades pendientes" valor={n0.format(tot.pendientes)} nota="pedidas − ingresadas − canceladas" />
            <Kpi icono={<PackageX size={14} className="text-sky-500" />} label="Unidades canceladas" valor={n0.format(tot.canceladas)} />
            <Kpi icono={<ClipboardList size={14} className="text-rose-500" />} label="Pedidos abiertos" valor={n0.format(tot.abiertos)} nota={`${n0.format(tot.sin)} sin ningún ingreso`} />
            <Kpi icono={<PackageCheck size={14} className="text-violet-500" />} label="Pedidos completos" valor={n0.format(tot.completos)} nota={`de ${n0.format(base.length)} pedidos`} />
          </div>

          {/* Por proveedor */}
          {!proveedor && (
            <section className="rounded-2xl border border-line bg-surface p-3">
              <h2 className="mb-2 text-sm font-semibold text-ink">Por proveedor <span className="font-normal text-sub">(más pendiente primero · tocá uno para filtrar)</span></h2>
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full min-w-[40rem] text-sm">
                  <thead className="sticky top-0 bg-surface text-left text-[11px] uppercase tracking-wide text-sub">
                    <tr>
                      <th className="py-1.5 pr-3">Proveedor</th>
                      <th className="py-1.5 pr-3 text-right">Pedidos abiertos</th>
                      <th className="py-1.5 pr-3 text-right">Unidades</th>
                      <th className="py-1.5 pr-3 text-right">Pendientes</th>
                      <th className="py-1.5 pr-3 text-right">Canceladas</th>
                      <th className="w-40 py-1.5">Ingreso</th>
                    </tr>
                  </thead>
                  <tbody>
                    {porProveedor.map((g) => {
                      const v = pct(g.recibidas, g.unidades)
                      return (
                        <tr key={g.codigo} onClick={() => setProveedor(g.codigo)} className="cursor-pointer border-t border-line hover:bg-surface2/60">
                          <td className="py-1.5 pr-3 font-medium text-ink">{g.nombre}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{n0.format(g.abiertos)} <span className="text-sub">/ {n0.format(g.pedidos)}</span></td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{n0.format(g.unidades)}</td>
                          <td className="py-1.5 pr-3 text-right font-semibold tabular-nums text-ink">{n0.format(g.pendientes)}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums text-sub">{g.canceladas ? n0.format(g.canceladas) : '—'}</td>
                          <td className="py-1.5"><div className="flex items-center gap-2"><Barra valor={v} /><span className="w-9 text-right text-xs tabular-nums text-sub">{v}%</span></div></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Pedidos */}
          <section className="rounded-2xl border border-line bg-surface p-3">
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <h2 className="mr-2 text-sm font-semibold text-ink">Pedidos <span className="font-normal text-sub">({n0.format(lista.length)})</span></h2>
              {(['todos', 'sin', 'parcial', 'completo'] as const).map((e) => (
                <button key={e} onClick={() => setEstado(e)}
                  className={`${chip} ${estado === e ? 'border-lime-500/50 bg-lime-500/15 text-lime-500' : 'border-line text-sub hover:text-ink'}`}>
                  {e === 'todos' ? 'Todos' : ESTADOS[e].label}
                </button>
              ))}
              {proveedor && <button onClick={() => setProveedor('')} className="ml-auto text-xs text-brand-400 hover:underline">Ver todos los proveedores</button>}
            </div>
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
                            {dias != null && est !== 'completo' && <span className={`ml-1.5 text-xs ${dias > 60 ? 'text-rose-400' : 'text-sub'}`}>hace {dias} d</span>}
                          </td>
                          <td className="py-2 pr-3">{p.proveedor_nombre ?? p.proveedor}</td>
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
                                <table className="w-full max-w-3xl text-xs">
                                  <thead className="text-left text-[10px] uppercase tracking-wide text-sub">
                                    <tr><th className="py-1 pr-3">Artículo</th><th className="py-1 pr-3">Color</th><th className="py-1 pr-3">Talle</th>
                                      <th className="py-1 pr-3 text-right">Pedido</th><th className="py-1 pr-3 text-right">Ingresado</th><th className="py-1 pr-3 text-right">Cancelado</th><th className="py-1 text-right">Falta</th></tr>
                                  </thead>
                                  <tbody>
                                    {[...renglones].sort((a, b) => (b.cantidad - b.recibido - b.cancelado) - (a.cantidad - a.recibido - a.cancelado)).map((r) => {
                                      const falta = Math.max(0, r.cantidad - r.recibido - r.cancelado)
                                      return (
                                        <tr key={`${r.articulo}|${r.color}|${r.talle}`} className="border-t border-line/60">
                                          <td className="py-1 pr-3 font-medium text-ink">{r.articulo}</td>
                                          <td className="py-1 pr-3">{r.color}</td>
                                          <td className="py-1 pr-3">{r.talle}</td>
                                          <td className="py-1 pr-3 text-right tabular-nums">{n0.format(r.cantidad)}</td>
                                          <td className="py-1 pr-3 text-right tabular-nums">{n0.format(r.recibido)}</td>
                                          <td className="py-1 pr-3 text-right tabular-nums text-sub">{r.cancelado ? n0.format(r.cancelado) : '—'}</td>
                                          <td className={`py-1 text-right font-semibold tabular-nums ${falta ? 'text-amber-400' : 'text-emerald-400'}`}>{falta ? n0.format(falta) : '✓'}</td>
                                        </tr>
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
                  {!lista.length && (
                    <tr><td colSpan={10} className="py-10 text-center text-sub">No hay pedidos con esos filtros.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </Layout>
  )
}
