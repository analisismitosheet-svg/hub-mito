import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Loader2, Search, ChevronLeft, ChevronRight, RefreshCw, Download, ClipboardList, Ban, ArrowLeft,
} from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { supabase } from '@/lib/supabase'
import { descripcionesMaestro } from '@/lib/descripcionArticulos'

/* ------------------------------------------------------------------ */
/*  Pedidos de compra (Compras / Depósito)                             */
/*  Copia de VISTAS_CONSOLIDADAS.dbo.PEDIDO_COMPRA (sql/pedidos_compra.sql),*/
/*  actualizada cada 1 hora por puente-sql/scripts/sync-pedidos-compra.js    */
/* ------------------------------------------------------------------ */

interface Pedido {
  codigo: string
  numero: number | null
  descripcion: string | null
  fecha: string | null
  fecha_alta: string | null
  proveedor: string | null
  proveedor_nombre: string | null
  lista: string | null
  observacion: string | null
  total: number | null
  anulado: boolean
  usuario: string | null
}

interface ItemPedido {
  linea: number
  articulo: string | null
  color: string | null
  talle: string | null
  cantidad: number | null
  precio: number | null
  neto: number | null
  iva: number | null
  bruto: number | null
}

const $ = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const n0 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 })
const plata = (v: number | null | undefined) => (v == null ? '—' : $.format(v))
const fechaCorta = (f: string | null) => (f ? f.split('-').reverse().join('/') : '—')

/** "PEDIDODECOMPRA X 00001-00009787" -> "X 00001-00009787" */
function numeroComprobante(p: Pedido): string {
  const m = /([A-Z]\s+\d{5}-\d{8})\s*$/.exec(p.descripcion ?? '')
  return m ? m[1] : p.numero != null ? String(p.numero) : p.codigo
}

export default function PedidosCompra() {
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actualizado, setActualizado] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [sel, setSel] = useState<string | null>(null)

  // Botón "Actualizar datos": fuerza la copia desde el SQL (api/pedidos-sync.ts?tipo=compra)
  const [forzando, setForzando] = useState(false)
  const [avisoSync, setAvisoSync] = useState<{ ok: boolean; texto: string } | null>(null)
  // Sube al actualizar: vuelve a traer los artículos del pedido abierto
  const [version, setVersion] = useState(0)

  const [items, setItems] = useState<ItemPedido[]>([])
  const [cargandoItems, setCargandoItems] = useState(false)
  const [descripciones, setDescripciones] = useState<Map<string, string>>(new Map())

  // Deep-link: /compras/pedidos-compra?numero=15183 (lo usa la columna "N° OC" de
  // Recepción INDO). Solo se lee, no se escribe: la pantalla es de dos panes, así que
  // siempre queda la lista al lado para volver, y no hay que sincronizar el URL en cada
  // clic (que es la forma fácil de armar un ciclo con el efecto que lo lee).
  const [params] = useSearchParams()
  const numeroUrl = (params.get('numero') ?? '').trim()
  const [avisoUrl, setAvisoUrl] = useState<string | null>(null)
  const abiertoDesdeUrl = useRef(false)

  const cargar = useCallback(async () => {
    if (!supabase) return
    setCargando(true)
    setError(null)
    try {
      const [{ data, error: e }, { data: sync }] = await Promise.all([
        supabase
          .from('pedidos_compra')
          .select('codigo,numero,descripcion,fecha,fecha_alta,proveedor,proveedor_nombre,lista,observacion,total,anulado,usuario')
          .order('fecha', { ascending: false })
          .order('numero', { ascending: false })
          .range(0, 4999),
        supabase.from('pedidos_compra_sync').select('ultima_at').maybeSingle(),
      ])
      if (e) throw new Error(e.message)
      const lista = (data as Pedido[] | null) ?? []
      setPedidos(lista)
      setActualizado((sync as { ultima_at: string | null } | null)?.ultima_at ?? null)
      setSel((prev) => prev ?? (window.matchMedia('(min-width: 1024px)').matches ? lista[0]?.codigo ?? null : null))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar los pedidos.')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  // Llega ?numero= y abre ese pedido. Se espera a que terminen de cargar los pedidos y
  // corre una sola vez: si se dejara en el effect, cada cambio de la lista reescribiría
  // la búsqueda del usuario.
  useEffect(() => {
    if (cargando || pedidos.length === 0 || !numeroUrl || abiertoDesdeUrl.current) return
    abiertoDesdeUrl.current = true
    const n = numeroUrl.replace(/\s+/g, '')
    const coincidentes = pedidos.filter((p) => String(p.numero ?? '') === n)
    if (coincidentes.length === 0) {
      setAvisoUrl(`No hay ningún pedido de compra con N° ${n}.`)
      return
    }
    if (coincidentes.length > 1) {
      // Pasa con números bajos (hay 34 repetidos en la base): se avisa cuál se abrió.
      const elegido = coincidentes[0]
      setAvisoUrl(
        `El N° ${n} está repetido en ${coincidentes.length} pedidos; se abrió el más reciente ` +
          `(${elegido.proveedor_nombre ?? elegido.proveedor}, ${fechaCorta(elegido.fecha)}).`,
      )
    } else {
      setAvisoUrl(null)
    }
    setBusqueda(n)
    setSel(coincidentes[0].codigo)
  }, [cargando, pedidos, numeroUrl])

  // Ítems del pedido elegido (+ descripción desde el maestro de artículos)
  useEffect(() => {
    if (!sel || !supabase) {
      setItems([])
      return
    }
    let vivo = true
    setCargandoItems(true)
    void supabase
      .from('pedidos_compra_items')
      .select('linea,articulo,color,talle,cantidad,precio,neto,iva,bruto')
      .eq('codigo', sel)
      .order('linea', { ascending: true })
      .range(0, 4999)
      .then(({ data, error: e }) => {
        if (!vivo) return
        if (e) setError(e.message)
        const its = (data as ItemPedido[] | null) ?? []
        setItems(its)
        setCargandoItems(false)
        descripcionesMaestro(its.map((i) => i.articulo ?? ''))
          .then((m) => { if (vivo) setDescripciones((prev) => new Map([...prev, ...m])) })
          .catch(() => { /* sin descripciones */ })
      })
    return () => { vivo = false }
  }, [sel, version])

  async function actualizarDatos() {
    if (!supabase || forzando) return
    setForzando(true)
    setAvisoSync(null)
    try {
      const { data } = await supabase.auth.getSession()
      const r = await fetch('/api/pedidos-sync?tipo=compra', {
        method: 'POST',
        headers: { Authorization: `Bearer ${data.session?.access_token ?? ''}` },
      })
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
  const visibles = useMemo(() => {
    if (!q) return pedidos
    return pedidos.filter((p) =>
      [String(p.numero ?? ''), p.descripcion, p.proveedor, p.proveedor_nombre, p.observacion, fechaCorta(p.fecha)]
        .some((v) => String(v ?? '').toUpperCase().includes(q)),
    )
  }, [pedidos, q])

  const idx = visibles.findIndex((p) => p.codigo === sel)
  const pedido = pedidos.find((p) => p.codigo === sel) ?? null
  const ir = (d: number) => {
    const p = visibles[idx + d]
    if (p) setSel(p.codigo)
  }

  const tot = useMemo(
    () =>
      items.reduce(
        (a, i) => ({
          cant: a.cant + (i.cantidad ?? 0),
          neto: a.neto + (i.neto ?? 0),
          iva: a.iva + (i.iva ?? 0),
          bruto: a.bruto + (i.bruto ?? 0),
        }),
        { cant: 0, neto: 0, iva: 0, bruto: 0 },
      ),
    [items],
  )
  const descDe = (a: string | null) => descripciones.get(String(a ?? '').toUpperCase()) ?? ''

  async function exportar() {
    if (!pedido) return
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    const filas = items.map((i) => ({
      Artículo: i.articulo ?? '',
      Descripción: descDe(i.articulo),
      Color: i.color ?? '',
      Talle: i.talle ?? '',
      Cantidad: i.cantidad ?? 0,
      Precio: i.precio ?? 0,
      Neto: i.neto ?? 0,
      IVA: i.iva ?? 0,
      Total: i.bruto ?? 0,
    }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas), 'Pedido')
    XLSX.writeFile(wb, `pedido_compra_${pedido.numero ?? pedido.codigo}.xlsx`)
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
          <h1 className="font-display text-2xl font-semibold text-ink">Pedidos de compra</h1>
          <p className="text-sm text-sub">
            {pedidos.length} pedidos
            {actualizado && ` · actualizado ${new Date(actualizado).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}`}
          </p>
        </div>
        <button
          onClick={() => void actualizarDatos()}
          disabled={forzando}
          className="btn-press inline-flex h-10 items-center gap-1.5 rounded-xl bg-amber-600 px-4 text-sm font-semibold text-white shadow-soft transition hover:bg-amber-700 disabled:opacity-60"
          title="Trae los pedidos del SQL ahora (tarda unos segundos)"
        >
          <RefreshCw size={15} aria-hidden className={forzando ? 'animate-spin' : ''} />
          {forzando ? 'Actualizando…' : 'Actualizar datos'}
        </button>
      </header>

      {avisoSync && (
        <p
          role="status"
          className={`mb-3 rounded-xl border p-3 text-sm ${
            avisoSync.ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : 'border-brand-600/30 bg-brand-600/10 text-brand-400'
          }`}
        >
          {avisoSync.texto}
        </p>
      )}

      {avisoUrl && (
        <p
          role="status"
          className="mb-3 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-400"
        >
          <ClipboardList size={15} aria-hidden className="mt-0.5 shrink-0" />
          <span>
            {avisoUrl}
            {numeroUrl && (
              <button
                onClick={() => setAvisoUrl(null)}
                className="ml-2 underline underline-offset-2 hover:text-amber-300"
              >
                descartar
              </button>
            )}
          </span>
        </p>
      )}

      {error && (
        <p role="alert" className="mb-3 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>
      )}

      <div className="grid gap-4 pb-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
        {/* ---------- Lista de pedidos ---------- */}
        <aside className={`${sel ? 'hidden lg:block' : ''} min-w-0`}>
          <div className="relative mb-2">
            <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub" />
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Número, proveedor, fecha…"
              aria-label="Buscar pedido"
              className="h-11 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-sm text-ink outline-none transition placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40"
            />
          </div>
          <div className="overflow-hidden rounded-2xl border border-line bg-surface lg:max-h-[calc(100vh-15rem)] lg:overflow-y-auto">
            {cargando && pedidos.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sub">
                <Loader2 size={16} className="animate-spin" aria-hidden /> Cargando…
              </div>
            ) : visibles.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-sub">No hay pedidos que coincidan.</p>
            ) : (
              <ul className="divide-y divide-line/60">
                {visibles.map((p) => {
                  const activo = p.codigo === sel
                  return (
                    <li key={p.codigo}>
                      <button
                        onClick={() => setSel(p.codigo)}
                        className={`flex w-full items-start gap-3 px-3 py-2.5 text-left transition ${
                          activo ? 'bg-amber-500/15' : 'hover:bg-surface2'
                        }`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className={`font-display text-sm font-bold tabular-nums ${activo ? 'text-amber-500' : 'text-ink'}`}>
                              N° {p.numero ?? '—'}
                            </span>
                            {p.anulado && (
                              <span className="rounded-md bg-brand-600/15 px-1.5 py-0.5 text-[10px] font-semibold text-brand-400">ANULADO</span>
                            )}
                          </span>
                          <span className="block truncate text-xs font-medium text-ink/90">{p.proveedor_nombre || p.proveedor}</span>
                          <span className="block text-[11px] text-sub">{fechaCorta(p.fecha)}</span>
                        </span>
                        <span className="shrink-0 text-right text-xs font-semibold tabular-nums text-ink">$ {plata(p.total)}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </aside>

        {/* ---------- Pedido (formato remito) ---------- */}
        <section className={`${sel ? '' : 'hidden lg:block'} min-w-0`}>
          {!pedido ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-line bg-surface/50 px-4 py-16 text-center text-sub">
              <ClipboardList size={28} aria-hidden />
              Elegí un pedido de la lista.
            </div>
          ) : (
            <div className="space-y-3">
              {/* Barra: volver (celular) · anterior/siguiente · Excel */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSel(null)}
                  className="inline-flex h-10 items-center gap-1 rounded-xl px-2 text-sm font-medium text-sub hover:text-ink lg:hidden"
                >
                  <ArrowLeft size={16} aria-hidden /> Pedidos
                </button>
                <div className="ml-auto flex items-center gap-1.5">
                  <button
                    onClick={() => ir(-1)}
                    disabled={idx <= 0}
                    className="btn-press flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface text-ink transition hover:bg-surface2 disabled:opacity-40"
                    title="Pedido anterior (más nuevo)"
                    aria-label="Pedido anterior"
                  >
                    <ChevronLeft size={18} aria-hidden />
                  </button>
                  <button
                    onClick={() => ir(1)}
                    disabled={idx === -1 || idx >= visibles.length - 1}
                    className="btn-press flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface text-ink transition hover:bg-surface2 disabled:opacity-40"
                    title="Pedido siguiente (más viejo)"
                    aria-label="Pedido siguiente"
                  >
                    <ChevronRight size={18} aria-hidden />
                  </button>
                  <button
                    onClick={() => void exportar()}
                    disabled={items.length === 0}
                    className="btn-press inline-flex h-10 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-sm font-medium text-ink transition hover:bg-surface2 disabled:opacity-50"
                  >
                    <Download size={15} aria-hidden /> Excel
                  </button>
                </div>
              </div>

              {/* Cabecera */}
              <div className="rounded-2xl border border-line bg-surface p-4 shadow-soft">
                <div className="flex flex-wrap items-start gap-4">
                  <div className="grid min-w-0 flex-1 grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                    {campo(
                      'Proveedor',
                      <>
                        <span className="text-amber-500">{pedido.proveedor}</span>
                        {pedido.proveedor_nombre && <span className="ml-1.5 font-medium">{pedido.proveedor_nombre}</span>}
                      </>,
                      'col-span-2',
                    )}
                    {campo('Lista de precio', pedido.lista)}
                    {campo('Observación', pedido.observacion, 'col-span-2')}
                    {campo('Usuario', pedido.usuario)}
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl border-2 border-ink/80 font-display text-2xl font-bold text-ink">
                      {numeroComprobante(pedido).charAt(0)}
                    </div>
                    <div className="space-y-2 text-right">
                      <div>
                        <p className="text-[11px] font-medium uppercase tracking-wide text-sub">Número</p>
                        <p className="font-mono text-sm font-semibold text-ink">{numeroComprobante(pedido)}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-medium uppercase tracking-wide text-sub">Fecha</p>
                        <p className="text-sm font-semibold tabular-nums text-ink">{fechaCorta(pedido.fecha)}</p>
                      </div>
                    </div>
                  </div>
                </div>
                {pedido.anulado && (
                  <p className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-brand-600/15 px-2.5 py-1 text-xs font-semibold text-brand-400">
                    <Ban size={13} aria-hidden /> Pedido anulado
                  </p>
                )}
              </div>

              {/* Artículos */}
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
                    <tbody className="divide-y divide-line/50">
                      {cargandoItems ? (
                        <tr>
                          <td colSpan={7} className="px-3 py-8 text-center text-sub">
                            <Loader2 size={16} className="mr-1.5 inline animate-spin" aria-hidden /> Cargando artículos…
                          </td>
                        </tr>
                      ) : (
                        items.map((i) => (
                          <tr key={i.linea} className="hover:bg-surface2/60">
                            <td className="whitespace-nowrap px-3 py-1.5 font-semibold text-ink">{i.articulo}</td>
                            <td className="max-w-[18rem] truncate px-3 py-1.5 text-ink/90" title={descDe(i.articulo)}>{descDe(i.articulo) || '—'}</td>
                            <td className="px-3 py-1.5 tabular-nums text-sub">{i.color}</td>
                            <td className="px-3 py-1.5 text-sub">{i.talle}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-ink">{n0.format(i.cantidad ?? 0)}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-ink">{plata(i.precio)}</td>
                            <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-ink">{plata(i.neto)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-line bg-surface2 text-sm font-semibold">
                        <td colSpan={4} className="px-3 py-2 text-sub">Items: {items.length}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-ink">{n0.format(tot.cant)}</td>
                        <td />
                        <td className="px-3 py-2 text-right tabular-nums text-ink">{plata(tot.neto)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              {/* Totales */}
              <div className="flex justify-end">
                <div className="w-full max-w-sm space-y-1.5 rounded-2xl border border-line bg-surface p-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-sub">Subtotal neto</span>
                    <span className="font-semibold tabular-nums text-ink">$ {plata(tot.neto)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-sub">I.V.A.</span>
                    <span className="font-semibold tabular-nums text-ink">$ {plata(tot.iva)}</span>
                  </div>
                  {/* El total de Dragonfish ya trae el descuento del pedido: la diferencia se muestra aparte */}
                  {pedido.total != null && tot.neto + tot.iva - pedido.total > 1 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-sub">Descuento / ajustes</span>
                      <span className="font-semibold tabular-nums text-emerald-500">− $ {plata(tot.neto + tot.iva - pedido.total)}</span>
                    </div>
                  )}
                  <div className="mt-2 flex items-baseline justify-between border-t border-line pt-2">
                    <span className="font-display text-lg font-bold text-ink">Total</span>
                    <span className="font-display text-2xl font-bold tabular-nums text-amber-500">$ {plata(pedido.total ?? tot.bruto)}</span>
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
