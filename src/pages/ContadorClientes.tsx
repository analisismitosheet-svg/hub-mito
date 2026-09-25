import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Loader2, RefreshCw, Footprints, LogIn, LogOut, Users, Percent, Cctv, Plus, Copy, Check, Power, Trash2,
} from 'lucide-react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend, ComposedChart, Line,
} from 'recharts'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import ConfirmDialog from '@/components/ConfirmDialog'
import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'
import { leerVista } from '@/lib/sqlApi'

function sb() {
  if (!supabase) throw new Error('Supabase no está configurado.')
  return supabase
}

/**
 * Contador de clientes por cámaras (DVR Dahua + IA en la PC de cada local).
 * Los conteos los sube contador-camaras/contador.py vía /api/contador-ingesta;
 * acá solo se leen. El tablero se agrega en la base (`contador_resumen`).
 *
 * Conversión: si en config_app hay una vista SQL en 'contador_vista_ventas'
 * (columnas local, fecha, tickets — agregada por local y día), se cruzan
 * tickets / entradas.
 */

interface Resumen {
  totales: { entradas: number; salidas: number; transeuntes: number; empleados: number; nuevos: number; reingresos: number; dias: number }
  porHora: { hora: number; entradas: number; salidas: number; promedio: number }[]
  porDia: { fecha: string; entradas: number; salidas: number }[]
  porLocal: { local: string; entradas: number; salidas: number; transeuntes: number; empleados: number; nuevos: number; reingresos: number }[]
  ocupacion: { local: string; entradas: number; salidas: number; adentro: number }[]
}

export interface Dispositivo {
  id: string
  local: string
  nombre: string
  activo: boolean
  ultimo_latido: string | null
  estado: { version?: string; camaras?: { nombre: string; ok: boolean; fps: number; error: string | null; entradas_hoy?: number; vista_url?: string | null }[] } | null
}

export type Venta = { local: string; fecha: string; tickets: number }

export const CLAVE_VISTA = 'contador_vista_ventas'
const REFRESCO_MS = 60000
const OFFLINE_MIN = 5

const TOOLTIP = {
  contentStyle: {
    background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, fontSize: 12,
    color: 'var(--ink)', boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
  },
  labelStyle: { color: 'var(--sub)', fontSize: 11, marginBottom: 2 },
  itemStyle: { color: 'var(--ink)' },
  cursor: { fill: 'rgba(148,163,184,0.12)' },
}

const iso = (d: Date) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return z.toISOString().slice(0, 10)
}
const sumarDias = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const nf = (n: number) => Math.round(n).toLocaleString('es-AR')

type Preset = 'hoy' | 'ayer' | '7d' | '30d' | 'mes'
const PRESETS: { id: Preset; label: string }[] = [
  { id: 'hoy', label: 'Hoy' }, { id: 'ayer', label: 'Ayer' }, { id: '7d', label: '7 días' },
  { id: '30d', label: '30 días' }, { id: 'mes', label: 'Este mes' },
]
function rangoDe(p: Preset): { desde: string; hasta: string } {
  const hoy = new Date()
  switch (p) {
    case 'hoy': return { desde: iso(hoy), hasta: iso(hoy) }
    case 'ayer': return { desde: iso(sumarDias(hoy, -1)), hasta: iso(sumarDias(hoy, -1)) }
    case '7d': return { desde: iso(sumarDias(hoy, -6)), hasta: iso(hoy) }
    case 'mes': return { desde: iso(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), hasta: iso(hoy) }
    default: return { desde: iso(sumarDias(hoy, -29)), hasta: iso(hoy) }
  }
}

/** Normaliza filas de la vista de ventas aceptando nombres de columna habituales. */
export function aVentas(filas: Record<string, unknown>[]): Venta[] {
  const col = (f: Record<string, unknown>, ...ops: string[]) => {
    const k = Object.keys(f).find((c) => ops.includes(c.toLowerCase()))
    return k ? f[k] : undefined
  }
  return filas.flatMap((f) => {
    const local = String(col(f, 'local', 'sucursal', 'codigo_local') ?? '').trim().toUpperCase()
    const fecha = String(col(f, 'fecha', 'dia') ?? '').slice(0, 10)
    const tickets = Number(col(f, 'tickets', 'cantidad', 'comprobantes', 'ventas'))
    return local && /^\d{4}-\d{2}-\d{2}$/.test(fecha) && Number.isFinite(tickets) ? [{ local, fecha, tickets }] : []
  })
}

async function sha256Hex(texto: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export default function ContadorClientes() {
  const { can, isAdmin, perfil } = useAuth()
  const puedeGestionar = isAdmin || can('contador.gestionar')
  // Cada local ve solo lo suyo (la base igual lo filtra por RLS); la central necesita contador.ver_todo
  const verTodo = isAdmin || can('contador.ver_todo')
  const miLocal = perfil?.local ?? ''
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'camaras' && puedeGestionar ? 'camaras' : 'tablero'
  const preset = (PRESETS.some((p) => p.id === params.get('preset')) ? params.get('preset') : '7d') as Preset
  const fLocal = verTodo ? params.get('local') ?? '' : miLocal
  const rango = useMemo(() => rangoDe(preset), [preset])

  const [datos, setDatos] = useState<Resumen | null>(null)
  const [ventas, setVentas] = useState<Venta[] | null>(null)
  const [dispositivos, setDispositivos] = useState<Dispositivo[]>([])
  const [locales, setLocales] = useState<string[]>([])
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setParam = (k: string, v: string) =>
    setParams((prev) => { const q = new URLSearchParams(prev); if (v) q.set(k, v); else q.delete(k); return q }, { replace: true })

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    const [res, disp] = await Promise.all([
      sb().rpc('contador_resumen', { p_desde: rango.desde, p_hasta: rango.hasta, p_locales: fLocal ? [fLocal] : null }),
      sb().from('contador_dispositivos').select('id,local,nombre,activo,ultimo_latido,estado').order('local'),
    ])
    if (res.error) setError(res.error.message)
    else setDatos(res.data as Resumen)
    setDispositivos((disp.data as Dispositivo[] | null) ?? [])
    setCargando(false)
  }, [rango.desde, rango.hasta, fLocal])

  useEffect(() => { void cargar() }, [cargar])
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') void cargar() }, REFRESCO_MS)
    return () => clearInterval(t)
  }, [cargar])

  useEffect(() => {
    void sb().from('locales').select('codigo').order('codigo').then(({ data }) => setLocales((data ?? []).map((l) => l.codigo as string).filter((c) => verTodo || c === miLocal)))
    void (async () => {
      const { data } = await sb().from('config_app').select('valor').eq('clave', CLAVE_VISTA).maybeSingle()
      const vista = typeof data?.valor === 'string' ? data.valor : ''
      if (!vista) return setVentas(null)
      try { setVentas(aVentas(await leerVista(vista, 5000))) } catch { setVentas(null) }
    })()
  }, [])

  // Tickets del rango, por local (y total)
  const tickets = useMemo(() => {
    if (!ventas) return null
    const porLocal = new Map<string, number>()
    for (const v of ventas) {
      if (v.fecha < rango.desde || v.fecha > rango.hasta || (fLocal && v.local !== fLocal)) continue
      porLocal.set(v.local, (porLocal.get(v.local) ?? 0) + v.tickets)
    }
    return porLocal
  }, [ventas, rango, fLocal])

  const conversion = (entradas: number, tk: number | undefined) => (entradas > 0 && tk != null ? (tk / entradas) * 100 : null)
  const totalTickets = tickets ? [...tickets.values()].reduce((a, b) => a + b, 0) : null
  const convTotal = datos && totalTickets != null ? conversion(datos.totales.entradas, totalTickets) : null
  const adentroAhora = (datos?.ocupacion ?? []).reduce((a, o) => a + o.adentro, 0)

  const serieDia = useMemo(() => {
    if (!datos) return []
    const tkDia = new Map<string, number>()
    for (const v of ventas ?? []) if (!fLocal || v.local === fLocal) tkDia.set(v.fecha, (tkDia.get(v.fecha) ?? 0) + v.tickets)
    return datos.porDia.map((d) => ({
      ...d, name: d.fecha.slice(5).split('-').reverse().join('/'),
      conversion: ventas ? conversion(d.entradas, tkDia.get(d.fecha) ?? 0) : null,
    }))
  }, [datos, ventas, fLocal])

  const offline = dispositivos.filter((d) => d.activo && (!d.ultimo_latido || Date.now() - new Date(d.ultimo_latido).getTime() > OFFLINE_MIN * 60000))

  const tarjeta = 'rounded-2xl border border-line bg-surface p-4'
  const btnChico = 'btn-press h-8 rounded-lg border border-line bg-surface2 px-2.5 text-xs font-medium text-ink transition hover:bg-line disabled:opacity-50'
  const tabBtn = (id: string, label: string) => (
    <button onClick={() => setParam('tab', id === 'tablero' ? '' : id)}
      className={'h-8 rounded-lg px-3 text-xs font-medium transition ' + (tab === id ? 'bg-brand-600 text-white' : 'border border-line bg-surface2 text-sub hover:text-ink')}>
      {label}
    </button>
  )

  return (
    <Layout wide>
      <BackButton />
      <header className="mb-3 mt-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink">
            <Footprints size={22} className="text-green-500" aria-hidden /> Contador de clientes
          </h1>
          <div className="ml-auto flex items-center gap-1.5">
            {tabBtn('tablero', 'Tablero')}
            {puedeGestionar && tabBtn('camaras', `Cámaras${offline.length ? ` (${offline.length} sin señal)` : ''}`)}
            <button onClick={() => void cargar()} className={btnChico + ' inline-flex items-center gap-1'}>
              <RefreshCw size={13} className={cargando ? 'animate-spin' : ''} aria-hidden /> Actualizar
            </button>
          </div>
        </div>
      </header>

      {error && <p role="alert" className="mb-4 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>}

      {tab === 'camaras' ? (
        <Camaras dispositivos={dispositivos} locales={locales} onCambio={cargar} tarjeta={tarjeta} btnChico={btnChico} />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-end gap-2 rounded-2xl border border-line bg-surface p-3">
            <div className="flex flex-wrap gap-1">
              {PRESETS.map((p) => (
                <button key={p.id} onClick={() => setParam('preset', p.id)}
                  className={'h-8 rounded-lg px-2.5 text-xs font-medium transition ' + (preset === p.id ? 'bg-brand-600 text-white' : 'border border-line bg-surface2 text-sub hover:text-ink')}>
                  {p.label}
                </button>
              ))}
            </div>
            <label className="block">
              <span className="mb-0.5 block text-[11px] font-medium text-sub">Local</span>
              <select value={fLocal} onChange={(e) => setParam('local', e.target.value)} className="h-8 rounded-lg border border-line bg-surface2 px-2 text-xs">
                <option value="">Todos</option>
                {locales.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </label>
            <span className="ml-auto self-center text-[11px] text-sub/70">{rango.desde} → {rango.hasta}</span>
          </div>

          {!datos ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sub"><Loader2 size={18} className="animate-spin" aria-hidden /> Cargando datos...</div>
          ) : (
            <div className={'flex flex-col gap-4 transition-opacity ' + (cargando ? 'opacity-60' : '')}>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
                <Kpi icono={<LogIn size={16} className="text-emerald-500" />} label="Entradas" valor={nf(datos.totales.entradas)} />
                <Kpi icono={<LogOut size={16} className="text-sky-500" />} label="Salidas" valor={nf(datos.totales.salidas)} />
                <Kpi icono={<Footprints size={16} className="text-violet-500" />} label="Promedio / día" valor={nf(datos.totales.entradas / Math.max(datos.totales.dias, 1))} />
                <Kpi icono={<Footprints size={16} className="text-sky-500" />} label="Transeúntes" valor={nf(datos.totales.transeuntes)}
                  nota={datos.totales.transeuntes ? `atracción ${((100 * datos.totales.entradas) / datos.totales.transeuntes).toFixed(1)}% · ${nf(datos.totales.nuevos)} únicos` : `${nf(datos.totales.empleados)} entradas de personal (no suman)`} />
                <Kpi icono={<Users size={16} className="text-amber-500" />} label="Adentro ahora" valor={nf(adentroAhora)} nota="estimado: entradas − salidas de hoy" />
                <Kpi icono={<Percent size={16} className="text-pink-500" />} label="Conversión"
                  valor={convTotal != null ? `${convTotal.toFixed(1)}%` : '—'}
                  nota={ventas ? `${nf(totalTickets ?? 0)} tickets` : 'configurá la vista de ventas en Cámaras'} />
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className={tarjeta}>
                  <h3 className="mb-3 text-sm font-semibold text-ink">Entradas por hora del día <span className="font-normal text-sub/70">(promedio diario)</span></h3>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={datos.porHora.map((h) => ({ ...h, name: `${h.hora}h` }))} margin={{ left: -12, right: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                      <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip {...TOOLTIP} />
                      <Bar dataKey="promedio" name="Entradas promedio" fill="#34d399" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className={tarjeta}>
                  <h3 className="mb-3 text-sm font-semibold text-ink">Por día</h3>
                  <ResponsiveContainer width="100%" height={260}>
                    <ComposedChart data={serieDia} margin={{ left: -12, right: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                      <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                      <YAxis yAxisId="c" tick={{ fontSize: 10 }} />
                      {ventas && <YAxis yAxisId="p" orientation="right" unit="%" tick={{ fontSize: 10 }} />}
                      <Tooltip {...TOOLTIP} formatter={(v, n) => (n === 'Conversión' ? `${Number(v).toFixed(1)}%` : nf(Number(v)))} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar yAxisId="c" dataKey="entradas" name="Entradas" fill="#34d399" radius={[4, 4, 0, 0]} />
                      <Bar yAxisId="c" dataKey="salidas" name="Salidas" fill="#60a5fa" radius={[4, 4, 0, 0]} />
                      {ventas && <Line yAxisId="p" dataKey="conversion" name="Conversión" stroke="#f472b6" strokeWidth={2} dot={false} />}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className={tarjeta}>
                <h3 className="mb-3 text-sm font-semibold text-ink">Por local</h3>
                {datos.porLocal.length === 0 ? (
                  <p className="text-sm text-sub">Todavía no hay conteos en este rango.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-left text-[11px] uppercase tracking-wider text-sub/70">
                        <tr>
                          <th className="py-1.5 pr-3">Local</th>
                          <th className="py-1.5 pr-3 text-right">Entradas</th>
                          <th className="py-1.5 pr-3 text-right">Salidas</th>
                          <th className="py-1.5 pr-3 text-right">Adentro ahora</th>
                          {ventas && <th className="py-1.5 pr-3 text-right">Tickets</th>}
                          {ventas && <th className="py-1.5 text-right">Conversión</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {datos.porLocal.map((l) => {
                          const tk = tickets?.get(l.local)
                          const conv = conversion(l.entradas, tk ?? 0)
                          return (
                            <tr key={l.local} className="border-t border-line">
                              <td className="py-1.5 pr-3 font-medium text-ink">
                                <button onClick={() => setParam('local', fLocal === l.local ? '' : l.local)} className="hover:underline">{l.local}</button>
                              </td>
                              <td className="py-1.5 pr-3 text-right tabular-nums">{nf(l.entradas)}</td>
                              <td className="py-1.5 pr-3 text-right tabular-nums">{nf(l.salidas)}</td>
                              <td className="py-1.5 pr-3 text-right tabular-nums">{nf(datos.ocupacion.find((o) => o.local === l.local)?.adentro ?? 0)}</td>
                              {ventas && <td className="py-1.5 pr-3 text-right tabular-nums">{nf(tk ?? 0)}</td>}
                              {ventas && <td className="py-1.5 text-right tabular-nums">{conv != null ? `${conv.toFixed(1)}%` : '—'}</td>}
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </Layout>
  )
}

function Kpi({ icono, label, valor, nota }: { icono: React.ReactNode; label: string; valor: string; nota?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-3">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-sub/70">{icono} {label}</div>
      <div className="font-display text-2xl font-bold text-ink">{valor}</div>
      {nota && <div className="text-[11px] text-sub/70">{nota}</div>}
    </div>
  )
}

export function Camaras({ dispositivos, locales, onCambio, tarjeta, btnChico }: {
  dispositivos: Dispositivo[]
  locales: string[]
  onCambio: () => Promise<void>
  tarjeta: string
  btnChico: string
}) {
  const { isAdmin } = useAuth()
  const [local, setLocal] = useState('')
  const [nombre, setNombre] = useState('PC local')
  const [token, setToken] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [borrar, setBorrar] = useState<Dispositivo | null>(null)
  const [quitarCam, setQuitarCam] = useState<{ d: Dispositivo; nombre: string } | null>(null)
  const navegar = useNavigate()

  // Segunda entrada (u otra cámara del mismo DVR): se elige el canal y se calibra en el editor;
  // al guardar, la PC del local crea la cámara sola.
  const agregarCamara = async (d: Dispositivo) => {
    const existentes = new Set((d.estado?.camaras ?? []).map((c) => c.nombre))
    let sugerido = `${d.local} Puerta 2`
    for (let i = 3; existentes.has(sugerido); i++) sugerido = `${d.local} Puerta ${i}`
    const nombre = window.prompt(`Nombre de la cámara nueva de ${d.local} (ej. la segunda entrada):`, sugerido)?.trim()
    if (!nombre) return
    if (existentes.has(nombre)) return setMsg(`Ya hay una cámara llamada "${nombre}".`)
    navegar(`/ia-camaras/calibrar?disp=${d.id}&cam=${encodeURIComponent(nombre)}&nueva=1`)
  }

  const confirmarQuitar = async () => {
    if (!quitarCam) return
    const { error } = await sb().from('contador_config').upsert(
      { dispositivo_id: quitarCam.d.id, camara: quitarCam.nombre, config: { eliminar: true }, actualizado: new Date().toISOString() },
      { onConflict: 'dispositivo_id,camara' })
    setMsg(error ? error.message : `La cámara "${quitarCam.nombre}" se quita en menos de 1 minuto (sus conteos ya guardados se conservan).`)
    setQuitarCam(null)
    await onCambio()
  }
  const [vista, setVista] = useState('')

  useEffect(() => {
    void sb().from('config_app').select('valor').eq('clave', CLAVE_VISTA).maybeSingle()
      .then(({ data }) => setVista(typeof data?.valor === 'string' ? data.valor : ''))
  }, [])

  const registrar = async (e: React.FormEvent) => {
    e.preventDefault()
    setMsg(null)
    const bytes = crypto.getRandomValues(new Uint8Array(32))
    const nuevo = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
    // Solo se guarda el hash: el token se muestra una vez y vive en config.json de la PC
    const { error } = await sb().from('contador_dispositivos').insert({ local, nombre: nombre.trim(), token_hash: await sha256Hex(nuevo) })
    if (error) return setMsg(error.message)
    setToken(nuevo)
    await onCambio()
  }

  const alternar = async (d: Dispositivo) => {
    const { error } = await sb().from('contador_dispositivos').update({ activo: !d.activo }).eq('id', d.id)
    if (error) setMsg(error.message)
    await onCambio()
  }

  const eliminar = async (d: Dispositivo) => {
    const { error } = await sb().from('contador_dispositivos').delete().eq('id', d.id)
    if (error) setMsg(error.message)
    setBorrar(null)
    await onCambio()
  }

  const guardarVista = async () => {
    const v = vista.trim()
    if (v && !/^[A-Za-z0-9_]+$/.test(v)) return setMsg('Nombre de vista inválido.')
    const { error } = await sb().from('config_app').upsert({ clave: CLAVE_VISTA, valor: v }, { onConflict: 'clave' })
    setMsg(error ? error.message : 'Vista de ventas guardada. Recargá el tablero.')
  }

  const minutos = (f: string | null) => (f ? Math.round((Date.now() - new Date(f).getTime()) / 60000) : null)

  return (
    <div className="flex flex-col gap-4">
      {msg && <p className="rounded-xl border border-line bg-surface2 p-3 text-sm text-ink">{msg}</p>}

      <div className={tarjeta}>
        <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-ink"><Cctv size={15} aria-hidden /> PCs contadoras</h3>
        {dispositivos.length === 0 ? (
          <p className="text-sm text-sub">No hay PCs registradas todavía.</p>
        ) : (
          <div className="flex flex-col divide-y divide-line">
            {dispositivos.map((d) => {
              const m = minutos(d.ultimo_latido)
              const online = d.activo && m != null && m <= OFFLINE_MIN
              return (
                <div key={d.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <span className={'inline-block h-2.5 w-2.5 rounded-full ' + (online ? 'bg-emerald-500' : d.activo ? 'bg-red-500' : 'bg-slate-500')} aria-hidden />
                  <div className="min-w-[10rem]">
                    <div className="text-sm font-medium text-ink">{d.local} · {d.nombre}</div>
                    <div className="text-[11px] text-sub/70">
                      {!d.activo ? 'Desactivada' : m == null ? 'Nunca se conectó' : online ? `En línea (hace ${m} min)` : `Sin señal hace ${m} min`}
                      {d.estado?.version && ` · v${d.estado.version}`}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(d.estado?.camaras ?? []).map((c) => (
                      <span key={c.nombre} className="inline-flex items-center gap-1">
                        <span title={c.error ?? ''}
                          className={'rounded-full border px-2 py-0.5 text-[11px] ' + (c.ok ? 'border-emerald-600/40 text-emerald-400' : 'border-red-600/40 text-red-400')}>
                          {c.nombre}: {c.ok ? `${c.fps} fps · ${c.entradas_hoy ?? 0} hoy` : c.error ?? 'error'}
                        </span>
                        <Link to={`/ia-camaras/calibrar?disp=${d.id}&cam=${encodeURIComponent(c.nombre)}`}
                          className="rounded-full border border-line px-2 py-0.5 text-[11px] text-brand-400 hover:bg-surface2">Calibrar</Link>
                        {(d.estado?.camaras?.length ?? 0) > 1 && (
                          <button onClick={() => setQuitarCam({ d, nombre: c.nombre })}
                            className="rounded-full border border-line px-2 py-0.5 text-[11px] text-sub hover:bg-surface2 hover:text-red-400">Quitar</button>
                        )}
                      </span>
                    ))}
                    {d.activo && (d.estado?.camaras?.length ?? 0) > 0 && (
                      <button onClick={() => void agregarCamara(d)}
                        className="rounded-full border border-dashed border-brand-500/60 px-2 py-0.5 text-[11px] text-brand-400 hover:bg-surface2">+ Agregar cámara</button>
                    )}
                  </div>
                  <div className="ml-auto flex gap-1.5">
                    <button onClick={() => void alternar(d)} className={btnChico + ' inline-flex items-center gap-1'}>
                      <Power size={13} aria-hidden /> {d.activo ? 'Desactivar' : 'Activar'}
                    </button>
                    <button onClick={() => setBorrar(d)} className={btnChico} aria-label={`Borrar ${d.nombre}`}><Trash2 size={13} aria-hidden /></button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className={tarjeta}>
        <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-ink"><Plus size={15} aria-hidden /> Registrar PC de un local</h3>
        {token ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-ink">Copiá este token en el <code>config.json</code> de la PC (campo <code>"token"</code>). <strong>No se vuelve a mostrar.</strong></p>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all rounded-lg border border-line bg-surface2 p-2 text-xs">{token}</code>
              <button onClick={() => { void navigator.clipboard.writeText(token); setCopiado(true) }} className={btnChico + ' inline-flex items-center gap-1'}>
                {copiado ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />} {copiado ? 'Copiado' : 'Copiar'}
              </button>
            </div>
            <button onClick={() => { setToken(null); setCopiado(false) }} className={btnChico + ' self-start'}>Listo</button>
          </div>
        ) : (
          <form onSubmit={(e) => void registrar(e)} className="flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="mb-0.5 block text-[11px] font-medium text-sub">Local</span>
              <select value={local} onChange={(e) => setLocal(e.target.value)} required className="h-8 rounded-lg border border-line bg-surface2 px-2 text-xs">
                <option value="">Elegí…</option>
                {locales.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-0.5 block text-[11px] font-medium text-sub">Nombre</span>
              <input value={nombre} onChange={(e) => setNombre(e.target.value)} required maxLength={60} className="h-8 rounded-lg border border-line bg-surface2 px-2 text-xs" />
            </label>
            <button type="submit" className="btn-press h-8 rounded-lg bg-brand-600 px-3 text-xs font-medium text-white">Generar token</button>
          </form>
        )}
      </div>

      {isAdmin && (
        <div className={tarjeta}>
          <h3 className="mb-1 text-sm font-semibold text-ink">Cruce con ventas</h3>
          <p className="mb-3 text-xs text-sub">
            Vista del SQL Server con columnas <code>local</code>, <code>fecha</code>, <code>tickets</code>, agrupada por local y día
            (últimos ~90 días). Tiene que estar habilitada también en Configuraciones → Conexión SQL.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <input value={vista} onChange={(e) => setVista(e.target.value)} placeholder="vw_tickets_diarios" className="h-8 rounded-lg border border-line bg-surface2 px-2 text-xs" />
            <button onClick={() => void guardarVista()} className={btnChico}>Guardar</button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!quitarCam}
        title="¿Quitar la cámara?"
        confirmLabel="Quitar"
        message={quitarCam ? `Se deja de contar con "${quitarCam.nombre}" (${quitarCam.d.local}). Los conteos ya guardados se conservan.` : ''}
        onConfirm={() => void confirmarQuitar()}
        onCancel={() => setQuitarCam(null)}
      />
      <ConfirmDialog
        open={!!borrar}
        message={borrar ? `¿Borrar la PC "${borrar.nombre}" de ${borrar.local}? Deja de poder subir conteos (los ya subidos se conservan).` : ''}
        onConfirm={() => borrar && void eliminar(borrar)}
        onCancel={() => setBorrar(null)}
      />
    </div>
  )
}
