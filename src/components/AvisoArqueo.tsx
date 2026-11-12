import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, BellOff, Check, CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { releerArqueos, useArqueoLocal } from '@/lib/useArqueoLocal'
import { ahoraCordoba, enCuanto, etiquetaHorario, marcarArqueo, proximoHorario, type Horario } from '@/lib/arqueos'
import { notificarArmado, sonarArmado, vibrarArmado } from '@/lib/alarma'
import AvisosCelular from '@/components/AvisosCelular'

/* ------------------------------------------------------------------ */
/*  Aviso de arqueo para las cuentas de local (sql/arqueos_locales.sql) */
/*  Cartel rojo arriba de cualquier pantalla cuando falta el arqueo de  */
/*  las 10, 14, 19 o 22 (15 a 60 min pasado el horario). Suena y vibra */
/*  al aparecer y cada 15 min; «Callar 15 min» lo silencia en este      */
/*  dispositivo. Se va solo apenas el arqueo de Dragon llega al hub.    */
/* ------------------------------------------------------------------ */

const CLAVE_CALLADO = 'hub-arqueo-callado'
const REPITE_MS = 15 * 60_000

function calladoHasta(): number {
  try { return Number(localStorage.getItem(CLAVE_CALLADO)) || 0 } catch { return 0 }
}

export default function AvisoArqueo() {
  const { perfil } = useAuth()
  const e = useArqueoLocal(perfil?.local)
  const [callado, setCallado] = useState(calladoHasta)
  const [revisando, setRevisando] = useState(false)
  const [errorMarca, setErrorMarca] = useState<string | null>(null)
  const ultimoSonido = useRef<{ horario: number; at: number } | null>(null)

  const falta = e?.falta ?? null
  const silencio = callado > Date.now()

  useEffect(() => {
    if (!falta || silencio) return
    const u = ultimoSonido.current
    if (u && u.horario === falta.horario && Date.now() - u.at < REPITE_MS) return
    ultimoSonido.current = { horario: falta.horario, at: Date.now() }
    sonarArmado('urgente')
    vibrarArmado('urgente')
    if (document.hidden) notificarArmado(`💵 Falta el arqueo de las ${etiquetaHorario(falta.horario)}`, 'Hacé el arqueo de caja en Dragon.', '/')
  }, [falta, silencio, e?.leido])

  if (!falta) return null

  async function yaLoHice(horario: number) {
    setRevisando(true)
    setErrorMarca(null)
    try {
      await marcarArqueo(horario)
      await releerArqueos()
    } catch (err) {
      setErrorMarca(err instanceof Error ? err.message : 'No se pudo marcar')
    } finally {
      setRevisando(false)
    }
  }
  function callar() {
    const hasta = Date.now() + REPITE_MS
    try { localStorage.setItem(CLAVE_CALLADO, String(hasta)) } catch { /* sin almacenamiento */ }
    setCallado(hasta)
  }

  const cierra = falta.horario * 60 + 60 - ahoraCordoba().min
  return (
    <div role="alert" className={`mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-red-500/50 bg-red-500/15 p-3 sm:p-4 ${silencio ? '' : 'animate-pulse'}`}>
      <AlertTriangle size={26} className="shrink-0 text-red-400" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-display text-base font-bold text-red-200">Falta el arqueo de las {etiquetaHorario(falta.horario)}</p>
        <p className="text-xs text-red-200/80">
          Hacé el arqueo de caja en Dragon y tocá «Ya lo hice».{cierra > 0 ? ` El horario cierra ${enCuanto(cierra)}.` : ''}
        </p>
        {errorMarca && <p className="mt-1 text-xs font-semibold text-red-300">{errorMarca}</p>}
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => void yaLoHice(falta.horario)} disabled={revisando}
          className="btn-press inline-flex h-9 items-center gap-1.5 rounded-full bg-red-600 px-3 text-sm font-semibold text-white disabled:opacity-60">
          {revisando ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Check size={14} aria-hidden />} Ya lo hice
        </button>
        {!silencio && (
          <button type="button" onClick={callar} className="btn-press inline-flex h-9 items-center gap-1.5 rounded-full border border-red-400/40 px-3 text-sm font-semibold text-red-200">
            <BellOff size={14} aria-hidden /> Callar 15 min
          </button>
        )}
      </div>
    </div>
  )
}

const ICONO: Record<Horario['estado'], { clase: string; texto: (h: Horario) => string }> = {
  ok: { clase: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300', texto: (h) => `✓ ${h.hora}` },
  tarde: { clase: 'border-amber-500/40 bg-amber-500/10 text-amber-300', texto: (h) => `tarde ${h.hora}` },
  marcado: { clase: 'border-sky-500/40 bg-sky-500/10 text-sky-300', texto: () => 'marcado' },
  avisando: { clase: 'animate-pulse border-red-500/60 bg-red-500/15 text-red-300', texto: () => 'falta' },
  no: { clase: 'border-red-500/40 bg-red-500/10 text-red-300', texto: () => '✕ no se hizo' },
  pendiente: { clase: 'border-line text-sub', texto: () => '—' },
}

/** Tarjeta «Arqueos de hoy» del menú, para las cuentas de local que arquean */
export function ArqueosHoyLocal() {
  const { perfil } = useAuth()
  const e = useArqueoLocal(perfil?.local)
  if (!e?.activo) return null
  const prox = proximoHorario(ahoraCordoba().min)
  return (
    <section className="mb-4 rounded-2xl border border-line bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display text-base font-semibold text-ink">
          <Clock size={17} className="text-yellow-500" aria-hidden /> Arqueos de hoy
        </h2>
        <p className="text-xs text-sub">
          {e.ultima ? `Último: ${e.ultima}` : 'Todavía no arqueaste hoy'}
          {prox ? ` · Próximo: ${etiquetaHorario(prox.horario)} · ${enCuanto(prox.faltan)}` : ''}
        </p>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {e.horarios.map((h) => {
          const I = ICONO[h.estado]
          return (
            <div key={h.horario} className={`rounded-xl border px-2 py-2 text-center ${I.clase}`}>
              <p className="font-display text-sm font-bold text-ink">{etiquetaHorario(h.horario)}</p>
              <p className="mt-0.5 flex items-center justify-center gap-1 text-xs font-semibold tabular-nums">
                {h.estado === 'ok' && <CheckCircle2 size={12} aria-hidden />}
                {h.estado === 'no' && <XCircle size={12} aria-hidden />}
                {I.texto(h).replace(/^[✓✕] /, '')}
              </p>
            </div>
          )
        })}
      </div>
      <p className="mt-2 text-[11px] text-sub">Cada arqueo vale desde 1 h 30 antes hasta 1 h después del horario.</p>
      <div className="mt-3">
        <AvisosCelular texto="Activá los avisos para que este equipo suene si falta un arqueo, aunque estés en Dragon o con el celular bloqueado." />
      </div>
    </section>
  )
}
