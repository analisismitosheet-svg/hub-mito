import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Search, RefreshCw, ChevronRight, ExternalLink, Users } from 'lucide-react'
import { Link } from 'react-router-dom'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { supabase } from '@/lib/supabase'

/* ------------------------------------------------------------------ */
/*  Estado de pedidos (Mayorista)                                      */
/*  Saldo correcto de cada cliente: los pedidos de venta de Dragonfish */
/*  MITO con saldo pendiente (sql/estado_pedidos_venta.sql), y por     */
/*  línea cómo se llegó: pedido − remitido − facturado − preparado −   */
/*  cancelado = pendiente (AFESALDO de Dragon). La actualiza           */
/*  puente-sql/scripts/sync-estado-pedidos.js al final de la copia de  */
/*  pedidos de venta (cada 15 minutos). Solo lectura.                  */
/* ------------------------------------------------------------------ */

interface Comprobante {
  tipo: number // 11 remito, 1 factura, 57 preparación, 12 cancelación
  numero: number
}

interface PedidoEstado {
  codigo: string
  numero: number | null
  fecha: string | null
  cliente: string | null
  cliente_nombre: string | null
  motivo: string | null
  motivo_nombre: string | null
  lineas: number
  lineas_saldo: number
  u_pedido: number
  u_remitido: number
  u_facturado: number
  u_preparado: number
  u_cancelado: number
  u_saldo: number
  pesos_saldo: number
  comprobantes: Comprobante[]
}

interface Linea {
  linea: number
  articulo: string | null
  descripcion: string | null
  color: string | null
  color_nombre: string | null
  talle: string | null
  pedido: number
  remitido: number
  facturado: number
  preparado: number
  cancelado: number
  saldo: number
  precio: number
}

interface Cliente {
  cliente: string
  nombre: string
  pedidos: PedidoEstado[]
  saldo: number
  pesos: number
}

/** Qué se suma en cada columna y su color (mismo orden en barra, números y tabla) */
const PARTES = [
  { k: 'remitido', titulo: 'Remitido', color: '#22c55e' },
  { k: 'facturado', titulo: 'Facturado', color: '#38bdf8' },
  { k: 'preparado', titulo: 'Preparado', color: '#a78bfa' },
  { k: 'cancelado', titulo: 'Cancelado', color: '#f87171' },
  { k: 'saldo', titulo: 'Pendiente', color: '#f59e0b' },
] as const
const TIPOS: Record<number, { nombre: string; color: string }> = {
  11: { nombre: 'Remito', color: '#22c55e' },
  1: { nombre: 'Factura', color: '#38bdf8' },
  57: { nombre: 'Preparación', color: '#a78bfa' },
  12: { nombre: 'Cancelación', color: '#f87171' },
}
const SIN_MOTIVO = '_sin'
const COLORES_MOTIVO = ['#38bdf8', '#a78bfa', '#2dd4bf', '#f472b6', '#facc15']

const $ = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const n0 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 })
const plata = (v: number | null | undefined) => (v == null ? '—' : $.format(v))
const fechaCorta = (f: string | null) => (f ? f.split('-').reverse().join('/') : '—')
const claveMotivo = (p: PedidoEstado) => p.motivo || SIN_MOTIVO
const totalDe = (ps: PedidoEstado[], k: keyof PedidoEstado) => ps.reduce((s, p) => s + (Number(p[k]) || 0), 0)
/** Primero los clientes con número (00005, 00110…) de menor a mayor; después los de letras (locales) */
const esNumero = (s: string) => /^\d+$/.test(s)
const porNumeroCliente = (a: Cliente, b: Cliente) =>
  Number(esNumero(b.cliente)) - Number(esNumero(a.cliente)) ||
  (esNumero(a.cliente) ? Number(a.cliente) - Number(b.cliente) : a.cliente.localeCompare(b.cliente, 'es'))

function Barra({ p }: { p: PedidoEstado }) {
  const total = p.u_pedido || 1
  const valores = [p.u_remitido, p.u_facturado, p.u_preparado, p.u_cancelado, p.u_saldo]
  return (
    <div className="hidden h-2 w-40 shrink-0 overflow-hidden rounded-full bg-line sm:flex" aria-hidden>
      {PARTES.map((x, i) => (
        <i key={x.k} className="block h-full" style={{ width: `${(valores[i] / total) * 100}%`, backgroundColor: x.color }} />
      ))}
    </div>
  )
}

export default function EstadoPedidosVenta() {
  const [pedidos, setPedidos] = useState<PedidoEstado[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actualizado, setActualizado] = useState<string | null>(null)
  const [fMotivo, setFMotivo] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [sel, setSel] = useState<string | null>(null)
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set())
  const [lineas, setLineas] = useState<Record<string, Linea[]>>({})
  const [soloSaldo, setSoloSaldo] = useState(true)
  const [forzando, setForzando] = useState(false)
  const [avisoSync, setAvisoSync] = useState<{ ok: boolean; texto: string } | null>(null)

  const cargar = useCallback(async () => {
    if (!supabase) return
    setCargando(true)
    setError(null)
    try {
      const { data, error: e } = await supabase
        .from('estado_pedidos')
        .select('codigo,numero,fecha,cliente,cliente_nombre,motivo,motivo_nombre,lineas,lineas_saldo,u_pedido,u_remitido,u_facturado,u_preparado,u_cancelado,u_saldo,pesos_saldo,comprobantes')
        .order('numero', { ascending: false })
        .limit(5000)
      if (e) throw e
      setPedidos((data ?? []) as PedidoEstado[])
      setLineas({})
      const { data: s } = await supabase.from('estado_pedidos_sync').select('ultima_at').maybeSingle()
      setActualizado((s as { ultima_at: string | null } | null)?.ultima_at ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar el estado de los pedidos.')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  async function actualizarDatos() {
    if (!supabase || forzando) return
    setForzando(true)
    setAvisoSync(null)
    try {
      const { data } = await supabase.auth.getSession()
      // El estado de pedidos se copia al final de la copia de pedidos de venta
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

  // Motivos con su cantidad de pedidos (para los chips)
  const motivos = useMemo(() => {
    const m = new Map<string, { clave: string; nombre: string; n: number }>()
    for (const p of pedidos) {
      const clave = claveMotivo(p)
      const actual = m.get(clave) ?? { clave, nombre: p.motivo ? `${p.motivo} · ${p.motivo_nombre ?? ''}` : 'Sin motivo', n: 0 }
      actual.n++
      m.set(clave, actual)
    }
    return [...m.values()].sort((a, b) => Number(a.clave === SIN_MOTIVO) - Number(b.clave === SIN_MOTIVO) || a.clave.localeCompare(b.clave))
  }, [pedidos])
  const colorMotivo = (clave: string) =>
    clave === SIN_MOTIVO ? '#94a3b8' : COLORES_MOTIVO[Math.max(0, motivos.findIndex((m) => m.clave === clave)) % COLORES_MOTIVO.length]

  // Búsqueda por artículo: se busca en las líneas (código o descripción) y se marcan los pedidos que lo tienen
  const q = busqueda.trim().toLowerCase()
  const [conArticulo, setConArticulo] = useState<Set<string> | null>(null)
  const [buscandoArticulo, setBuscandoArticulo] = useState(false)
  useEffect(() => {
    const limpio = q.replace(/[,()*%\\]/g, ' ').trim()
    if (!supabase || limpio.length < 3) {
      setConArticulo(null)
      return
    }
    let vivo = true
    const t = setTimeout(() => {
      setBuscandoArticulo(true)
      void supabase!
        .from('estado_pedidos_items')
        .select('codigo')
        .or(`articulo.ilike.%${limpio}%,descripcion.ilike.%${limpio}%`)
        .limit(5000)
        .then(({ data }) => {
          if (!vivo) return
          setConArticulo(new Set((data ?? []).map((r) => (r as { codigo: string }).codigo)))
          setBuscandoArticulo(false)
        })
    }, 300)
    return () => {
      vivo = false
      clearTimeout(t)
    }
  }, [q])

  // Clientes (con los pedidos del motivo elegido), ordenados por número de cliente
  const clientes = useMemo(() => {
    const m = new Map<string, Cliente>()
    for (const p of pedidos) {
      if (fMotivo && claveMotivo(p) !== fMotivo) continue
      const k = p.cliente || '—'
      const c = m.get(k) ?? { cliente: k, nombre: p.cliente_nombre || k, pedidos: [], saldo: 0, pesos: 0 }
      c.pedidos.push(p)
      c.saldo += p.u_saldo
      c.pesos += p.pesos_saldo
      m.set(k, c)
    }
    return [...m.values()].sort(porNumeroCliente)
  }, [pedidos, fMotivo])

  const visibles = useMemo(
    () =>
      clientes.filter(
        (c) =>
          !q ||
          `${c.cliente} ${c.nombre} ${c.pedidos.map((p) => p.numero).join(' ')}`.toLowerCase().includes(q) ||
          c.pedidos.some((p) => conArticulo?.has(p.codigo)),
      ),
    [clientes, q, conArticulo],
  )

  const cliente = clientes.find((c) => c.cliente === sel) ?? null

  // Líneas de un pedido: se piden al abrirlo (o cuando la búsqueda por artículo lo encuentra)
  const pedirLineas = useCallback(
    async (codigo: string) => {
      if (!supabase || lineas[codigo]) return
      const todas: Linea[] = []
      for (let desde = 0; ; desde += 1000) {
        const { data } = await supabase
          .from('estado_pedidos_items')
          .select('linea,articulo,descripcion,color,color_nombre,talle,pedido,remitido,facturado,preparado,cancelado,saldo,precio')
          .eq('codigo', codigo)
          .order('linea')
          .range(desde, desde + 999)
        todas.push(...((data ?? []) as Linea[]))
        if (!data || data.length < 1000) break
      }
      setLineas((l) => ({ ...l, [codigo]: todas }))
    },
    [lineas],
  )
  const abiertosAhora = useMemo(() => {
    const s = new Set(abiertos)
    if (conArticulo && cliente) for (const p of cliente.pedidos) if (conArticulo.has(p.codigo)) s.add(p.codigo)
    return s
  }, [abiertos, conArticulo, cliente])
  useEffect(() => {
    for (const c of abiertosAhora) void pedirLineas(c)
  }, [abiertosAhora, pedirLineas])

  const alternar = (codigo: string) =>
    setAbiertos((a) => {
      const s = new Set(a)
      if (s.has(codigo)) s.delete(codigo)
      else s.add(codigo)
      return s
    })

  const filtrados = clientes.flatMap((c) => c.pedidos)
  const kpi = (titulo: string, valor: number, color: string) => (
    <div key={titulo} className="rounded-2xl border border-line bg-surface px-3 py-2.5">
      <p className="text-[10.5px] font-bold uppercase tracking-wide text-sub">{titulo}</p>
      <p className="font-display text-xl font-bold tabular-nums" style={{ color }}>{n0.format(valor)}</p>
      <p className="text-[11px] text-sub">unidades</p>
    </div>
  )

  return (
    <Layout>
      <BackButton />
      <header className="mb-3 mt-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">Estado de pedidos</h1>
          <p className="text-sm text-sub">
            {clientes.length} clientes · {filtrados.length} pedidos con saldo · {n0.format(totalDe(filtrados, 'u_saldo'))} u. pendientes · $ {plata(totalDe(filtrados, 'pesos_saldo'))}
            {actualizado && ` · actualizado ${new Date(actualizado).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}`}
          </p>
        </div>
        <button
          onClick={() => void actualizarDatos()}
          disabled={forzando}
          className="btn-press inline-flex h-10 items-center gap-1.5 rounded-xl bg-amber-600 px-4 text-sm font-semibold text-white shadow-soft transition hover:bg-amber-700 disabled:opacity-60"
          title="Trae del SQL los pedidos de venta y recalcula los saldos ahora (tarda unos segundos)"
        >
          <RefreshCw size={15} aria-hidden className={forzando ? 'animate-spin' : ''} />
          {forzando ? 'Actualizando…' : 'Actualizar datos'}
        </button>
      </header>

      <p className="mb-3 rounded-xl border border-dashed border-sky-400/40 bg-sky-400/5 px-3 py-2 text-xs text-sky-200">
        Saldo = el pendiente que guarda Dragon en cada línea del pedido. Se ve cómo se llegó: <b>pedido − remitido − facturado − preparado − cancelado</b>. Solo pedidos con saldo, desde 2025.
      </p>

      {avisoSync && (
        <p role="status" className={`mb-3 rounded-xl border p-3 text-sm ${avisoSync.ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : 'border-brand-600/30 bg-brand-600/10 text-brand-400'}`}>
          {avisoSync.texto}
        </p>
      )}
      {error && <p role="alert" className="mb-3 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>}

      {motivos.length > 0 && (
        <div role="tablist" aria-label="Motivo" className="mb-3 flex items-center gap-1.5 overflow-x-auto pb-1">
          <span className="shrink-0 text-xs font-medium text-sub">Motivo:</span>
          {[{ clave: '', nombre: 'Todos', n: pedidos.length }, ...motivos].map((m) => {
            const activo = fMotivo === m.clave
            const color = m.clave ? colorMotivo(m.clave) : '#f59e0b'
            return (
              <button
                key={m.clave || 'todos'}
                role="tab"
                aria-selected={activo}
                onClick={() => {
                  setFMotivo(m.clave)
                  setAbiertos(new Set())
                }}
                className="shrink-0 rounded-full border border-line px-3 py-1.5 text-xs font-medium transition"
                style={activo ? { borderColor: `${color}80`, backgroundColor: `${color}26`, color } : undefined}
              >
                <span className={activo ? '' : 'text-sub'}>{m.nombre}</span>
                <span className="ml-1.5 tabular-nums opacity-70">{m.n.toLocaleString('es-AR')}</span>
              </button>
            )
          })}
        </div>
      )}

      <div className="grid gap-4 pb-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
        {/* ---------- Clientes ---------- */}
        <aside className={`${sel ? 'hidden lg:block' : ''} min-w-0`}>
          <div className="relative mb-2">
            <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub" />
            {buscandoArticulo && <Loader2 size={15} aria-label="Buscando en los artículos" className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-sub" />}
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Cliente, N° de pedido, artículo…"
              aria-label="Buscar"
              className="h-11 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-sm text-ink outline-none transition placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40"
            />
          </div>
          <div className="overflow-hidden rounded-2xl border border-line bg-surface lg:max-h-[calc(100vh-17rem)] lg:overflow-y-auto">
            {cargando && pedidos.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sub"><Loader2 size={16} className="animate-spin" aria-hidden /> Cargando…</div>
            ) : visibles.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-sub">Nada que coincida.</p>
            ) : (
              <ul className="divide-y divide-line/60">
                {visibles.map((c) => {
                  const activo = c.cliente === sel
                  return (
                    <li key={c.cliente}>
                      <button onClick={() => { setSel(c.cliente); setAbiertos(new Set()) }} className={`flex w-full items-start gap-3 px-3 py-2.5 text-left transition ${activo ? 'bg-amber-500/15' : 'hover:bg-surface2'}`}>
                        <span className="min-w-0 flex-1">
                          <span className={`block truncate font-display text-[15px] font-bold leading-tight ${activo ? 'text-amber-500' : 'text-ink'}`}>{c.nombre}</span>
                          <span className="block text-xs font-semibold text-sub">Cliente {c.cliente} · {c.pedidos.length} pedido{c.pedidos.length > 1 ? 's' : ''}</span>
                          <span className="block text-[11px] font-semibold text-amber-500">{n0.format(c.saldo)} u. pendientes</span>
                        </span>
                        <span className="shrink-0 text-right text-xs font-semibold tabular-nums text-amber-500">$ {n0.format(Math.round(c.pesos))}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </aside>

        {/* ---------- Cliente ---------- */}
        <section className={`${sel ? '' : 'hidden lg:block'} min-w-0`}>
          {!cliente ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-line bg-surface/50 px-4 py-16 text-center text-sub">
              <Users size={28} aria-hidden />
              Elegí un cliente de la lista.
            </div>
          ) : (
            <div className="space-y-3">
              <button onClick={() => setSel(null)} className="inline-flex h-10 items-center gap-1 rounded-xl px-2 text-sm font-medium text-sub hover:text-ink lg:hidden">
                ‹ Clientes
              </button>
              <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-line bg-surface p-4 shadow-soft">
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-sub">Cliente</p>
                  <p className="font-display text-lg font-bold text-ink"><span className="text-amber-500">{cliente.cliente}</span> {cliente.nombre}</p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-sub">Saldo pendiente</p>
                  <p className="font-display text-2xl font-extrabold tabular-nums text-amber-500">$ {plata(cliente.pesos)}</p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
                {kpi('Pedido', totalDe(cliente.pedidos, 'u_pedido'), 'var(--ink)')}
                {kpi('Remitido', totalDe(cliente.pedidos, 'u_remitido'), PARTES[0].color)}
                {kpi('Facturado', totalDe(cliente.pedidos, 'u_facturado'), PARTES[1].color)}
                {kpi('Preparado', totalDe(cliente.pedidos, 'u_preparado'), PARTES[2].color)}
                {kpi('Cancelado', totalDe(cliente.pedidos, 'u_cancelado'), PARTES[3].color)}
                {kpi('Pendiente', totalDe(cliente.pedidos, 'u_saldo'), PARTES[4].color)}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-3 text-[11px] text-sub">
                  {PARTES.map((x) => (
                    <span key={x.k} className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: x.color }} />{x.titulo}</span>
                  ))}
                </div>
                <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-sub">
                  <input type="checkbox" checked={soloSaldo} onChange={(e) => setSoloSaldo(e.target.checked)} className="h-4 w-4 accent-amber-500" />
                  Ver solo las líneas con saldo
                </label>
              </div>

              {[...cliente.pedidos].sort((a, b) => (b.numero ?? 0) - (a.numero ?? 0)).map((p) => {
                const abierto = abiertosAhora.has(p.codigo)
                const colorMot = colorMotivo(claveMotivo(p))
                const ls = (lineas[p.codigo] ?? []).filter((l) => !soloSaldo || l.saldo > 0)
                const valores: Record<string, number> = { remitido: p.u_remitido, facturado: p.u_facturado, cancelado: p.u_cancelado, saldo: p.u_saldo }
                return (
                  <div key={p.codigo} className="overflow-hidden rounded-2xl border border-line bg-surface">
                    <button onClick={() => alternar(p.codigo)} className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left transition hover:bg-surface2">
                      <ChevronRight size={16} aria-hidden className={`shrink-0 text-sub transition ${abierto ? 'rotate-90' : ''}`} />
                      <span className="min-w-0 flex-1">
                        <span className="font-display text-[15px] font-bold text-ink">Pedido N° {p.numero}</span>
                        <span className="ml-2 rounded-md px-1.5 py-px text-[10px] font-semibold" style={{ color: colorMot, backgroundColor: `${colorMot}1f` }}>
                          {p.motivo ? `${p.motivo} · ${p.motivo_nombre ?? ''}` : 'Sin motivo'}
                        </span>
                        <span className="block text-xs text-sub">
                          del {fechaCorta(p.fecha)} · {p.lineas} líneas · <b className="text-amber-500">{n0.format(p.u_saldo)} u. · $ {plata(p.pesos_saldo)} pendiente</b>
                        </span>
                      </span>
                      <span className="hidden gap-4 text-[11px] text-sub md:flex">
                        <span className="text-right"><b className="block font-display text-sm tabular-nums text-ink">{n0.format(p.u_pedido)}</b>Pedido</span>
                        {[PARTES[0], PARTES[1], PARTES[3], PARTES[4]].map((x) => (
                          <span key={x.k} className="text-right"><b className="block font-display text-sm tabular-nums" style={{ color: x.color }}>{n0.format(valores[x.k])}</b>{x.titulo}</span>
                        ))}
                      </span>
                      <Barra p={p} />
                    </button>
                    {abierto && (
                      <div className="border-t border-line">
                        <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-2 text-xs text-sub">
                          Descontaron:
                          {p.comprobantes.length === 0 ? (
                            <span>nada todavía</span>
                          ) : (
                            p.comprobantes.map((c) => {
                              const t = TIPOS[c.tipo] ?? { nombre: `Tipo ${c.tipo}`, color: '#94a3b8' }
                              return (
                                <span key={`${c.tipo}-${c.numero}`} className="rounded-md bg-surface2 px-1.5 py-px text-[10px] font-semibold" style={{ color: t.color }}>
                                  {t.nombre} N° {c.numero}
                                </span>
                              )
                            })
                          )}
                          <Link to={`/mayorista/pedidos-venta?abrir=${encodeURIComponent(p.codigo)}`} className="ml-auto inline-flex items-center gap-1 font-semibold text-amber-500 hover:underline">
                            Ver pedido <ExternalLink size={12} aria-hidden />
                          </Link>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[60rem] text-sm">
                            <thead>
                              <tr className="border-b border-line bg-surface2 text-left text-[11px] font-semibold uppercase tracking-wide text-sub">
                                <th className="px-3 py-2">Artículo</th>
                                <th className="px-3 py-2">Descripción</th>
                                <th className="px-3 py-2">Color</th>
                                <th className="px-3 py-2">Talle</th>
                                <th className="px-3 py-2 text-right">Pedido</th>
                                {PARTES.map((x) => <th key={x.k} className="px-3 py-2 text-right">{x.titulo}</th>)}
                                <th className="px-3 py-2 text-right">$ Pendiente</th>
                              </tr>
                            </thead>
                            <tbody>
                              {!lineas[p.codigo] ? (
                                <tr><td colSpan={11} className="px-3 py-6 text-center text-sub"><Loader2 size={16} className="mr-2 inline animate-spin" aria-hidden />Cargando líneas…</td></tr>
                              ) : ls.length === 0 ? (
                                <tr><td colSpan={11} className="px-3 py-6 text-center text-sub">Sin líneas con saldo.</td></tr>
                              ) : (
                                ls.map((l) => (
                                  <tr key={l.linea} className={`border-b border-line/50 ${l.saldo ? '' : 'text-sub'}`}>
                                    <td className="whitespace-nowrap px-3 py-1.5 font-semibold">{l.articulo}</td>
                                    <td className="max-w-[16rem] truncate px-3 py-1.5" title={l.descripcion ?? ''}>{l.descripcion || '—'}</td>
                                    <td className="whitespace-nowrap px-3 py-1.5 text-sub">{[l.color, l.color_nombre].filter(Boolean).join(' ')}</td>
                                    <td className="px-3 py-1.5 text-sub">{l.talle}</td>
                                    <td className="px-3 py-1.5 text-right tabular-nums">{n0.format(l.pedido)}</td>
                                    {PARTES.map((x) => (
                                      <td key={x.k} className={`px-3 py-1.5 text-right tabular-nums ${x.k === 'saldo' ? 'font-extrabold' : ''}`} style={{ color: x.color }}>
                                        {l[x.k] ? n0.format(l[x.k]) : x.k === 'saldo' ? '—' : ''}
                                      </td>
                                    ))}
                                    <td className="px-3 py-1.5 text-right tabular-nums">{l.saldo ? plata(l.saldo * l.precio) : ''}</td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                            {ls.length > 0 && (
                              <tfoot>
                                <tr className="border-t border-line font-semibold">
                                  <td colSpan={4} className="px-3 py-2 text-sub">Líneas: {ls.length}{soloSaldo ? ` de ${p.lineas}` : ''}</td>
                                  <td className="px-3 py-2 text-right tabular-nums">{n0.format(ls.reduce((s, l) => s + l.pedido, 0))}</td>
                                  {PARTES.map((x) => (
                                    <td key={x.k} className="px-3 py-2 text-right tabular-nums" style={{ color: x.color }}>{n0.format(ls.reduce((s, l) => s + l[x.k], 0))}</td>
                                  ))}
                                  <td className="px-3 py-2 text-right tabular-nums">{plata(ls.reduce((s, l) => s + l.saldo * l.precio, 0))}</td>
                                </tr>
                              </tfoot>
                            )}
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </Layout>
  )
}
