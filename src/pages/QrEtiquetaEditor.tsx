import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Loader2, Save, Upload, Image as ImageIcon, Trash2, Printer } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { supabase } from '@/lib/supabase'
import {
  QrLabelPreview,
  imprimirEtiquetaQR,
  QR_LABEL_DEFAULT,
  type QrLabelConfig,
} from '@/components/QrEtiqueta'

const CLAVE = 'qr_etiqueta'

function Campo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-sub">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  )
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative h-6 w-11 rounded-full transition ${on ? 'bg-brand-600' : 'bg-line2'}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${on ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  )
}

const inputCls =
  'w-full rounded-lg border border-line bg-surface2 px-3 py-2 text-sm text-ink outline-none focus-visible:border-brand-500'

export default function QrEtiquetaEditor() {
  const [cfg, setCfg] = useState<QrLabelConfig>(QR_LABEL_DEFAULT)
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [subiendo, setSubiendo] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const logoRef = useRef<HTMLInputElement>(null)

  // Datos de muestra para la vista previa
  const nombreDemo = 'LOCAL DE EJEMPLO'
  const urlDemo = `${window.location.origin}/opinar/EJEMPLO`

  useEffect(() => {
    if (!supabase) return
    supabase
      .from('config_app')
      .select('valor')
      .eq('clave', CLAVE)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.valor) setCfg({ ...QR_LABEL_DEFAULT, ...(data.valor as Partial<QrLabelConfig>) })
        setCargando(false)
      })
  }, [])

  function set(patch: Partial<QrLabelConfig>) {
    setCfg((c) => ({ ...c, ...patch }))
  }
  function flash(t: string) {
    setMsg(t)
    setTimeout(() => setMsg((m) => (m === t ? null : m)), 2500)
  }

  async function subirLogo(file: File) {
    if (!supabase) return
    setSubiendo(true)
    const ext = file.name.split('.').pop() || 'png'
    const path = `logo-${Date.now()}.${ext}`
    const up = await supabase.storage.from('banners').upload(path, file, {
      contentType: file.type || 'image/png',
      upsert: true,
    })
    setSubiendo(false)
    if (up.error) {
      flash('No se pudo subir la imagen')
      return
    }
    const { data } = supabase.storage.from('banners').getPublicUrl(path)
    set({ logo: data.publicUrl })
  }

  async function guardar() {
    if (!supabase) return
    setGuardando(true)
    const { error } = await supabase.from('config_app').upsert({ clave: CLAVE, valor: cfg })
    setGuardando(false)
    flash(error ? 'No se pudo guardar' : 'Diseño guardado')
  }

  if (cargando) {
    return (
      <Layout>
        <BackButton />
        <p className="mt-4 text-sm text-sub">Cargando…</p>
      </Layout>
    )
  }

  return (
    <Layout>
      <BackButton />

      <header className="mb-5 mt-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">Etiqueta del QR</h1>
          <p className="mt-1 text-sm text-sub">Diseñá cómo se imprime el QR. Optimizado para impresoras térmicas (monocromo).</p>
        </div>
        <div className="flex items-center gap-2">
          {msg && (
            <span className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-sm text-emerald-400">
              {msg}
            </span>
          )}
          <button onClick={guardar} disabled={guardando} className="btn-press flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
            {guardando ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Save size={15} aria-hidden />}
            Guardar
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
        {/* Controles */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Formato */}
          <section className="space-y-3 rounded-2xl border border-line bg-surface p-4 sm:col-span-2">
            <h2 className="text-sm font-semibold text-ink">Formato de etiqueta</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Campo label="Ancho de etiqueta (mm)">
                <input type="number" value={cfg.ancho_mm} onChange={(e) => set({ ancho_mm: Number(e.target.value) })} className={inputCls} />
              </Campo>
              <Campo label="Tamaño del QR (mm)">
                <input type="number" value={cfg.qr_mm} onChange={(e) => set({ qr_mm: Number(e.target.value) })} className={inputCls} />
              </Campo>
              <Campo label="Alineación">
                <select value={cfg.align} onChange={(e) => set({ align: e.target.value as QrLabelConfig['align'] })} className={inputCls}>
                  <option value="left">Izquierda</option>
                  <option value="center">Centro</option>
                  <option value="right">Derecha</option>
                </select>
              </Campo>
            </div>
          </section>

          {/* Logo */}
          <section className="space-y-3 rounded-2xl border border-line bg-surface p-4">
            <h2 className="text-sm font-semibold text-ink">Logo (opcional)</h2>
            <div className="flex items-center gap-2">
              <button onClick={() => logoRef.current?.click()} className="btn-press flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm text-ink hover:border-line2">
                {subiendo ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Upload size={15} aria-hidden />}
                Subir logo
              </button>
              {cfg.logo && (
                <button onClick={() => set({ logo: null })} className="btn-press rounded-lg border border-line p-2 text-sub hover:text-brand-400" title="Quitar">
                  <Trash2 size={15} aria-hidden />
                </button>
              )}
              <input ref={logoRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && subirLogo(e.target.files[0])} />
            </div>
            {cfg.logo && (
              <div className="flex items-center gap-2 text-xs text-sub">
                <ImageIcon size={13} aria-hidden /> Logo cargado
              </div>
            )}
            <Campo label="Alto del logo (mm)">
              <input type="number" value={cfg.logo_alto_mm} onChange={(e) => set({ logo_alto_mm: Number(e.target.value) })} className={inputCls} />
            </Campo>
            <p className="text-xs text-sub">Tené en cuenta que la térmica imprime en blanco y negro; un logo simple (alto contraste) se ve mejor.</p>
          </section>

          {/* Nombre del local */}
          <section className="space-y-3 rounded-2xl border border-line bg-surface p-4">
            <h2 className="text-sm font-semibold text-ink">Nombre del local</h2>
            <label className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface2 px-3 py-2">
              <span className="text-sm text-ink">Mostrar el nombre</span>
              <Toggle on={cfg.mostrar_nombre} onClick={() => set({ mostrar_nombre: !cfg.mostrar_nombre })} />
            </label>
            {cfg.mostrar_nombre && (
              <div className="grid grid-cols-2 gap-3">
                <Campo label="Tamaño (pt)">
                  <input type="number" value={cfg.nombre_pt} onChange={(e) => set({ nombre_pt: Number(e.target.value) })} className={inputCls} />
                </Campo>
                <label className="flex items-end justify-between gap-2 rounded-lg border border-line bg-surface2 px-3 py-2">
                  <span className="text-sm text-ink">Negrita</span>
                  <Toggle on={cfg.nombre_bold} onClick={() => set({ nombre_bold: !cfg.nombre_bold })} />
                </label>
              </div>
            )}
          </section>

          {/* Textos */}
          <section className="space-y-3 rounded-2xl border border-line bg-surface p-4 sm:col-span-2">
            <h2 className="text-sm font-semibold text-ink">Textos</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Campo label="Encabezado (arriba del QR)">
                <input value={cfg.texto_encabezado} onChange={(e) => set({ texto_encabezado: e.target.value })} placeholder="Ej: ¿Cómo te atendimos?" className={inputCls} />
              </Campo>
              <Campo label="Tamaño encabezado (pt)">
                <input type="number" value={cfg.encabezado_pt} onChange={(e) => set({ encabezado_pt: Number(e.target.value) })} className={inputCls} />
              </Campo>
              <Campo label="Frase debajo del QR">
                <input value={cfg.cta} onChange={(e) => set({ cta: e.target.value })} className={inputCls} />
              </Campo>
              <Campo label="Tamaño frase (pt)">
                <input type="number" value={cfg.cta_pt} onChange={(e) => set({ cta_pt: Number(e.target.value) })} className={inputCls} />
              </Campo>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface2 px-3 py-2">
                <span className="text-sm text-ink">Mostrar la URL</span>
                <Toggle on={cfg.mostrar_url} onClick={() => set({ mostrar_url: !cfg.mostrar_url })} />
              </label>
              {cfg.mostrar_url && (
                <Campo label="Tamaño URL (pt)">
                  <input type="number" value={cfg.url_pt} onChange={(e) => set({ url_pt: Number(e.target.value) })} className={inputCls} />
                </Campo>
              )}
            </div>
          </section>
        </div>

        {/* Vista previa en vivo */}
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <div className="rounded-2xl border border-line bg-surface2 p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs text-sub">Vista previa ({cfg.ancho_mm} mm)</p>
              <button
                onClick={() => imprimirEtiquetaQR(cfg, nombreDemo, urlDemo)}
                className="btn-press flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-sub hover:text-ink"
              >
                <Printer size={13} aria-hidden /> Probar impresión
              </button>
            </div>
            <div className="flex justify-center overflow-auto rounded-xl bg-surface p-4">
              <QrLabelPreview config={cfg} nombre={nombreDemo} url={urlDemo} />
            </div>
          </div>
        </aside>
      </div>
    </Layout>
  )
}
