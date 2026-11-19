import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Loader2, Plus, Printer, Trash2, X, Package } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import ConfirmDialog from '@/components/ConfirmDialog'
import { tamanoMembrete } from '@/components/EtiquetasBultos'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { TRAMO_CAJAS, cargarListaCajas, qrCaja, tramoDe } from '@/lib/mapeoCajas'

const inputCls =
  'h-11 w-full rounded-xl border border-line bg-surface2 px-3 text-base text-ink outline-none transition placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40'

/** Más cajas que esto de una vez es casi seguro un error de tipeo */
const MAX_POR_VEZ = 1000

/* Membrete de caja: mismo marco y tamaño que las etiquetas de bultos de Facturación */
function MembreteCaja({ numero, ancho, alto }: { numero: number; ancho: number; alto: number }) {
  const qrMm = Math.max(10, Math.min(alto - 6, ancho * 0.5))
  return (
    <div
      className="etiqueta-bulto"
      style={{ width: `${ancho}mm`, height: `${alto}mm`, flexDirection: 'row', alignItems: 'center', gap: '2mm', padding: '2mm' }}
    >
      <QRCodeSVG value={qrCaja(numero)} size={256} level="M" style={{ width: `${qrMm}mm`, height: `${qrMm}mm`, flexShrink: 0 }} />
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '1mm', minWidth: 0, flex: 1, textAlign: 'center' }}>
        <div style={{ fontSize: `${alto * 0.1}mm`, fontWeight: 700, textTransform: 'uppercase' }}>CAJA</div>
        <div style={{ fontSize: `${Math.min(alto * 0.4, ancho * 0.16)}mm`, fontWeight: 800, lineHeight: 1, whiteSpace: 'nowrap' }}>{numero}</div>
      </div>
    </div>
  )
}

/** Imprime los membretes: una hoja por etiqueta, del tamaño del membrete (igual que Facturación) */
function imprimirMembretes(ancho: number, alto: number) {
  const src = document.getElementById('cajas-print-area')
  if (!src || !src.innerHTML.trim()) return
  const root = document.createElement('div')
  root.id = 'etiquetas-print-root'
  root.innerHTML = src.innerHTML
  document.body.appendChild(root)
  const style = document.createElement('style')
  style.id = 'etiquetas-print-css'
  style.innerHTML = [
    `@page { size: ${ancho}mm ${alto}mm; margin: 0; }`,
    `@media print {`,
    `  body > *:not(#etiquetas-print-root) { display: none !important; }`,
    `  #etiquetas-print-root { display: block !important; position: static !important; margin: 0 !important; padding: 0 !important; }`,
    `  #etiquetas-print-root .etiqueta-bulto { page-break-after: always; break-after: page; }`,
    `}`,
  ].join('\n')
  document.head.appendChild(style)
  requestAnimationFrame(() => {
    window.print()
    root.remove()
    document.getElementById('etiquetas-print-css')?.remove()
  })
}

/** Mapeo de cajas · Lista de cajas: crear números e imprimir sus QR */
export default function MapeoCajasLista() {
  const { isAdmin, can } = useAuth()
  const puedeGestionar = isAdmin || can('deposito.cajas.gestionar')

  const [lista, setLista] = useState<number[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [creando, setCreando] = useState(false)

  const [sel, setSel] = useState<Set<number>>(new Set())
  const [imprimir, setImprimir] = useState(false)
  const [tam, setTam] = useState(tamanoMembrete)

  const [borrarTramo, setBorrarTramo] = useState<{ desde: number; hasta: number } | null>(null)
  const [borrando, setBorrando] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      setLista(await cargarListaCajas())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar la lista.')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  // Agrupado de a 50 (la lista ya viene ordenada)
  const porTramo = useMemo(() => {
    const m = new Map<number, { desde: number; hasta: number; nums: number[] }>()
    for (const n of lista) {
      const t = tramoDe(n)
      const g = m.get(t.desde) ?? { ...t, nums: [] }
      g.nums.push(n)
      m.set(t.desde, g)
    }
    return [...m.values()]
  }, [lista])

  /** Crea las cajas desde..hasta; las que ya existen quedan igual */
  async function crear(e: FormEvent) {
    e.preventDefault()
    const d = Math.floor(Number(desde))
    const h = hasta.trim() ? Math.floor(Number(hasta)) : d
    if (!(d >= 1) || !(h >= d)) {
      setError('Poné el número de caja (desde 1) y, si querés varias, un "hasta" igual o mayor.')
      return
    }
    if (h - d + 1 > MAX_POR_VEZ) {
      setError(`Son ${h - d + 1} cajas: de a ${MAX_POR_VEZ} como máximo por vez.`)
      return
    }
    if (!supabase) return
    setCreando(true)
    setError(null)
    setAviso(null)
    const existentes = new Set(lista)
    const nuevas: { numero: number }[] = []
    for (let n = d; n <= h; n++) if (!existentes.has(n)) nuevas.push({ numero: n })
    const { error: e2 } = nuevas.length
      ? await supabase.from('mapeo_cajas_lista').upsert(nuevas, { onConflict: 'numero', ignoreDuplicates: true })
      : { error: null }
    setCreando(false)
    if (e2) {
      setError(e2.message)
      return
    }
    setAviso(nuevas.length === 0 ? 'Ya estaban todas creadas.' : `Se crearon ${nuevas.length} ${nuevas.length === 1 ? 'caja' : 'cajas'}.`)
    // Quedan seleccionadas las recién creadas, listas para imprimir
    setSel(new Set(nuevas.map((x) => x.numero)))
    void cargar()
  }

  async function confirmarBorrarTramo() {
    if (!borrarTramo || !supabase) return
    setBorrando(true)
    const { desde: d, hasta: h } = borrarTramo
    const { error: e } = await supabase.from('mapeo_cajas_lista').delete().gte('numero', d).lte('numero', h)
    setBorrando(false)
    if (e) setError(e.message)
    else {
      setLista((prev) => prev.filter((n) => n < d || n > h))
      setSel((prev) => new Set([...prev].filter((n) => n < d || n > h)))
    }
    setBorrarTramo(null)
  }

  function alternar(nums: number[]) {
    setSel((prev) => {
      const todos = nums.every((n) => prev.has(n))
      const s = new Set(prev)
      for (const n of nums) {
        if (todos) s.delete(n)
        else s.add(n)
      }
      return s
    })
  }

  const previa = (() => {
    const d = Math.floor(Number(desde))
    if (!(d >= 1)) return 'Ej: desde 1 hasta 200 crea las cajas 1 a 200. '
    const h = hasta.trim() ? Math.floor(Number(hasta)) : d
    if (!(h >= d)) return ''
    return h > d ? `Crea las cajas ${d} a ${h} (${h - d + 1}). ` : `Crea la caja ${d}. `
  })()

  const seleccionadas = useMemo(() => lista.filter((n) => sel.has(n)), [lista, sel])
  const todoSel = lista.length > 0 && lista.every((n) => sel.has(n))

  return (
    <Layout>
      <BackButton />
      <header className="mb-3 mt-2">
        <h1 className="font-display text-2xl font-semibold text-ink">Lista de cajas</h1>
        <p className="text-sm text-sub">Creá los números de caja e imprimí sus QR en membrete.</p>
      </header>

      {error && (
        <p role="alert" className="mb-3 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>
      )}
      {aviso && (
        <p className="mb-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-400">{aviso}</p>
      )}

      {puedeGestionar && (
        <form onSubmit={(e) => void crear(e)} className="mb-4 rounded-2xl border border-line bg-surface p-4 shadow-soft">
          <p className="mb-2.5 font-display text-sm font-semibold text-ink">Crear cajas</p>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-[1fr_1fr_auto]">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-sub">Desde caja</span>
              <input type="number" inputMode="numeric" min={1} value={desde} onChange={(e) => setDesde(e.target.value)} placeholder="Ej: 1" className={inputCls} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-sub">Hasta caja (opcional)</span>
              <input type="number" inputMode="numeric" min={1} value={hasta} onChange={(e) => setHasta(e.target.value)} placeholder="Ej: 200" className={inputCls} />
            </label>
            <button
              type="submit"
              disabled={creando}
              className="btn-press col-span-2 inline-flex h-11 items-center justify-center gap-1.5 self-end rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white shadow-soft transition hover:bg-emerald-700 disabled:opacity-60 sm:col-span-1"
            >
              {creando ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Plus size={16} aria-hidden />} Crear
            </button>
          </div>
          <p className="mt-2 text-xs text-sub">
            {previa}
            Las que ya existen no se tocan. Si no creás ninguna, al escanear se acepta cualquier número.
          </p>
        </form>
      )}

      {lista.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button
            onClick={() => alternar(lista)}
            className="btn-press inline-flex h-11 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-sm font-medium text-ink transition hover:bg-surface2"
          >
            {todoSel ? 'Quitar selección' : 'Seleccionar todo'}
          </button>
          <button
            onClick={() => setImprimir(true)}
            disabled={seleccionadas.length === 0}
            className="btn-press ml-auto inline-flex h-11 items-center gap-1.5 rounded-xl bg-orange-600 px-4 text-sm font-semibold text-white shadow-soft transition hover:bg-orange-700 disabled:opacity-50"
          >
            <Printer size={16} aria-hidden /> Imprimir QR ({seleccionadas.length})
          </button>
        </div>
      )}

      {cargando && lista.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sub">
          <Loader2 size={18} className="animate-spin" aria-hidden /> Cargando…
        </div>
      ) : lista.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line bg-surface/50 px-4 py-12 text-center text-sm text-sub">
          Todavía no hay cajas creadas.
        </p>
      ) : (
        <div className="space-y-3 pb-4">
          {porTramo.map(({ desde: d, hasta: h, nums }) => {
            const todos = nums.every((n) => sel.has(n))
            return (
              <div key={d} className="overflow-hidden rounded-2xl border border-line bg-surface">
                <div className="flex items-center gap-2 border-b border-line px-4 py-2">
                  <label className="flex min-h-[2.5rem] flex-1 cursor-pointer items-center gap-2.5">
                    <input type="checkbox" checked={todos} onChange={() => alternar(nums)} className="h-4 w-4 accent-orange-600" />
                    <span className="font-display text-sm font-semibold tabular-nums text-ink">Cajas {d}–{h}</span>
                    <span className="inline-flex items-center gap-1 text-xs text-sub">
                      <Package size={12} aria-hidden /> {nums.length} de {TRAMO_CAJAS}
                    </span>
                  </label>
                  {puedeGestionar && (
                    <button
                      onClick={() => setBorrarTramo({ desde: d, hasta: h })}
                      className="flex h-9 w-9 items-center justify-center rounded-lg text-sub transition hover:bg-brand-600/10 hover:text-brand-400"
                      title="Borrar estas cajas de la lista"
                      aria-label={`Borrar cajas ${d} a ${h}`}
                    >
                      <Trash2 size={16} aria-hidden />
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 p-3">
                  {nums.map((n) => {
                    const on = sel.has(n)
                    return (
                      <button
                        key={n}
                        onClick={() => alternar([n])}
                        aria-pressed={on}
                        className={`inline-flex min-h-[2.5rem] min-w-[3rem] items-center justify-center rounded-xl border px-3 text-sm font-semibold tabular-nums transition ${
                          on ? 'border-orange-500/60 bg-orange-500/15 text-orange-500' : 'border-line bg-surface2 text-ink hover:bg-line'
                        }`}
                      >
                        {n}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {imprimir && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setImprimir(false)}>
          <div className="flex w-[95vw] max-w-[1100px] flex-col rounded-2xl border border-line bg-surface shadow-2xl" style={{ maxHeight: '92vh' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
                <Printer size={18} className="text-orange-400" aria-hidden /> Membretes de caja
              </h2>
              <button onClick={() => setImprimir(false)} className="rounded-lg border border-line p-1.5 text-sub transition hover:bg-line hover:text-ink" aria-label="Cerrar">
                <X size={16} aria-hidden />
              </button>
            </div>
            <div className="flex flex-wrap items-end gap-3 border-b border-line px-5 py-3">
              <label className="block w-28">
                <span className="mb-1 block text-xs font-medium text-sub">Ancho (mm)</span>
                <input type="number" min={20} value={tam.ancho} onChange={(e) => setTam((t) => ({ ...t, ancho: Number(e.target.value) || 80 }))} className={inputCls} />
              </label>
              <label className="block w-28">
                <span className="mb-1 block text-xs font-medium text-sub">Alto (mm)</span>
                <input type="number" min={20} value={tam.alto} onChange={(e) => setTam((t) => ({ ...t, alto: Number(e.target.value) || 50 }))} className={inputCls} />
              </label>
              <p className="pb-3 text-xs text-sub">Por defecto, el tamaño del membrete de Facturación.</p>
            </div>
            <div className="flex-1 overflow-auto px-5 py-4">
              <div className="etq-preview flex flex-wrap gap-3">
                {seleccionadas.map((n) => (
                  <MembreteCaja key={n} numero={n} ancho={tam.ancho} alto={tam.alto} />
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-3">
              <p className="text-xs text-sub">{seleccionadas.length} membretes · {tam.ancho} × {tam.alto} mm</p>
              <div className="flex gap-2">
                <button onClick={() => setImprimir(false)} className="btn-press rounded-xl border border-line bg-surface2 px-4 py-2 text-sm font-medium text-ink hover:bg-line">Cerrar</button>
                <button onClick={() => imprimirMembretes(tam.ancho, tam.alto)} className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700">
                  <Printer size={15} aria-hidden /> Imprimir
                </button>
              </div>
            </div>
            <div id="cajas-print-area" className="etiquetas-print-area">
              {seleccionadas.map((n) => (
                <MembreteCaja key={`p${n}`} numero={n} ancho={tam.ancho} alto={tam.alto} />
              ))}
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={borrarTramo != null}
        title={borrarTramo ? `¿Borrar las cajas ${borrarTramo.desde}–${borrarTramo.hasta}?` : ''}
        message="Se sacan de la lista de cajas. Lo ya mapeado adentro no se toca."
        confirmLabel="Borrar"
        busy={borrando}
        onCancel={() => setBorrarTramo(null)}
        onConfirm={() => void confirmarBorrarTramo()}
      />
    </Layout>
  )
}
