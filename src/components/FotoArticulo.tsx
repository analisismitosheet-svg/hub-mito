import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, ImageOff, X } from 'lucide-react'
import { fotosArticulo, useFotosArticulos } from '@/lib/fotosArticulos'

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
 * El zoom muestra TODAS las fotos del artículo (los otros colores / ángulos)
 * con flechas, contador y miniaturas. Si no hay foto publicada muestra un
 * recuadro "sin foto".
 */
export default function FotoArticulo({ codigo, nombre, size = 44, className = '' }: FotoArticuloProps) {
  const mapa = useFotosArticulos()
  const fotos = useMemo(() => fotosArticulo(codigo, mapa), [codigo, mapa])
  const [abierta, setAbierta] = useState(false)
  const [indice, setIndice] = useState(0)
  const total = fotos.length

  const ir = useCallback(
    (delta: number) => {
      if (!total) return
      setIndice((i) => (i + delta + total) % total)
    },
    [total],
  )

  useEffect(() => {
    if (!abierta) return
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAbierta(false)
      if (e.key === 'ArrowRight') ir(1)
      if (e.key === 'ArrowLeft') ir(-1)
    }
    window.addEventListener('keydown', alTeclear)
    return () => window.removeEventListener('keydown', alTeclear)
  }, [abierta, ir])

  if (!total) {
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

  const actual = fotos[Math.min(indice, total - 1)]

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setIndice(0)
          setAbierta(true)
        }}
        className={`group relative inline-flex shrink-0 cursor-zoom-in overflow-hidden rounded-lg border border-line bg-surface2 transition hover:border-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 ${className}`}
        style={{ width: size, height: size }}
        title={codigo ? `Ver ${total > 1 ? `las ${total} fotos` : 'la foto'} de ${codigo}` : 'Ver foto'}
        aria-label={codigo ? `Ver ${total > 1 ? `las ${total} fotos` : 'la foto'} de ${codigo}` : 'Ver foto'}
      >
        <img
          src={fotos[0]}
          alt={codigo ? `Foto de ${codigo}` : 'Foto del artículo'}
          loading="lazy"
          className="h-full w-full object-cover transition duration-150 group-hover:scale-105"
        />
        {total > 1 && (
          <span className="pointer-events-none absolute bottom-0 right-0 rounded-tl-md bg-black/65 px-1 text-[9px] font-semibold leading-4 text-white">
            {total}
          </span>
        )}
      </button>

      {abierta && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={codigo ? `Fotos de ${codigo}` : 'Fotos del artículo'}
          className="fixed inset-0 z-[90] flex flex-col items-center justify-center gap-3 bg-black/90 p-3 backdrop-blur-sm sm:p-6"
          onClick={() => setAbierta(false)}
        >
          <button
            type="button"
            onClick={() => setAbierta(false)}
            aria-label="Cerrar fotos"
            className="absolute right-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
          >
            <X size={20} aria-hidden />
          </button>

          <div
            className="relative flex w-full max-w-[min(1200px,96vw)] flex-1 items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            {total > 1 && (
              <button
                type="button"
                onClick={() => ir(-1)}
                aria-label="Foto anterior"
                className="absolute left-0 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 sm:left-2"
              >
                <ChevronLeft size={26} aria-hidden />
              </button>
            )}

            <img
              src={actual}
              alt={codigo ? `Foto ${indice + 1} de ${codigo}` : 'Foto del artículo'}
              className="max-h-[72vh] max-w-full rounded-xl object-contain shadow-2xl"
            />

            {total > 1 && (
              <button
                type="button"
                onClick={() => ir(1)}
                aria-label="Foto siguiente"
                className="absolute right-0 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 sm:right-2"
              >
                <ChevronRight size={26} aria-hidden />
              </button>
            )}
          </div>

          <div className="shrink-0 text-center" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-medium text-white/90">
              {codigo}
              {nombre ? <span className="text-white/60"> · {nombre}</span> : null}
              {total > 1 && <span className="ml-2 tabular-nums text-white/50">{indice + 1} / {total}</span>}
            </p>
          </div>

          {total > 1 && (
            <div
              className="flex max-h-[22vh] shrink-0 flex-wrap items-center justify-center gap-2 overflow-auto px-1"
              onClick={(e) => e.stopPropagation()}
            >
              {fotos.map((url, i) => (
                <button
                  key={url + i}
                  type="button"
                  onClick={() => setIndice(i)}
                  aria-label={`Ver foto ${i + 1}`}
                  aria-current={i === indice}
                  className={`h-14 w-14 shrink-0 overflow-hidden rounded-lg border-2 transition ${
                    i === indice ? 'border-brand-500 opacity-100' : 'border-white/15 opacity-60 hover:opacity-100'
                  }`}
                >
                  <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  )
}
