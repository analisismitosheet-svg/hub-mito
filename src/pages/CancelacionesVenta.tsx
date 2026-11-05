import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Search, ChevronLeft, ChevronRight, RefreshCw, Download, Ban, ArrowLeft, ExternalLink, Undo2 } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'

/* ------------------------------------------------------------------ */
/*  Cancelaciones de venta (Mayorista)                                 */
/*  Copia de las «Cancelación de venta» de Dragonfish MITO             */
/*  (sql/cancelaciones_venta.sql) con los pedidos y remitos que afecta */
/*  cada una. La actualiza puente-sql/scripts/sync-cancelaciones-venta */
/*  .js al final de la copia de pedidos de venta (cada 15 minutos;     */
/*  120 días). Mismo diseño que Pedidos de venta. Solo lectura: anular */
/*  en Dragon espera que la API lo permita (DELETE /Devolucion/ da 400) */
/* ------------------------------------------------------------------ */

interface Afectado {
  codigo: string
  tipo: number | null // 23 = pedido de venta, 11 = remito de venta
  numero: number | null
  comprobante: string
  fecha: string | null
  total: number | null
}

interface Cancelacion {
  codigo: string
  numero: number | null
  fecha: string | null
  hora: string | null
  cliente: string | null
  cliente_nombre: string | null
  usuario: string | null
  observacion: string | null
  motivo: string | null
  motivo_nombre: string | null
  total: number | null
  unidades: number | null
  anulado: boolean
  afecta: Afectado[]
}

interface Item {
  linea: number
  articulo: string | null
  descripcion: string | null
  color: string | null
  color_nombre: string | null
  talle: string | null
  cantidad: number | null
  precio: number | null
}

type Periodo = 'hoy' | 'semana' | 'anterior' | 'cuatro' | 'todas'
const PERIODOS: { id: Periodo; label: string }[] = [
  { id: 'hoy', label: '📅 Hoy' },
  { id: 'semana', label: 'Esta semana' },
  { id: 'anterior', label: 'Semana pasada' },
  { id: 'cuatro', label: 'Últimas 4 semanas' },
  { id: 'todas', label: 'Todas (120 días)' },
]

/** Lunes (AAAA-MM-DD, hora Argentina) de la semana actual menos `semanasAtras`. */
function lunesAR(semanasAtras = 0): string {
  const hoy = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })
  const d = new Date(`${hoy}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) - semanasAtras * 7)
  return d.toISOString().slice(0, 10)
}
const hoyAR = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })

function enPeriodo(f: string | null, p: Periodo): boolean {
  if (p === 'todas') return true
  if (!f) return false
  if (p === 'hoy') return f === hoyAR()
  if (p === 'semana') return f >= lunesAR(0)
  if (p === 'anterior') return f >= lunesAR(1) && f < lunesAR(0)
  return f >= lunesAR(3)
}

const PEDIDO = 23
const REMITO = 11
const SIN_VINCULO = '_sin'
const CON_REMITO = '_remito'
/** Un color por usuario (fijos y distintos entre sí) */
const PALETA = ['#38bdf8', '#a78bfa', '#f472b6', '#2dd4bf', '#fb923c', '#facc15', '#4ade80', '#e879f9', '#60a5fa', '#f87171', '#94a3b8']

const $ = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const n0 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 })
const plata = (v: number | null | undefined) => (v == null ? '—' : $.format(v))
const fechaCorta = (f: string | null) => (f ? f.split('-').reverse().join('/') : '—')
const numeroComprobante = (n: number | null) => (n == null ? '—' : `X 0001-${String(n).padStart(8, '0')}`)
const numerosDe = (c: Cancelacion, tipo: number) => c.afecta.filter((a) => a.tipo === tipo).map((a) => a.numero)

const PAGINA = 1000 // filas por consulta a Supabase (su tope)

export default function CancelacionesVenta() {
  const { isAdmin } = useAuth()
  const [params, setParams] = useSearchParams()
  const [lista, setLista] = useState<Cancelacion[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actualizado, setActualizado] = useState<string | null>(null)
  const [periodo, setPeriodo] = useState<Periodo>('cuatro')
  const [filtro, setFiltro] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [sel, setSel] = useState<string | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [cargandoItems, setCargandoItems] = useState(false)
  const [forzando, setForzando] = useState(false)
  const [avisoSync, setAvisoSync] = useState<{ ok: boolean; texto: string } | null>(null)

  const cargar = useCallback(async () => {
    if (!supabase) return
    setCargando(true)
    setError(null)
    try {
      const todas: Cancelacion[] = []
      for (let desde = 0; ; desde += PAGINA) {
        const { data, error: e } = await supabase
          .from('cancelaciones_venta')
          .select('codigo,numero,fecha,hora,cliente,cliente_nombre,usuario,observacion,motivo,motivo_nombre,total,unidades,anulado,afecta')
          .order('fecha', { ascending: false })
          .order('numero', { ascending: false })
          .range(desde, desde + PAGINA - 1)
        if (e) throw e
        todas.push(...((data ?? []) as Cancelacion[]))
        if (!data || data.length < PAGINA) break
      }
      setLista(todas)
      const { data: s } = await supabase.from('cancelaciones_venta_sync').select('ultima_at').maybeSingle()
      setActualizado((s as { ultima_at: string | null } | null)?.ultima_at ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar las cancelaciones.')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  // Deep-link: ?abrir=CODIGO abre esa cancelación (busca en todo el período)
  useEffect(() => {
    const abrir = params.get('abrir')
    if (!abrir) return
    setSel(abrir)
    setPeriodo('todas')
    const limpiar = new URLSearchParams(params)
    limpiar.delete('abrir')
    setParams(limpiar, { replace: true })
  }, [params, setParams])

  // Renglones de la cancelación elegida
  useEffect(() => {
    if (!supabase || !sel) {
      setItems([])
      return
    }
    let vivo = true
    setCargandoItems(true)
    void supabase
      .from('cancelaciones_venta_items')
      .select('linea,articulo,descripcion,color,color_nombre,talle,cantidad,precio')
      .eq('codigo', sel)
      .order('linea')
      .then(({ data }) => {
        if (!vivo) return
        setItems((data ?? []) as Item[])
        setCargandoItems(false)
      })
    return () => {
      vivo = false
    }
  }, [sel])

  async function actualizarDatos() {
    if (!supabase || forzando) return
    setForzando(true)
    setAvisoSync(null)
    try {
      const { data } = await supabase.auth.getSession()
      // La copia de cancelaciones corre al final de la de pedidos de venta
      const r = await fetch('/api/pedidos-sync?tipo=venta', {
        method: 'POST',
        headers: { Authorization: `Bearer ${data.session?.access_token ?? ''}` },
      })
      const cuerpo = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (!r.ok || !cuerpo?.ok) throw new Error(cuerpo?.error ?? `Error ${r.status}`)
      await cargar()
      setAvisoSync({ ok: true, texto: 'Datos actualizados desde el SQL.' })
    } catch (e) {
      setAvisoSync({ ok: false, texto: e instanceof Error ? e.message : 'No se pudieron actualizar los datos.' })
    } finally {
      setForzando(false)
    }
  }

  const delPeriodo = useMemo(() => lista.filter((c) => enPeriodo(c.fecha, periodo)), [lista, periodo])

  // Usuarios del período (con un color fijo por usuario de toda la lista)
  const usuarios = useMemo(() => [...new Set(lista.map((c) => c.usuario || '—'))].sort(), [lista])
  const colorDe = (u: string | null) => PALETA[Math.max(0, usuarios.indexOf(u || '—')) % PALETA.length]
  const chips = useMemo(() => {
    const cuenta = new Map<string, number>()
    for (const c of delPeriodo) cuenta.set(c.usuario || '—', (cuenta.get(c.usuario || '—') ?? 0) + 1)
    return [
      { clave: '', nombre: 'Todas', color: '#f59e0b', n: delPeriodo.length },
      ...usuarios.filter((u) => cuenta.get(u)).map((u) => ({ clave: u, nombre: u, color: colorDe(u), n: cuenta.get(u) ?? 0 })),
      { clave: CON_REMITO, nombre: 'Con remito', color: '#34d399', n: delPeriodo.filter((c) => numerosDe(c, REMITO).length).length },
      { clave: SIN_VINCULO, nombre: 'Sin vínculo', color: '#f87171', n: delPeriodo.filter((c) => !c.afecta.length).length },
    ].filter((x) => x.n > 0 || x.clave === '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [delPeriodo, usuarios])

  const q = busqueda.trim().toLowerCase()
  const visibles = useMemo(
    () =>
      delPeriodo.filter((c) => {
        if (filtro === SIN_VINCULO && c.afecta.length) return false
        if (filtro === CON_REMITO && !numerosDe(c, REMITO).length) return false
        if (filtro && filtro[0] !== '_' && (c.usuario || '—') !== filtro) return false
        if (!q) return true
        return [c.cliente, c.cliente_nombre, c.numero, c.usuario, c.observacion, fechaCorta(c.fecha), ...c.afecta.map((a) => a.numero)]
          .join(' ')
          .toLowerCase()
          .includes(q)
      }),
    [delPeriodo, filtro, q],
  )

  const canc = lista.find((c) => c.codigo === sel) ?? null
  const idx = canc ? visibles.findIndex((c) => c.codigo === canc.codigo) : -1
  const ir = (d: number) => {
    const otra = visibles[idx + d]
    if (otra) setSel(otra.codigo)
  }

  const neto = items.reduce((s, i) => s + (i.cantidad ?? 0) * (i.precio ?? 0), 0)
  const unidades = items.reduce((s, i) => s + (i.cantidad ?? 0), 0)

  async function exportar() {
    if (!canc) return
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    const filas = items.map((i) => ({
      Artículo: i.articulo ?? '',
      Descripción: i.descripcion ?? '',
      Color: [i.color, i.color_nombre].filter(Boolean).join(' '),
      Talle: i.talle ?? '',
      Cantidad: i.cantidad ?? 0,
      Precio: i.precio ?? 0,
      Monto: (i.cantidad ?? 0) * (i.precio ?? 0),
    }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas), 'Cancelación')
    XLSX.writeFile(wb, `cancelacion_venta_${canc.numero ?? canc.codigo}.xlsx`)
  }

  const campo = (titulo: string, valor: React.ReactNode, clase = '') => (
    <div className={`min-w-0 ${clase}`}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-sub">{titulo}</p>
      <div className="mt-0.5 text-sm font-semibold text-ink">{valor || '—'}</div>
    </div>
  )

  return (
    <Layout>
      <BackButton />
      <header className="mb-3 mt-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">Cancelaciones de venta</h1>
          <p className="text-sm text-sub">
            {delPeriodo.length} cancelaciones · {n0.format(delPeriodo.reduce((s, c) => s + (c.unidades ?? 0), 0))} unidades
            {actualizado && ` · actualizado ${new Date(actualizado).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}`}
          </p>
        </div>
        <button
          onClick={() => void actualizarDatos()}
          disabled={forzando}
          className="btn-press inline-flex h-10 items-center gap-1.5 rounded-xl bg-amber-600 px-4 text-sm font-semibold text-white shadow-soft transition hover:bg-amber-700 disabled:opacity-60"
          title="Trae del SQL los pedidos de los últimos 7 días y las cancelaciones de los últimos 2 (tarda unos segundos)"
        >
          <RefreshCw size={15} aria-hidden className={forzando ? 'animate-spin' : ''} />
          {forzando ? 'Actualizando…' : 'Actualizar datos'}
        </button>
      </header>

      {avisoSync && (
        <p role="status" className={`mb-3 rounded-xl border p-3 text-sm ${avisoSync.ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : 'border-brand-600/30 bg-brand-600/10 text-brand-400'}`}>
          {avisoSync.texto}
        </p>
      )}
      {error && <p role="alert" className="mb-3 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>}

      <div role="tablist" aria-label="Período" className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
        {PERIODOS.map((p) => (
          <button
            key={p.id}
            role="tab"
            aria-selected={periodo === p.id}
            onClick={() => setPeriodo(p.id)}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
              periodo === p.id ? 'border-amber-500/50 bg-amber-500/15 text-amber-500' : 'border-line text-sub hover:border-line2 hover:text-ink'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div role="tablist" aria-label="Hecha por" className="mb-3 flex items-center gap-1.5 overflow-x-auto pb-1">
        <span className="shrink-0 text-xs font-medium text-sub">Hecha por:</span>
        {chips.map((m) => {
          const activo = filtro === m.clave
          return (
            <button
              key={m.clave || 'todas'}
              role="tab"
              aria-selected={activo}
              onClick={() => setFiltro(m.clave)}
              className="shrink-0 rounded-full border border-line px-3 py-1.5 text-xs font-medium transition"
              style={activo ? { borderColor: `${m.color}80`, backgroundColor: `${m.color}26`, color: m.color } : undefined}
            >
              <span className={activo ? '' : 'text-sub'}>{m.nombre}</span>
              <span className="ml-1.5 tabular-nums opacity-70">{m.n.toLocaleString('es-AR')}</span>
            </button>
          )
        })}
      </div>

      <div className="grid gap-4 pb-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
        {/* ---------- Lista ---------- */}
        <aside className={`${sel ? 'hidden lg:block' : ''} min-w-0`}>
          <div className="relative mb-2">
            <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub" />
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Número, cliente, pedido, remito…"
              aria-label="Buscar cancelación"
              className="h-11 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-sm text-ink outline-none transition placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40"
            />
          </div>
          <div className="overflow-hidden rounded-2xl border border-line bg-surface lg:max-h-[calc(100vh-15rem)] lg:overflow-y-auto">
            {cargando && lista.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sub"><Loader2 size={16} className="animate-spin" aria-hidden /> Cargando…</div>
            ) : visibles.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-sub">No hay cancelaciones que coincidan.</p>
            ) : (
              <ul className="divide-y divide-line/60">
                {visibles.map((c) => {
                  const activo = c.codigo === sel
                  const peds = numerosDe(c, PEDIDO)
                  const rems = numerosDe(c, REMITO)
                  const color = colorDe(c.usuario)
                  return (
                    <li key={c.codigo}>
                      <button onClick={() => setSel(c.codigo)} className={`flex w-full items-start gap-3 px-3 py-2.5 text-left transition ${activo ? 'bg-amber-500/15' : 'hover:bg-surface2'}`}>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className={`min-w-0 max-w-full truncate font-display text-[15px] font-bold leading-tight ${activo ? 'text-amber-500' : 'text-ink'}`}>
                              {c.cliente_nombre || c.cliente || '—'}
                            </span>
                            {c.anulado && <span className="rounded-md bg-brand-600/15 px-1.5 py-0.5 text-[10px] font-semibold text-brand-400">ANULADA</span>}
                          </span>
                          <span className="block text-xs font-semibold tabular-nums text-sub">N° {c.numero ?? '—'}</span>
                          {peds.length > 0 && <span className="block truncate text-[11px] text-sub">Cancela pedido N° {peds.join(', ')}</span>}
                          {rems.length > 0 && <span className="block truncate text-[11px] text-sub">Afecta remito N° {rems.join(', ')}</span>}
                          {!c.afecta.length && <span className="block text-[11px] font-medium text-red-400">Sin vínculo (no cancela nada)</span>}
                          <span className="flex items-center gap-1.5 text-[11px] text-sub">
                            {fechaCorta(c.fecha)}
                            <span className="truncate rounded-md px-1.5 py-px text-[10px] font-semibold" style={{ color, backgroundColor: `${color}1f` }}>
                              {c.usuario || '—'}
                            </span>
                          </span>
                        </span>
                        <span className="shrink-0 text-right text-xs font-semibold tabular-nums text-ink">{n0.format(c.unidades ?? 0)} u.</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </aside>

        {/* ---------- Detalle (formato comprobante) ---------- */}
        <section className={`${sel ? '' : 'hidden lg:block'} min-w-0`}>
          {!canc ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-line bg-surface/50 px-4 py-16 text-center text-sub">
              <Ban size={28} aria-hidden />
              Elegí una cancelación de la lista.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => setSel(null)} className="inline-flex h-10 items-center gap-1 rounded-xl px-2 text-sm font-medium text-sub hover:text-ink lg:hidden">
                  <ArrowLeft size={16} aria-hidden /> Cancelaciones
                </button>
                <div className="ml-auto flex flex-wrap items-center gap-1.5">
                  <button onClick={() => ir(-1)} disabled={idx <= 0} aria-label="Cancelación anterior" title="Anterior (más nueva)"
                    className="btn-press flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface text-ink transition hover:bg-surface2 disabled:opacity-40">
                    <ChevronLeft size={18} aria-hidden />
                  </button>
                  <button onClick={() => ir(1)} disabled={idx === -1 || idx >= visibles.length - 1} aria-label="Cancelación siguiente" title="Siguiente (más vieja)"
                    className="btn-press flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface text-ink transition hover:bg-surface2 disabled:opacity-40">
                    <ChevronRight size={18} aria-hidden />
                  </button>
                  <button onClick={() => void exportar()} disabled={items.length === 0}
                    className="btn-press inline-flex h-10 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-sm font-medium text-ink transition hover:bg-surface2 disabled:opacity-50">
                    <Download size={15} aria-hidden /> Excel
                  </button>
                  {/* Solo admin. Desactivado hasta que la API de Dragon permita anular (DELETE /Devolucion/ responde 400) */}
                  {isAdmin && (
                    <button
                      disabled
                      title="Todavía no se puede: la API de Dragon no deja anular cancelaciones (lo tiene que habilitar Zoo Logic). Se anula desde Dragon."
                      className="inline-flex h-10 cursor-not-allowed items-center gap-1.5 rounded-xl border border-brand-600/40 bg-brand-600/10 px-3 text-sm font-semibold text-brand-400 opacity-50"
                    >
                      <Undo2 size={15} aria-hidden /> Anular en Dragon
                    </button>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-line bg-surface p-4 shadow-soft">
                <div className="flex flex-wrap items-start gap-4">
                  <div className="grid min-w-0 flex-1 grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                    {campo('Cliente', <><span className="text-amber-500">{canc.cliente}</span>{canc.cliente_nombre && <span className="ml-1.5 font-medium">{canc.cliente_nombre}</span>}</>, 'col-span-2')}
                    {campo('Usuario', canc.usuario)}
                    {campo(
                      'Comprobantes que afecta',
                      canc.afecta.length ? (
                        <ul className="space-y-0.5">
                          {canc.afecta.map((a) => (
                            <li key={`${a.codigo}-${a.numero}`} className="text-amber-500">
                              {a.tipo === PEDIDO ? (
                                <Link to={`/mayorista/pedidos-venta?abrir=${encodeURIComponent(a.codigo)}`} className="inline-flex items-center gap-1 hover:underline">
                                  {a.comprobante} <ExternalLink size={12} aria-hidden />
                                </Link>
                              ) : (
                                a.comprobante
                              )}
                              <span className="ml-1.5 text-xs font-medium text-sub">· {fechaCorta(a.fecha)} · $ {plata(a.total)}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-red-400">Ninguno: no está atada a ningún comprobante</span>
                      ),
                      'col-span-2',
                    )}
                    {campo('Líneas', items.length || '—')}
                    {campo('Observación', <span className="font-medium">{canc.observacion}</span>, 'col-span-2 sm:col-span-3')}
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl border-2 border-ink/80 font-display text-2xl font-bold text-ink">X</div>
                    <div className="space-y-2 text-right">
                      <div><p className="text-[11px] font-medium uppercase tracking-wide text-sub">Número</p><p className="font-mono text-sm font-semibold text-ink">{numeroComprobante(canc.numero)}</p></div>
                      <div><p className="text-[11px] font-medium uppercase tracking-wide text-sub">Fecha</p><p className="text-sm font-semibold tabular-nums text-ink">{fechaCorta(canc.fecha)}</p></div>
                      <div><p className="text-[11px] font-medium uppercase tracking-wide text-sub">Hora</p><p className="text-sm font-semibold tabular-nums text-ink">{canc.hora || '—'}</p></div>
                      <div>
                        <p className="text-[11px] font-medium uppercase tracking-wide text-sub">Motivo</p>
                        <p className={`text-sm ${canc.motivo ? 'font-semibold text-ink' : 'font-medium text-sub'}`}>
                          {canc.motivo ? `${canc.motivo} · ${canc.motivo_nombre ?? ''}` : 'Sin motivo'}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {canc.anulado && <span className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600/15 px-2.5 py-1 text-xs font-semibold text-brand-400"><Ban size={13} aria-hidden /> Cancelación anulada</span>}
                  {numerosDe(canc, PEDIDO).length > 0 && (
                    <span className="rounded-lg bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400">
                      ✓ Bajó el pendiente del pedido{numerosDe(canc, PEDIDO).length > 1 ? ` (${numerosDe(canc, PEDIDO).length} pedidos)` : ''}
                    </span>
                  )}
                  {numerosDe(canc, REMITO).length > 0 && (
                    <span className="rounded-lg bg-teal-500/15 px-2.5 py-1 text-xs font-semibold text-teal-300">
                      ↩ Afecta {numerosDe(canc, REMITO).length} remito{numerosDe(canc, REMITO).length > 1 ? 's' : ''} de venta
                    </span>
                  )}
                  {!canc.afecta.length && (
                    <span className="rounded-lg bg-red-500/15 px-2.5 py-1 text-xs font-semibold text-red-400">⚠ Sin vínculo: no cancela nada y puede mover stock</span>
                  )}
                </div>
              </div>

              <div className="overflow-hidden rounded-2xl border border-line bg-surface">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[46rem] text-sm">
                    <thead>
                      <tr className="border-b border-line bg-surface2 text-left text-[11px] font-semibold uppercase tracking-wide text-sub">
                        <th className="px-3 py-2">Artículo</th>
                        <th className="px-3 py-2">Descripción</th>
                        <th className="px-3 py-2">Color</th>
                        <th className="px-3 py-2">Talle</th>
                        <th className="px-3 py-2 text-right">Cantidad</th>
                        <th className="px-3 py-2 text-right">Precio</th>
                        <th className="px-3 py-2 text-right">Monto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cargandoItems ? (
                        <tr><td colSpan={7} className="px-3 py-8 text-center text-sub"><Loader2 size={16} className="mr-2 inline animate-spin" aria-hidden />Cargando renglones…</td></tr>
                      ) : items.length === 0 ? (
                        <tr><td colSpan={7} className="px-3 py-8 text-center text-sub">Sin renglones.</td></tr>
                      ) : (
                        items.map((i) => (
                          <tr key={i.linea} className="border-b border-line/50">
                            <td className="whitespace-nowrap px-3 py-1.5 font-semibold text-ink">{i.articulo}</td>
                            <td className="max-w-[18rem] truncate px-3 py-1.5 text-ink/90" title={i.descripcion ?? ''}>{i.descripcion || '—'}</td>
                            <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-sub">{[i.color, i.color_nombre].filter(Boolean).join(' ')}</td>
                            <td className="px-3 py-1.5 text-sub">{i.talle}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-ink">{n0.format(i.cantidad ?? 0)}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-ink">{plata(i.precio)}</td>
                            <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-ink">{plata((i.cantidad ?? 0) * (i.precio ?? 0))}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                    {items.length > 0 && (
                      <tfoot>
                        <tr className="border-t border-line font-semibold">
                          <td colSpan={4} className="px-3 py-2 text-sub">Items: {items.length}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-ink">{n0.format(unidades)}</td>
                          <td />
                          <td className="px-3 py-2 text-right tabular-nums text-ink">{plata(neto)}</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>

              <div className="rounded-2xl border border-line bg-surface p-4 shadow-soft">
                <div className="ml-auto max-w-xs space-y-1.5">
                  <div className="flex justify-between text-sm"><span className="text-sub">Suma de líneas</span><span className="font-semibold tabular-nums text-ink">$ {plata(neto)}</span></div>
                  <div className="mt-2 flex items-baseline justify-between border-t border-line pt-2">
                    <span className="font-display text-lg font-bold text-ink">Total</span>
                    <span className="font-display text-2xl font-bold tabular-nums text-amber-500">$ {plata(canc.total)}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </Layout>
  )
}
