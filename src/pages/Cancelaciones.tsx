import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Search, ChevronLeft, ChevronRight, RefreshCw, Download, PackageX, ArrowLeft } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { supabase } from '@/lib/supabase'

/* ------------------------------------------------------------------ */
/*  Cancelaciones de pedidos de compra (Compras → Pedidos)             */
/*  Copia de DWH.dbo.vw_FACT_CANCELADOS (sql/cancelaciones.sql), la    */
/*  actualiza puente-sql/scripts/sync-cancelaciones.js junto con los   */
/*  pedidos de compra (cada 1 hora o con "Actualizar datos").          */
/* ------------------------------------------------------------------ */

interface Cancelacion {
  nro: string
  numero: number | null
  proveedor: string | null
  fecha: string | null
  comprobante: string | null
  nro_pedido: string | null
  codigo_pedido: string | null
  observacion: string | null
  unidades: number
}

interface ItemCancelado {
  linea: number
  articulo: string | null
  descripcion: string | null
  color: string | null
  talle: string | null
  cantidad: number | null
}

const n0 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 })
const fechaCorta = (f: string | null) => (f ? f.split('-').reverse().join('/') : '—')
/** "PEDIDODECOMPRA X 00164-00015276" -> "X 00164-00015276" */
const pedidoCorto = (c: string | null) => (c ? c.replace(/^PEDIDODECOMPRA\s+/i, '') : '')

export default function Cancelaciones() {
  const [lista, setLista] = useState<Cancelacion[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actualizado, setActualizado] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [sel, setSel] = useState<string | null>(null)
  const [forzando, setForzando] = useState(false)
  const [avisoSync, setAvisoSync] = useState<{ ok: boolean; texto: string } | null>(null)
  const [version, setVersion] = useState(0)
  const [items, setItems] = useState<ItemCancelado[]>([])
  const [cargandoItems, setCargandoItems] = useState(false)

  const cargar = useCallback(async () => {
    if (!supabase) return
    setCargando(true)
    setError(null)
    try {
      const [{ data, error: e }, { data: sync }] = await Promise.all([
        supabase
          .from('cancelaciones')
          .select('nro,numero,proveedor,fecha,comprobante,nro_pedido,codigo_pedido,observacion,cancelaciones_items(cantidad)')
          .order('fecha', { ascending: false })
          .order('numero', { ascending: false })
          .range(0, 4999),
        supabase.from('cancelaciones_sync').select('ultima_at').maybeSingle(),
      ])
      if (e) throw new Error(e.message)
      const filas = ((data as (Omit<Cancelacion, 'unidades'> & { cancelaciones_items: { cantidad: number | null }[] })[] | null) ?? [])
        .map(({ cancelaciones_items, ...c }) => ({ ...c, unidades: cancelaciones_items.reduce((a, i) => a + Number(i.cantidad ?? 0), 0) }))
      setLista(filas)
      setActualizado((sync as { ultima_at: string | null } | null)?.ultima_at ?? null)
      setSel((prev) => prev ?? (window.matchMedia('(min-width: 1024px)').matches ? filas[0]?.nro ?? null : null))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar las cancelaciones.')
    } finally {
      setCargando(false)
    }
  }, [])
  useEffect(() => { void cargar() }, [cargar])

  useEffect(() => {
    if (!sel || !supabase) { setItems([]); return }
    let vivo = true
    setCargandoItems(true)
    void supabase
      .from('cancelaciones_items')
      .select('linea,articulo,descripcion,color,talle,cantidad')
      .eq('nro', sel)
      .order('linea', { ascending: true })
      .range(0, 4999)
      .then(({ data, error: e }) => {
        if (!vivo) return
        if (e) setError(e.message)
        setItems((data as ItemCancelado[] | null) ?? [])
        setCargandoItems(false)
      })
    return () => { vivo = false }
  }, [sel, version])

  // "Actualizar datos": la misma copia que pedidos de compra (trae también las cancelaciones)
  async function actualizarDatos() {
    if (!supabase || forzando) return
    setForzando(true)
    setAvisoSync(null)
    try {
      const { data } = await supabase.auth.getSession()
      const r = await fetch('/api/pedidos-sync?tipo=compra', { method: 'POST', headers: { Authorization: `Bearer ${data.session?.access_token ?? ''}` } })
      const cuerpo = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (!r.ok || !cuerpo?.ok) throw new Error(cuerpo?.error ?? `Error ${r.status}`)
      await cargar()
      setAvisoSync({ ok: true, texto: 'Datos actualizados desde el SQL.' })
      setVersion((v) => v + 1)
    } catch (e) {
      setAvisoSync({ ok: false, texto: e instanceof Error ? e.message : 'No se pudieron actualizar los datos.' })
    } finally {
      setForzando(false)
    }
  }

  const q = busqueda.trim().toUpperCase()
  const visibles = useMemo(() => (!q ? lista : lista.filter((c) =>
    [String(c.numero ?? ''), c.proveedor, c.comprobante, c.nro_pedido, c.observacion, fechaCorta(c.fecha)]
      .some((v) => String(v ?? '').toUpperCase().includes(q)))), [lista, q])

  const idx = visibles.findIndex((c) => c.nro === sel)
  const canc = lista.find((c) => c.nro === sel) ?? null
  const ir = (d: number) => { const c = visibles[idx + d]; if (c) setSel(c.nro) }
  const totUnidades = useMemo(() => items.reduce((a, i) => a + Number(i.cantidad ?? 0), 0), [items])

  async function exportar() {
    if (!canc) return
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(items.map((i) => ({
      Artículo: i.articulo ?? '', Descripción: i.descripcion ?? '', Color: i.color ?? '', Talle: i.talle ?? '', Cantidad: Number(i.cantidad ?? 0),
    }))), 'Cancelación')
    XLSX.writeFile(wb, `cancelacion_${canc.numero ?? canc.nro}.xlsx`)
  }

  const campo = (etiqueta: string, valor: React.ReactNode, ancho = '') => (
    <div className={`min-w-0 ${ancho}`}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-sub">{etiqueta}</p>
      <p className="truncate text-sm font-semibold text-ink">{valor || '—'}</p>
    </div>
  )

  return (
    <Layout>
      <BackButton />
      <header className="mb-3 mt-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">Cancelaciones</h1>
          <p className="text-sm text-sub">
            {lista.length} cancelaciones
            {actualizado && ` · actualizado ${new Date(actualizado).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}`}
          </p>
        </div>
        <button
          onClick={() => void actualizarDatos()}
          disabled={forzando}
          className="btn-press inline-flex h-10 items-center gap-1.5 rounded-xl bg-amber-600 px-4 text-sm font-semibold text-white shadow-soft transition hover:bg-amber-700 disabled:opacity-60"
          title="Trae los pedidos y las cancelaciones del SQL ahora (tarda unos segundos)"
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

      <div className="grid gap-4 pb-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
        {/* ---------- Lista ---------- */}
        <aside className={`${sel ? 'hidden lg:block' : ''} min-w-0`}>
          <div className="relative mb-2">
            <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub" />
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Número, proveedor, pedido, fecha…"
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
                  const activo = c.nro === sel
                  return (
                    <li key={c.nro}>
                      <button onClick={() => setSel(c.nro)} className={`flex w-full items-start gap-3 px-3 py-2.5 text-left transition ${activo ? 'bg-amber-500/15' : 'hover:bg-surface2'}`}>
                        <span className="min-w-0 flex-1">
                          <span className={`font-display text-sm font-bold tabular-nums ${activo ? 'text-amber-500' : 'text-ink'}`}>N° {c.numero ?? '—'}</span>
                          <span className="block truncate text-xs font-medium text-ink/90">{c.proveedor}</span>
                          <span className="block text-[11px] text-sub">{fechaCorta(c.fecha)}{c.comprobante ? ` · pedido ${pedidoCorto(c.comprobante)}` : ''}</span>
                        </span>
                        <span className="shrink-0 text-right text-xs font-semibold tabular-nums text-ink">{n0.format(c.unidades)} u.</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </aside>

        {/* ---------- Detalle ---------- */}
        <section className={`${sel ? '' : 'hidden lg:block'} min-w-0`}>
          {!canc ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-line bg-surface/50 px-4 py-16 text-center text-sub">
              <PackageX size={28} aria-hidden />
              Elegí una cancelación de la lista.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <button onClick={() => setSel(null)} className="inline-flex h-10 items-center gap-1 rounded-xl px-2 text-sm font-medium text-sub hover:text-ink lg:hidden">
                  <ArrowLeft size={16} aria-hidden /> Cancelaciones
                </button>
                <div className="ml-auto flex items-center gap-1.5">
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
                </div>
              </div>

              <div className="rounded-2xl border border-line bg-surface p-4 shadow-soft">
                <div className="flex flex-wrap items-start gap-4">
                  <div className="grid min-w-0 flex-1 grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                    {campo('Proveedor', <span className="text-amber-500">{canc.proveedor}</span>, 'col-span-2')}
                    {campo('Pedido de compra', canc.comprobante ? `${pedidoCorto(canc.comprobante)}${canc.nro_pedido ? ` (${canc.nro_pedido})` : ''}` : 'Sin pedido asociado')}
                    {campo('Observación', canc.observacion, 'col-span-3')}
                  </div>
                  <div className="space-y-2 text-right">
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-wide text-sub">Número</p>
                      <p className="font-mono text-sm font-semibold text-ink">{canc.nro}</p>
                    </div>
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-wide text-sub">Fecha</p>
                      <p className="text-sm font-semibold tabular-nums text-ink">{fechaCorta(canc.fecha)}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="overflow-hidden rounded-2xl border border-line bg-surface">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[40rem] text-sm">
                    <thead>
                      <tr className="border-b border-line bg-surface2 text-left text-[11px] font-semibold uppercase tracking-wide text-sub">
                        <th className="px-3 py-2">Artículo</th>
                        <th className="px-3 py-2">Descripción</th>
                        <th className="px-3 py-2">Color</th>
                        <th className="px-3 py-2">Talle</th>
                        <th className="px-3 py-2 text-right">Cantidad</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line/50">
                      {cargandoItems ? (
                        <tr><td colSpan={5} className="px-3 py-8 text-center text-sub"><Loader2 size={16} className="mr-1.5 inline animate-spin" aria-hidden /> Cargando artículos…</td></tr>
                      ) : (
                        items.map((i) => (
                          <tr key={i.linea} className="hover:bg-surface2/60">
                            <td className="whitespace-nowrap px-3 py-1.5 font-semibold text-ink">{i.articulo}</td>
                            <td className="max-w-[20rem] truncate px-3 py-1.5 text-ink/90" title={i.descripcion ?? ''}>{i.descripcion || '—'}</td>
                            <td className="px-3 py-1.5 tabular-nums text-sub">{i.color}</td>
                            <td className="px-3 py-1.5 text-sub">{i.talle}</td>
                            <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-ink">{n0.format(Number(i.cantidad ?? 0))}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-line bg-surface2 text-sm font-semibold">
                        <td colSpan={4} className="px-3 py-2 text-sub">Items: {items.length}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-amber-500">{n0.format(totUnidades)} unidades</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </Layout>
  )
}
