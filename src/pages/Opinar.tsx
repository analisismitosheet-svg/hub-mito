import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Star, Loader2, Check } from 'lucide-react'
import { supabase } from '@/lib/supabase'

export default function Opinar() {
  const { local = '' } = useParams()
  const [nombre, setNombre] = useState<string | null>(null)
  const [puntaje, setPuntaje] = useState(0)
  const [hover, setHover] = useState(0)
  const [comentario, setComentario] = useState('')
  const [busy, setBusy] = useState(false)
  const [enviado, setEnviado] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!supabase || !local) return
    supabase.rpc('nombre_local', { p_codigo: local }).then(({ data }) => {
      setNombre((data as string | null) ?? null)
    })
  }, [local])

  async function enviar() {
    if (!supabase) return
    if (puntaje < 1) {
      setError('Elegí de 1 a 5 estrellas.')
      return
    }
    setBusy(true)
    setError(null)
    const { error } = await supabase.from('opiniones').insert({
      local,
      puntaje,
      comentario: comentario.trim() || null,
    })
    setBusy(false)
    if (error) {
      setError('No se pudo enviar. Probá de nuevo.')
      return
    }
    setEnviado(true)
  }

  const activo = hover || puntaje

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-8 text-center shadow-soft-lg">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 font-display text-lg font-bold text-white shadow-glow">
          M
        </div>

        {enviado ? (
          <>
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-400">
              <Check size={28} aria-hidden />
            </div>
            <h1 className="font-display text-xl font-semibold text-ink">¡Gracias por tu opinión!</h1>
            <p className="mt-2 text-sm text-sub">Tu puntaje nos ayuda a mejorar.</p>
          </>
        ) : (
          <>
            <h1 className="font-display text-xl font-semibold text-ink">¿Cómo fue tu experiencia?</h1>
            <p className="mt-1 text-sm text-sub">{nombre ?? local}</p>

            <div className="my-6 flex items-center justify-center gap-1.5" onMouseLeave={() => setHover(0)}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onMouseEnter={() => setHover(n)}
                  onClick={() => setPuntaje(n)}
                  aria-label={`${n} estrella${n > 1 ? 's' : ''}`}
                  className="p-1 transition-transform hover:scale-110"
                >
                  <Star
                    size={38}
                    aria-hidden
                    className={n <= activo ? 'text-amber-400' : 'text-line2'}
                    fill={n <= activo ? 'currentColor' : 'none'}
                  />
                </button>
              ))}
            </div>

            <textarea
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="Contanos algo (opcional)"
              className="w-full rounded-xl border border-line bg-surface2 px-3 py-2 text-ink outline-none transition placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40"
            />

            {error && <p className="mt-2 text-sm text-brand-400">{error}</p>}

            <button
              onClick={enviar}
              disabled={busy}
              className="btn-press mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-brand-600 py-2.5 font-medium text-white shadow-soft hover:bg-brand-700 disabled:opacity-50"
            >
              {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
              {busy ? 'Enviando…' : 'Enviar opinión'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
