import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowLeft, Camera, Loader2, Search, Tag, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import ScannerCamara from '@/components/ScannerCamara'
import { fotosArticulo, useFotosArticulos } from '@/lib/fotosArticulos'

/**
 * CONSULTA DE PRECIOS para clientes (link público /precios, sin usuario).
 * Versión web del tótem ConsultaPrecios.exe: buscar por código, nombre o
 * escaneando la etiqueta, y ver el precio de contado (LISTA1).
 * Datos: RPC `precios_publicos_buscar` (sql/precios_publicos.sql).
 * Se puede abrir directo con un artículo: /precios?q=CODIGO
 */

type Articulo = { articulo: string; descripcion: string; precio: number }
type Respuesta = { exacto?: Articulo; resultados: Articulo[]; actualizado?: string | null }

const pesos = (n: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)

const fechaHora = (iso: string) =>
  new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })

export default function PreciosPublicos() {
  const [params, setParams] = useSearchParams()
  const [texto, setTexto] = useState(params.get('q') ?? '')
  const [resultados, setResultados] = useState<Articulo[]>([])
  const [elegido, setElegido] = useState<Articulo | null>(null)
  const [buscado, setBuscado] = useState('')
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [actualizado, setActualizado] = useState<string | null>(null)
  const [camara, setCamara] = useState(false)
  const fotos = useFotosArticulos()
  const pedido = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    document.title = 'Consulta de precios · MITO'
  }, [])

  const buscar = useCallback(
    async (q: string) => {
      const limpio = q.trim()
      const n = ++pedido.current
      if (limpio.length < 2) {
        setResultados([])
        setBuscado('')
        setError(null)
        return
      }
      if (!supabase) {
        setError('La consulta no está disponible en este momento.')
        return
      }
      setCargando(true)
      setError(null)
      const { data, error: err } = await supabase.rpc('precios_publicos_buscar', { p_q: limpio })
      if (n !== pedido.current) return
      setCargando(false)
      if (err) {
        setError('No se pudo consultar. Revisá la conexión y probá de nuevo.')
        return
      }
      const r = (data ?? { resultados: [] }) as Respuesta
      setActualizado(r.actualizado ?? null)
      setResultados(r.resultados ?? [])
      setBuscado(limpio)
      if (r.exacto) setElegido(r.exacto)
    },
    [],
  )

  // Búsqueda mientras escribe (con pausa) y la del ?q= al abrir el link
  useEffect(() => {
    const t = setTimeout(() => void buscar(texto), 350)
    return () => clearTimeout(t)
  }, [texto, buscar])

  // El código queda en la URL: se puede compartir el link de un artículo
  useEffect(() => {
    const q = texto.trim()
    if ((params.get('q') ?? '') !== q) setParams(q ? { q } : {}, { replace: true })
  }, [texto, params, setParams])

  const leido = (cod: string) => {
    setCamara(false)
    setElegido(null)
    setTexto(cod.trim())
    if (navigator.vibrate) navigator.vibrate(60)
  }

  const limpiar = () => {
    setTexto('')
    setElegido(null)
    inputRef.current?.focus()
  }

  return (
    <div className="min-h-screen bg-paper px-4 pb-10 pt-6">
      <div className="mx-auto w-full max-w-lg">
        <header className="mb-5 flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-600 font-display text-lg font-bold text-white shadow-glow">
            M
          </div>
          <div>
            <h1 className="font-display text-xl font-semibold leading-tight text-ink">Consulta de precios</h1>
            <p className="text-sm text-sub">Buscá por código, nombre o escaneá la etiqueta</p>
          </div>
        </header>

        {elegido ? (
          <Detalle art={elegido} fotos={fotosArticulo(elegido.articulo, fotos)} onVolver={() => setElegido(null)} />
        ) : (
          <>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub" aria-hidden />
                <input
                  ref={inputRef}
                  value={texto}
                  onChange={(e) => {
                    setElegido(null)
                    setTexto(e.target.value)
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && void buscar(texto)}
                  autoFocus
                  inputMode="search"
                  enterKeyHint="search"
                  autoComplete="off"
                  autoCapitalize="characters"
                  maxLength={80}
                  placeholder="Ej: ZN126205 o remera negra"
                  aria-label="Código o nombre del artículo"
                  className="w-full rounded-xl border border-line bg-surface py-3 pl-10 pr-10 text-base text-ink outline-none transition placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40"
                />
                {texto && (
                  <button
                    type="button"
                    onClick={limpiar}
                    aria-label="Borrar"
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-sub hover:text-ink"
                  >
                    <X size={18} aria-hidden />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setCamara((v) => !v)}
                className="btn-press inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-brand-600 px-4 font-medium text-white shadow-soft hover:bg-brand-700"
              >
                <Camera size={18} aria-hidden />
                <span className="hidden sm:inline">Escanear</span>
              </button>
            </div>

            {camara && (
              <div className="mt-3">
                <ScannerCamara onLectura={(t) => leido(t)} onCerrar={() => setCamara(false)} />
              </div>
            )}

            <div className="mt-4">
              {cargando && resultados.length === 0 ? (
                <p className="flex items-center justify-center gap-2 py-10 text-sm text-sub">
                  <Loader2 size={16} className="animate-spin" aria-hidden /> Buscando…
                </p>
              ) : error ? (
                <p className="py-10 text-center text-sm text-brand-400">{error}</p>
              ) : buscado && resultados.length === 0 ? (
                <div className="py-10 text-center">
                  <p className="font-medium text-ink">No encontramos «{buscado}»</p>
                  <p className="mt-1 text-sm text-sub">Probá con otra palabra o con el código de la etiqueta.</p>
                </div>
              ) : !buscado ? (
                <div className="rounded-2xl border border-dashed border-line px-5 py-10 text-center text-sm text-sub">
                  <Tag size={28} className="mx-auto mb-2 text-sub/70" aria-hidden />
                  Escribí el código que figura en la etiqueta o tocá <b className="text-ink">Escanear</b> y apuntá al
                  código de barras.
                </div>
              ) : (
                <ul className="space-y-2" aria-live="polite">
                  {resultados.map((a) => {
                    const foto = fotosArticulo(a.articulo, fotos)[0]
                    return (
                      <li key={a.articulo}>
                        <button
                          type="button"
                          onClick={() => setElegido(a)}
                          className="btn-press flex w-full items-center gap-3 rounded-xl border border-line bg-surface p-2.5 text-left hover:border-line2"
                        >
                          <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-paper">
                            {foto ? (
                              <img src={foto} alt="" loading="lazy" className="h-full w-full object-cover" />
                            ) : (
                              <Tag size={18} className="text-sub/60" aria-hidden />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="line-clamp-2 text-sm font-medium text-ink">{a.descripcion}</p>
                            <p className="font-mono text-xs text-sub">{a.articulo}</p>
                          </div>
                          <p className="shrink-0 font-display text-base font-semibold tabular-nums text-ink">{pesos(a.precio)}</p>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </>
        )}

        <p className="mt-8 text-center text-xs text-sub">
          Precios de contado, con IVA incluido.
          {actualizado && <> Actualizados el {fechaHora(actualizado)} h.</>} Pueden variar sin previo aviso; el precio
          final es el que figura en caja.
        </p>
      </div>
    </div>
  )
}

function Detalle({ art, fotos, onVolver }: { art: Articulo; fotos: string[]; onVolver: () => void }) {
  const [foto, setFoto] = useState(0)
  useEffect(() => setFoto(0), [art.articulo])
  return (
    <div>
      <button
        type="button"
        onClick={onVolver}
        className="btn-press mb-3 inline-flex items-center gap-1.5 rounded-lg px-1 py-1 text-sm font-medium text-sub hover:text-ink"
      >
        <ArrowLeft size={16} aria-hidden /> Buscar otro
      </button>
      <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-soft-lg">
        {fotos.length > 0 && (
          <div className="bg-white">
            <img src={fotos[foto]} alt={art.descripcion} className="mx-auto aspect-square w-full max-w-sm object-contain" />
            {fotos.length > 1 && (
              <div className="flex gap-1.5 overflow-x-auto border-t border-line bg-surface p-2">
                {fotos.map((u, i) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => setFoto(i)}
                    aria-label={`Foto ${i + 1}`}
                    className={`h-12 w-12 shrink-0 overflow-hidden rounded-md border-2 ${i === foto ? 'border-brand-500' : 'border-transparent'}`}
                  >
                    <img src={u} alt="" loading="lazy" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="p-5 text-center">
          <p className="font-mono text-xs text-sub">{art.articulo}</p>
          <h2 className="mt-1 text-base font-medium text-ink">{art.descripcion}</h2>
          <p className="mt-4 font-display text-4xl font-bold tabular-nums text-ink">{pesos(art.precio)}</p>
          <p className="mt-1 text-sm text-sub">Precio de contado</p>
        </div>
      </div>
    </div>
  )
}
