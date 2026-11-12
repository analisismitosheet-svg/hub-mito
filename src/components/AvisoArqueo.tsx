import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, BellOff, Check, CheckCircle2, ChevronDown, Clock, Loader2, XCircle } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { releerArqueos, useArqueoLocal } from '@/lib/useArqueoLocal'
import {
  ahoraCordoba, arqueosDelDia, arqueosMarcados, colorBillete, enCuanto, estadoHorarios, etiquetaHorario, hhmm, marcarArqueo, numero, pesos, proximoHorario,
  type Arqueo, type Horario,
} from '@/lib/arqueos'
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

/** Tarjeta «Arqueos de hoy» de un local (Locales → Arqueos de mi local): horarios y sus arqueos del día */
export function ArqueosHoyLocal({ local, fecha }: { local: string; fecha?: string }) {
  if (fecha && fecha !== ahoraCordoba().fecha) return <ArqueosOtroDia local={local} fecha={fecha} />
  return <ArqueosDeHoy local={local} />
}

function GrillaHorarios({ horarios }: { horarios: Horario[] }) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {horarios.map((h) => {
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
  )
}

/** Un día que ya pasó: horarios cerrados y los arqueos de ese día */
function ArqueosOtroDia({ local, fecha }: { local: string; fecha: string }) {
  const [horarios, setHorarios] = useState<Horario[] | null>(null)
  useEffect(() => {
    let vivo = true
    setHorarios(null)
    Promise.all([arqueosDelDia(fecha, local.toUpperCase()), arqueosMarcados(fecha, local.toUpperCase())])
      .then(([a, m]) => { if (vivo) setHorarios(estadoHorarios(a.map((x) => x.hora), 24 * 60 + 1, m.get(local.toUpperCase()))) })
      .catch(() => { if (vivo) setHorarios([]) })
    return () => { vivo = false }
  }, [local, fecha])
  if (!horarios) return <p className="py-8 text-center text-sm text-sub">Cargando arqueos…</p>
  return (
    <section className="mb-4 rounded-2xl border border-line bg-surface p-4">
      <h2 className="mb-3 flex items-center gap-2 font-display text-base font-semibold text-ink">
        <Clock size={17} className="text-yellow-500" aria-hidden /> Arqueos del {fecha.slice(8, 10)}/{fecha.slice(5, 7)}
      </h2>
      <GrillaHorarios horarios={horarios} />
      <MisArqueosHoy local={local} fecha={fecha} leido={0} />
    </section>
  )
}

function ArqueosDeHoy({ local }: { local: string }) {
  const e = useArqueoLocal(local)
  if (!e?.leido) return <p className="py-8 text-center text-sm text-sub">Cargando arqueos…</p>
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
      <GrillaHorarios horarios={e.horarios} />
      <p className="mt-2 text-[11px] text-sub">Cada arqueo vale desde 1 h 30 antes hasta 1 h después del horario.</p>
      <MisArqueosHoy local={local} fecha={ahoraCordoba().fecha} leido={e.leido} />
      {!e.activo && <p className="mt-2 text-xs text-amber-300">Este local no tiene arqueos en las últimas 2 semanas o tiene los avisos apagados.</p>}
      <div className="mt-3">
        <AvisosCelular texto="Activá los avisos para que este equipo suene si falta un arqueo, aunque estés en Dragon o con el celular bloqueado." />
      </div>
    </section>
  )
}

/** Arqueos de hoy del local con el total y, al tocar, el detalle por billete (RLS: solo los suyos) */
function MisArqueosHoy({ local, fecha, leido }: { local: string; fecha: string; leido: number }) {
  const [lista, setLista] = useState<Arqueo[]>([])
  const [abierto, setAbierto] = useState<number | null>(null)
  useEffect(() => {
    let vivo = true
    arqueosDelDia(fecha, local.toUpperCase())
      .then((a) => { if (vivo) setLista([...a].reverse()) })
      .catch(() => undefined)
    return () => { vivo = false }
  }, [local, fecha, leido])
  if (!lista.length) return <p className="mt-3 border-t border-line pt-3 text-xs text-sub">{fecha === ahoraCordoba().fecha ? 'Todavía no hay arqueos de hoy.' : 'No hubo arqueos ese día.'}</p>
  return (
    <div className="mt-3 border-t border-line pt-3">
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-sub">{fecha === ahoraCordoba().fecha ? 'Tus arqueos de hoy' : 'Arqueos del día'}</p>
      <div className="grid gap-1.5">
        {lista.map((a) => {
          const ver = abierto === a.arqueo
          const bil = a.billetes.filter((b) => b.cant > 0)
          return (
            <div key={`${a.caja}-${a.arqueo}`} className="rounded-xl border border-line bg-surface2/50">
              <button type="button" onClick={() => setAbierto(ver ? null : a.arqueo)} aria-expanded={ver}
                className="flex w-full items-center gap-2 px-3 py-2 text-left">
                <span className="font-display text-sm font-bold tabular-nums text-ink">{hhmm(a.hora)}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-sub">{a.vendedor ?? `Caja ${a.caja}`}</span>
                <span className="font-display text-sm font-bold tabular-nums text-ink">{pesos(a.total)}</span>
                <ChevronDown size={14} className={`shrink-0 text-sub transition ${ver ? 'rotate-180' : ''}`} aria-hidden />
              </button>
              {ver && (
                <div className="border-t border-line px-3 py-2">
                  <p className="mb-1 text-[11px] text-sub">Arqueo N° {a.arqueo} · Caja {a.caja}</p>
                  {bil.map((b) => (
                    <div key={`${b.tipo}${b.valor}`} className="grid grid-cols-[1fr_44px_96px] items-center gap-2 text-xs leading-5">
                      <span className="flex items-center gap-1.5 tabular-nums text-ink">
                        <i className="h-2 w-2 rounded-full" style={{ background: colorBillete(b.valor) }} aria-hidden />
                        {b.tipo === 'Billete' ? pesos(b.valor) : `Moneda ${pesos(b.valor)}`}
                      </span>
                      <span className="text-right tabular-nums text-sub">{numero(b.cant)}</span>
                      <span className="text-right tabular-nums text-ink">{pesos(b.tot)}</span>
                    </div>
                  ))}
                  <div className="mt-1 grid grid-cols-[1fr_96px] border-t border-line pt-1 text-xs font-bold text-ink">
                    <span>Total</span><span className="text-right tabular-nums">{pesos(a.total)}</span>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
