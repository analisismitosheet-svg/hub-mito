import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, ChevronDown, Loader2, Package, Receipt, RefreshCw, Search, ShoppingBag, Wallet } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { supabase } from '@/lib/supabase'
import { coloresUnicos } from '@/lib/coloresUnicos'

/**
 * Administradores > Ventas web.
 *
 * Pedidos de la tienda Tiendanube (Indonesiashop). Los copia a Supabase
 * puente-sql/scripts/sync-tiendanube.js desde la PC central cada 20 minutos
 * (tablas tn_pedidos / tn_pedidos_items, sql/tiendanube.sql). El resumen lo
 * agrupa la base (RPC tn_ventas_resumen); la pantalla no sondea: carga al
 * abrir, al cambiar el rango o con "Recargar".
 * "Vendido" = pago aprobado y pedido no cancelado.
 */

interface Grupo { nombre: string; pedidos: number; facturado: number }
interface Resumen {
  totales: { pedidos: number; vendidos: number; facturado: number; unidades: number; envios: number; descuentos: number; pendientes: number; cancelados: number }
  por_dia: { dia: string; pedidos: number; facturado: number }[]
  por_medio: Grupo[]
  por_envio: Grupo[]
  por_provincia: Grupo[]
  top_productos: { nombre: string | null; sku: string | null; unidades: number; facturado: number }[]
}
interface Pedido {
  id: number
  numero: number | null
  creado_at: string
  estado: string | null
  estado_pago: string | null
  estado_envio: string | null
  total: number | null
  medio_pago: string | null
  envio_opcion: string | null
  cliente: string | null
  provincia: string | null
  unidades: number | null
}
interface Item { linea: number; sku: string | null; nombre: string | null; variante: string | null; cantidad: number | null; precio: number | null }

const PESOS = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })
const N0 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })
const pesos = (v: number | null | undefined) => PESOS.format(Number(v ?? 0))
const iso = (d: Date) => d.toLocaleDateString('sv-SE')
const diaCorto = (f: string) => f.slice(8, 10) + '/' + f.slice(5, 7)
/** Límite de un día en hora de Córdoba, para filtrar creado_at */
const inicioDia = (f: string) => `${f}T00:00:00-03:00`

const ESTADO_PAGO: Record<string, string> = {
  paid: 'Pagado', pending: 'Pendiente', authorized: 'Autorizado', refunded: 'Devuelto',
  voided: 'Anulado', abandoned: 'Abandonado', partially_paid: 'Pago parcial', partially_refunded: 'Devuelto parcial',
}
const PRESETS = [
  { id: 'hoy', texto: 'Hoy' },
  { id: '7', texto: '7 días' },
  { id: 'mes', texto: 'Este mes' },
  { id: 'mesant', texto: 'Mes anterior' },
] as const

function rangoDe(p: (typeof PRESETS)[number]['id']): [string, string] {
  const hoy = new Date()
  if (p === 'hoy') return [iso(hoy), iso(hoy)]
  if (p === '7') return [iso(new Date(hoy.getTime() - 6 * 86400000)), iso(hoy)]
  if (p === 'mes') return [iso(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), iso(hoy)]
  return [iso(new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1)), iso(new Date(hoy.getFullYear(), hoy.getMonth(), 0))]
}

export default function VentasWeb() {
  const [[desde, hasta], setRango] = useState<[string, string]>(() => rangoDe('mes'))
  const [resumen, setResumen] = useState<Resumen | null>(null)
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [actualizado, setActualizado] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [abierto, setAbierto] = useState<number | null>(null)
  const [items, setItems] = useState<Item[]>([])

  const cargar = useCallback(async () => {
    if (!supabase || !desde || !hasta || hasta < desde) return
    setCargando(true)
    setError(null)
    try {
      const hastaMas1 = iso(new Date(new Date(`${hasta}T12:00:00`).getTime() + 86400000))
      const [r, p, s] = await Promise.all([
        supabase.rpc('tn_ventas_resumen', { p_desde: desde, p_hasta: hasta }),
        supabase
          .from('tn_pedidos')
          .select('id,numero,creado_at,estado,estado_pago,estado_envio,total,medio_pago,envio_opcion,cliente,provincia,unidades')
          .gte('creado_at', inicioDia(desde))
          .lt('creado_at', inicioDia(hastaMas1))
          .order('creado_at', { ascending: false })
          .range(0, 999),
        supabase.from('tn_sync').select('ultima_at').maybeSingle(),
      ])
      if (r.error) throw new Error(r.error.message)
      if (p.error) throw new Error(p.error.message)
      setResumen(r.data as Resumen)
      setPedidos((p.data as Pedido[] | null) ?? [])
      setActualizado((s.data as { ultima_at: string | null } | null)?.ultima_at ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar las ventas web.')
    } finally {
      setCargando(false)
    }
  }, [desde, hasta])
  useEffect(() => { void cargar() }, [cargar])

  useEffect(() => {
    if (abierto == null || !supabase) { setItems([]); return }
    let vivo = true
    void supabase
      .from('tn_pedidos_items')
      .select('linea,sku,nombre,variante,cantidad,precio')
      .eq('pedido_id', abierto)
      .order('linea')
      .then(({ data }) => { if (vivo) setItems((data as Item[] | null) ?? []) })
    return () => { vivo = false }
  }, [abierto])

  const q = busqueda.trim().toUpperCase()
  const visibles = useMemo(() => (!q ? pedidos : pedidos.filter((p) =>
    [String(p.numero ?? ''), p.cliente, p.medio_pago, p.envio_opcion, p.provincia, ESTADO_PAGO[p.estado_pago ?? ''] ?? p.estado_pago]
      .some((v) => String(v ?? '').toUpperCase().includes(q)))), [pedidos, q])

  const t = resumen?.totales
  const colores = coloresUnicos(['#10b981', '#0ea5e9', '#a855f7', '#f97316'])
  const tarjetas = t ? [
    { titulo: 'Facturado', valor: pesos(t.facturado), pie: `envíos ${pesos(t.envios)} · descuentos ${pesos(t.descuentos)}`, icono: Wallet },
    { titulo: 'Pedidos vendidos', valor: N0.format(t.vendidos), pie: `${N0.format(t.pedidos)} pedidos · ${N0.format(t.pendientes)} pendientes · ${N0.format(t.cancelados)} cancelados`, icono: ShoppingBag },
    { titulo: 'Ticket promedio', valor: pesos(t.vendidos ? t.facturado / t.vendidos : 0), pie: 'facturado / pedidos vendidos', icono: Receipt },
    { titulo: 'Unidades', valor: N0.format(t.unidades), pie: t.vendidos ? `${(t.unidades / t.vendidos).toFixed(1).replace('.', ',')} por pedido` : '—', icono: Package },
  ].map((x, i) => ({ ...x, color: colores[i] })) : []
  const maxDia = Math.max(1, ...(resumen?.por_dia ?? []).map((d) => d.facturado))

  const grupo = (titulo: string, filas: Grupo[] = []) => (
    <div className="min-w-0 rounded-2xl border border-line bg-surface p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-sub">{titulo}</p>
      {filas.length === 0 ? <p className="text-sm text-sub">Sin ventas.</p> : (
        <ul className="space-y-1.5 text-sm">
          {filas.slice(0, 8).map((g) => (
            <li key={g.nombre} className="flex items-baseline justify-between gap-2">
              <span className="truncate text-ink" title={g.nombre}>{g.nombre}</span>
              <span className="shrink-0 tabular-nums text-sub">{N0.format(g.pedidos)} · <span className="font-semibold text-ink">{pesos(g.facturado)}</span></span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )

  return (
    <Layout>
      <BackButton />
      <header className="mb-3 mt-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">Ventas web</h1>
          <p className="text-sm text-sub">
            Tienda Tiendanube
            {actualizado && ` · copiado ${new Date(actualizado).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })} (cada 20 min)`}
          </p>
        </div>
        <button
          onClick={() => void cargar()}
          disabled={cargando}
          className="btn-press inline-flex h-10 items-center gap-1.5 rounded-xl border border-line bg-surface px-4 text-sm font-semibold text-ink shadow-soft transition hover:bg-surface2 disabled:opacity-60"
        >
          <RefreshCw size={15} aria-hidden className={cargando ? 'animate-spin' : ''} /> Recargar
        </button>
      </header>

      {/* Rango */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-xl border border-line bg-surface p-1">
          {PRESETS.map((p) => {
            const [d, h] = rangoDe(p.id)
            const activo = d === desde && h === hasta
            return (
              <button key={p.id} type="button" onClick={() => setRango([d, h])}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${activo ? 'bg-violet-600 text-white' : 'text-sub hover:bg-surface2'}`}>
                {p.texto}
              </button>
            )
          })}
        </div>
        <label className="flex items-center gap-1.5 text-sm text-sub">
          <CalendarDays size={15} aria-hidden />
          <input type="date" value={desde} max={hasta} onChange={(e) => e.target.value && setRango([e.target.value, hasta])}
            aria-label="Desde" className="h-9 rounded-lg border border-line bg-surface px-2 text-sm text-ink" />
          a
          <input type="date" value={hasta} min={desde} onChange={(e) => e.target.value && setRango([desde, e.target.value])}
            aria-label="Hasta" className="h-9 rounded-lg border border-line bg-surface px-2 text-sm text-ink" />
        </label>
      </div>

      {error && <p role="alert" className="mb-3 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>}
      {cargando && !resumen && (
        <p className="flex items-center gap-2 rounded-xl border border-line bg-surface p-4 text-sm text-sub">
          <Loader2 size={16} className="animate-spin" aria-hidden /> Cargando ventas…
        </p>
      )}

      {resumen && (
        <div className="space-y-4 pb-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {tarjetas.map((x) => (
              <div key={x.titulo} className="rounded-2xl border border-line bg-surface p-3">
                <p className="flex items-center gap-1.5 text-xs text-sub">
                  <x.icono size={14} style={{ color: x.color }} aria-hidden /> {x.titulo}
                </p>
                <p className="mt-1 font-display text-2xl font-semibold text-ink">{x.valor}</p>
                <p className="text-[11px] text-sub/70">{x.pie}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            {/* Por día */}
            <div className="min-w-0 rounded-2xl border border-line bg-surface p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-sub">Facturado por día</p>
              {resumen.por_dia.length === 0 ? <p className="text-sm text-sub">Sin ventas en el rango.</p> : (
                <ul className="max-h-80 space-y-1 overflow-y-auto pr-1 text-sm">
                  {resumen.por_dia.map((d) => (
                    <li key={d.dia} className="grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-2">
                      <span className="tabular-nums text-sub">{diaCorto(d.dia)}</span>
                      <span className="h-3 rounded-full bg-violet-500/70" style={{ width: `${Math.max(2, (d.facturado / maxDia) * 100)}%` }} aria-hidden />
                      <span className="tabular-nums text-ink">{pesos(d.facturado)} <span className="text-sub">· {d.pedidos}</span></span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Más vendidos */}
            <div className="min-w-0 rounded-2xl border border-line bg-surface p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-sub">Productos más vendidos</p>
              {resumen.top_productos.length === 0 ? <p className="text-sm text-sub">Sin ventas en el rango.</p> : (
                <ul className="max-h-80 space-y-1.5 overflow-y-auto pr-1 text-sm">
                  {resumen.top_productos.map((p, i) => (
                    <li key={`${p.nombre}-${i}`} className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-ink" title={p.nombre ?? ''}>{p.nombre ?? p.sku ?? '—'}</span>
                      <span className="shrink-0 tabular-nums text-sub">{N0.format(p.unidades)} u · <span className="font-semibold text-ink">{pesos(p.facturado)}</span></span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {grupo('Medio de pago', resumen.por_medio)}
            {grupo('Envío o retiro', resumen.por_envio)}
            {grupo('Provincia', resumen.por_provincia)}
          </div>

          {/* Pedidos */}
          <div className="min-w-0 rounded-2xl border border-line bg-surface">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-sub">
                Pedidos ({N0.format(visibles.length)}{pedidos.length >= 1000 ? ', los últimos 1000' : ''})
              </p>
              <div className="relative w-full sm:w-72">
                <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub" />
                <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Número, cliente, pago, envío…"
                  aria-label="Buscar pedido"
                  className="h-10 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-sm text-ink outline-none placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40" />
              </div>
            </div>
            <div className="max-h-[32rem] overflow-auto">
              <table className="w-full min-w-[42rem] text-sm">
                <thead className="sticky top-0 bg-surface text-left text-[11px] uppercase tracking-wide text-sub">
                  <tr>
                    <th className="px-3 py-2">#</th><th className="px-3 py-2">Fecha</th><th className="px-3 py-2">Cliente</th>
                    <th className="px-3 py-2">Pago</th><th className="px-3 py-2">Envío</th><th className="px-3 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {visibles.map((p) => {
                    const cancelado = p.estado === 'cancelled'
                    return (
                      <Fragment key={p.id}>
                        <tr onClick={() => setAbierto(abierto === p.id ? null : p.id)} className={`cursor-pointer hover:bg-surface2 ${cancelado ? 'opacity-50' : ''}`}>
                          <td className="px-3 py-2 font-semibold text-ink">
                            <span className="inline-flex items-center gap-1">
                              <ChevronDown size={13} aria-hidden className={`text-sub transition ${abierto === p.id ? 'rotate-180' : ''}`} />{p.numero}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-sub">{new Date(p.creado_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                          <td className="max-w-[12rem] truncate px-3 py-2 text-ink">{p.cliente ?? '—'}{p.provincia && <span className="text-sub"> · {p.provincia}</span>}</td>
                          <td className="px-3 py-2">
                            <span className={p.estado_pago === 'paid' ? 'text-emerald-500' : 'text-amber-500'}>{cancelado ? 'Cancelado' : ESTADO_PAGO[p.estado_pago ?? ''] ?? p.estado_pago}</span>
                            <span className="text-sub"> · {p.medio_pago ?? '—'}</span>
                          </td>
                          <td className="max-w-[12rem] truncate px-3 py-2 text-sub">{p.envio_opcion ?? '—'}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums text-ink">{pesos(p.total)}</td>
                        </tr>
                        {abierto === p.id && (
                          <tr>
                            <td colSpan={6} className="bg-surface2 px-6 py-2">
                              {items.length === 0 ? <p className="text-sub">Cargando…</p> : (
                                <ul className="space-y-1">
                                  {items.map((i) => (
                                    <li key={i.linea} className="flex justify-between gap-3">
                                      <span className="min-w-0 truncate text-ink">{i.nombre}{i.variante && <span className="text-sub"> · {i.variante}</span>}{i.sku && <span className="text-sub/70"> · {i.sku}</span>}</span>
                                      <span className="shrink-0 tabular-nums text-sub">{N0.format(Number(i.cantidad ?? 0))} × {pesos(i.precio)}</span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
              {visibles.length === 0 && <p className="px-4 py-8 text-center text-sm text-sub">No hay pedidos en el rango.</p>}
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}
