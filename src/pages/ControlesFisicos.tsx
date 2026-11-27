import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, ClipboardCheck, Download, Loader2, RefreshCw, RotateCcw, Search } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import DesgloseChips from '@/components/control/DesgloseChips'
import { useAuth } from '@/context/AuthContext'
import {
  claveLinea,
  estadoLinea,
  fechaHora,
  lineasControl,
  listarControles,
  marcarVisto,
  n0,
  pesos,
  reabrirControl,
  type ControlResumen,
  type LineaControl,
} from '@/lib/controlFisico'

type Periodo = 'hoy' | 'semana' | 'anterior' | '4s' | 'todos'
type FiltroEstado = 'todos' | 'dif' | 'ok' | 'curso' | 'pendiente'

const PERIODOS: [Periodo, string][] = [['hoy', 'Hoy'], ['semana', 'Esta semana'], ['anterior', 'Semana anterior'], ['4s', 'Últimas 4 semanas'], ['todos', 'Todos']]

function enPeriodo(iso: string | null, p: Periodo): boolean {
  if (p === 'todos') return true
  if (!iso) return false
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso)
  const hoy = new Date()
  const ini = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate())
  const lunes = new Date(ini)
  lunes.setDate(ini.getDate() - ((ini.getDay() + 6) % 7))
  if (p === 'hoy') return d >= ini
  if (p === 'semana') return d >= lunes
  if (p === 'anterior') {
    const prev = new Date(lunes)
    prev.setDate(lunes.getDate() - 7)
    return d >= prev && d < lunes
  }
  const hace = new Date(ini)
  hace.setDate(ini.getDate() - 28)
  return d >= hace
}

/**
 * Depósito → Controles físicos (27/11/2026). Mismo diseño que Pedidos de venta:
 * lista a la izquierda, detalle a la derecha pintado por renglón (verde igual,
 * rojo falta, verde flúor sobra) con precio de compra y el desglose desplegable.
 * La campana / push «Control físico terminado» abre ?abrir=<factura>.
 */
export default function ControlesFisicos() {
  const { isAdmin } = useAuth()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const sel = params.get('abrir')

  const [controles, setControles] = useState<ControlResumen[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [periodo, setPeriodo] = useState<Periodo>('4s')
  const [estado, setEstado] = useState<FiltroEstado>('todos')
  const [q, setQ] = useState('')

  const cargar = useCallback(async () => {
    try {
      setError(null)
      setControles(await listarControles())
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])
  useEffect(() => { void cargar() }, [cargar])

  const fechaDe = (c: ControlResumen) => c.terminado_at ?? c.ultimo_at ?? c.fecha_ingreso
  const enElPeriodo = useMemo(() => (controles ?? []).filter((c) => c.estado !== 'terminado' || enPeriodo(fechaDe(c), periodo)), [controles, periodo])
  const cuenta = {
    todos: enElPeriodo.length,
    dif: enElPeriodo.filter((c) => c.estado === 'terminado' && c.con_diferencias).length,
    ok: enElPeriodo.filter((c) => c.estado === 'terminado' && !c.con_diferencias).length,
    curso: enElPeriodo.filter((c) => c.estado === 'en_curso').length,
    pendiente: enElPeriodo.filter((c) => c.estado === 'pendiente').length,
  }
  const visibles = useMemo(() => {
    const t = q.trim().toUpperCase()
    return enElPeriodo.filter((c) => {
      if (estado === 'dif' && !(c.estado === 'terminado' && c.con_diferencias)) return false
      if (estado === 'ok' && !(c.estado === 'terminado' && !c.con_diferencias)) return false
      if (estado === 'curso' && c.estado !== 'en_curso') return false
      if (estado === 'pendiente' && c.estado !== 'pendiente') return false
      if (t && !`${c.proveedor} ${c.n_factura} ${c.n_oc} ${c.terminado_nombre ?? ''} ${c.iniciado_nombre ?? ''}`.toUpperCase().includes(t)) return false
      return true
    })
  }, [enElPeriodo, estado, q])

  const elegido = (controles ?? []).find((c) => c.factura_clave === sel) ?? null
  const idx = elegido ? visibles.findIndex((c) => c.factura_clave === sel) : -1
  const elegir = (f: string | null) => setParams(f ? { abrir: f } : {})

  useEffect(() => {
    if (elegido?.estado === 'terminado') void marcarVisto(elegido.factura_clave)
  }, [elegido?.factura_clave, elegido?.estado])

  const estados: [FiltroEstado, string, string][] = [
    ['todos', 'Todos', 'border-sky-500/50 bg-sky-500/15 text-sky-400'],
    ['dif', 'Con diferencias', 'border-red-500/50 bg-red-500/15 text-red-400'],
    ['ok', 'OK', 'border-emerald-500/50 bg-emerald-500/15 text-emerald-400'],
    ['curso', 'En curso', 'border-amber-500/50 bg-amber-500/15 text-amber-400'],
    ['pendiente', 'Pendientes', 'border-violet-500/50 bg-violet-500/15 text-violet-400'],
  ]

  return (
    <Layout>
      <BackButton />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="rounded-xl border p-2.5" style={{ color: '#e11d48', backgroundColor: '#e11d4824', borderColor: '#e11d4840' }}>
          <ClipboardCheck size={24} aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-bold text-ink sm:text-2xl">Controles físicos</h1>
          <p className="text-sm text-sub">{controles ? `${controles.length} facturas con picking` : 'Cargando…'} · Depósito Indo</p>
        </div>
        <button type="button" onClick={() => navigate('/deposito/control-fisico')} className="rounded-xl border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink hover:bg-surface2">
          Contar (celular)
        </button>
        <button type="button" onClick={() => void cargar()} className="rounded-xl border border-line p-2 text-sub hover:text-ink" aria-label="Actualizar">
          <RefreshCw size={16} aria-hidden />
        </button>
      </div>

      <div className="mb-2 flex flex-wrap gap-1.5">
        {PERIODOS.map(([k, t]) => (
          <button key={k} type="button" onClick={() => setPeriodo(k)}
            className={`rounded-full border px-3 py-1 text-xs font-semibold ${periodo === k ? 'border-amber-500/60 bg-amber-500/15 text-amber-400' : 'border-line text-sub hover:text-ink'}`}>
            {t}
          </button>
        ))}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-sub">Estado:</span>
        {estados.map(([k, t, cls]) => (
          <button key={k} type="button" onClick={() => setEstado(k)}
            className={`rounded-full border px-3 py-1 text-xs font-semibold ${estado === k ? cls : 'border-line text-sub hover:text-ink'}`}>
            {t} <span className="ml-1 tabular-nums opacity-70">{cuenta[k]}</span>
          </button>
        ))}
      </div>
      {error && <div className="mb-3 rounded-xl border border-red-500/30 bg-red-500/10 p-2 text-sm text-red-500">{error}</div>}

      <div className="grid gap-4 pb-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <aside className={`${sel ? 'hidden lg:block' : ''} min-w-0`}>
          <div className="relative mb-2">
            <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Proveedor, factura, OC, quién…"
              className="h-11 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-sm text-ink outline-none focus-visible:border-brand-500" />
          </div>
          <div className="overflow-hidden rounded-2xl border border-line bg-surface lg:max-h-[calc(100vh-16rem)] lg:overflow-y-auto">
            {!controles ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sub"><Loader2 size={16} className="animate-spin" aria-hidden /> Cargando…</div>
            ) : !visibles.length ? (
              <p className="px-4 py-10 text-center text-sm text-sub">No hay controles con esos filtros.</p>
            ) : (
              <ul className="divide-y divide-line/60">
                {visibles.map((c) => {
                  const activo = c.factura_clave === sel
                  return (
                    <li key={c.factura_clave}>
                      <button type="button" onClick={() => elegir(c.factura_clave)}
                        className={`flex w-full items-start gap-3 px-3 py-2.5 text-left transition ${activo ? 'bg-amber-500/15' : 'hover:bg-surface2'}`}>
                        <span className="min-w-0 flex-1">
                          <span className={`block truncate font-display text-[15px] font-bold leading-tight ${activo ? 'text-amber-500' : 'text-ink'}`}>{c.proveedor}</span>
                          <span className="block text-xs font-semibold tabular-nums text-sub">Fact. {c.n_factura} · OC {c.n_oc || '—'}</span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-sub">
                            {c.estado === 'terminado' ? fechaHora(c.terminado_at) : c.fecha_ingreso ? c.fecha_ingreso.split('-').reverse().join('/') : ''}
                            <ChipEstado c={c} />
                          </span>
                          {c.estado === 'terminado' && <span className="block truncate text-[11px] font-semibold text-emerald-400">👤 {c.terminado_nombre}</span>}
                          {c.estado === 'en_curso' && <span className="block truncate text-[11px] font-semibold text-amber-500">👤 {c.iniciado_nombre} · lo está haciendo</span>}
                        </span>
                        <span className="shrink-0 text-right text-xs font-semibold tabular-nums text-ink">{n0.format(c.estado === 'terminado' ? c.unidades_contadas : c.unidades_picking)} u.</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </aside>

        <section className={`${sel ? '' : 'hidden lg:block'} min-w-0`}>
          {!elegido ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-line bg-surface/50 px-4 py-16 text-center text-sub">
              <ClipboardCheck size={28} aria-hidden />
              {sel && controles ? 'Ese control ya no está (¿se anuló el picking?).' : 'Elegí un control de la lista.'}
            </div>
          ) : (
            <Detalle
              c={elegido}
              isAdmin={isAdmin}
              onVolver={() => elegir(null)}
              onAnterior={idx > 0 ? () => elegir(visibles[idx - 1].factura_clave) : undefined}
              onSiguiente={idx >= 0 && idx < visibles.length - 1 ? () => elegir(visibles[idx + 1].factura_clave) : undefined}
              onCambio={() => void cargar()}
            />
          )}
        </section>
      </div>
    </Layout>
  )
}

function ChipEstado({ c }: { c: ControlResumen }) {
  if (c.estado === 'terminado')
    return c.con_diferencias ? (
      <span className="rounded-md bg-red-500/15 px-1.5 py-px text-[10px] font-bold text-red-400">
        CON DIFERENCIAS{c.faltan ? ` −${n0.format(c.faltan)}` : ''}{c.sobran ? ` +${n0.format(c.sobran)}` : ''}
      </span>
    ) : (
      <span className="rounded-md bg-emerald-500/15 px-1.5 py-px text-[10px] font-bold text-emerald-400">OK ✓</span>
    )
  if (c.estado === 'en_curso')
    return <span className="rounded-md bg-amber-500/15 px-1.5 py-px text-[10px] font-bold text-amber-400">EN CURSO {c.renglones ? Math.round((c.controlados / c.renglones) * 100) : 0}%</span>
  return <span className="rounded-md bg-violet-500/15 px-1.5 py-px text-[10px] font-bold text-violet-400">PENDIENTE</span>
}

function Detalle({
  c,
  isAdmin,
  onVolver,
  onAnterior,
  onSiguiente,
  onCambio,
}: {
  c: ControlResumen
  isAdmin: boolean
  onVolver: () => void
  onAnterior?: () => void
  onSiguiente?: () => void
  onCambio: () => void
}) {
  const [lineas, setLineas] = useState<LineaControl[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set())

  useEffect(() => {
    let vivo = true
    setLineas(null)
    setError(null)
    lineasControl(c.factura_clave)
      .then((l) => {
        if (!vivo) return
        setLineas(l)
        // con diferencias: los desgloses con diferencia arrancan abiertos
        setAbiertos(new Set(l.filter((x) => x.desglose && x.contado !== x.picking).map(claveLinea)))
      })
      .catch((e: Error) => vivo && setError(e.message))
    return () => { vivo = false }
  }, [c.factura_clave, c.estado, c.controlados])

  const l = lineas ?? []
  const contado = l.reduce((s, x) => s + (x.contado ?? 0), 0)
  const picking = l.reduce((s, x) => s + x.picking, 0)
  const faltan = l.reduce((s, x) => s + (x.contado != null && x.contado < x.picking ? x.picking - x.contado : 0), 0)
  const sobran = l.reduce((s, x) => s + (x.contado != null && x.contado > x.picking ? x.contado - x.picking : 0), 0)
  const faltanImp = l.reduce((s, x) => s + (x.contado != null && x.contado < x.picking ? (x.picking - x.contado) * (x.precio ?? 0) : 0), 0)
  const sobranImp = l.reduce((s, x) => s + (x.contado != null && x.contado > x.picking ? (x.contado - x.picking) * (x.precio ?? 0) : 0), 0)
  const desglosados = l.filter((x) => x.requiere_desglose).length
  const conDif = l.filter((x) => x.contado != null && x.contado !== x.picking)

  async function exportar() {
    const XLSX = await import('xlsx')
    const filas: Record<string, string | number>[] = []
    for (const x of l) {
      const base = { OC: x.numero ?? '', Artículo: x.articulo, Descripción: x.descripcion ?? '' }
      filas.push({
        ...base, Color: x.color, Talle: x.talle, Picking: x.picking, Contado: x.contado ?? '',
        'Precio compra': x.precio ?? '', 'Importe contado': x.contado != null && x.precio != null ? x.contado * x.precio : '',
        'Dif. u.': x.contado != null ? x.contado - x.picking : '', 'Dif. $': x.contado != null && x.precio != null ? (x.contado - x.picking) * x.precio : '',
        Motivo: x.motivo ?? '', Desglose: '',
      })
      for (const d of x.desglose ?? []) {
        filas.push({ ...base, Color: d.color, Talle: d.talle, Picking: '', Contado: d.cantidad, 'Precio compra': x.precio ?? '', 'Importe contado': x.precio != null ? d.cantidad * x.precio : '', 'Dif. u.': '', 'Dif. $': '', Motivo: '', Desglose: `de ${x.color}/${x.talle}${d.color_desc ? ` · ${d.color_desc}` : ''}` })
      }
    }
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas), 'Control')
    XLSX.writeFile(wb, `control_fisico_${c.n_factura}.xlsx`)
  }

  async function reabrir() {
    if (!window.confirm('¿Reabrir este control? Vuelve a «En curso» y se saca la fecha de controlada en Recepción INDO.')) return
    try {
      await reabrirControl(c.factura_clave)
      onCambio()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const campo = (label: string, valor: ReactNode, extra = '') => (
    <div className={`min-w-0 ${extra}`}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-sub">{label}</p>
      <div className="text-sm font-semibold text-ink">{valor || '—'}</div>
    </div>
  )

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onVolver} className="inline-flex h-10 items-center gap-1 rounded-xl px-2 text-sm font-medium text-sub hover:text-ink lg:hidden">
          <ArrowLeft size={16} aria-hidden /> Controles
        </button>
        <div className="ml-auto flex items-center gap-1.5">
          <button type="button" onClick={onAnterior} disabled={!onAnterior} aria-label="Anterior"
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface text-ink hover:bg-surface2 disabled:opacity-40"><ChevronLeft size={18} aria-hidden /></button>
          <button type="button" onClick={onSiguiente} disabled={!onSiguiente} aria-label="Siguiente"
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface text-ink hover:bg-surface2 disabled:opacity-40"><ChevronRight size={18} aria-hidden /></button>
          <button type="button" onClick={() => void exportar()} disabled={!l.length}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-sm font-medium text-ink hover:bg-surface2 disabled:opacity-50">
            <Download size={15} aria-hidden /> Excel
          </button>
          {isAdmin && c.estado === 'terminado' && (
            <button type="button" onClick={() => void reabrir()}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-sm font-medium text-sub hover:text-ink">
              <RotateCcw size={15} aria-hidden /> Reabrir
            </button>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-line bg-surface p-4 shadow-soft">
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          {campo('Proveedor', c.proveedor, 'col-span-2')}
          {campo('Factura', <span className="font-mono">{c.n_factura}</span>)}
          {campo('Estado', <ChipEstado c={c} />)}
          {campo('Pedido de compra', <span className="text-amber-500">OC {c.n_oc || '—'}</span>, 'col-span-2')}
          {campo('Controló', c.estado === 'terminado' ? c.terminado_nombre : c.iniciado_nombre)}
          {campo('Fecha / hora', c.estado === 'terminado' ? fechaHora(c.terminado_at) : c.ultimo_at ? `${fechaHora(c.ultimo_at)} (último conteo)` : '—')}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Kpi label="Picking" valor={n0.format(picking)} />
          <Kpi label="Contado" valor={n0.format(contado)} />
          <Kpi label="Faltan" valor={n0.format(faltan)} color={faltan ? 'text-red-400' : undefined} />
          <Kpi label="Desglosados" valor={String(desglosados)} color="text-violet-400" />
          <Kpi label="Faltante a precio compra" valor={pesos.format(faltanImp)} color={faltanImp ? 'text-red-400' : undefined} />
        </div>
      </div>

      {conDif.length > 0 && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
          Diferencias:{' '}
          {faltan > 0 && <b>faltan {n0.format(faltan)} u. ({pesos.format(faltanImp)})</b>}
          {faltan > 0 && sobran > 0 && ' · '}
          {sobran > 0 && <b className="text-lime-300">sobran {n0.format(sobran)} u. ({pesos.format(sobranImp)})</b>}
          {' — '}
          {conDif.map((x) => `${x.articulo}${x.requiere_desglose ? '' : ` ${x.color} ${x.talle}`} (${x.contado! - x.picking > 0 ? '+' : ''}${x.contado! - x.picking}${x.motivo ? ` ${x.motivo}` : ''})`).join(' · ')}
        </div>
      )}
      {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-2 text-sm text-red-500">{error}</div>}

      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-sub">
              <th className="px-3 py-2">Artículo</th>
              <th className="px-3 py-2">Color</th>
              <th className="px-3 py-2">Talle</th>
              <th className="px-3 py-2 text-right">Picking</th>
              <th className="px-3 py-2 text-right">Contado</th>
              <th className="px-3 py-2 text-right">P. compra</th>
              <th className="px-3 py-2 text-right">Importe contado</th>
              <th className="px-3 py-2 text-right">$ Dif.</th>
              <th className="px-3 py-2">Estado</th>
            </tr>
          </thead>
          <tbody>
            {!lineas && !error && (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-sub"><Loader2 size={16} className="mr-2 inline animate-spin" aria-hidden />Cargando…</td></tr>
            )}
            {l.map((x) => {
              const k = claveLinea(x)
              const est = estadoLinea(x)
              const abierto = abiertos.has(k)
              const fondo = est === 'ok' ? 'bg-emerald-500/[0.06]' : est === 'falta' ? 'bg-red-500/[0.07]' : est === 'sobra' ? 'bg-lime-400/[0.07]' : x.requiere_desglose ? 'bg-violet-500/[0.06]' : ''
              const dif = x.contado != null && x.precio != null ? (x.contado - x.picking) * x.precio : null
              return (
                <Fragment key={k}>
                  <tr className={`border-b border-line/50 ${fondo}`}>
                    <td className="px-3 py-2">
                      <button type="button" disabled={!x.desglose} onClick={() => setAbiertos((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })}
                        className="flex items-center gap-1 text-left disabled:cursor-default">
                        {x.desglose && <ChevronDown size={14} className={`shrink-0 text-violet-400 transition ${abierto ? '' : '-rotate-90'}`} aria-hidden />}
                        <span>
                          <b className="text-ink">{x.articulo}</b>
                          <span className="block max-w-[16rem] truncate text-[11px] text-sub">{x.descripcion || '—'}{x.numero ? ` · OC ${x.numero}` : ''}</span>
                        </span>
                      </button>
                    </td>
                    <td className="px-3 py-2"><span className={`rounded px-1.5 text-xs font-bold ${x.requiere_desglose ? 'border border-dashed border-violet-500/50 text-violet-300' : 'bg-sky-500/15 text-sky-400'}`}>{x.color || '—'}</span></td>
                    <td className="px-3 py-2"><span className={`rounded px-1.5 text-xs font-bold ${x.requiere_desglose ? 'border border-dashed border-violet-500/50 text-violet-300' : 'bg-violet-500/15 text-violet-400'}`}>{x.talle || '—'}</span></td>
                    <td className="px-3 py-2 text-right tabular-nums">{n0.format(x.picking)}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{x.contado == null ? '—' : n0.format(x.contado)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-sub">{x.precio == null ? '—' : pesos.format(x.precio)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{x.contado == null || x.precio == null ? '—' : pesos.format(x.contado * x.precio)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${dif && dif < 0 ? 'text-red-400' : dif && dif > 0 ? 'text-lime-300' : 'text-sub'}`}>{dif ? pesos.format(dif) : '—'}</td>
                    <td className="px-3 py-2">
                      {est === 'ok' && <span className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-xs font-bold text-emerald-400">✓</span>}
                      {est === 'falta' && <span className="rounded-md bg-red-500/15 px-1.5 py-0.5 text-xs font-bold text-red-400">✕ Faltan {x.picking - x.contado!}{x.motivo ? ` · ${x.motivo}` : ''}</span>}
                      {est === 'sobra' && <span className="rounded-md bg-lime-400/15 px-1.5 py-0.5 text-xs font-bold text-lime-300">+{x.contado! - x.picking}</span>}
                      {est === 'sin' && <span className="text-xs text-sub">{x.requiere_desglose ? 'Falta desglosar' : 'Sin contar'}</span>}
                    </td>
                  </tr>
                  {abierto && x.desglose && (
                    <tr className="border-b border-line/50">
                      <td colSpan={9} className="px-3 pb-3 pl-8 pt-1">
                        <p className="mb-1 text-[11px] text-sub">Lo que contó {x.actualizado_nombre ?? 'el operario'} (no cambia el picking):</p>
                        <DesgloseChips desglose={x.desglose} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-sub">
        P. compra = precio unitario sin IVA de la línea de la OC en Dragon. En un renglón desglosado vale el mismo precio para todos sus colores y talles.
      </p>
    </div>
  )
}

function Kpi({ label, valor, color }: { label: string; valor: string; color?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface2 px-3 py-2">
      <p className="text-[11px] text-sub">{label}</p>
      <p className={`font-display text-lg font-bold tabular-nums ${color ?? 'text-ink'}`}>{valor}</p>
    </div>
  )
}
