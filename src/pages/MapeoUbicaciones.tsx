import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Loader2, Plus, Printer, Trash2, X, Layers } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import ConfirmDialog from '@/components/ConfirmDialog'
import { tamanoMembrete } from '@/components/EtiquetasBultos'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { MAX_PASILLOS, cargarUbicaciones, codigoUbicacion, letraPasillo, qrUbicacion, type Ubicacion } from '@/lib/mapeo'

const inputCls =
  'h-11 w-full rounded-xl border border-line bg-surface2 px-3 text-base text-ink outline-none transition placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40'

/* ------------------------------------------------------------------ */
/*  Membrete de ubicación: mismo marco y tamaño que las etiquetas de   */
/*  bultos de Facturación (clase .etiqueta-bulto, tamaño predefinido). */
/* ------------------------------------------------------------------ */
function MembreteUbicacion({ u, ancho, alto }: { u: Ubicacion; ancho: number; alto: number }) {
  // QR cuadrado: lo que permita el lado corto, dejando lugar al texto
  const qrMm = Math.max(10, Math.min(alto - 6, ancho * 0.55))
  return (
    <div
      className="etiqueta-bulto"
      style={{ width: `${ancho}mm`, height: `${alto}mm`, flexDirection: 'row', alignItems: 'center', gap: '2mm', padding: '2mm' }}
    >
      <QRCodeSVG value={qrUbicacion(u.codigo)} size={256} level="M" style={{ width: `${qrMm}mm`, height: `${qrMm}mm`, flexShrink: 0 }} />
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', minWidth: 0, flex: 1, textAlign: 'center' }}>
        <div style={{ fontSize: `${alto * 0.07}mm`, fontWeight: 700 }}>PASILLO</div>
        <div style={{ fontSize: `${alto * 0.3}mm`, fontWeight: 800, lineHeight: 1 }}>{letraPasillo(u.pasillo)}</div>
        <div style={{ fontSize: `${alto * 0.07}mm`, fontWeight: 700, marginTop: '1mm' }}>NIVEL</div>
        <div style={{ fontSize: `${alto * 0.3}mm`, fontWeight: 800, lineHeight: 1 }}>{u.nivel}</div>
        <div style={{ fontSize: `${alto * 0.06}mm`, fontWeight: 600, marginTop: '1mm' }}>{u.codigo}</div>
      </div>
    </div>
  )
}

/** Imprime los membretes: una hoja por etiqueta, del tamaño del membrete (igual que Facturación) */
function imprimirMembretes(ancho: number, alto: number) {
  const src = document.getElementById('ubicaciones-print-area')
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

/** Mapeo depósito · Lista pasillos / niveles: crearlos e imprimir sus QR */
export default function MapeoUbicaciones() {
  const { can } = useAuth()
  const puedeGestionar = can('mayorista.mapeo.gestionar')

  const [lista, setLista] = useState<Ubicacion[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  // Crear
  const [pasillos, setPasillos] = useState('')
  const [niveles, setNiveles] = useState('')
  const [creando, setCreando] = useState(false)

  // Selección para imprimir
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [imprimir, setImprimir] = useState(false)
  const [tam, setTam] = useState(tamanoMembrete)

  // Borrar un pasillo entero
  const [borrarPasillo, setBorrarPasillo] = useState<number | null>(null)
  const [borrando, setBorrando] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      setLista(await cargarUbicaciones())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar la lista.')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const porPasillo = useMemo(() => {
    const m = new Map<number, Ubicacion[]>()
    for (const u of lista) m.set(u.pasillo, [...(m.get(u.pasillo) ?? []), u])
    return [...m.entries()].sort((a, b) => a[0] - b[0])
  }, [lista])

  /** Crea pasillos A.. (P letras) con niveles 1..N; los que ya existen quedan igual */
  async function crear(e: FormEvent) {
    e.preventDefault()
    const p = Math.floor(Number(pasillos))
    const n = Math.floor(Number(niveles))
    if (!(p >= 1 && p <= MAX_PASILLOS) || !(n >= 1 && n <= 99)) {
      setError(`Poné entre 1 y ${MAX_PASILLOS} pasillos (A a Z) y entre 1 y 99 niveles.`)
      return
    }
    if (!supabase) return
    setCreando(true)
    setError(null)
    setAviso(null)
    const filas: Ubicacion[] = []
    for (let i = 1; i <= p; i++) for (let j = 1; j <= n; j++) filas.push({ codigo: codigoUbicacion(i, j), pasillo: i, nivel: j })
    const existentes = new Set(lista.map((u) => u.codigo))
    const nuevas = filas.filter((f) => !existentes.has(f.codigo))
    const { error: e2 } = nuevas.length
      ? await supabase.from('mapeo_ubicaciones').upsert(nuevas, { onConflict: 'codigo', ignoreDuplicates: true })
      : { error: null }
    setCreando(false)
    if (e2) {
      setError(e2.message)
      return
    }
    setAviso(nuevas.length === 0 ? 'Ya estaban todas creadas.' : `Se crearon ${nuevas.length} ubicaciones.`)
    void cargar()
  }

  async function confirmarBorrarPasillo() {
    if (borrarPasillo == null || !supabase) return
    setBorrando(true)
    const { error: e } = await supabase.from('mapeo_ubicaciones').delete().eq('pasillo', borrarPasillo)
    setBorrando(false)
    if (e) setError(e.message)
    else {
      const p = borrarPasillo
      const delPasillo = new Set(lista.filter((u) => u.pasillo === p).map((u) => u.codigo))
      setLista((prev) => prev.filter((u) => u.pasillo !== p))
      setSel((prev) => new Set([...prev].filter((c) => !delPasillo.has(c))))
    }
    setBorrarPasillo(null)
  }

  function alternar(codigos: string[]) {
    setSel((prev) => {
      const todos = codigos.every((c) => prev.has(c))
      const n = new Set(prev)
      for (const c of codigos) {
        if (todos) n.delete(c)
        else n.add(c)
      }
      return n
    })
  }

  const seleccionadas = useMemo(() => lista.filter((u) => sel.has(u.codigo)), [lista, sel])
  const todosCodigos = useMemo(() => lista.map((u) => u.codigo), [lista])
  const todoSel = todosCodigos.length > 0 && todosCodigos.every((c) => sel.has(c))

  return (
    <Layout>
      <BackButton />
      <header className="mb-3 mt-2">
        <h1 className="font-display text-2xl font-semibold text-ink">Lista pasillos / niveles</h1>
        <p className="text-sm text-sub">Creá las ubicaciones del depósito e imprimí sus QR en membrete.</p>
      </header>

      {error && (
        <p role="alert" className="mb-3 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>
      )}
      {aviso && (
        <p className="mb-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-400">{aviso}</p>
      )}

      {puedeGestionar && (
        <form onSubmit={(e) => void crear(e)} className="mb-4 rounded-2xl border border-line bg-surface p-4 shadow-soft">
          <p className="mb-2.5 font-display text-sm font-semibold text-ink">Crear ubicaciones</p>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-[1fr_1fr_auto]">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-sub">Cantidad de pasillos</span>
              <input type="number" inputMode="numeric" min={1} max={MAX_PASILLOS} value={pasillos} onChange={(e) => setPasillos(e.target.value)} placeholder="Ej: 6 (A a F)" className={inputCls} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-sub">Niveles por pasillo</span>
              <input type="number" inputMode="numeric" min={1} max={99} value={niveles} onChange={(e) => setNiveles(e.target.value)} placeholder="Ej: 4" className={inputCls} />
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
            {Number(pasillos) >= 1 && Number(pasillos) <= MAX_PASILLOS
              ? `Crea los pasillos A a ${letraPasillo(Math.floor(Number(pasillos)))}, cada uno con esos niveles. `
              : 'Los pasillos van por letra (A a Z). '}
            Las que ya existen no se tocan: para sumar pasillos, poné el total nuevo.
          </p>
        </form>
      )}

      {/* Barra de selección / impresión */}
      {lista.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button
            onClick={() => alternar(todosCodigos)}
            className="btn-press inline-flex h-11 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-sm font-medium text-ink transition hover:bg-surface2"
          >
            {todoSel ? 'Quitar selección' : 'Seleccionar todo'}
          </button>
          <button
            onClick={() => setImprimir(true)}
            disabled={seleccionadas.length === 0}
            className="btn-press ml-auto inline-flex h-11 items-center gap-1.5 rounded-xl bg-amber-600 px-4 text-sm font-semibold text-white shadow-soft transition hover:bg-amber-700 disabled:opacity-50"
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
          Todavía no hay pasillos creados.
        </p>
      ) : (
        <div className="space-y-3 pb-4">
          {porPasillo.map(([p, us]) => {
            const codigos = us.map((u) => u.codigo)
            const todos = codigos.every((c) => sel.has(c))
            return (
              <div key={p} className="overflow-hidden rounded-2xl border border-line bg-surface">
                <div className="flex items-center gap-2 border-b border-line px-4 py-2">
                  <label className="flex min-h-[2.5rem] flex-1 cursor-pointer items-center gap-2.5">
                    <input type="checkbox" checked={todos} onChange={() => alternar(codigos)} className="h-4 w-4 accent-amber-600" />
                    <span className="font-display text-sm font-semibold text-ink">Pasillo {letraPasillo(p)}</span>
                    <span className="inline-flex items-center gap-1 text-xs text-sub">
                      <Layers size={12} aria-hidden /> {us.length} {us.length === 1 ? 'nivel' : 'niveles'}
                    </span>
                  </label>
                  {puedeGestionar && (
                    <button
                      onClick={() => setBorrarPasillo(p)}
                      className="flex h-9 w-9 items-center justify-center rounded-lg text-sub transition hover:bg-brand-600/10 hover:text-brand-400"
                      title="Borrar pasillo"
                      aria-label={`Borrar pasillo ${letraPasillo(p)}`}
                    >
                      <Trash2 size={16} aria-hidden />
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 p-3">
                  {us.map((u) => {
                    const on = sel.has(u.codigo)
                    return (
                      <button
                        key={u.codigo}
                        onClick={() => alternar([u.codigo])}
                        aria-pressed={on}
                        className={`inline-flex min-h-[2.5rem] items-center rounded-xl border px-3 text-sm font-semibold transition ${
                          on ? 'border-amber-500/60 bg-amber-500/15 text-amber-500' : 'border-line bg-surface2 text-ink hover:bg-line'
                        }`}
                        title={u.codigo}
                      >
                        Nivel {u.nivel}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Impresión: previsualización + tamaño (por defecto el del membrete de Facturación) */}
      {imprimir && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setImprimir(false)}>
          <div className="flex w-[95vw] max-w-[1100px] flex-col rounded-2xl border border-line bg-surface shadow-2xl" style={{ maxHeight: '92vh' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
                <Printer size={18} className="text-amber-400" aria-hidden /> Membretes de ubicación
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
                {seleccionadas.map((u) => (
                  <MembreteUbicacion key={u.codigo} u={u} ancho={tam.ancho} alto={tam.alto} />
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
            {/* Área de impresión oculta en pantalla */}
            <div id="ubicaciones-print-area" className="etiquetas-print-area">
              {seleccionadas.map((u) => (
                <MembreteUbicacion key={`p${u.codigo}`} u={u} ancho={tam.ancho} alto={tam.alto} />
              ))}
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={borrarPasillo != null}
        title={`¿Borrar el pasillo ${borrarPasillo != null ? letraPasillo(borrarPasillo) : ''}?`}
        message="Se borran todos sus niveles de la lista. Lo ya mapeado no se toca."
        confirmLabel="Borrar"
        busy={borrando}
        onCancel={() => setBorrarPasillo(null)}
        onConfirm={() => void confirmarBorrarPasillo()}
      />
    </Layout>
  )
}
