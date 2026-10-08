import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { ExternalLink, Loader2, Package, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { descripcionesMaestro } from '@/lib/descripcionArticulos'

/* ------------------------------------------------------------------ */
/*  Tarjeta de detalle de una orden de compra (Recepción INDO).          */
/*                                                                      */
/*  Se abre desde el SelectorOc (botón 📄 de cada OC) para ver qué       */
/*  contiene el pedido antes de tildarlo: cabecera de public.pedidos_    */
/*  compra + sus ítems de public.pedidos_compra_items con la             */
/*  descripción del maestro. Requiere 'pedidos_compra.view' (lo que      */
/*  exige la RLS de esas tablas); sin ese permiso se avisa y se cierra.  */
/*                                                                      */
/*  Se cachea por sesión en memoria: el selector se abre y cierra        */
/*  muchas veces y no tiene sentido re-pedir el mismo pedido.            */
/* ------------------------------------------------------------------ */

interface PedidoDetalle {
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
  bruto: number | null
}

const $ = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const n0 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 })
const plata = (v: number | null | undefined) => (v == null ? '—' : $.format(v))
const fechaCorta = (f: string | null) => (f ? f.split('-').reverse().join('/') : '—')

/** "PEDIDODECOMPRA X 00001-00009787" -> "X 00001-00009787" */
function numeroComprobante(p: PedidoDetalle): string {
  const m = /([A-Z]\s+\d{5}-\d{8})\s*$/.exec(p.descripcion ?? '')
  return m ? m[1] : p.numero != null ? String(p.numero) : p.codigo
}

/** Pedido + ítems ya pedidos: { codigo: { pedido, items, desc } } */
const cache = new Map<string, { pedido: PedidoDetalle; items: ItemPedido[]; desc: Promise<Map<string, string>> }>()
/** Descripciones del maestro compartidas entre aperturas */
const descripciones = new Map<string, string>()

async function cargarDetalle(codigo: string): Promise<{ pedido: PedidoDetalle; items: ItemPedido[]; desc: Promise<Map<string, string>> }> {
  const guardado = cache.get(codigo)
  if (guardado) return guardado
  if (!supabase) throw new Error('Sin conexión a la base.')
  const [{ data: p, error: eP }, { data: its }] = await Promise.all([
    supabase
      .from('pedidos_compra')
      .select('codigo,numero,descripcion,fecha,fecha_alta,proveedor,proveedor_nombre,lista,observacion,total,anulado,usuario')
      .eq('codigo', codigo)
      .maybeSingle(),
    supabase
      .from('pedidos_compra_items')
      .select('linea,articulo,color,talle,cantidad,precio,neto,bruto')
      .eq('codigo', codigo)
      .order('linea', { ascending: true }),
  ])
  if (eP) throw new Error(`No pude cargar la OC: ${eP.message}`)
  if (!p) throw new Error('Esta OC no está en public.pedidos_compra (puede que sea más vieja que la copia sincronizada).')
  const pedido = p as PedidoDetalle
  // Si falla la consulta de ítems, se muestra la cabecera igual (deja items en [])
  const items = (its as ItemPedido[] | null) ?? []
  // Descripciones del maestro: se piden una vez por artículo y quedan para siempre
  const desc = descripcionesMaestro(items.map((i) => i.articulo ?? ''))
    .then((m) => { for (const [k, v] of m) descripciones.set(k, v); return m })
    .catch(() => new Map<string, string>())
  const r = { pedido, items, desc }
  cache.set(codigo, r)
  return r
}

export default function DetalleOc({
  codigo, numero, proveedorNombre, onCerrar,
}: {
  codigo: string
  /** N° mostrado en el título (puede venir del selector aunque el pedido esté anulado) */
  numero: string
  proveedorNombre?: string | null
  onCerrar: () => void
}) {
  const [pedido, setPedido] = useState<PedidoDetalle | null>(null)
  const [items, setItems] = useState<ItemPedido[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Las descripciones del maestro llegan después del pedido: un tick más de render
  const [, setDescOk] = useState(0)

  useEffect(() => {
    let vivo = true
    setCargando(true)
    setError(null)
    void cargarDetalle(codigo)
      .then((r) => {
        if (!vivo) return
        setPedido(r.pedido)
        setItems(r.items)
        setCargando(false)
        void r.desc.then(() => { if (vivo) setDescOk((n) => n + 1) })
      })
      .catch((e) => {
        if (!vivo) return
        setError(e instanceof Error ? e.message : String(e))
        setCargando(false)
      })
    return () => { vivo = false }
  }, [codigo])

  useEffect(() => {
    // Capture + stopImmediatePropagation: Esc cierra SOLO la tarjeta. Sin esto, el
    // Esc burbujea al listener del popup del SelectorOc (z-[90]) y cierra los dos.
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      onCerrar()
    }
    document.addEventListener('keydown', esc, true)
    return () => document.removeEventListener('keydown', esc, true)
  }, [onCerrar])

  const tot = items.reduce(
    (a, i) => ({ cant: a.cant + (i.cantidad ?? 0), neto: a.neto + (i.neto ?? 0), bruto: a.bruto + (i.bruto ?? 0) }),
    { cant: 0, neto: 0, bruto: 0 },
  )

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`Detalle de la OC ${numero}`}
      onClick={(e) => { if (e.target === e.currentTarget) onCerrar() }}
    >
      <div className="my-6 w-full max-w-2xl animate-enter overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
        {/* Cabecera */}
        <div className="flex items-start gap-3 border-b border-line bg-surface2/60 p-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-500">
            <Package size={18} aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="flex flex-wrap items-center gap-2 text-base font-semibold text-ink">
              Orden de compra <span className="tabular-nums text-amber-500">N° {numero}</span>
              {pedido?.anulado && (
                <span className="rounded-md bg-brand-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-400">
                  anulada
                </span>
              )}
            </h3>
            <p className="truncate text-sm text-sub">
              {pedido?.proveedor_nombre || proveedorNombre || pedido?.proveedor || '—'}
              {pedido?.numero != null && (
                <span className="ml-2 font-mono text-xs text-sub/70">{numeroComprobante(pedido)}</span>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            className="shrink-0 rounded-lg p-1.5 text-sub transition hover:bg-line/60 hover:text-ink"
            aria-label="Cerrar detalle"
          >
            <X size={17} aria-hidden />
          </button>
        </div>

        {cargando && (
          <div className="flex items-center justify-center gap-2 p-8 text-sm text-sub">
            <Loader2 size={16} className="animate-spin" aria-hidden /> Cargando el pedido…
          </div>
        )}

        {!cargando && error && (
          <div className="p-4">
            <p className="rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>
            <p className="mt-2 text-xs text-sub">
              Para ver el detalle hace falta el permiso <b className="text-ink">pedidos_compra.view</b> (es el mismo que usa la pantalla
              Compras → Pedidos de compra). Mientras tanto podés escribir el N° de OC a mano.
            </p>
          </div>
        )}

        {!cargando && pedido && (
          <>
            {/* Campos */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 p-4 sm:grid-cols-4">
              {[
                ['Fecha OC', fechaCorta(pedido.fecha)],
                ['Fecha de alta', fechaCorta(pedido.fecha_alta)],
                ['Lista', pedido.lista || '—'],
                ['Usuario', pedido.usuario || '—'],
              ].map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-sub/70">{k}</p>
                  <p className="truncate text-sm font-semibold text-ink">{v}</p>
                </div>
              ))}
              <div className="col-span-2 min-w-0 sm:col-span-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-sub/70">Observación</p>
                <p className="text-sm text-ink">{pedido.observacion?.trim() || <span className="text-sub/50">—</span>}</p>
              </div>
              <div className="min-w-0 text-right">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-sub/70">Total</p>
                <p className="text-base font-bold tabular-nums text-ink">${plata(pedido.total)}</p>
              </div>
            </div>

            {/* Ítems */}
            <div className="px-4 pb-2">
              {items.length === 0 ? (
                <p className="rounded-xl border border-line bg-surface2 p-3 text-center text-sm text-sub">
                  Este pedido no tiene ítems en la copia sincronizada.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-line">
                  <table className="w-full min-w-[460px] text-left text-xs">
                    <thead>
                      <tr className="border-b border-line text-[10px] uppercase tracking-wider text-sub/70">
                        <th className="px-2.5 py-2 font-semibold">Artículo</th>
                        <th className="px-2.5 py-2 font-semibold">Color</th>
                        <th className="px-2.5 py-2 font-semibold">Talle</th>
                        <th className="px-2.5 py-2 text-right font-semibold">Cant.</th>
                        <th className="px-2.5 py-2 text-right font-semibold">Precio</th>
                        <th className="px-2.5 py-2 text-right font-semibold">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((i) => {
                        const desc = descripciones.get(String(i.articulo ?? '').trim().toUpperCase())
                        return (
                          <tr key={i.linea} className="border-b border-line/50 last:border-0">
                            <td className="px-2.5 py-1.5">
                              <span className="font-medium text-ink">{i.articulo ?? '—'}</span>
                              {desc && <span className="block max-w-[16rem] truncate text-[10px] text-sub/80">{desc}</span>}
                            </td>
                            <td className="px-2.5 py-1.5 text-sub">{i.color ?? '—'}</td>
                            <td className="px-2.5 py-1.5 text-sub">{i.talle ?? '—'}</td>
                            <td className="px-2.5 py-1.5 text-right tabular-nums text-ink">{n0.format(i.cantidad ?? 0)}</td>
                            <td className="px-2.5 py-1.5 text-right tabular-nums text-sub">{plata(i.precio)}</td>
                            <td className="px-2.5 py-1.5 text-right tabular-nums text-ink">{plata(i.bruto)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-line bg-surface2/50 text-xs font-semibold">
                        <td className="px-2.5 py-2" colSpan={3}>
                          {items.length} {items.length === 1 ? 'renglón' : 'renglones'}
                        </td>
                        <td className="px-2.5 py-2 text-right tabular-nums text-ink">{n0.format(tot.cant)}</td>
                        <td className="px-2.5 py-2" />
                        <td className="px-2.5 py-2 text-right tabular-nums text-ink">${plata(tot.bruto)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>

            {/* Pie */}
            <div className="flex justify-end gap-2 border-t border-line bg-surface2/40 p-3">
              <button
                type="button"
                onClick={onCerrar}
                className="btn-press rounded-xl border border-line bg-surface2 px-4 py-2 text-sm font-medium text-ink transition hover:bg-line"
              >
                Cerrar
              </button>
              {/^\d+$/.test(numero) && (
                <Link
                  to={`/compras/pedidos-compra?numero=${encodeURIComponent(numero)}`}
                  onClick={onCerrar}
                  className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-700"
                >
                  <ExternalLink size={14} aria-hidden /> Abrir pedido completo
                </Link>
              )}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
