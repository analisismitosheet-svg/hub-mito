import { useEffect, useMemo, useState } from 'react'
import { Star, QrCode, Copy, Check, MessageSquare, ChevronDown } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'

interface Opinion {
  id: string
  local: string
  puntaje: number
  comentario: string | null
  created_at: string
}
interface Local {
  codigo: string
  nombre: string
}

const PAGE = 1000

function Estrellas({ valor, size = 16 }: { valor: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={size}
          aria-hidden
          className={n <= Math.round(valor) ? 'text-amber-400' : 'text-line2'}
          fill={n <= Math.round(valor) ? 'currentColor' : 'none'}
        />
      ))}
    </span>
  )
}

export default function Opiniones() {
  const [opiniones, setOpiniones] = useState<Opinion[]>([])
  const [locales, setLocales] = useState<Local[]>([])
  const [cargando, setCargando] = useState(true)
  const [abierto, setAbierto] = useState<string | null>(null)
  const [copiado, setCopiado] = useState<string | null>(null)
  const [qr, setQr] = useState<string | null>(null)

  useEffect(() => {
    if (!supabase) return
    ;(async () => {
      const { data: locs } = await supabase!
        .from('locales')
        .select('codigo, nombre')
        .order('nombre')

      const todas: Opinion[] = []
      for (let desde = 0; ; desde += PAGE) {
        const { data, error } = await supabase!
          .from('opiniones')
          .select('id, local, puntaje, comentario, created_at')
          .order('created_at', { ascending: false })
          .range(desde, desde + PAGE - 1)
        if (error || !data || data.length === 0) break
        todas.push(...(data as Opinion[]))
        if (data.length < PAGE) break
      }
      setLocales((locs as Local[]) ?? [])
      setOpiniones(todas)
      setCargando(false)
    })()
  }, [])

  const nombrePorCodigo = useMemo(() => {
    const m = new Map<string, string>()
    locales.forEach((l) => m.set(l.codigo, l.nombre))
    return m
  }, [locales])

  // Resumen por local (incluye locales sin opiniones)
  const resumen = useMemo(() => {
    const porLocal = new Map<string, Opinion[]>()
    opiniones.forEach((o) => {
      const arr = porLocal.get(o.local) ?? []
      arr.push(o)
      porLocal.set(o.local, arr)
    })
    const codigos = new Set<string>([...locales.map((l) => l.codigo), ...porLocal.keys()])
    return [...codigos]
      .map((codigo) => {
        const ops = porLocal.get(codigo) ?? []
        const total = ops.length
        const prom = total ? ops.reduce((s, o) => s + o.puntaje, 0) / total : 0
        return {
          codigo,
          nombre: nombrePorCodigo.get(codigo) ?? codigo,
          total,
          prom,
          ops,
        }
      })
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  }, [opiniones, locales, nombrePorCodigo])

  const totalOpiniones = opiniones.length
  const promGeneral = totalOpiniones
    ? opiniones.reduce((s, o) => s + o.puntaje, 0) / totalOpiniones
    : 0

  function linkPublico(codigo: string) {
    return `${window.location.origin}/opinar/${encodeURIComponent(codigo)}`
  }
  async function copiar(codigo: string) {
    try {
      await navigator.clipboard.writeText(linkPublico(codigo))
      setCopiado(codigo)
      setTimeout(() => setCopiado((c) => (c === codigo ? null : c)), 1800)
    } catch {
      /* ignore */
    }
  }
  function fecha(iso: string) {
    return new Date(iso).toLocaleDateString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
    })
  }

  return (
    <Layout>
      <BackButton />

      <header className="mb-6 mt-2">
        <h1 className="font-display text-2xl font-semibold text-ink">Opiniones</h1>
        <p className="mt-1 text-sm text-sub">
          Puntaje de clientes por local. Compartí el enlace o el QR en cada tienda.
        </p>
      </header>

      {!cargando && (
        <div className="mb-6 flex flex-wrap items-center gap-4 rounded-2xl border border-line bg-surface p-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-display text-3xl font-bold text-ink">
                {promGeneral ? promGeneral.toFixed(1) : '—'}
              </span>
              <Estrellas valor={promGeneral} size={20} />
            </div>
            <p className="mt-0.5 text-xs text-sub">
              {totalOpiniones} opinión{totalOpiniones === 1 ? '' : 'es'} en total
            </p>
          </div>
        </div>
      )}

      {cargando ? (
        <p className="text-sm text-sub">Cargando…</p>
      ) : (
        <div className="space-y-2">
          {resumen.map((r) => {
            const open = abierto === r.codigo
            return (
              <div key={r.codigo} className="overflow-hidden rounded-2xl border border-line bg-surface">
                <div className="flex items-center gap-3 p-3">
                  <button
                    onClick={() => setAbierto(open ? null : r.codigo)}
                    className="flex flex-1 items-center gap-3 text-left"
                  >
                    <ChevronDown
                      size={16}
                      aria-hidden
                      className={`shrink-0 text-sub transition-transform ${open ? 'rotate-180' : ''}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-ink">{r.nombre}</span>
                      <span className="text-xs text-sub">
                        {r.total ? `${r.total} opinión${r.total === 1 ? '' : 'es'}` : 'Sin opiniones'}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="font-display text-lg font-semibold text-ink">
                        {r.total ? r.prom.toFixed(1) : '—'}
                      </span>
                      <Estrellas valor={r.prom} />
                    </span>
                  </button>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => copiar(r.codigo)}
                      title="Copiar enlace público"
                      className="btn-press rounded-lg border border-line p-2 text-sub hover:text-ink"
                    >
                      {copiado === r.codigo ? (
                        <Check size={15} className="text-emerald-400" aria-hidden />
                      ) : (
                        <Copy size={15} aria-hidden />
                      )}
                    </button>
                    <button
                      onClick={() => setQr(qr === r.codigo ? null : r.codigo)}
                      title="Ver QR"
                      className="btn-press rounded-lg border border-line p-2 text-sub hover:text-ink"
                    >
                      <QrCode size={15} aria-hidden />
                    </button>
                  </div>
                </div>

                {qr === r.codigo && (
                  <div className="flex flex-col items-center gap-2 border-t border-line bg-surface2 p-4">
                    <img
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=8&data=${encodeURIComponent(
                        linkPublico(r.codigo),
                      )}`}
                      alt={`QR para opinar sobre ${r.nombre}`}
                      width={180}
                      height={180}
                      className="rounded-xl bg-white p-2"
                    />
                    <code className="max-w-full truncate text-xs text-sub">{linkPublico(r.codigo)}</code>
                  </div>
                )}

                {open && (
                  <div className="border-t border-line bg-surface2 p-3">
                    {r.ops.length === 0 ? (
                      <p className="text-sm text-sub">Todavía no hay opiniones de este local.</p>
                    ) : (
                      <ul className="space-y-2">
                        {r.ops.map((o) => (
                          <li key={o.id} className="rounded-xl border border-line bg-surface p-3">
                            <div className="flex items-center justify-between gap-2">
                              <Estrellas valor={o.puntaje} />
                              <span className="text-xs text-sub">{fecha(o.created_at)}</span>
                            </div>
                            {o.comentario && (
                              <p className="mt-1.5 flex items-start gap-1.5 text-sm text-ink">
                                <MessageSquare size={14} className="mt-0.5 shrink-0 text-sub" aria-hidden />
                                <span>{o.comentario}</span>
                              </p>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Layout>
  )
}
