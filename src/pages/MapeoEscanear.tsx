import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import {
  Loader2, Check, AlertTriangle, Camera, CameraOff, MapPin, MoveDown, QrCode, Plus,
} from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import ScannerCamara from '@/components/ScannerCamara'
import { supabase } from '@/lib/supabase'
import {
  ChipsArticulo as Etiquetas, PREFIJO_UBICACION, cargarUbicaciones, fmtTalle, limpiarUbicacion,
  type AccionRepetido, type FilaEscaneo,
} from '@/lib/mapeo'

/**
 * Mapeo depósito · Escanear
 * Paso 1: QR de la ubicación. Paso 2: artículos de esa ubicación.
 * Escanear otra ubicación cambia dónde van los artículos siguientes.
 */
export default function MapeoEscanear() {
  const [ubicacion, setUbicacion] = useState<string | null>(null)
  const [camara, setCamara] = useState(false)
  const [enViaje, setEnViaje] = useState(0)
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null)
  // Artículo que ya estaba en otra ubicación: se pregunta si moverlo o agregarlo
  const [repetido, setRepetido] = useState<{ bruto: string; ubicacion: string; fila: FilaEscaneo } | null>(null)
  const [resolviendo, setResolviendo] = useState<AccionRepetido | null>(null)
  // Artículos escaneados en la ubicación actual (desde que se leyó su QR)
  const [enEsta, setEnEsta] = useState(0)

  const inputRef = useRef<HTMLInputElement>(null)
  const enfocar = useCallback(() => {
    // El escáner inalámbrico escribe como teclado: el foco tiene que volver siempre.
    window.setTimeout(() => inputRef.current?.focus(), 0)
  }, [])

  useEffect(() => {
    enfocar()
  }, [enfocar, ubicacion])

  const ubicacionRef = useRef(ubicacion)

  // Pasillos / niveles creados: si hay lista, solo se aceptan esas ubicaciones.
  // Además sirven para reconocer una ubicación leída con el lector inalámbrico.
  const validasRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    let vivo = true
    cargarUbicaciones()
      .then((l) => { if (vivo) validasRef.current = new Set(l.map((u) => u.codigo.toUpperCase())) })
      .catch(() => { /* sin lista: se acepta cualquier ubicación */ })
    return () => { vivo = false }
  }, [])

  const fijarUbicacion = useCallback((u: string) => {
    if (!u) return
    if (validasRef.current.size > 0 && !validasRef.current.has(u)) {
      setMensaje({ ok: false, texto: `La ubicación ${u} no está en la lista de pasillos / niveles.` })
      return
    }
    ubicacionRef.current = u
    setUbicacion(u)
    setEnEsta(0)
    setRepetido(null)
    setMensaje({ ok: true, texto: `Ubicación ${u}: ahora escaneá los artículos.` })
  }, [])

  const escanearArticulo = useCallback(async (codigo: string, accion?: AccionRepetido, ubicacionFija?: string) => {
    // Al resolver un repetido se usa la ubicación del momento en que se escaneó
    const ubic = ubicacionFija ?? ubicacionRef.current
    if (!codigo || !ubic || !supabase) return
    setEnViaje((n) => n + 1)
    try {
      // El servidor traduce el código con las equivalencias de Dragonfish
      const { data, error } = await supabase.rpc('mapeo_escanear', {
        p_codigo: codigo,
        p_ubicacion: ubic,
        p_accion: accion ?? null,
      })
      if (error) throw new Error(error.message)
      const f = ((Array.isArray(data) ? data[0] : data) ?? null) as FilaEscaneo | null
      if (!f) throw new Error('Sin respuesta del servidor.')
      const etiqueta = [f.codigo, f.color, fmtTalle(f.talle)].filter(Boolean).join(' · ')
      if (f.estado === 'ya_mapeado') {
        setRepetido({ bruto: codigo, ubicacion: ubic, fila: f })
        setMensaje(null)
      } else if (f.estado === 'ya_aca') {
        setRepetido(null)
        setMensaje({ ok: false, texto: `${etiqueta} ya está mapeado en ${ubic}` })
      } else {
        setRepetido(null)
        if (ubic === ubicacionRef.current) setEnEsta((n) => n + 1)
        const verbo = f.estado === 'movido' ? 'Movido' : f.estado === 'agregado' ? 'Agregado' : 'Mapeado'
        setMensaje({ ok: true, texto: `${verbo}: ${etiqueta}` })
      }
    } catch (e) {
      setRepetido(null)
      setMensaje({ ok: false, texto: e instanceof Error ? e.message : 'No se pudo guardar el escaneo.' })
    } finally {
      setEnViaje((n) => n - 1)
    }
  }, [])

  /** Cada lectura (lector, teclado o cámara): ¿ubicación o artículo? */
  const procesar = useCallback(
    (texto: string, formato?: string) => {
      const bruto = texto.trim()
      if (!bruto) return
      const esUbicacion =
        !ubicacionRef.current ||
        formato === 'QR_CODE' ||
        PREFIJO_UBICACION.test(bruto) ||
        validasRef.current.has(limpiarUbicacion(bruto))
      if (esUbicacion) fijarUbicacion(limpiarUbicacion(bruto))
      else void escanearArticulo(bruto)
    },
    [fijarUbicacion, escanearArticulo],
  )

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const input = inputRef.current
    if (!input) return
    const v = input.value
    input.value = ''
    procesar(v)
    enfocar()
  }

  async function resolverRepetido(accion: AccionRepetido) {
    if (!repetido) return
    setResolviendo(accion)
    await escanearArticulo(repetido.bruto, accion, repetido.ubicacion)
    setResolviendo(null)
    enfocar()
  }

  return (
    <Layout>
      <BackButton />
      <header className="mb-3 mt-2">
        <h1 className="font-display text-2xl font-semibold text-ink">Escanear</h1>
        <p className="text-sm text-sub">Escaneá el QR de la ubicación y después los artículos que están ahí.</p>
      </header>

      <div className="space-y-3 pb-4">
        <div className="space-y-3 rounded-2xl border border-line bg-surface p-4 shadow-soft">
          {/* Paso actual */}
          {ubicacion ? (
            <div className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
              <MapPin size={22} aria-hidden className="shrink-0 text-amber-500" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-sub">Ubicación</p>
                <p className="truncate font-display text-xl font-bold leading-tight text-ink">{ubicacion}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-display text-xl font-bold leading-tight tabular-nums text-amber-500">{enEsta}</p>
                <p className="text-[11px] text-sub">artículos</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-xl border border-dashed border-line bg-surface2 px-3 py-4">
              <QrCode size={26} aria-hidden className="shrink-0 text-amber-500" />
              <div>
                <p className="font-display font-semibold text-ink">Escaneá el QR de la ubicación</p>
                <p className="text-xs text-sub">Después se habilitan los códigos de barra de los artículos.</p>
              </div>
            </div>
          )}

          {/* Entrada: escáner inalámbrico (escribe + Enter), teclado o cámara */}
          <form onSubmit={onSubmit} className="flex gap-2">
            <input
              ref={inputRef}
              name="codigo"
              type="text"
              inputMode="text"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="send"
              placeholder={ubicacion ? 'Escaneá el artículo…' : 'Escaneá el QR de la ubicación…'}
              aria-label={ubicacion ? 'Código de barra del artículo' : 'QR de la ubicación'}
              onBlur={() => { if (!camara) enfocar() }}
              className="h-12 w-full min-w-0 rounded-xl border border-line bg-surface2 px-3 text-base text-ink outline-none transition placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40"
            />
            <button
              type="button"
              onClick={() => setCamara((c) => !c)}
              className="btn-press flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-line bg-surface2 text-ink transition hover:bg-line"
              title={camara ? 'Cerrar cámara' : 'Abrir cámara'}
              aria-label={camara ? 'Cerrar cámara' : 'Abrir cámara'}
            >
              {camara ? <CameraOff size={20} aria-hidden /> : <Camera size={20} aria-hidden />}
            </button>
          </form>

          {(mensaje || enViaje > 0) && (
            <div aria-live="polite" className="space-y-1.5">
              {mensaje && (
                <div
                  className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm font-medium ${
                    mensaje.ok
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                      : 'border-brand-600/40 bg-brand-600/10 text-brand-400'
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {mensaje.ok ? <Check size={16} className="shrink-0" aria-hidden /> : <AlertTriangle size={16} className="shrink-0" aria-hidden />}
                    <span className="truncate">{mensaje.texto}</span>
                  </span>
                </div>
              )}
              {enViaje > 0 && (
                <p className="flex items-center gap-1.5 text-xs text-sub">
                  <Loader2 size={12} className="animate-spin" aria-hidden />
                  Guardando {enViaje === 1 ? '1 escaneo' : `${enViaje} escaneos`}…
                </p>
              )}
            </div>
          )}

          {/* Artículo que ya está en otra ubicación: mover o agregar */}
          {repetido && (
            <div role="alert" className="space-y-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle size={18} aria-hidden className="mt-0.5 shrink-0 text-amber-500" />
                <div className="min-w-0 text-sm">
                  <Etiquetas m={repetido.fila} chico />
                  <p className="mt-1 text-sub">
                    Ya está en <span className="font-semibold text-ink">{repetido.fila.otras}</span>.
                    ¿Qué hacés en <span className="font-semibold text-ink">{repetido.ubicacion}</span>?
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => void resolverRepetido('mover')}
                  disabled={!!resolviendo}
                  className="btn-press inline-flex h-11 items-center justify-center gap-1.5 rounded-xl border border-amber-500/40 bg-surface text-sm font-semibold text-amber-500 transition hover:bg-amber-500/15 disabled:opacity-60"
                  title="Lo saca de la otra ubicación y lo deja solo en esta"
                >
                  {resolviendo === 'mover' ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <MoveDown size={16} aria-hidden />}
                  Mover
                </button>
                <button
                  onClick={() => void resolverRepetido('agregar')}
                  disabled={!!resolviendo}
                  className="btn-press inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 text-sm font-semibold text-white shadow-soft transition hover:bg-emerald-700 disabled:opacity-60"
                  title="Queda en las dos ubicaciones"
                >
                  {resolviendo === 'agregar' ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Plus size={16} aria-hidden />}
                  Agregar
                </button>
              </div>
            </div>
          )}

          {ubicacion && (
            <p className="text-xs text-sub">Para cambiar de ubicación, escaneá otro QR de ubicación.</p>
          )}
        </div>

        {camara && (
          <ScannerCamara
            conQr
            onLectura={(t, formato) => procesar(t, formato)}
            onCerrar={() => {
              setCamara(false)
              enfocar()
            }}
          />
        )}
      </div>
    </Layout>
  )
}
