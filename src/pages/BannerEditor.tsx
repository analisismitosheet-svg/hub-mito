import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Loader2, Save, Upload, Image as ImageIcon, Trash2 } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { supabase } from '@/lib/supabase'
import { BannerView, BANNER_DEFAULT, type BannerConfig } from '@/components/Banner'

function Campo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-sub">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  )
}

function Color({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-12 cursor-pointer rounded-lg border border-line bg-surface2"
      />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-24 rounded-lg border border-line bg-surface2 px-2 py-1.5 text-sm text-ink outline-none focus-visible:border-brand-500"
      />
    </div>
  )
}

const inputCls =
  'w-full rounded-lg border border-line bg-surface2 px-3 py-2 text-sm text-ink outline-none focus-visible:border-brand-500'

export default function BannerEditor() {
  const [cfg, setCfg] = useState<BannerConfig>(BANNER_DEFAULT)
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [subiendo, setSubiendo] = useState<'bg_image' | 'logo' | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const bgRef = useRef<HTMLInputElement>(null)
  const logoRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!supabase) return
    supabase
      .from('config_app')
      .select('valor')
      .eq('clave', 'banner')
      .maybeSingle()
      .then(({ data }) => {
        if (data?.valor) setCfg({ ...BANNER_DEFAULT, ...(data.valor as Partial<BannerConfig>) })
        setCargando(false)
      })
  }, [])

  function set(patch: Partial<BannerConfig>) {
    setCfg((c) => ({ ...c, ...patch }))
  }
  function flash(t: string) {
    setMsg(t)
    setTimeout(() => setMsg((m) => (m === t ? null : m)), 2500)
  }

  async function subir(campo: 'bg_image' | 'logo', file: File) {
    if (!supabase) return
    setSubiendo(campo)
    const ext = file.name.split('.').pop() || 'png'
    const path = `${campo}-${Date.now()}.${ext}`
    const up = await supabase.storage.from('banners').upload(path, file, {
      contentType: file.type || 'image/png',
      upsert: true,
    })
    setSubiendo(null)
    if (up.error) {
      flash('No se pudo subir la imagen')
      return
    }
    const { data } = supabase.storage.from('banners').getPublicUrl(path)
    set({ [campo]: data.publicUrl } as Partial<BannerConfig>)
  }

  async function guardar() {
    if (!supabase) return
    setGuardando(true)
    const { error } = await supabase.from('config_app').upsert({ clave: 'banner', valor: cfg })
    setGuardando(false)
    flash(error ? 'No se pudo guardar' : 'Banner guardado')
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
          <h1 className="font-display text-2xl font-semibold text-ink">Editor de banner</h1>
          <p className="mt-1 text-sm text-sub">Personalizá el banner que se muestra arriba del menú.</p>
        </div>
        <div className="flex items-center gap-2">
          {msg && (
            <span className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-sm text-emerald-400">
              {msg}
            </span>
          )}
          <button
            onClick={guardar}
            disabled={guardando}
            className="btn-press flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {guardando ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Save size={15} aria-hidden />}
            Guardar
          </button>
        </div>
      </header>

      {/* Vista previa */}
      <div className="mb-5">
        <p className="mb-2 text-xs text-sub">Vista previa</p>
        {cfg.enabled ? (
          <BannerView config={cfg} />
        ) : (
          <div className="rounded-2xl border border-dashed border-line2 bg-surface2 p-6 text-center text-sm text-sub">
            El banner está desactivado. Activalo abajo para verlo y mostrarlo en el menú.
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* General */}
        <section className="space-y-3 rounded-2xl border border-line bg-surface p-4">
          <h2 className="text-sm font-semibold text-ink">General</h2>
          <label className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface2 px-3 py-2">
            <span className="text-sm text-ink">Banner activo</span>
            <button
              type="button"
              onClick={() => set({ enabled: !cfg.enabled })}
              className={`relative h-6 w-11 rounded-full transition ${cfg.enabled ? 'bg-brand-600' : 'bg-line2'}`}
            >
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${cfg.enabled ? 'left-[22px]' : 'left-0.5'}`} />
            </button>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <Campo label="Alto (px)">
              <input type="number" value={cfg.height} onChange={(e) => set({ height: Number(e.target.value) })} className={inputCls} />
            </Campo>
            <Campo label="Redondeo (px)">
              <input type="number" value={cfg.radius} onChange={(e) => set({ radius: Number(e.target.value) })} className={inputCls} />
            </Campo>
          </div>
          <Campo label="Alineación">
            <select value={cfg.align} onChange={(e) => set({ align: e.target.value as BannerConfig['align'] })} className={inputCls}>
              <option value="left">Izquierda</option>
              <option value="center">Centro</option>
              <option value="right">Derecha</option>
            </select>
          </Campo>
        </section>

        {/* Fondo */}
        <section className="space-y-3 rounded-2xl border border-line bg-surface p-4">
          <h2 className="text-sm font-semibold text-ink">Fondo</h2>
          <Campo label="Tipo de fondo">
            <select value={cfg.bg_type} onChange={(e) => set({ bg_type: e.target.value as BannerConfig['bg_type'] })} className={inputCls}>
              <option value="color">Color</option>
              <option value="image">Imagen</option>
            </select>
          </Campo>
          {cfg.bg_type === 'color' ? (
            <Campo label="Color de fondo">
              <Color value={cfg.bg_color} onChange={(v) => set({ bg_color: v })} />
            </Campo>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => bgRef.current?.click()}
                  className="btn-press flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm text-ink hover:border-line2"
                >
                  {subiendo === 'bg_image' ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Upload size={15} aria-hidden />}
                  Subir imagen
                </button>
                {cfg.bg_image && (
                  <button onClick={() => set({ bg_image: null })} className="btn-press rounded-lg border border-line p-2 text-sub hover:text-brand-400" title="Quitar">
                    <Trash2 size={15} aria-hidden />
                  </button>
                )}
                <input ref={bgRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && subir('bg_image', e.target.files[0])} />
              </div>
              {cfg.bg_image && (
                <div className="flex items-center gap-2 text-xs text-sub">
                  <ImageIcon size={13} aria-hidden /> Imagen cargada
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Campo label="Ajuste">
                  <select value={cfg.bg_fit} onChange={(e) => set({ bg_fit: e.target.value as BannerConfig['bg_fit'] })} className={inputCls}>
                    <option value="cover">Cubrir</option>
                    <option value="contain">Contener</option>
                  </select>
                </Campo>
                <Campo label={`Oscurecer (${Math.round(cfg.overlay * 100)}%)`}>
                  <input type="range" min={0} max={1} step={0.05} value={cfg.overlay} onChange={(e) => set({ overlay: Number(e.target.value) })} className="w-full" />
                </Campo>
              </div>
            </div>
          )}
        </section>

        {/* Título */}
        <section className="space-y-3 rounded-2xl border border-line bg-surface p-4">
          <h2 className="text-sm font-semibold text-ink">Título</h2>
          <Campo label="Texto">
            <input value={cfg.title} onChange={(e) => set({ title: e.target.value })} className={inputCls} />
          </Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo label="Color">
              <Color value={cfg.title_color} onChange={(v) => set({ title_color: v })} />
            </Campo>
            <Campo label="Tamaño (px)">
              <input type="number" value={cfg.title_size} onChange={(e) => set({ title_size: Number(e.target.value) })} className={inputCls} />
            </Campo>
          </div>
        </section>

        {/* Subtítulo */}
        <section className="space-y-3 rounded-2xl border border-line bg-surface p-4">
          <h2 className="text-sm font-semibold text-ink">Subtítulo</h2>
          <Campo label="Texto">
            <input value={cfg.subtitle} onChange={(e) => set({ subtitle: e.target.value })} className={inputCls} />
          </Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo label="Color">
              <Color value={cfg.subtitle_color} onChange={(v) => set({ subtitle_color: v })} />
            </Campo>
            <Campo label="Tamaño (px)">
              <input type="number" value={cfg.subtitle_size} onChange={(e) => set({ subtitle_size: Number(e.target.value) })} className={inputCls} />
            </Campo>
          </div>
        </section>

        {/* Logo */}
        <section className="space-y-3 rounded-2xl border border-line bg-surface p-4">
          <h2 className="text-sm font-semibold text-ink">Logo / Imagen</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => logoRef.current?.click()}
              className="btn-press flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm text-ink hover:border-line2"
            >
              {subiendo === 'logo' ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Upload size={15} aria-hidden />}
              Subir logo
            </button>
            {cfg.logo && (
              <button onClick={() => set({ logo: null })} className="btn-press rounded-lg border border-line p-2 text-sub hover:text-brand-400" title="Quitar">
                <Trash2 size={15} aria-hidden />
              </button>
            )}
            <input ref={logoRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && subir('logo', e.target.files[0])} />
          </div>
          <Campo label="Alto del logo (px)">
            <input type="number" value={cfg.logo_height} onChange={(e) => set({ logo_height: Number(e.target.value) })} className={inputCls} />
          </Campo>
        </section>

        {/* Botón */}
        <section className="space-y-3 rounded-2xl border border-line bg-surface p-4">
          <h2 className="text-sm font-semibold text-ink">Botón (opcional)</h2>
          <div className="grid grid-cols-2 gap-3">
            <Campo label="Texto">
              <input value={cfg.btn_text} onChange={(e) => set({ btn_text: e.target.value })} className={inputCls} />
            </Campo>
            <Campo label="Enlace (URL)">
              <input value={cfg.btn_url} onChange={(e) => set({ btn_url: e.target.value })} placeholder="https://…" className={inputCls} />
            </Campo>
            <Campo label="Color de fondo">
              <Color value={cfg.btn_bg} onChange={(v) => set({ btn_bg: v })} />
            </Campo>
            <Campo label="Color del texto">
              <Color value={cfg.btn_color} onChange={(v) => set({ btn_color: v })} />
            </Campo>
          </div>
        </section>
      </div>
    </Layout>
  )
}
