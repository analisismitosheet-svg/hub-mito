import { useEffect, useState } from 'react'
import { ImageOff, X } from 'lucide-react'
import { fotoArticulo, useFotosArticulos } from '@/lib/fotosArticulos'

interface FotoArticuloProps {
  /** Código de artículo (ej. CF006001) */
  codigo: string | null | undefined
  /** Texto para el pie de la foto ampliada */
  nombre?: string | null
  /** Lado del thumbnail en px */
  size?: number
  className?: string
}

/**
 * Foto del artículo con zoom al clic.
 * Si el artículo no tiene foto publicada muestra un recuadro "sin foto".
 */
export default function FotoArticulo({ codigo, nombre, size = 44, className = '' }: FotoArticuloProps) {
  const fotos = useFotosArticulos()
  const url = fotoArticulo(codigo, fotos)
  const [abierta, setAbierta] = useState(false)

  useEffect(() => {
    if (!abierta) return
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAbierta(false)
    }
    window.addEventListener('keydown', alTeclear)
    return () => window.removeEventListener('keydown', alTeclear)
  }, [abierta])

  if (!url) {
    return (
      <div
        className={`inline-flex shrink-0 flex-col items-center justify-center rounded-lg border border-dashed border-line bg-surface2 text-center text-[9px] leading-tight text-sub ${className}`}
        style={{ width: size, height: size }}
        title={codigo ? `Sin foto publicada para ${codigo}` : 'Sin foto'}
        aria-label={codigo ? `Sin foto para ${codigo}` : 'Sin foto'}
      >
        <ImageOff size={Math.max(12, Math.round(size * 0.32))} aria-hidden />
      </div>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierta(true)}
        className={`group inline-flex shrink-0 cursor-zoom-in overflow-hidden rounded-lg border border-line bg-surface2 transition hover:border-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 ${className}`}
        style={{ width: size, height: size }}
        title={codigo ? `Ver foto de ${codigo}` : 'Ver foto'}
        aria-label={codigo ? `Ver foto de ${codigo}` : 'Ver foto'}
      >
        <img
          src={url}
          alt={codigo ? `Foto de ${codigo}` : 'Foto del artículo'}
          loading="lazy"
          className="h-full w-full object-cover transition duration-150 group-hover:scale-105"
        />
      </button>

      {abierta && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={codigo ? `Foto de ${codigo}` : 'Foto del artículo'}
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
          onClick={() => setAbierta(false)}
        >
          <button
            type="button"
            onClick={() => setAbierta(false)}
            aria-label="Cerrar foto"
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
          >
            <X size={20} aria-hidden />
          </button>
          <figure className="flex max-h-full max-w-[min(1100px,94vw)] flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
            <img
              src={url}
              alt={codigo ? `Foto de ${codigo}` : 'Foto del artículo'}
              className="max-h-[82vh] max-w-full rounded-xl object-contain shadow-2xl"
            />
            <figcaption className="text-center text-sm font-medium text-white/90">
              {codigo}
              {nombre ? <span className="text-white/60"> · {nombre}</span> : null}
            </figcaption>
          </figure>
        </div>
      )}
    </>
  )
}
