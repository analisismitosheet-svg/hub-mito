import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Pause, Check, X, Store, PackageCheck, BellRing } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import AvisosCelular from '@/components/AvisosCelular'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { nombreMotivoPausa } from '@/components/MotivoPausa'
import { suscribirCambios } from '@/lib/realtime'

/* ------------------------------------------------------------------ */
/*  Pausas del piso esperando autorización (sql/pausas_autorizacion).  */
/*  El legajo pide la pausa y sigue trabajando; acá se autoriza o se   */
/*  rechaza. Solo entra quien tiene mayorista.pausas.autorizar.        */
/* ------------------------------------------------------------------ */

interface PausaPendiente {
  pausa_id: string
  tipo: string
  motivo: string
  detalle: string | null
  solicitada_at: string
  usuario_id: string
  legajo: string | null
  nombre: string | null
  sesion_id: string | null
  armado_id: string | null
  local: string | null
  cliente: string | null
}

/** "hace 3 min" / "hace 1 h 5 min" */
function hace(iso: string): string {
  const seg = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (seg < 60) return 'recién'
  const min = Math.floor(seg / 60)
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m > 0 ? `hace ${h} h ${m} min` : `hace ${h} h`
}

export default function PausasPendientes() {
  const { can } = useAuth()
  const puede = can('mayorista.pausas.autorizar')

  const [filas, setFilas] = useState<PausaPendiente[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [resolviendo, setResolviendo] = useState<string | null>(null)
  const [rechazando, setRechazando] = useState<string | null>(null)
  const [motivoRechazo, setMotivoRechazo] = useState('')
  const [, setTic] = useState(0)

  const cargar = useCallback(async () => {
    if (!supabase || !puede) { setCargando(false); return }
    const { data, error: err } = await supabase.rpc('pausas_pendientes')
    if (err) setError(err.message)
    else setError(null)
    setFilas(err ? [] : ((data as PausaPendiente[] | null) ?? []))
    setCargando(false)
  }, [puede])

  useEffect(() => { void cargar() }, [cargar])

  useEffect(() => {
    if (!puede) return
    const desuscribir = suscribirCambios(['piso_pausas'], () => void cargar(), { espera: 400 })
    const intervalo = setInterval(() => {
      if (document.visibilityState === 'visible') void cargar()
    }, 30000)
    const reloj = setInterval(() => setTic((t) => t + 1), 30000)
    return () => { desuscribir(); clearInterval(intervalo); clearInterval(reloj) }
  }, [puede, cargar])

  async function autorizar(id: string) {
    if (!supabase) return
    setResolviendo(id)
    const { error: err } = await supabase.rpc('pausa_autorizar', { p_pausa: id })
    setResolviendo(null)
    if (err) setError(err.message)
    else await cargar()
  }

  async function rechazar(id: string) {
    if (!supabase) return
    setResolviendo(id)
    const { error: err } = await supabase.rpc('pausa_rechazar', {
      p_pausa: id,
      p_motivo: motivoRechazo.trim() || null,
    })
    setResolviendo(null)
    if (err) { setError(err.message); return }
    setRechazando(null)
    setMotivoRechazo('')
    await cargar()
  }

  const total = filas.length
  const resumen = useMemo(
    () => filas.map((f) => ({
      ...f,
      quien: f.nombre ?? (f.legajo ? `#${f.legajo}` : 'Legajo'),
      donde: f.tipo === 'armado' ? `Armado · ${f.cliente ?? 'Cliente'}` : `Repo · ${f.local ?? 'sin local'}`,
    })),
    [filas],
  )

  if (!puede) {
    return (
      <Layout>
        <BackButton />
        <p className="rounded-xl border border-line bg-surface p-6 text-sm text-sub">
          No tenés permiso para autorizar pausas.
        </p>
      </Layout>
    )
  }

  return (
    <Layout>
      <BackButton />
      <header className="mb-3 mt-2">
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink">
          <Pause size={20} className="text-amber-500" aria-hidden /> Pausas por autorizar
        </h1>
        <p className="text-xs text-sub/70">
          Los legajos piden la pausa y siguen trabajando hasta que la autorices. Si la rechazás, sigue como estaba.
        </p>
      </header>

      <div className="mb-4">
        <AvisosCelular />
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">
          {error}
        </p>
      )}

      {cargando ? (
        <p className="flex items-center gap-2 rounded-xl border border-line bg-surface p-6 text-sm text-sub">
          <Loader2 size={15} className="animate-spin" aria-hidden /> Cargando…
        </p>
      ) : total === 0 ? (
        <p className="rounded-xl border border-line bg-surface p-6 text-sm text-sub">
          No hay pausas esperando autorización.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {resumen.map((f) => (
            <li key={f.pausa_id} className="rounded-2xl border border-amber-500/30 bg-surface p-4 shadow-soft">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-display font-semibold text-ink">
                    {f.tipo === 'armado' ? <PackageCheck size={15} className="text-brand-500" aria-hidden /> : <Store size={15} className="text-amber-500" aria-hidden />}
                    {f.legajo ? `#${f.legajo} ` : ''}{f.quien}
                    <span className="text-xs font-normal text-sub/70">{hace(f.solicitada_at)}</span>
                  </p>
                  <p className="mt-0.5 text-sm text-sub">{f.donde}</p>
                  <p className="mt-1 text-sm text-ink">
                    <span className="font-semibold">{nombreMotivoPausa(f.motivo)}</span>
                    {f.detalle ? <span className="text-sub"> · {f.detalle}</span> : null}
                  </p>
                </div>

                {rechazando !== f.pausa_id && (
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void autorizar(f.pausa_id)}
                      disabled={resolviendo === f.pausa_id}
                      className="btn-press inline-flex h-9 items-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-sm font-semibold text-white shadow-soft transition hover:bg-emerald-700 disabled:opacity-60"
                    >
                      {resolviendo === f.pausa_id ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Check size={15} aria-hidden />}
                      Autorizar
                    </button>
                    <button
                      type="button"
                      onClick={() => { setRechazando(f.pausa_id); setMotivoRechazo('') }}
                      disabled={resolviendo === f.pausa_id}
                      className="btn-press inline-flex h-9 items-center gap-1.5 rounded-xl border border-brand-600/40 bg-brand-600/10 px-3 text-sm font-semibold text-brand-400 transition hover:bg-brand-600/20 disabled:opacity-60"
                    >
                      <X size={15} aria-hidden /> Rechazar
                    </button>
                  </div>
                )}
              </div>

              {rechazando === f.pausa_id && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input
                    autoFocus
                    value={motivoRechazo}
                    onChange={(e) => setMotivoRechazo(e.target.value)}
                    placeholder="Motivo del rechazo (opcional)"
                    className="h-9 min-w-0 flex-1 rounded-xl border border-line bg-surface2 px-3 text-sm text-ink outline-none placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40"
                  />
                  <button
                    type="button"
                    onClick={() => void rechazar(f.pausa_id)}
                    disabled={resolviendo === f.pausa_id}
                    className="btn-press inline-flex h-9 items-center gap-1.5 rounded-xl bg-brand-600 px-3 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
                  >
                    {resolviendo === f.pausa_id ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <X size={15} aria-hidden />}
                    Confirmar rechazo
                  </button>
                  <button
                    type="button"
                    onClick={() => { setRechazando(null); setMotivoRechazo('') }}
                    disabled={resolviendo === f.pausa_id}
                    className="btn-press inline-flex h-9 items-center gap-1.5 rounded-xl border border-line bg-surface2 px-3 text-sm font-medium text-ink transition hover:bg-line disabled:opacity-60"
                  >
                    Cancelar
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-6 flex items-center gap-1.5 text-[11px] text-sub/70">
        <BellRing size={12} aria-hidden /> Activá los avisos para que te suene el celular cuando pidan una pausa.
      </p>
    </Layout>
  )
}
