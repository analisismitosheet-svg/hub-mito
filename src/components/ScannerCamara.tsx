import { useEffect, useRef, useState } from 'react'
import { Camera, CameraOff, Loader2 } from 'lucide-react'
// Solo el tipo: así html5-qrcode NO entra en el bundle inicial.
// La librería real se trae con un import() cuando el usuario abre la cámara.
import type { Html5Qrcode } from 'html5-qrcode'

/** Códigos de barra de prenda/etiqueta (1D). QR solo si se pide con `conQr`. */
const FORMATOS_1D = ['EAN_13', 'EAN_8', 'UPC_A', 'UPC_E', 'CODE_128', 'CODE_39', 'ITF', 'CODABAR'] as const

/**
 * Visor de cámara que lee códigos de barra y pasa cada lectura por `onLectura`.
 * Al desmontarse libera la cámara siempre (si no, queda prendida en el celular).
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
        })
        scannerRef.current = sc

        await sc.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: conQr ? { width: 260, height: 200 } : { width: 280, height: 120 } },
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

        if (vivo) setListo(true)
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

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <span className="flex items-center gap-2 text-sm font-medium text-ink">
          <Camera size={15} aria-hidden /> Escaneando con la cámara
        </span>
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
