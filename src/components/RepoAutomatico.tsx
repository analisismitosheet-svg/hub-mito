import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Clock, Loader2, Play, Save, XCircle } from 'lucide-react'
import { correrAhora, guardarConfigAuto, leerConfigAuto, type ConfigAuto, type LogAuto } from '@/lib/repoDiaria'

/**
 * Compras > Repo diaria > Automático: días y hora en que corren solas
 *   - la repo diaria → pedidos VTD en Dragon (+ «Pedir armado» de esos pedidos)
 *   - la cascada entre locales → lote en Transferencias (con los parámetros guardados)
 * Lo ejecuta el Puente SQL de la PC central (puente-sql/programador.js), que mira
 * repo_auto_config cada minuto. «Correr ahora» lo toma en el próximo minuto.
 */

const DIAS = ['L', 'M', 'X', 'J', 'V', 'S', 'D']
const NOMBRE_DIA = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']

function Interruptor({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={`relative h-6 w-11 flex-none rounded-full transition ${on ? 'bg-emerald-500' : 'bg-line'}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${on ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  )
}

function Dias({ valor, onChange }: { valor: number[]; onChange: (v: number[]) => void }) {
  return (
    <div className="flex gap-1">
      {DIAS.map((d, i) => {
        const n = i + 1
        const on = valor.includes(n)
        return (
          <button
            key={d}
            type="button"
            title={NOMBRE_DIA[i]}
            onClick={() => onChange(on ? valor.filter((x) => x !== n) : [...valor, n].sort())}
            className={`h-8 w-8 rounded-lg border text-xs font-semibold transition ${on ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-line bg-surface2 text-sub hover:text-ink'}`}
          >
            {d}
          </button>
        )
      })}
    </div>
  )
}

function UltimaCorrida({ log, pendiente }: { log: LogAuto | null; pendiente: string | null }) {
  return (
    <div className="mt-3 rounded-xl border border-line bg-surface2/60 p-2.5 text-xs">
      {pendiente && (
        <p className="mb-1 flex items-center gap-1.5 text-sky-500">
          <Loader2 size={13} className="animate-spin" aria-hidden /> Pedida para correr ahora: el Puente la toma en el próximo minuto…
        </p>
      )}
      {log ? (
        <p className={`flex items-start gap-1.5 ${log.ok ? 'text-ink' : 'text-red-400'}`}>
          {log.ok ? <CheckCircle2 size={13} className="mt-0.5 flex-none text-emerald-500" aria-hidden /> : <XCircle size={13} className="mt-0.5 flex-none" aria-hidden />}
          <span>
            <span className="text-sub">
              {new Date(log.at).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })} ·{' '}
            </span>
            {log.texto}
          </span>
        </p>
      ) : (
        !pendiente && <p className="text-sub">Todavía no corrió nunca.</p>
      )}
    </div>
  )
}

/** `solo`: la pantalla de la repo muestra solo la repo; la de la cascada, solo la cascada. */
export default function RepoAutomatico({ solo }: { solo?: 'repo' | 'cascada' } = {}) {
  const [cfg, setCfg] = useState<ConfigAuto | null>(null)
  const [orig, setOrig] = useState<ConfigAuto | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)

  const leer = useCallback(async (soloEstado = false) => {
    try {
      const c = await leerConfigAuto()
      if (!c) throw new Error('Falta la configuración: hay que aplicar sql/repo_cascada_auto.sql en Supabase.')
      setOrig(c)
      // Al refrescar el estado no se pisan los cambios que se están editando
      setCfg((prev) => (soloEstado && prev ? { ...prev, repo_log: c.repo_log, cascada_log: c.cascada_log, repo_ahora_at: c.repo_ahora_at, cascada_ahora_at: c.cascada_ahora_at } : c))
      setError(null)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(/repo_auto_config/.test(msg) ? 'Falta crear la programación en Supabase (sql/repo_cascada_auto.sql): hasta entonces no corre nada solo.' : msg)
    }
  }, [])

  useEffect(() => {
    void leer()
    const t = setInterval(() => void leer(true), 15_000)
    return () => clearInterval(t)
  }, [leer])

  if (error && !cfg) return <p role="alert" className="rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>
  if (!cfg || !orig) return <p className="flex items-center gap-2 text-sm text-sub"><Loader2 size={15} className="animate-spin" aria-hidden /> Leyendo la programación…</p>

  const campos = (
    solo === 'repo'
      ? ['repo_activo', 'repo_dias', 'repo_hora', 'repo_armado', 'repo_armado_prioridad']
      : solo === 'cascada'
        ? ['cascada_activo', 'cascada_dias', 'cascada_hora']
        : ['repo_activo', 'repo_dias', 'repo_hora', 'repo_armado', 'repo_armado_prioridad', 'cascada_activo', 'cascada_dias', 'cascada_hora']
  ) as readonly (keyof ConfigAuto)[]
  const cambios = campos.filter((k) => JSON.stringify(cfg[k]) !== JSON.stringify(orig[k]))
  const set = <K extends keyof ConfigAuto>(k: K, v: ConfigAuto[K]) => setCfg({ ...cfg, [k]: v })

  async function guardar() {
    if (!cfg) return
    setGuardando(true)
    setAviso(null)
    try {
      await guardarConfigAuto(Object.fromEntries(campos.map((k) => [k, cfg[k]])))
      await leer()
      setAviso('Guardado. Si hoy ya pasó la hora, arranca el próximo día que toque (para ya: «Correr ahora»).')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setGuardando(false)
  }
  async function ahora(t: 'repo' | 'cascada') {
    try {
      await correrAhora(t)
      await leer(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  const resumen = (activo: boolean, dias: number[], hora: string) =>
    !activo ? 'apagada' : !dias.length ? 'sin días elegidos' : `${dias.length === 7 ? 'todos los días' : dias.map((d) => NOMBRE_DIA[d - 1]).join(', ')} a las ${hora}`
  const fila = 'flex flex-wrap items-center gap-3 border-b border-dashed border-line py-2.5 last:border-0'
  const etiqueta = 'w-28 text-xs text-sub'

  return (
    <div className="space-y-4 pb-6">
      <p className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-3 text-xs text-ink">
        El Puente SQL de la PC central revisa cada minuto. A la hora elegida saca una foto nueva del DWH y hace todo solo, sin abrir el Hub.
        Si la prendés o le cambiás la hora cuando la de hoy ya pasó, arranca el próximo día que toque; para correrla en el momento usá «Correr ahora».
        {solo !== 'cascada' && 'La repo cubre los días con venta que todavía no tienen su repo en Dragon (un lunes, sábado y domingo juntos) y nunca repite un local que ya tiene el pedido. '}
        {solo !== 'repo' && 'La cascada usa los días de la última repo cargada y los parámetros guardados en Transferencia diaria; conviene programarla después de la repo.'}
      </p>
      {error && <p role="alert" className="rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>}

      <div className={`grid gap-4 ${solo ? 'max-w-xl' : 'lg:grid-cols-2'}`}>
        {solo !== 'cascada' && (
        <section className="rounded-2xl border border-line bg-surface p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-ink">Repo diaria → Dragon</h2>
            <Interruptor on={cfg.repo_activo} onChange={(v) => set('repo_activo', v)} label="Repo automática" />
          </div>
          <p className="text-[11px] text-sub">{resumen(cfg.repo_activo, cfg.repo_dias, cfg.repo_hora)}</p>
          <div className="mt-2">
            <div className={fila}><span className={etiqueta}>Días</span><Dias valor={cfg.repo_dias} onChange={(v) => set('repo_dias', v)} /></div>
            <div className={fila}>
              <span className={etiqueta}>Hora</span>
              <input type="time" value={cfg.repo_hora} onChange={(e) => set('repo_hora', e.target.value)} className="h-8 rounded-lg border border-line bg-surface px-2 text-sm text-ink" />
            </div>
            <div className={fila}>
              <span className={etiqueta}>Pedir armado</span>
              <Interruptor on={cfg.repo_armado} onChange={(v) => set('repo_armado', v)} label="Pedir armado" />
              <select value={cfg.repo_armado_prioridad} disabled={!cfg.repo_armado} onChange={(e) => set('repo_armado_prioridad', e.target.value as ConfigAuto['repo_armado_prioridad'])} className="h-8 rounded-lg border border-line bg-surface px-2 text-xs text-ink disabled:opacity-50">
                <option value="urgente">Urgente</option>
                <option value="normal">Normal</option>
                <option value="baja">Baja</option>
              </select>
              <span className="basis-full text-[11px] text-sub">Después de cargar en Dragon pide el armado de esos pedidos, como el botón «Pedir armado» de Pedidos de venta: les suena a todos los legajos del piso.</span>
            </div>
          </div>
          <UltimaCorrida log={cfg.repo_log} pendiente={cfg.repo_ahora_at} />
          <button type="button" onClick={() => void ahora('repo')} disabled={!!cfg.repo_ahora_at} className="btn-press mt-3 inline-flex h-8 items-center gap-1 rounded-lg border border-line bg-surface2 px-2.5 text-xs font-medium text-ink hover:bg-line disabled:opacity-50">
            <Play size={13} aria-hidden /> Correr ahora
          </button>
        </section>
        )}

        {solo !== 'repo' && (
        <section className="rounded-2xl border border-line bg-surface p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-ink">Cascada → Transferencias</h2>
            <Interruptor on={cfg.cascada_activo} onChange={(v) => set('cascada_activo', v)} label="Cascada automática" />
          </div>
          <p className="text-[11px] text-sub">{resumen(cfg.cascada_activo, cfg.cascada_dias, cfg.cascada_hora)}</p>
          <div className="mt-2">
            <div className={fila}><span className={etiqueta}>Días</span><Dias valor={cfg.cascada_dias} onChange={(v) => set('cascada_dias', v)} /></div>
            <div className={fila}>
              <span className={etiqueta}>Hora</span>
              <input type="time" value={cfg.cascada_hora} onChange={(e) => set('cascada_hora', e.target.value)} className="h-8 rounded-lg border border-line bg-surface px-2 text-sm text-ink" />
            </div>
            <div className={fila}>
              <span className={etiqueta}>Qué hace</span>
              <span className="flex-1 text-[11px] text-sub">
                Calcula la cascada con lo que MITO no cubrió y crea el lote «AAMMDD - CASCADA dd-mm» en Transferencias, igual que subir el Excel.
                Si el lote ya existe, no lo repite. Conviene ponerla después de la repo.
              </span>
            </div>
          </div>
          <UltimaCorrida log={cfg.cascada_log} pendiente={cfg.cascada_ahora_at} />
          <button type="button" onClick={() => void ahora('cascada')} disabled={!!cfg.cascada_ahora_at} className="btn-press mt-3 inline-flex h-8 items-center gap-1 rounded-lg border border-line bg-surface2 px-2.5 text-xs font-medium text-ink hover:bg-line disabled:opacity-50">
            <Play size={13} aria-hidden /> Correr ahora
          </button>
        </section>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void guardar()} disabled={!cambios.length || guardando} className="btn-press inline-flex h-9 items-center gap-1.5 rounded-lg bg-sky-600 px-3 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50">
          {guardando ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Save size={14} aria-hidden />} Guardar programación
        </button>
        {cambios.length > 0 && (
          <button type="button" onClick={() => setCfg(orig)} className="text-xs text-sub hover:text-ink">Deshacer cambios</button>
        )}
        {aviso && <span className="flex items-center gap-1 text-xs text-emerald-500"><Clock size={13} aria-hidden /> {aviso}</span>}
      </div>
    </div>
  )
}
