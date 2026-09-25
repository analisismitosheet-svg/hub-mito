import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Loader2, RefreshCw, Percent, LogIn, LogOut, Users, Footprints, Receipt, VideoOff, Video, ChevronRight, Info,
} from 'lucide-react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { supabase } from '@/lib/supabase'
import { leerVista } from '@/lib/sqlApi'
import { CLAVE_VISTA, aVentas, type Venta, type Dispositivo } from '@/pages/ContadorClientes'

/**
 * Tasa de conversión (Locales): video en vivo de la puerta con el conteo
 * dibujado + entradas vs tickets de HOY por local.
 *
 * Video: lo sirve la PC contadora del local (contador-camaras/vista.py) por
 * HTTPS dentro de la VPN (tailscale serve). Solo se ve desde equipos
 * conectados a Tailscale; el hub nunca recibe ni guarda imágenes.
 * Ventas: vista SQL configurada en config_app 'contador_vista_ventas'
 * (local, fecha, tickets). Si no hay, se muestra solo el conteo.
 */

interface CamaraEstado { nombre: string; ok: boolean; fps: number; error: string | null; vista_url?: string | null }
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
  dispositivos: (Dispositivo & { estado: { camaras?: CamaraEstado[] } | null })[]
}

const REFRESCO_MS = 30000
const OFFLINE_MIN = 5
const nf = (n: number) => Math.round(n).toLocaleString('es-AR')
const hoyIso = () => {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}
const enLinea = (d: Dispositivo) =>
  d.activo && !!d.ultimo_latido && Date.now() - new Date(d.ultimo_latido).getTime() <= OFFLINE_MIN * 60000

function sb() {
  if (!supabase) throw new Error('Supabase no está configurado.')
  return supabase
}

export default function TasaConversion() {
  const [params, setParams] = useSearchParams()
  const [datos, setDatos] = useState<LocalHoy[] | null>(null)
  const [ventas, setVentas] = useState<Venta[] | null>(null)
  const [nombres, setNombres] = useState<Record<string, string>>({})
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
    void sb().from('locales').select('codigo,nombre').then(({ data }) =>
      setNombres(Object.fromEntries((data ?? []).map((l) => [l.codigo as string, (l.nombre as string) ?? '']))))
    void (async () => {
      const { data } = await sb().from('config_app').select('valor').eq('clave', CLAVE_VISTA).maybeSingle()
      const vista = typeof data?.valor === 'string' ? data.valor : ''
      if (!vista) return setVentas(null)
      try { setVentas(aVentas(await leerVista(vista, 5000))) } catch { setVentas(null) }
    })()
  }, [])

  const ticketsHoy = useMemo(() => {
    if (!ventas) return null
    const hoy = hoyIso()
    const m = new Map<string, number>()
    for (const v of ventas) if (v.fecha === hoy) m.set(v.local, (m.get(v.local) ?? 0) + v.tickets)
    return m
  }, [ventas])

  const locales = datos ?? []
  const elegido = locales.find((l) => l.local === params.get('local')) ?? locales[0]
  const conv = (entradas: number, tk: number | undefined) => (ticketsHoy && entradas > 0 ? (100 * (tk ?? 0)) / entradas : null)
  const totEntradas = locales.reduce((a, l) => a + l.entradas, 0)
  const totTickets = ticketsHoy ? [...ticketsHoy.values()].reduce((a, b) => a + b, 0) : null

  return (
    <Layout wide>
      <BackButton />
      <header className="mb-4 mt-2 flex flex-wrap items-center gap-2">
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink">
          <Percent size={22} className="text-green-500" aria-hidden /> Tasa de conversión
        </h1>
        <span className="text-xs text-sub/70">Hoy · entradas por cámara vs tickets</span>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-xs text-sub">
            Total: <strong className="text-ink">{nf(totEntradas)}</strong> entradas
            {totTickets != null && <> · <strong className="text-ink">{nf(totTickets)}</strong> tickets · <strong className="text-ink">{totEntradas ? ((100 * totTickets) / totEntradas).toFixed(1) : '—'}%</strong></>}
          </span>
          <button onClick={() => void cargar()} className="btn-press inline-flex h-8 items-center gap-1 rounded-lg border border-line bg-surface2 px-2.5 text-xs font-medium text-ink hover:bg-line">
            <RefreshCw size={13} className={cargando ? 'animate-spin' : ''} aria-hidden /> Actualizar
          </button>
        </div>
      </header>

      {error && <p role="alert" className="mb-4 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>}

      {!datos ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sub"><Loader2 size={18} className="animate-spin" aria-hidden /> Cargando...</div>
      ) : locales.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface p-4 text-sm text-sub">
          Todavía no hay locales con cámaras contando. Se registran en <Link to="/ia-camaras?tab=pcs" className="text-brand-400 hover:underline">Sistemas → IA Cámaras</Link>.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {/* Selector de local */}
          <div className="flex flex-wrap gap-1.5">
            {locales.map((l) => {
              const c = conv(l.entradas, ticketsHoy?.get(l.local))
              const activo = l.local === elegido?.local
              const online = l.dispositivos.some(enLinea)
              return (
                <button key={l.local} onClick={() => setParams({ local: l.local }, { replace: true })}
                  className={'inline-flex h-9 items-center gap-2 rounded-xl px-3 text-sm font-medium transition ' +
                    (activo ? 'bg-brand-600 text-white' : 'border border-line bg-surface text-ink hover:bg-surface2')}>
                  <span className={'inline-block h-2 w-2 rounded-full ' + (online ? 'bg-emerald-400' : 'bg-red-400')} aria-hidden />
                  {l.local}
                  <span className={activo ? 'text-white/80' : 'text-sub'}>{c != null ? `${c.toFixed(1)}%` : nf(l.entradas)}</span>
                </button>
              )
            })}
          </div>

          {elegido && <DetalleLocal l={elegido} nombre={nombres[elegido.local]} tickets={ticketsHoy?.get(elegido.local)} hayVentas={!!ticketsHoy} />}

          {/* Todos los locales (solo la central: cada local ve únicamente el suyo por RLS) */}
          {locales.length > 1 && <div className="overflow-x-auto rounded-2xl border border-line bg-surface p-4">
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wider text-sub/70">
                <tr>
                  <th className="py-1.5 pr-3">Local</th>
                  <th className="py-1.5 pr-3 text-right">Entradas</th>
                  <th className="py-1.5 pr-3 text-right">Tickets</th>
                  <th className="py-1.5 pr-3 text-right">Conversión</th>
                  <th className="py-1.5 pr-3 text-right">Adentro</th>
                  <th className="py-1.5 text-right">Atracción</th>
                </tr>
              </thead>
              <tbody>
                {locales.map((l) => {
                  const tk = ticketsHoy?.get(l.local)
                  const c = conv(l.entradas, tk)
                  return (
                    <tr key={l.local} className="cursor-pointer border-t border-line hover:bg-surface2/60" onClick={() => setParams({ local: l.local }, { replace: true })}>
                      <td className="py-1.5 pr-3 font-medium text-ink">{l.local} <span className="text-xs font-normal text-sub">{nombres[l.local]}</span></td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{nf(l.entradas)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{ticketsHoy ? nf(tk ?? 0) : '—'}</td>
                      <td className="py-1.5 pr-3 text-right font-semibold tabular-nums text-ink">{c != null ? `${c.toFixed(1)}%` : '—'}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{nf(l.adentro)}</td>
                      <td className="py-1.5 text-right tabular-nums">{l.transeuntes ? `${((100 * l.entradas) / l.transeuntes).toFixed(1)}%` : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>}
        </div>
      )}
    </Layout>
  )
}

function DetalleLocal({ l, nombre, tickets, hayVentas }: { l: LocalHoy; nombre?: string; tickets?: number; hayVentas: boolean }) {
  const camaras = l.dispositivos.filter((d) => d.activo).flatMap((d) => (d.estado?.camaras ?? []).map((c) => ({ ...c, online: enLinea(d) })))
  const [camIdx, setCamIdx] = useState(0)
  useEffect(() => setCamIdx(0), [l.local])
  const cam = camaras[Math.min(camIdx, Math.max(camaras.length - 1, 0))]
  const c = hayVentas && l.entradas > 0 ? (100 * (tickets ?? 0)) / l.entradas : null
  const horas = Array.from({ length: 16 }, (_, i) => i + 8).map((h) => ({ name: `${h}h`, entradas: l.horas.find((x) => x.hora === h)?.entradas ?? 0 }))

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="rounded-2xl border border-line bg-surface p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Video size={15} className="text-sub" aria-hidden />
          <span className="text-sm font-semibold text-ink">{l.local}</span>
          {nombre && <span className="text-xs text-sub">{nombre}</span>}
          <div className="ml-auto flex gap-1">
            {camaras.length > 1 && camaras.map((x, i) => (
              <button key={x.nombre} onClick={() => setCamIdx(i)}
                className={'h-7 rounded-lg px-2 text-xs ' + (i === camIdx ? 'bg-brand-600 text-white' : 'border border-line bg-surface2 text-sub')}>
                {x.nombre}
              </button>
            ))}
          </div>
        </div>
        <VideoEnVivo key={`${l.local}-${cam?.nombre ?? ''}`} url={cam?.online && cam.ok ? cam?.vista_url ?? null : null}
          motivo={!cam ? 'Este local todavía no tiene cámaras informando.'
            : !cam.online ? 'La PC contadora del local no está en línea (apagada o sin internet).'
            : !cam.ok ? `La cámara no responde: ${cam.error ?? 'sin imagen'}. Revisá que el DVR del local esté prendido y con internet.`
            : !cam.vista_url ? 'El video en vivo no está publicado en esta PC (publicar_vista.bat).' : ''} />
      </div>

      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Dato icono={<Percent size={15} className="text-pink-500" />} label="Conversión" valor={c != null ? `${c.toFixed(1)}%` : '—'} grande
            nota={hayVentas ? `${nf(tickets ?? 0)} tickets / ${nf(l.entradas)} entradas` : 'faltan las ventas'} />
          <Dato icono={<LogIn size={15} className="text-emerald-500" />} label="Entradas hoy" valor={nf(l.entradas)} grande
            nota={l.nuevos + l.reingresos > 0 ? `${nf(l.nuevos)} clientes únicos · ${nf(l.reingresos)} volvieron` : undefined} />
          <Dato icono={<Users size={15} className="text-amber-500" />} label="Adentro ahora" valor={nf(l.adentro)} />
          <Dato icono={<LogOut size={15} className="text-sky-500" />} label="Salidas" valor={nf(l.salidas)} />
          <Dato icono={<Footprints size={15} className="text-violet-500" />} label="Transeúntes" valor={nf(l.transeuntes)}
            nota={l.transeuntes ? `atracción ${((100 * l.entradas) / l.transeuntes).toFixed(1)}%` : undefined} />
          <Dato icono={<Receipt size={15} className="text-lime-500" />} label="Tickets hoy" valor={hayVentas ? nf(tickets ?? 0) : '—'} />
        </div>

        <div className="rounded-2xl border border-line bg-surface p-3">
          <div className="mb-1 text-xs font-semibold text-ink">Entradas por hora</div>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={horas} margin={{ left: -24, right: 4, top: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
              <XAxis dataKey="name" tick={{ fontSize: 9 }} interval={1} />
              <YAxis tick={{ fontSize: 9 }} allowDecimals={false} />
              <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, fontSize: 11, color: 'var(--ink)' }} />
              <Bar dataKey="entradas" name="Entradas" fill="#34d399" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {!hayVentas && (
          <p className="flex gap-2 rounded-xl border border-line bg-surface2/60 p-3 text-xs text-sub">
            <Info size={14} className="mt-0.5 shrink-0" aria-hidden />
            Para calcular la conversión falta conectar los tickets de venta por local y día. Se configura en Locales → Contador de clientes → Cámaras → “Cruce con ventas”.
          </p>
        )}
        <Link to={`/contador-clientes?local=${encodeURIComponent(l.local)}`} className="inline-flex items-center gap-0.5 self-end text-xs font-medium text-brand-400 hover:underline">
          Historial y comparativas <ChevronRight size={13} aria-hidden />
        </Link>
      </div>
    </div>
  )
}

function VideoEnVivo({ url, motivo }: { url: string | null; motivo: string }) {
  const [estado, setEstado] = useState<'cargando' | 'ok' | 'error'>('cargando')
  const [causa, setCausa] = useState<'vpn' | 'imagen' | null>(null)
  const [intento, setIntento] = useState(0)
  const img = useRef<HTMLImageElement>(null)

  // MJPEG: Chrome no siempre dispara onLoad en un stream continuo -> se mira si ya llegó el primer cuadro
  useEffect(() => {
    if (!url) return
    setEstado('cargando')
    setCausa(null)
    const inicio = Date.now()
    const t = setInterval(() => {
      if ((img.current?.naturalWidth ?? 0) > 0) { setEstado('ok'); clearInterval(t) }
      else if (Date.now() - inicio > 12000) { setEstado('error'); clearInterval(t) }
    }, 400)
    return () => clearInterval(t)
  }, [url, intento])

  // Si falla: ¿llegamos a la PC del local? (sí -> problema de imagen; no -> falta la VPN)
  useEffect(() => {
    if (estado !== 'error' || !url) return
    const salud = new URL(url)
    salud.pathname = '/salud'
    salud.search = ''
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 6000)
    fetch(salud.toString(), { signal: ctrl.signal, cache: 'no-store' })
      .then((r) => setCausa(r.ok ? 'imagen' : 'vpn'))
      .catch(() => setCausa('vpn'))
      .finally(() => clearTimeout(t))
    return () => { clearTimeout(t); ctrl.abort() }
  }, [estado, url])

  if (!url) {
    return (
      <div className="flex aspect-video flex-col items-center justify-center gap-2 rounded-xl bg-black/40 p-4 text-center text-sm text-sub">
        <VideoOff size={28} aria-hidden /> {motivo}
      </div>
    )
  }
  return (
    <div className="relative aspect-video overflow-hidden rounded-xl bg-black">
      <img key={intento} ref={img} src={`${url}&r=${intento}`} alt="Video en vivo de la puerta con el conteo"
        className="h-full w-full object-contain" onError={() => setEstado('error')} />
      {estado !== 'ok' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 p-4 text-center text-sm text-white/80">
          {estado === 'cargando' ? <Loader2 size={24} className="animate-spin" aria-hidden /> : <VideoOff size={28} aria-hidden />}
          {estado === 'cargando' ? 'Conectando con la cámara…' : (
            <>
              No se pudo abrir el video.
              <span className="text-xs text-white/60">
                {causa === 'imagen' ? 'La PC del local responde, pero la cámara no está enviando imagen. Revisá el DVR.'
                  : causa === 'vpn' ? 'Este equipo no llega a la PC del local: el video en vivo solo se ve conectado a la VPN de la empresa (Tailscale).'
                  : 'Revisando la causa…'}
              </span>
              <button onClick={() => setIntento((n) => n + 1)} className="mt-1 rounded-lg border border-white/30 px-2 py-1 text-xs">Reintentar</button>
            </>
          )}
        </div>
      )}
      {estado === 'ok' && <span className="absolute left-2 top-2 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">EN VIVO</span>}
    </div>
  )
}

function Dato({ icono, label, valor, nota, grande }: { icono: React.ReactNode; label: string; valor: string; nota?: string; grande?: boolean }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-3">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-sub/70">{icono} {label}</div>
      <div className={'font-display font-bold text-ink ' + (grande ? 'text-3xl' : 'text-xl')}>{valor}</div>
      {nota && <div className="text-[11px] text-sub/70">{nota}</div>}
    </div>
  )
}
