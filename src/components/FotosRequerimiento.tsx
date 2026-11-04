import { useEffect, useMemo, useRef, useState } from 'react'
import { Camera, ExternalLink, ImageIcon, X } from 'lucide-react'
import { urlFoto } from '@/lib/requerimientos'

/** Miniaturas de las fotos de un requerimiento (bucket privado o link de Drive). */
export function FotosVer({ fotos }: { fotos: string[] }) {
  const [urls, setUrls] = useState<(string | null)[]>([])
  useEffect(() => {
    let vivo = true
    void Promise.all(fotos.map(urlFoto)).then((u) => { if (vivo) setUrls(u) })
    return () => { vivo = false }
  }, [fotos])
  if (!fotos.length) return null
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {fotos.map((f, i) => {
        const url = urls[i]
        // Drive no se deja mostrar como imagen: va como link
        if (/drive\.google\.com/i.test(f)) {
          return (
            <a key={f} href={f} target="_blank" rel="noreferrer"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface2 px-2.5 text-xs text-sub hover:text-ink">
              <ImageIcon size={14} aria-hidden /> Foto {i + 1} <ExternalLink size={12} aria-hidden />
            </a>
          )
        }
        return url ? (
          <a key={f} href={url} target="_blank" rel="noreferrer" className="block h-16 w-16 overflow-hidden rounded-lg border border-line">
            <img src={url} alt={`Foto ${i + 1}`} className="h-full w-full object-cover" loading="lazy" />
          </a>
        ) : (
          <span key={f} className="block h-16 w-16 animate-pulse rounded-lg border border-line bg-surface2" />
        )
      })}
    </div>
  )
}

/** Elegir hasta `max` fotos (cámara o galería), con vista previa y quitar. */
export function FotosElegir({ archivos, onCambio, max = 3, texto = 'Sacar o subir foto' }: {
  archivos: File[]
  onCambio: (a: File[]) => void
  max?: number
  texto?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const previas = useMemo(() => archivos.map((a) => URL.createObjectURL(a)), [archivos])
  useEffect(() => () => previas.forEach((u) => URL.revokeObjectURL(u)), [previas])

  return (
    <div className="flex flex-wrap items-center gap-2">
      {previas.map((u, i) => (
        <div key={u} className="relative h-20 w-20 overflow-hidden rounded-xl border border-line">
          <img src={u} alt={`Foto ${i + 1}`} className="h-full w-full object-cover" />
          <button type="button" onClick={() => onCambio(archivos.filter((_, j) => j !== i))} aria-label={`Quitar foto ${i + 1}`}
            className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white">
            <X size={14} aria-hidden />
          </button>
        </div>
      ))}
      {archivos.length < max && (
        <button type="button" onClick={() => input.current?.click()}
          className="btn-press flex h-20 min-w-20 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line2 bg-surface2 px-3 text-xs text-sub hover:text-ink">
          <Camera size={20} aria-hidden /> {texto}
        </button>
      )}
      <input ref={input} type="file" accept="image/*" multiple hidden
        onChange={(e) => {
          const nuevos = Array.from(e.target.files ?? [])
          onCambio([...archivos, ...nuevos].slice(0, max))
          e.target.value = ''
        }} />
    </div>
  )
}
