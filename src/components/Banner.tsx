import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export interface BannerConfig {
  enabled: boolean
  height: number
  radius: number
  align: 'left' | 'center' | 'right'
  bg_type: 'color' | 'image'
  bg_color: string
  bg_image: string | null
  bg_fit: 'cover' | 'contain'
  overlay: number // 0..1 (oscurece el fondo para leer el texto)
  title: string
  title_color: string
  title_size: number
  subtitle: string
  subtitle_color: string
  subtitle_size: number
  logo: string | null
  logo_height: number
  btn_text: string
  btn_url: string
  btn_bg: string
  btn_color: string
}

export const BANNER_DEFAULT: BannerConfig = {
  enabled: false,
  height: 180,
  radius: 16,
  align: 'left',
  bg_type: 'color',
  bg_color: '#e11d2e',
  bg_image: null,
  bg_fit: 'cover',
  overlay: 0.25,
  title: 'Bienvenido a Hub Mito',
  title_color: '#ffffff',
  title_size: 28,
  subtitle: 'Tu centro de aplicaciones internas',
  subtitle_color: '#ffffff',
  subtitle_size: 15,
  logo: null,
  logo_height: 48,
  btn_text: '',
  btn_url: '',
  btn_bg: '#ffffff',
  btn_color: '#111111',
}

/** Vista presentacional del banner (se usa en el menú y en la vista previa del editor). */
export function BannerView({ config: c }: { config: BannerConfig }) {
  if (!c.enabled) return null
  const justify = c.align === 'center' ? 'center' : c.align === 'right' ? 'flex-end' : 'flex-start'
  const textAlign = c.align

  return (
    <div
      className="relative mb-6 flex w-full items-center overflow-hidden border border-line"
      style={{
        height: c.height,
        borderRadius: c.radius,
        backgroundColor: c.bg_type === 'color' ? c.bg_color : '#000',
        backgroundImage: c.bg_type === 'image' && c.bg_image ? `url(${c.bg_image})` : undefined,
        backgroundSize: c.bg_fit,
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }}
    >
      {c.bg_type === 'image' && c.overlay > 0 && (
        <div className="absolute inset-0" style={{ backgroundColor: `rgba(0,0,0,${c.overlay})` }} aria-hidden />
      )}
      <div
        className="relative z-10 flex w-full flex-col gap-2 px-6"
        style={{ alignItems: justify, textAlign }}
      >
        {c.logo && <img src={c.logo} alt="" style={{ height: c.logo_height }} className="object-contain" />}
        {c.title && (
          <div style={{ color: c.title_color, fontSize: c.title_size, fontWeight: 700, lineHeight: 1.1 }} className="font-display">
            {c.title}
          </div>
        )}
        {c.subtitle && (
          <div style={{ color: c.subtitle_color, fontSize: c.subtitle_size }}>{c.subtitle}</div>
        )}
        {c.btn_text && c.btn_url && (
          <a
            href={c.btn_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-flex items-center rounded-lg px-4 py-2 text-sm font-medium shadow-soft"
            style={{ backgroundColor: c.btn_bg, color: c.btn_color }}
          >
            {c.btn_text}
          </a>
        )}
      </div>
    </div>
  )
}

/** Carga la config del banner desde la base y lo muestra (para el menú). */
export default function Banner() {
  const [config, setConfig] = useState<BannerConfig | null>(null)

  useEffect(() => {
    if (!supabase) return
    supabase
      .from('config_app')
      .select('valor')
      .eq('clave', 'banner')
      .maybeSingle()
      .then(({ data }) => {
        if (data?.valor) setConfig({ ...BANNER_DEFAULT, ...(data.valor as Partial<BannerConfig>) })
      })
  }, [])

  if (!config) return null
  return <BannerView config={config} />
}
