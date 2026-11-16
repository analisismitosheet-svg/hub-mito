import { useEffect, useRef, useState } from 'react'
import { Camera, CameraOff, Flashlight, Loader2, ZoomIn } from 'lucide-react'

/**
 * Escáner de códigos con la cámara usando zxing-cpp (zxing-wasm), para la consulta de precios (/precios).
 *
 * Por qué no html5-qrcode (16/11/2026): en iPhone no leía bien los Code 39 de las etiquetas. zxing-cpp
 * es bastante mejor con códigos de barra borrosos o chicos (tryHarder) y lee la imagen en alta
 * resolución. Además la vista previa es una franja baja (no ocupa toda la pantalla): se ve el
 * buscador y lo que se está escaneando sin desplazar.
 *
 * - Cámara trasera en 1920×1080; zoom 2x si el celular lo permite (los iPhone nuevos no enfocan a
 *   menos de ~15-20 cm: así se lee de más lejos); botón 1x/2x y linterna si existen.
 * - Se lee solo la franja marcada (centro de la imagen), unas 6 veces por segundo.
 * - El archivo .wasm del lector se sirve desde el mismo hub (import ?url), no desde un CDN.
 *   La CSP necesita 'wasm-unsafe-eval' en script-src (vercel.json).
 * Al desmontarse apaga la cámara siempre.
 */

const FORMATOS_1D = ['EAN-13', 'EAN-8', 'UPC-A', 'UPC-E', 'Code128', 'Code39', 'ITF', 'Codabar'] as const

type Lector = (img: ImageData) => Promise<Array<{ text: string; format: string; isValid: boolean }>>

let lectorListo: Promise<Lector> | null = null
/** Carga zxing-wasm una sola vez (y solo cuando se abre la cámara). */
function cargarLector(conQr: boolean): Promise<Lector> {
  if (!lectorListo) {
    lectorListo = (async () => {
      const [{ prepareZXingModule, readBarcodes }, { default: wasmUrl }] = await Promise.all([
        import('zxing-wasm/reader'),
        import('zxing-wasm/reader/zxing_reader.wasm?url'),
      ])
      await prepareZXingModule({
        overrides: { locateFile: (ruta: string, prefijo: string) => (ruta.endsWith('.wasm') ? wasmUrl : prefijo + ruta) },
        fireImmediately: true,
      })
      return (img: ImageData) =>
        readBarcodes(img, {
          formats: conQr ? [...FORMATOS_1D, 'QRCode'] : [...FORMATOS_1D],
          tryHarder: true,
          tryRotate: true,
          maxNumberOfSymbols: 1,
        })
    })()
    lectorListo.catch(() => {
      lectorListo = null
    })
  }
  return lectorListo
}

export default function EscanerZxing({
  onLectura,
  onCerrar,
  conQr = false,
}: {
  onLectura: (texto: string, formato?: string) => void
  onCerrar: () => void
  /** además de los códigos de barra, lee QR */
  conQr?: boolean
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const pistaRef = useRef<MediaStreamTrack | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [listo, setListo] = useState(false)
  const [zoom, setZoom] = useState<{ actual: number; max: number } | null>(null)
  const [linterna, setLinterna] = useState<boolean | null>(null)
  const lecturaRef = useRef(onLectura)
  lecturaRef.current = onLectura
  const ultimaRef = useRef<{ texto: string; ts: number } | null>(null)

  useEffect(() => {
    let vivo = true
    let flujo: MediaStream | null = null
    let temporizador: ReturnType<typeof setTimeout> | null = null
    const lienzo = document.createElement('canvas')
    const ctx = lienzo.getContext('2d', { willReadFrequently: true })

    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este navegador no permite usar la cámara.')
        const [lector, stream] = await Promise.all([
          cargarLector(conQr),
          navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          }),
        ])
        flujo = stream
        if (!vivo) return
        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        await video.play().catch(() => undefined)
        const pista = stream.getVideoTracks()[0]
        pistaRef.current = pista
        setListo(true)

        // Foco continuo (Android), zoom 2x y linterna si la cámara lo permite
        const caps = (pista.getCapabilities?.() ?? {}) as MediaTrackCapabilities & {
          zoom?: { min: number; max: number }
          torch?: boolean
          focusMode?: string[]
        }
        try {
          if (caps.focusMode?.includes('continuous')) {
            await pista.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] })
          }
        } catch {
          /* sin control de foco */
        }
        if (caps.zoom && caps.zoom.max > 1) {
          const inicial = Math.min(2, caps.zoom.max)
          try {
            await pista.applyConstraints({ advanced: [{ zoom: inicial } as MediaTrackConstraintSet] })
            if (vivo) setZoom({ actual: inicial, max: caps.zoom.max })
          } catch {
            /* sin zoom */
          }
        }
        if (caps.torch) setLinterna(false)

        // Lectura: la franja central de la imagen (lo que se ve marcado en pantalla)
        const leer = async () => {
          if (!vivo) return
          try {
            const w = video.videoWidth
            const h = video.videoHeight
            if (w && h && ctx) {
              const anchoF = Math.round(w * 0.9)
              const altoF = Math.round(conQr ? Math.min(h * 0.8, w * 0.6) : h * 0.45)
              lienzo.width = anchoF
              lienzo.height = altoF
              ctx.drawImage(video, (w - anchoF) / 2, (h - altoF) / 2, anchoF, altoF, 0, 0, anchoF, altoF)
              const res = await lector(ctx.getImageData(0, 0, anchoF, altoF))
              const r = res.find((x) => x.isValid && x.text)
              if (r && vivo) {
                const ahora = Date.now()
                const ultima = ultimaRef.current
                if (!ultima || ultima.texto !== r.text || ahora - ultima.ts > 700) {
                  ultimaRef.current = { texto: r.text, ts: ahora }
                  lecturaRef.current(r.text, r.format)
                }
              }
            }
          } catch {
            /* un cuadro que falla no corta la lectura */
          }
          if (vivo) temporizador = setTimeout(() => void leer(), 160)
        }
        void leer()
      } catch (e) {
        if (!vivo) return
        const nombre = e instanceof Error ? e.name : ''
        // Los mensajes del navegador vienen en inglés: se traducen los habituales
        const MENSAJES: Record<string, string> = {
          NotAllowedError: 'No diste permiso para usar la cámara.',
          SecurityError: 'No diste permiso para usar la cámara.',
          NotFoundError: 'No se encontró ninguna cámara en este equipo.',
          OverconstrainedError: 'No se encontró una cámara compatible.',
          NotReadableError: 'La cámara está siendo usada por otra aplicación.',
          AbortError: 'No se pudo abrir la cámara.',
        }
        setError(MENSAJES[nombre] ?? (e instanceof Error && /[áéíóúñ]/i.test(e.message) ? e.message : 'No se pudo abrir la cámara.'))
      }
    })()

    return () => {
      vivo = false
      if (temporizador) clearTimeout(temporizador)
      flujo?.getTracks().forEach((t) => t.stop())
      pistaRef.current = null
    }
  }, [conQr])

  const cambiarZoom = async () => {
    const pista = pistaRef.current
    if (!pista || !zoom) return
    const nuevo = zoom.actual >= 2 || zoom.max < 2 ? 1 : 2
    try {
      await pista.applyConstraints({ advanced: [{ zoom: nuevo } as MediaTrackConstraintSet] })
      setZoom({ ...zoom, actual: nuevo })
    } catch {
      /* queda como estaba */
    }
  }
  const cambiarLinterna = async () => {
    const pista = pistaRef.current
    if (!pista || linterna == null) return
    try {
      await pista.applyConstraints({ advanced: [{ torch: !linterna } as MediaTrackConstraintSet] })
      setLinterna(!linterna)
    } catch {
      /* no se pudo */
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="flex items-center gap-2 text-sm font-medium text-ink">
          <Camera size={15} aria-hidden /> Escaneando
        </span>
        <span className="flex-1" />
        {zoom && (
          <button
            type="button"
            onClick={() => void cambiarZoom()}
            aria-label={zoom.actual >= 2 ? 'Sacar el zoom' : 'Zoom 2x'}
            className="btn-press inline-flex items-center gap-1 rounded-lg border border-line bg-surface2 px-2.5 py-1 text-xs font-medium text-ink hover:bg-line"
          >
            <ZoomIn size={13} aria-hidden /> {zoom.actual >= 2 ? '2x' : '1x'}
          </button>
        )}
        {linterna != null && (
          <button
            type="button"
            onClick={() => void cambiarLinterna()}
            aria-label={linterna ? 'Apagar la linterna' : 'Prender la linterna'}
            aria-pressed={linterna}
            className={`btn-press inline-flex items-center rounded-lg border border-line px-2 py-1 text-xs font-medium hover:bg-line ${
              linterna ? 'bg-amber-400 text-black' : 'bg-surface2 text-ink'
            }`}
          >
            <Flashlight size={13} aria-hidden />
          </button>
        )}
        <button
          type="button"
          onClick={onCerrar}
          className="btn-press inline-flex items-center gap-1 rounded-lg border border-line bg-surface2 px-2.5 py-1 text-xs font-medium text-ink hover:bg-line"
        >
          <CameraOff size={13} aria-hidden /> Cerrar
        </button>
      </div>

      {/* Vista previa baja (no ocupa la pantalla): la imagen se recorta al centro */}
      <div className="relative h-44 bg-black sm:h-56">
        <video ref={videoRef} playsInline muted autoPlay className="absolute inset-0 h-full w-full object-cover" />
        {/* Franja de lectura */}
        {listo && !error && (
          <div
            className={`pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg border-2 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)] ${
              conQr ? 'h-[80%] w-[60%]' : 'h-[45%] w-[90%]'
            }`}
          >
            <div className="absolute inset-x-2 top-1/2 h-0.5 -translate-y-1/2 bg-red-500/80" />
          </div>
        )}
        {listo && !error && (
          <p className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/55 px-3 py-1 text-center text-[11px] text-white/90">
            Alejá el celular a unos 20 cm y mantenelo quieto
          </p>
        )}
        {!listo && !error && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 text-sm text-white/80">
            <Loader2 size={18} className="animate-spin" aria-hidden />
            Abriendo la cámara…
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/85 px-4 text-center text-sm text-white/90">
            <p className="font-medium text-red-400">No se pudo usar la cámara</p>
            <p className="text-xs text-white/70">{error}</p>
            <p className="text-xs text-white/50">Fijate de haber dado permiso, o escribí el código a mano.</p>
          </div>
        )}
      </div>
    </div>
  )
}
