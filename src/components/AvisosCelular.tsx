import { useEffect, useState } from 'react'
import { BellRing, CheckCircle2, Loader2 } from 'lucide-react'
import { activarAvisos, estadoAvisos, refrescarAvisos, type EstadoAvisos } from '@/lib/push'
import { sonarArmado } from '@/lib/alarma'

/**
 * Cartel de Mi repo para anotar este celular a los avisos push de armados
 * (suenan aunque el celular esté bloqueado). Si ya está activo queda un chip chico.
 */
export default function AvisosCelular() {
  const [estado, setEstado] = useState<EstadoAvisos | null>(null)
  const [trabajando, setTrabajando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void estadoAvisos().then((e) => {
      setEstado(e)
      // ya activo: se vuelve a anotar en silencio por si el navegador renovó la suscripción
      if (e === 'activo') void refrescarAvisos()
    })
  }, [])

  async function activar() {
    setTrabajando(true)
    setError(null)
    sonarArmado('baja') // de paso destraba el sonido dentro de la app
    const err = await activarAvisos()
    setError(err)
    setEstado(await estadoAvisos())
    setTrabajando(false)
  }

  if (!estado || estado === 'no-soportado') return null
  if (estado === 'activo') {
    return (
      <p className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-500">
        <CheckCircle2 size={13} aria-hidden /> Avisos activos en este celular: suena aunque esté bloqueado
      </p>
    )
  }
  return (
    <div className="mb-4 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4">
      <p className="flex items-start gap-2 text-sm font-semibold text-amber-400">
        <BellRing size={18} className="mt-0.5 shrink-0" aria-hidden />
        Activá los avisos para que el celular suene cuando pidan un armado, aunque esté bloqueado.
      </p>
      {estado === 'ios-instalar' ? (
        <p className="mt-2 text-xs text-sub">
          En iPhone: tocá Compartir → «Agregar a pantalla de inicio», abrí la app desde ese ícono y volvé a esta pantalla.
        </p>
      ) : estado === 'bloqueado' ? (
        <p className="mt-2 text-xs text-sub">
          Las notificaciones están bloqueadas para esta app. Habilitalas en Ajustes → Apps → Chrome (o Hub Mito) → Notificaciones, y recargá.
        </p>
      ) : (
        <button
          type="button"
          onClick={() => void activar()}
          disabled={trabajando}
          className="mt-3 inline-flex items-center gap-2 rounded-xl bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-700 disabled:opacity-60"
        >
          {trabajando ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <BellRing size={15} aria-hidden />}
          Activar avisos
        </button>
      )}
      {error && <p className="mt-2 text-xs text-brand-400">{error}</p>}
    </div>
  )
}
