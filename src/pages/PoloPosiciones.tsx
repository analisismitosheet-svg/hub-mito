import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Loader2, MapPin, Plus, Printer, Trash2, X } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import ConfirmDialog from '@/components/ConfirmDialog'
import { tamanoMembrete } from '@/components/EtiquetasBultos'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { nombrePosicion, posicionValida, qrPosicion } from '@/lib/poloMapeo'

const inputCls =
  'h-11 w-full rounded-xl border border-line bg-surface2 px-3 text-base text-ink outline-none transition placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40'

const MAX_POR_VEZ = 1000

/** Arma los códigos: «PALET» + 1..20 -> PALET-1..PALET-20 (sin ceros); sin «desde», el código tal cual */
function codigosDe(prefijo: string, desde: string, hasta: string): string[] | string {
  const p = prefijo.trim().toUpperCase().replace(/\s+/g, '-').replace(/-+$/, '')
  if (!desde.trim()) {
    if (!p) return 'Poné un código (ej. A-01) o un prefijo con desde/hasta.'
    return posicionValida(p) ? [p] : 'El código solo puede tener letras, números y guiones (hasta 20).'
  }
  const d = Math.floor(Number(desde))
  const h = hasta.trim() ? Math.floor(Number(hasta)) : d
  if (!(d >= 0) || !(h >= d)) return 'El «hasta» tiene que ser igual o mayor que el «desde».'
  if (h - d + 1 > MAX_POR_VEZ) return `Son ${h - d + 1}: de a ${MAX_POR_VEZ} como máximo por vez.`
  const out: string[] = []
  for (let n = d; n <= h; n++) out.push(`${p ? `${p}-` : ''}${n}`)
  const mala = out.find((c) => !posicionValida(c))
  return mala ? `«${mala}» no sirve: letras, números y guiones, hasta 20.` : out
}

let lienzo: CanvasRenderingContext2D | null | undefined

/** Ancho real del texto en Arial negrita, por cada 1 de tamaño de letra (sin canvas, una estimación holgada) */
function anchoPorUnidad(texto: string, peso: number) {
  if (lienzo === undefined) lienzo = document.createElement('canvas').getContext('2d')
  if (!lienzo) return texto.length * 0.72
  lienzo.font = `${peso} 100px Arial, Helvetica, sans-serif`
  return lienzo.measureText(texto).width / 100
}

function MembretePosicion({ codigo, ancho, alto }: { codigo: string; ancho: number; alto: number }) {
  const nombre = nombrePosicion(codigo)
  const qrMm = Math.max(10, Math.min(alto - 8, ancho * 0.35))
  // ancho libre para el texto: menos QR, separación (2), relleno (4), borde y un margen de seguridad
  const textoMm = Math.max(5, ancho - qrMm - 8)
  const letraMm = Math.min(alto * 0.4, textoMm / anchoPorUnidad(nombre, 900))
  const tituloMm = Math.min(alto * 0.08, textoMm / anchoPorUnidad('POLO 52', 700))
  return (
    <div
      className="etiqueta-bulto"
      style={{ width: `${ancho}mm`, height: `${alto}mm`, flexDirection: 'row', alignItems: 'center', gap: '2mm', padding: '2mm' }}
    >
      <QRCodeSVG value={qrPosicion(codigo)} size={256} level="M" style={{ width: `${qrMm}mm`, height: `${qrMm}mm`, flexShrink: 0 }} />
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '1mm', minWidth: 0, flex: 1, textAlign: 'center' }}>
        <div style={{ fontSize: `${tituloMm}mm`, fontWeight: 700, textTransform: 'uppercase' }}>POLO 52</div>
        <div style={{ fontSize: `${letraMm}mm`, fontWeight: 900, lineHeight: 1, whiteSpace: 'nowrap' }}>
          {nombre}
        </div>
      </div>
    </div>
  )
}

function imprimirMembretes(ancho: number, alto: number) {
  const src = document.getElementById('polo-posiciones-print-area')
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

/** Polo 52 · Posiciones (palets): crear códigos e imprimir sus QR */
export default function PoloPosiciones() {
  const { isAdmin, can } = useAuth()
  const puedeGestionar = isAdmin || can('polo52.mapeo.gestionar')

  const [lista, setLista] = useState<string[]>([])
  const [ocupadas, setOcupadas] = useState<Map<string, number>>(new Map())
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const [prefijo, setPrefijo] = useState('')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [creando, setCreando] = useState(false)

  const [sel, setSel] = useState<Set<string>>(new Set())
  const [imprimir, setImprimir] = useState(false)
  const [tam, setTam] = useState(tamanoMembrete)
  const [borrar, setBorrar] = useState<string | null>(null)
  const [borrando, setBorrando] = useState(false)

  const cargar = useCallback(async () => {
    if (!supabase) return
    setError(null)
    const [p, b] = await Promise.all([
      supabase.from('polo_posiciones').select('codigo').limit(5000),
      supabase.from('polo_mapeo_bultos').select('posicion').limit(20000),
    ])
    setCargando(false)
    if (p.error) return setError(p.error.message)
    setLista((p.data ?? []).map((x) => x.codigo as string).sort((a, c) => a.localeCompare(c, 'es', { numeric: true })))
    const m = new Map<string, number>()
    for (const x of b.data ?? []) m.set(x.posicion as string, (m.get(x.posicion as string) ?? 0) + 1)
    setOcupadas(m)
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const previa = useMemo(() => {
    const r = codigosDe(prefijo, desde, hasta)
    if (typeof r === 'string') return ''
    return r.length === 1 ? `Crea la posición ${nombrePosicion(r[0])}.` : `Crea ${nombrePosicion(r[0])} a ${nombrePosicion(r[r.length - 1])} (${r.length}).`
  }, [prefijo, desde, hasta])

  async function crear(e: FormEvent) {
    e.preventDefault()
    const r = codigosDe(prefijo, desde, hasta)
    if (typeof r === 'string') return setError(r)
    if (!supabase) return
    setCreando(true)
    setError(null)
    setAviso(null)
    const { data, error: e2 } = await supabase.rpc('polo_posiciones_crear', { p_codigos: r })
    setCreando(false)
    if (e2) return setError(e2.message)
    const n = Number(data ?? 0)
    setAviso(n === 0 ? 'Ya estaban todas creadas.' : `Se crearon ${n} ${n === 1 ? 'posición' : 'posiciones'}.`)
    setSel(new Set(r))
    void cargar()
  }

  async function confirmarBorrar() {
    if (!borrar || !supabase) return
    setBorrando(true)
    const { error: e } = await supabase.rpc('polo_posicion_borrar', { p_codigo: borrar })
    setBorrando(false)
    if (e) setError(e.message)
    setBorrar(null)
    void cargar()
  }

  function alternar(cs: string[]) {
    setSel((prev) => {
      const todos = cs.every((c) => prev.has(c))
      const s = new Set(prev)
      for (const c of cs) {
        if (todos) s.delete(c)
        else s.add(c)
      }
      return s
    })
  }

  const seleccionadas = lista.filter((c) => sel.has(c))
  const todoSel = lista.length > 0 && lista.every((c) => sel.has(c))

  return (
    <Layout>
      <BackButton />
      <header className="mb-3 mt-2">
        <h1 className="font-display text-2xl font-semibold text-ink">Posiciones de Polo 52</h1>
        <p className="text-sm text-sub">Creá los palets / posiciones e imprimí su QR para el mapeo de bultos.</p>
      </header>

      {error && <p role="alert" className="mb-3 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>}
      {aviso && <p className="mb-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-400">{aviso}</p>}

      {puedeGestionar && (
        <form onSubmit={(e) => void crear(e)} className="mb-4 rounded-2xl border border-line bg-surface p-4 shadow-soft">
          <p className="mb-2.5 font-display text-sm font-semibold text-ink">Crear posiciones</p>
          <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-[1.4fr_1fr_1fr_auto]">
            <label className="col-span-3 block sm:col-span-1">
              <span className="mb-1 block text-xs font-medium text-sub">Código o prefijo</span>
              <input value={prefijo} onChange={(e) => setPrefijo(e.target.value.toUpperCase())} placeholder="Ej: A" className={inputCls} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-sub">Desde (opcional)</span>
              <input type="number" inputMode="numeric" min={0} value={desde} onChange={(e) => setDesde(e.target.value)} placeholder="1" className={inputCls} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-sub">Hasta (opcional)</span>
              <input type="number" inputMode="numeric" min={0} value={hasta} onChange={(e) => setHasta(e.target.value)} placeholder="30" className={inputCls} />
            </label>
            <button
              type="submit"
              disabled={creando}
              className="btn-press inline-flex h-11 items-center justify-center gap-1.5 self-end rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white shadow-soft transition hover:bg-emerald-700 disabled:opacity-60"
            >
              {creando ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Plus size={16} aria-hidden />} Crear
            </button>
          </div>
          <p className="mt-2 text-xs text-sub">
            {previa || 'Ej: prefijo PALET, desde 1 hasta 30 crea PALET - 1 a PALET - 30. Sin «desde» crea el código tal cual.'} Las que ya existen no se tocan.
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
            className="btn-press ml-auto inline-flex h-11 items-center gap-1.5 rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white shadow-soft transition hover:bg-violet-700 disabled:opacity-50"
          >
            <Printer size={16} aria-hidden /> Imprimir QR ({seleccionadas.length})
          </button>
        </div>
      )}

      {cargando ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sub">
          <Loader2 size={18} className="animate-spin" aria-hidden /> Cargando…
        </div>
      ) : lista.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line bg-surface/50 px-4 py-12 text-center text-sm text-sub">Todavía no hay posiciones creadas.</p>
      ) : (
        <div className="flex flex-wrap gap-2 pb-4">
          {lista.map((c) => {
            const on = sel.has(c)
            const n = ocupadas.get(c) ?? 0
            return (
              <div
                key={c}
                className={`inline-flex min-h-[2.75rem] items-center rounded-xl border text-sm font-semibold transition ${
                  on ? 'border-violet-500/60 bg-violet-500/15 text-violet-500' : 'border-line bg-surface2 text-ink'
                }`}
              >
                <button onClick={() => alternar([c])} aria-pressed={on} className="inline-flex h-full items-center gap-1.5 px-3 py-2">
                  <MapPin size={14} aria-hidden /> {nombrePosicion(c)}
                  <span className="text-xs font-normal text-sub">{n > 0 ? `· ${n} bultos` : '· vacía'}</span>
                </button>
                {puedeGestionar && n === 0 && (
                  <button
                    onClick={() => setBorrar(c)}
                    className="mr-1 flex h-8 w-8 items-center justify-center rounded-lg text-sub transition hover:bg-brand-600/10 hover:text-brand-400"
                    aria-label={`Borrar posición ${c}`}
                    title="Borrar la posición (está vacía)"
                  >
                    <Trash2 size={14} aria-hidden />
                  </button>
                )}
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
                <Printer size={18} className="text-violet-400" aria-hidden /> Membretes de posición
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
                {seleccionadas.map((c) => <MembretePosicion key={c} codigo={c} ancho={tam.ancho} alto={tam.alto} />)}
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
            <div id="polo-posiciones-print-area" className="etiquetas-print-area">
              {seleccionadas.map((c) => <MembretePosicion key={`p${c}`} codigo={c} ancho={tam.ancho} alto={tam.alto} />)}
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={borrar != null}
        title={borrar ? `¿Borrar la posición ${borrar}?` : ''}
        message="Está vacía. Su QR impreso deja de servir hasta que la vuelvas a crear."
        confirmLabel="Borrar posición"
        busy={borrando}
        onCancel={() => setBorrar(null)}
        onConfirm={() => void confirmarBorrar()}
      />
    </Layout>
  )
}
