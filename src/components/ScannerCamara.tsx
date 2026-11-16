import { useEffect, useRef, useState } from 'react'
import { Camera, CameraOff, Flashlight, Loader2, ZoomIn } from 'lucide-react'
// Solo el tipo: así html5-qrcode NO entra en el bundle inicial.
// La librería real se trae con un import() cuando el usuario abre la cámara.
import type { Html5Qrcode } from 'html5-qrcode'

/** Códigos de barra de prenda/etiqueta (1D). QR solo si se pide con `conQr`. */
const FORMATOS_1D = ['EAN_13', 'EAN_8', 'UPC_A', 'UPC_E', 'CODE_128', 'CODE_39', 'ITF', 'CODABAR'] as const

/**
 * Visor de cámara que lee códigos de barra y pasa cada lectura por `onLectura`.
 * Al desmontarse libera la cámara siempre (si no, queda prendida en el celular).
 *
 * Pensado para que lea bien en iPhone (16/11/2026): los iPhone nuevos no enfocan a menos de
 * ~15-20 cm y la web no puede forzar el foco ni tocar para enfocar. Entonces se lee DE LEJOS:
 *  - se pide la cámara en 1920×1080 (más detalle para leer un código chico a 20 cm);
 *  - zoom 2x automático si el celular lo permite (botón 1x / 2x para cambiarlo);
 *  - el cuadro de lectura ocupa casi todo el ancho (los códigos de barra son anchos);
 *  - un consejo en pantalla: «alejá el celular a unos 20 cm».
 * En Android Chrome además usa el lector nativo del sistema (BarcodeDetector) si existe,
 * y la linterna si la cámara la tiene.
 */
export default function ScannerCamara({
  onLectura,
  onCerrar,
  conQr = false,
}: {
  /** `formato`: nombre del formato leído (ej. 'QR_CODE', 'EAN_13') */
  onLectura: (texto: string, formato?: string) => void
  onCerrar: () => void
  /** además de los códigos de barra, lee QR (ej. ubicaciones del depósito) */
  conQr?: boolean
}) {
  const [error, setError] = useState<string | null>(null)
  const [listo, setListo] = useState(false)
  // Zoom y linterna: solo si la cámara los permite (en iPhone depende de la versión de iOS)
  const [zoom, setZoom] = useState<{ actual: number; max: number } | null>(null)
  const [linterna, setLinterna] = useState<boolean | null>(null)
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const cerradoRef = useRef(false)
  // El mismo código puede llegar varias veces seguidas: lo ignoramos por 700 ms.
  const ultimaRef = useRef<{ texto: string; ts: number } | null>(null)

  // onLectura cambia en cada render del padre; lo guardamos en una ref para
  // no reiniciar la cámara por eso.
  const lecturaRef = useRef(onLectura)
  lecturaRef.current = onLectura

  const elementoId = 'scanner-camara-piso'

  useEffect(() => {
    let vivo = true

    void (async () => {
      try {
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode')
        if (!vivo) return

        const formatos = [
          ...FORMATOS_1D.map((f) => Html5QrcodeSupportedFormats[f]),
          ...(conQr ? [Html5QrcodeSupportedFormats.QR_CODE] : []),
        ]
        const sc = new Html5Qrcode(elementoId, {
          formatsToSupport: formatos,
          verbose: false,
          // Android Chrome: lector nativo, más rápido y mejor con códigos borrosos
          experimentalFeatures: { useBarCodeDetectorIfSupported: true },
        })
        scannerRef.current = sc

        await sc.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            // Casi todo el ancho; alto según lo que se lee (los QR son cuadrados, las barras anchas)
            qrbox: (ancho: number, alto: number) => ({
              width: Math.max(200, Math.floor(ancho * 0.9)),
              height: Math.max(120, Math.floor(conQr ? Math.min(ancho * 0.75, alto * 0.8) : alto * 0.5)),
            }),
            // Alta resolución: con más detalle se lee de más lejos, donde el iPhone sí enfoca
            videoConstraints: {
              facingMode: { ideal: 'environment' },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            },
          },
          (texto: string, resultado) => {
            if (!vivo || cerradoRef.current) return
            const ahora = Date.now()
            const ultima = ultimaRef.current
            if (ultima && ultima.texto === texto && ahora - ultima.ts < 700) return
            ultimaRef.current = { texto, ts: ahora }
            lecturaRef.current(texto, resultado?.result?.format?.formatName)
          },
          () => { /* frame sin código: es normal */ },
        )

        if (!vivo) return
        setListo(true)

        // Zoom 2x de entrada (si se puede): la etiqueta se ve grande con el celular a distancia de foco
        try {
          const caps = sc.getRunningTrackCameraCapabilities()
          const z = caps.zoomFeature()
          if (z.isSupported() && z.max() > 1) {
            const inicial = Math.min(2, z.max())
            await z.apply(inicial)
            if (vivo) setZoom({ actual: inicial, max: z.max() })
          }
          const t = caps.torchFeature()
          if (t.isSupported() && vivo) setLinterna(false)
        } catch {
          /* sin zoom ni linterna: sigue igual */
        }
      } catch (e) {
        if (vivo) setError(e instanceof Error ? e.message : 'No se pudo abrir la cámara.')
      }
    })()

    return () => {
      vivo = false
      cerradoRef.current = true
      const sc = scannerRef.current
      scannerRef.current = null
      if (!sc) return
      // stop() sin clear() deja el <video> colgado adentro del contenedor.
      void sc
        .stop()
        .catch(() => undefined)
        .finally(() => {
          try { sc.clear() } catch { /* ya limpio */ }
        })
    }
  }, [conQr])

  const cambiarZoom = async () => {
    const sc = scannerRef.current
    if (!sc || !zoom) return
    const nuevo = zoom.actual >= 2 || zoom.max < 2 ? 1 : 2
    try {
      await sc.getRunningTrackCameraCapabilities().zoomFeature().apply(nuevo)
      setZoom({ ...zoom, actual: nuevo })
    } catch {
      /* no se pudo: queda como estaba */
    }
  }

  const cambiarLinterna = async () => {
    const sc = scannerRef.current
    if (!sc || linterna == null) return
    try {
      await sc.getRunningTrackCameraCapabilities().torchFeature().apply(!linterna)
      setLinterna(!linterna)
    } catch {
      /* no se pudo */
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <span className="flex items-center gap-2 text-sm font-medium text-ink">
          <Camera size={15} aria-hidden /> Escaneando con la cámara
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
          onClick={onCerrar}
          className="btn-press inline-flex items-center gap-1 rounded-lg border border-line bg-surface2 px-2.5 py-1 text-xs font-medium text-ink hover:bg-line"
        >
          <CameraOff size={13} aria-hidden /> Cerrar
        </button>
      </div>

      <div className="relative bg-black">
        {/* html5-qrcode renderiza adentro de este contenedor. */}
        <div id={elementoId} className="min-h-[220px] w-full [&_video]:!h-auto [&_video]:w-full" />

        {listo && !error && (
          <p className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/55 px-3 py-1.5 text-center text-xs text-white/90">
            Alejá el celular a unos 20 cm y mantenelo quieto
          </p>
        )}

        {!listo && !error && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 text-sm text-white/80">
            <Loader2 size={18} className="animate-spin" aria-hidden />
            Pidiendo permiso de cámara…
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/85 px-4 text-center text-sm text-white/90">
            <p className="font-medium text-brand-400">No se pudo usar la cámara</p>
            <p className="text-xs text-white/70">{error}</p>
            <p className="text-xs text-white/50">
              Fijate de haber dado permiso, o usá el lector inalámbrico / escribí el código a mano.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
