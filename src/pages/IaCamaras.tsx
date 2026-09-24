import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Loader2, RefreshCw, ScanEye, LogIn, LogOut, Users, Footprints, UserCheck, BadgeCheck, ChevronRight } from 'lucide-react'
import { ResponsiveContainer, BarChart, Bar, XAxis, Tooltip } from 'recharts'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'
import { Camaras, type Dispositivo } from '@/pages/ContadorClientes'

/**
 * IA Cámaras (Sistemas): vista previa de HOY por local y estado de las PCs
 * contadoras. Los números vienen agregados de `contador_locales_hoy()`; el
 * detalle histórico está en Locales → Contador de clientes.
 */

interface LocalHoy {
  local: string
  entradas: number
  salidas: number
  transeuntes: number
  empleados: number
  nuevos: number
  reingresos: number
  adentro: number
  actualizado: string | null
  horas: { hora: number; entradas: number }[]
  dispositivos: Dispositivo[]
}

const REFRESCO_MS = 30000
const OFFLINE_MIN = 5

const nf = (n: number) => Math.round(n).toLocaleString('es-AR')
const minutosDesde = (f: string | null) => (f ? Math.round((Date.now() - new Date(f).getTime()) / 60000) : null)
const enLinea = (d: Dispositivo) => {
  const m = minutosDesde(d.ultimo_latido)
  return d.activo && m != null && m <= OFFLINE_MIN
}

function sb() {
  if (!supabase) throw new Error('Supabase no está configurado.')
  return supabase
}

export default function IaCamaras() {
  const { can, isAdmin } = useAuth()
  const puedeGestionar = isAdmin || can('contador.gestionar')
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'pcs' && puedeGestionar ? 'pcs' : 'locales'
  const [datos, setDatos] = useState<LocalHoy[] | null>(null)
  const [locales, setLocales] = useState<string[]>([])
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    const { data, error: err } = await sb().rpc('contador_locales_hoy')
    if (err) setError(err.message)
    else {
      setError(null)
      setDatos((data as LocalHoy[]) ?? [])
    }
    setCargando(false)
  }, [])

  useEffect(() => { void cargar() }, [cargar])
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') void cargar() }, REFRESCO_MS)
    return () => clearInterval(t)
  }, [cargar])
  useEffect(() => {
    void sb().from('locales').select('codigo').order('codigo').then(({ data }) => setLocales((data ?? []).map((l) => l.codigo as string)))
  }, [])

  const todos = datos ?? []
  const dispositivos = todos.flatMap((l) => l.dispositivos)
  const pcsOnline = dispositivos.filter(enLinea).length
  const total = (k: keyof LocalHoy) => todos.reduce((a, l) => a + (Number(l[k]) || 0), 0)

  const tarjeta = 'rounded-2xl border border-line bg-surface p-4'
  const btnChico = 'btn-press h-8 rounded-lg border border-line bg-surface2 px-2.5 text-xs font-medium text-ink transition hover:bg-line disabled:opacity-50'
  const tabBtn = (id: string, label: string) => (
    <button onClick={() => setParams(id === 'locales' ? {} : { tab: id }, { replace: true })}
      className={'h-8 rounded-lg px-3 text-xs font-medium transition ' + (tab === id ? 'bg-brand-600 text-white' : 'border border-line bg-surface2 text-sub hover:text-ink')}>
      {label}
    </button>
  )

  return (
    <Layout wide>
      <BackButton />
      <header className="mb-4 mt-2 flex flex-wrap items-center gap-2">
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink">
          <ScanEye size={22} className="text-cyan-500" aria-hidden /> IA Cámaras
        </h1>
        <span className="text-xs text-sub/70">Hoy · se actualiza cada 30 s</span>
        <div className="ml-auto flex items-center gap-1.5">
          {tabBtn('locales', 'Locales')}
          {puedeGestionar && tabBtn('pcs', `PCs y cámaras (${pcsOnline}/${dispositivos.length} en línea)`)}
          <button onClick={() => void cargar()} className={btnChico + ' inline-flex items-center gap-1'}>
            <RefreshCw size={13} className={cargando ? 'animate-spin' : ''} aria-hidden /> Actualizar
          </button>
        </div>
      </header>

      {error && <p role="alert" className="mb-4 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>}

      {!datos ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sub"><Loader2 size={18} className="animate-spin" aria-hidden /> Cargando...</div>
      ) : tab === 'pcs' ? (
        <Camaras dispositivos={dispositivos} locales={locales} onCambio={cargar} tarjeta={tarjeta} btnChico={btnChico} />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Resumen icono={<LogIn size={16} className="text-emerald-500" />} label="Entradas hoy" valor={nf(total('entradas'))} />
            <Resumen icono={<Users size={16} className="text-amber-500" />} label="Adentro ahora" valor={nf(total('adentro'))} />
            <Resumen icono={<Footprints size={16} className="text-violet-500" />} label="Transeúntes" valor={nf(total('transeuntes'))}
              nota={total('transeuntes') ? `atracción ${((100 * total('entradas')) / total('transeuntes')).toFixed(1)}%` : undefined} />
            <Resumen icono={<UserCheck size={16} className="text-sky-500" />} label="Clientes únicos" valor={nf(total('nuevos'))}
              nota={total('reingresos') ? `${nf(total('reingresos'))} reingresos` : undefined} />
            <Resumen icono={<ScanEye size={16} className="text-cyan-500" />} label="PCs en línea" valor={`${pcsOnline}/${dispositivos.length}`} />
          </div>

          {todos.length === 0 ? (
            <div className={tarjeta + ' text-sm text-sub'}>
              Todavía no hay locales con cámaras. Registrá la PC de un local en <strong>PCs y cámaras</strong> e instalá el contador (carpeta <code>contador-camaras</code>).
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {todos.map((l) => <TarjetaLocal key={l.local} l={l} />)}
            </div>
          )}
        </div>
      )}
    </Layout>
  )
}

function Resumen({ icono, label, valor, nota }: { icono: React.ReactNode; label: string; valor: string; nota?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-3">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-sub/70">{icono} {label}</div>
      <div className="font-display text-2xl font-bold text-ink">{valor}</div>
      {nota && <div className="text-[11px] text-sub/70">{nota}</div>}
    </div>
  )
}

function TarjetaLocal({ l }: { l: LocalHoy }) {
  const online = l.dispositivos.filter(enLinea).length
  const hayPc = l.dispositivos.some((d) => d.activo)
  const estado = !hayPc ? { txt: 'Sin PC', cls: 'bg-slate-500' } : online ? { txt: 'En línea', cls: 'bg-emerald-500' } : { txt: 'Sin señal', cls: 'bg-red-500' }
  const m = minutosDesde(l.actualizado)
  // 8 a 23 h siempre visibles para que las barras de distintos locales se puedan comparar
  const horas = Array.from({ length: 16 }, (_, i) => i + 8).map((h) => ({ name: `${h}h`, entradas: l.horas.find((x) => x.hora === h)?.entradas ?? 0 }))
  const camaras = l.dispositivos.flatMap((d) => d.estado?.camaras ?? [])

  return (
    <div className="flex flex-col rounded-2xl border border-line bg-surface p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="font-display text-lg font-semibold text-ink">{l.local}</span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-[11px] text-sub">
          <span className={'inline-block h-2 w-2 rounded-full ' + estado.cls} aria-hidden /> {estado.txt}
        </span>
        <span className="ml-auto text-[11px] text-sub/70">{m == null ? 'sin datos hoy' : `act. hace ${m} min`}</span>
      </div>

      <div className="flex items-end gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-sub/70">Entradas hoy</div>
          <div className="font-display text-4xl font-bold leading-none text-ink">{nf(l.entradas)}</div>
        </div>
        <div className="grid flex-1 grid-cols-3 gap-2 text-center">
          <Mini icono={<LogOut size={12} />} label="Salidas" valor={nf(l.salidas)} />
          <Mini icono={<Users size={12} />} label="Adentro" valor={nf(l.adentro)} />
          <Mini icono={<BadgeCheck size={12} />} label="Personal" valor={nf(l.empleados)} />
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-sub">
        {l.transeuntes > 0 && <span>{nf(l.transeuntes)} transeúntes · atracción {((100 * l.entradas) / l.transeuntes).toFixed(1)}%</span>}
        {l.nuevos + l.reingresos > 0 && <span>{nf(l.nuevos)} únicos · {nf(l.reingresos)} reingresos</span>}
      </div>

      <div className="mt-2 h-16">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={horas} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
            <XAxis dataKey="name" hide />
            <Tooltip cursor={{ fill: 'rgba(148,163,184,0.12)' }}
              contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, fontSize: 11, color: 'var(--ink)' }} />
            <Bar dataKey="entradas" name="Entradas" fill="#34d399" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex justify-between text-[10px] text-sub/60"><span>8h</span><span>15h</span><span>23h</span></div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {camaras.map((c) => (
          <span key={c.nombre} title={c.error ?? ''}
            className={'rounded-full border px-2 py-0.5 text-[11px] ' + (c.ok ? 'border-emerald-600/40 text-emerald-400' : 'border-red-600/40 text-red-400')}>
            {c.nombre}: {c.ok ? `${c.fps} fps` : c.error ?? 'error'}
          </span>
        ))}
        <Link to={`/contador-clientes?local=${encodeURIComponent(l.local)}&preset=hoy`}
          className="ml-auto inline-flex items-center gap-0.5 text-xs font-medium text-brand-400 hover:underline">
          Detalle <ChevronRight size={13} aria-hidden />
        </Link>
      </div>
    </div>
  )
}

function Mini({ icono, label, valor }: { icono: React.ReactNode; label: string; valor: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface2/60 px-1 py-1">
      <div className="flex items-center justify-center gap-1 text-[10px] text-sub/70">{icono} {label}</div>
      <div className="text-sm font-semibold text-ink">{valor}</div>
    </div>
  )
}
