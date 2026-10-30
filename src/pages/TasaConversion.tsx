import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Loader2, RefreshCw, Percent, Gauge, LogIn, Footprints, Receipt, VideoOff, Video, ChevronRight, Info, Target, TrendingUp,
} from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { supabase } from '@/lib/supabase'
import { leerVista } from '@/lib/sqlApi'
import { CLAVE_VISTA, aVentas, type Venta, type Dispositivo } from '@/pages/ContadorClientes'
import { ErrorVideo, pedirPase, urlVideo } from '@/lib/videoContador'
import { FUERA_DE_CONVERSION } from '@/lib/informeConversion'

/**
 * Tasa de conversión (Locales): video en vivo de la puerta con el conteo
 * dibujado + entradas vs tickets de HOY por local, con objetivo diario,
 * diferencia y desglose interactivo hora por hora.
 *
 * Video: lo sirve la PC contadora (contador-camaras/vista.py) con un pase temporal que
 * valida el usuario contra el hub (cada local ve solo lo suyo). El hub nunca recibe ni guarda imágenes.
 * Ventas: vista SQL configurada en config_app 'contador_vista_ventas'
 * (local, fecha, hora, tickets, total). Si no hay, se muestra solo el conteo.
 */

interface CamaraEstado { nombre: string; ok: boolean; fps: number; error: string | null; vista_base?: string | null }
interface HoraLocal {
  hora: number
  entradas: number
  salidas?: number
  transeuntes?: number
  empleados?: number
  nuevos?: number
  reingresos?: number
}
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
  horas: HoraLocal[]
  dispositivos: (Dispositivo & { estado: { camaras?: CamaraEstado[] } | null })[]
}

const REFRESCO_MS = 30000
const MINUTOS_VIDEO = 5 // el video en vivo se pausa solo (sale por la subida de internet de la PC contadora)
const OFFLINE_MIN = 5
const nf = (n: number) => Math.round(n).toLocaleString('es-AR')
const nfMoneda = (n: number) => (n < 0 ? '-$' : '$') + Math.round(Math.abs(n)).toLocaleString('es-AR')
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
  const [objetivos, setObjetivos] = useState<Map<string, number>>(new Map())
  const [nombres, setNombres] = useState<Record<string, string>>({})
  const [horaSel, setHoraSel] = useState<number | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    const hoy = hoyIso()
    const [{ data, error: err }, objRes] = await Promise.all([
      sb().rpc('contador_locales_hoy'),
      sb().rpc('objetivos_locales_dia', { p_desde: hoy, p_hasta: hoy }),
    ])
    if (err) setError(err.message)
    else {
      setError(null)
      setDatos(((data as LocalHoy[]) ?? []).filter((l) => !FUERA_DE_CONVERSION.has(l.local)))
    }
    if (!objRes.error && Array.isArray(objRes.data)) {
      const m = new Map<string, number>()
      for (const f of objRes.data as { local: string; objetivo: number | null }[]) {
        if (f.local && f.objetivo != null && Number.isFinite(Number(f.objetivo))) {
          m.set(String(f.local).trim().toUpperCase(), Number(f.objetivo))
        }
      }
      setObjetivos(m)
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
  }, [])

  // Ventas: la vista trae una fila por local + día + hora (~11 000 filas en 180 días): se pide entera
  // (con un tope chico quedaban afuera horas de hoy) y se vuelve a pedir cada 2 minutos.
  const cargarVentas = useCallback(async () => {
    const { data } = await sb().from('config_app').select('valor').eq('clave', CLAVE_VISTA).maybeSingle()
    const vista = typeof data?.valor === 'string' ? data.valor : ''
    if (!vista) return setVentas(null)
    try { setVentas(aVentas(await leerVista(vista, 50000))) } catch { /* se mantiene lo último que llegó */ }
  }, [])
  useEffect(() => {
    void cargarVentas()
    const t = setInterval(() => { if (document.visibilityState === 'visible') void cargarVentas() }, 2 * 60 * 1000)
    return () => clearInterval(t)
  }, [cargarVentas])

  // Ventas acumuladas de todo el día por local
  const ventasDia = useMemo(() => {
    if (!ventas) return null
    const hoy = hoyIso()
    const tickets = new Map<string, number>()
    const totales = new Map<string, number>()
    let generalTickets = 0
    let generalTotal = 0
    for (const v of ventas) {
      if (v.fecha !== hoy) continue
      tickets.set(v.local, (tickets.get(v.local) ?? 0) + v.tickets)
      generalTickets += v.tickets
      const t = v.total ?? 0
      totales.set(v.local, (totales.get(v.local) ?? 0) + t)
      generalTotal += t
    }
    return { tickets, totales, generalTickets, generalTotal }
  }, [ventas])

  // Ventas filtradas(al elegir una hora o del día entero si horaSel === null)
  const ventasActivas = useMemo(() => {
    if (!ventas) return null
    if (horaSel == null) return ventasDia
    const hoy = hoyIso()
    const tickets = new Map<string, number>()
    const totales = new Map<string, number>()
    let generalTickets = 0
    let generalTotal = 0
    for (const v of ventas) {
      if (v.fecha !== hoy || v.hora !== horaSel) continue
      tickets.set(v.local, (tickets.get(v.local) ?? 0) + v.tickets)
      generalTickets += v.tickets
      const t = v.total ?? 0
      totales.set(v.local, (totales.get(v.local) ?? 0) + t)
      generalTotal += t
    }
    return { tickets, totales, generalTickets, generalTotal }
  }, [ventas, ventasDia, horaSel])

  const hayTotal = !!ventas?.some((v) => v.total != null)
  const hayObjetivos = objetivos.size > 0
  const locales = datos ?? []
  const elegido = locales.find((l) => l.local === params.get('local')) ?? locales[0]

  const metricasDe = useCallback((l: LocalHoy, hora: number | null) => {
    if (hora == null) {
      return {
        entradas: l.entradas,
        transeuntes: l.transeuntes,
        nuevos: l.nuevos,
        reingresos: l.reingresos,
      }
    }
    const h = l.horas.find((x) => x.hora === hora)
    return {
      entradas: h?.entradas ?? 0,
      transeuntes: h?.transeuntes ?? 0,
      nuevos: h?.nuevos ?? 0,
      reingresos: h?.reingresos ?? 0,
    }
  }, [])

  const conv = (entradas: number, tk: number | undefined) =>
    ventasActivas && entradas > 0 ? (100 * (tk ?? 0)) / entradas : null

  const totEntradas = locales.reduce((a, l) => a + metricasDe(l, horaSel).entradas, 0)
  const totTickets = ventasActivas ? ventasActivas.generalTickets : null
  const totTotal = hayTotal && ventasActivas ? ventasActivas.generalTotal : null
  const toggleHora = (h: number | null) => setHoraSel((prev) => (prev === h ? null : h))

  return (
    <Layout>
      <BackButton />
      <header className="mb-4 mt-2 flex flex-wrap items-center gap-2">
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink">
          <Percent size={22} className="text-green-500" aria-hidden /> Tasa de conversión
        </h1>
        <span className="text-xs text-sub/70">
          {horaSel != null
            ? `Filtrado de ${horaSel}:00 a ${horaSel}:59 hs · entradas vs tickets y ventas de esa hora`
            : 'Hoy · entradas por cámara vs tickets'}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-xs text-sub">
            {horaSel != null && <><strong className="text-emerald-400">{horaSel}h</strong> · </>}
            Total: <strong className="text-ink">{nf(totEntradas)}</strong> entradas
            {totTickets != null && <> · <strong className="text-ink">{nf(totTickets)}</strong> tickets · <strong className="text-ink">{totEntradas ? ((100 * totTickets) / totEntradas).toFixed(1) : '—'}%</strong></>}
            {totTotal != null && <> · <strong className="text-ink">{nfMoneda(totTotal)}</strong></>}
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
              const m = metricasDe(l, horaSel)
              const c = conv(m.entradas, ventasActivas?.tickets.get(l.local))
              const activo = l.local === elegido?.local
              const online = l.dispositivos.some(enLinea)
              return (
                <button key={l.local} onClick={() => setParams({ local: l.local }, { replace: true })}
                  className={'inline-flex h-9 items-center gap-2 rounded-xl px-3 text-sm font-medium transition ' +
                    (activo ? 'bg-brand-600 text-white' : 'border border-line bg-surface text-ink hover:bg-surface2')}>
                  <span className={'inline-block h-2 w-2 rounded-full ' + (online ? 'bg-emerald-400' : 'bg-red-400')} aria-hidden />
                  {l.local}
                  <span className={activo ? 'text-white/80' : 'text-sub'}>{c != null ? `${c.toFixed(1)}%` : nf(m.entradas)}</span>
                </button>
              )
            })}
          </div>

          {elegido && (
            <DetalleLocal
              l={elegido}
              locales={locales}
              nombres={nombres}
              horaSel={horaSel}
              onSelectHora={toggleHora}
              onSelectLocal={(cod) => setParams({ local: cod }, { replace: true })}
              metricas={metricasDe(elegido, horaSel)}
              tickets={ventasActivas?.tickets.get(elegido.local)}
              hayVentas={!!ventasActivas}
              total={ventasActivas?.totales.get(elegido.local)}
              totalDia={ventasDia?.totales.get(elegido.local)}
              hayTotal={hayTotal}
              objetivo={objetivos.get(elegido.local)}
              ventasHoraPorLocal={ventasActivas}
            />
          )}

          {/* Todos los locales (solo la central: cada local ve únicamente el suyo por RLS) */}
          {locales.length > 1 && (
            <div className="overflow-x-auto rounded-2xl border border-line bg-surface p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-ink">
                  {horaSel != null
                    ? `Todos los locales · Hora ${horaSel}:00 a ${horaSel}:59 hs`
                    : 'Todos los locales · Acumulado de hoy'}
                </span>
              </div>
              <table className="w-full text-sm">
                <thead className="text-left text-[11px] uppercase tracking-wider text-sub/70">
                  <tr>
                    <th className="py-1.5 pr-3">Local</th>
                    <th className="py-1.5 pr-3 text-right">Entradas</th>
                    <th className="py-1.5 pr-3 text-right">Tickets</th>
                    {hayTotal && <th className="py-1.5 pr-3 text-right">Total</th>}
                    {hayObjetivos && <th className="py-1.5 pr-3 text-right">Objetivo día</th>}
                    {hayTotal && hayObjetivos && <th className="py-1.5 pr-3 text-right">Diferencia</th>}
                    <th className="py-1.5 text-right">Conversión</th>
                  </tr>
                </thead>
                <tbody>
                  {locales.map((l) => {
                    const m = metricasDe(l, horaSel)
                    const tk = ventasActivas?.tickets.get(l.local)
                    const tot = ventasActivas?.totales.get(l.local) ?? 0
                    const obj = objetivos.get(l.local)
                    const dif = obj != null ? tot - obj : null
                    const pctObj = obj && obj > 0 ? (100 * tot) / obj : 0
                    const c = conv(m.entradas, tk)
                    const difColor = dif == null ? 'text-sub' : dif >= 0 ? 'text-emerald-400' : pctObj >= 80 ? 'text-amber-400' : 'text-red-400'
                    return (
                      <tr key={l.local} className={'cursor-pointer border-t border-line hover:bg-surface2/60 ' + (l.local === elegido?.local ? 'bg-surface2/40' : '')}
                        onClick={() => setParams({ local: l.local }, { replace: true })}>
                        <td className="py-1.5 pr-3 font-medium text-ink">{l.local} <span className="text-xs font-normal text-sub">{nombres[l.local]}</span></td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{nf(m.entradas)}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{ventasActivas ? nf(tk ?? 0) : '—'}</td>
                        {hayTotal && <td className="py-1.5 pr-3 text-right tabular-nums">{nfMoneda(tot)}</td>}
                        {hayObjetivos && <td className="py-1.5 pr-3 text-right tabular-nums">{obj != null ? nfMoneda(obj) : '—'}</td>}
                        {hayTotal && hayObjetivos && (
                          <td className={'py-1.5 pr-3 text-right font-medium tabular-nums ' + difColor}>
                            {dif != null ? `${dif >= 0 ? '+' : ''}${nfMoneda(dif)}` : '—'}
                          </td>
                        )}
                        <td className="py-1.5 text-right font-semibold tabular-nums text-ink">{c != null ? `${c.toFixed(1)}%` : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Layout>
  )
}

function DetalleLocal({
  l, locales, nombres, horaSel, onSelectHora, onSelectLocal, metricas, tickets, hayVentas, total, totalDia, hayTotal, objetivo, ventasHoraPorLocal,
}: {
  l: LocalHoy
  locales: LocalHoy[]
  nombres: Record<string, string>
  horaSel: number | null
  onSelectHora: (h: number | null) => void
  onSelectLocal: (cod: string) => void
  metricas: { entradas: number; transeuntes: number; nuevos: number; reingresos: number }
  tickets?: number
  hayVentas: boolean
  total?: number
  totalDia?: number
  hayTotal?: boolean
  objetivo?: number
  ventasHoraPorLocal: { tickets: Map<string, number>; totales: Map<string, number>; generalTickets: number; generalTotal: number } | null
}) {
  const camaras = l.dispositivos.filter((d) => d.activo).flatMap((d) => (d.estado?.camaras ?? []).map((c) => ({ ...c, online: enLinea(d) })))
  const [camIdx, setCamIdx] = useState(0)
  useEffect(() => setCamIdx(0), [l.local])
  const cam = camaras[Math.min(camIdx, Math.max(camaras.length - 1, 0))]
  const c = hayVentas && metricas.entradas > 0 ? (100 * (tickets ?? 0)) / metricas.entradas : null
  const horas = Array.from({ length: 16 }, (_, i) => i + 8).map((h) => ({
    hora: h,
    entradas: l.horas.find((x) => x.hora === h)?.entradas ?? 0,
  }))
  const maxEntradasHora = Math.max(...horas.map((x) => x.entradas), 1)

  const totVal = total ?? 0
  const dif = hayVentas && hayTotal && objetivo != null ? totVal - objetivo : null
  const pctObj = objetivo && objetivo > 0 ? (100 * totVal) / objetivo : null
  const colorDif = dif == null ? undefined : dif >= 0 ? 'text-emerald-400' : (pctObj ?? 0) >= 80 ? 'text-amber-400' : 'text-red-400'
  const sufijoHora = horaSel != null ? ` (${horaSel}h)` : ' hoy'

  const totHoraEntradas = horaSel != null
    ? locales.reduce((a, loc) => a + (loc.horas.find((x) => x.hora === horaSel)?.entradas ?? 0), 0)
    : 0

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="rounded-2xl border border-line bg-surface p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Video size={15} className="text-sub" aria-hidden />
          <span className="text-sm font-semibold text-ink">{l.local}</span>
          {nombres[l.local] && <span className="text-xs text-sub">{nombres[l.local]}</span>}
          <div className="ml-auto flex gap-1">
            {camaras.length > 1 && camaras.map((x, i) => (
              <button key={x.nombre} onClick={() => setCamIdx(i)}
                className={'h-7 rounded-lg px-2 text-xs ' + (i === camIdx ? 'bg-brand-600 text-white' : 'border border-line bg-surface2 text-sub')}>
                {x.nombre}
              </button>
            ))}
          </div>
        </div>
        <VideoEnVivo key={`${l.local}-${cam?.nombre ?? ''}`} base={cam?.online && cam.ok ? cam?.vista_base ?? null : null} camara={cam?.nombre ?? ''}
          motivo={!cam ? 'Este local todavía no tiene cámaras informando.'
            : !cam.online ? 'La PC contadora no está en línea (apagada o sin internet).'
            : !cam.ok ? `La cámara no responde: ${cam.error ?? 'sin imagen'}. Revisá que el DVR del local esté prendido y con internet.`
            : !cam.vista_base ? 'La PC contadora no publica el video en vivo (falta url_publica en su configuración).' : ''} />
      </div>

      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          {/* 1. Conversión */}
          <Dato icono={<Percent size={15} className="text-pink-500" />} label={horaSel != null ? `Conversión (${horaSel}h)` : 'Conversión'}
            valor={c != null ? `${c.toFixed(1)}%` : '—'} grande
            nota={hayVentas ? `${nf(tickets ?? 0)} tickets / ${nf(metricas.entradas)} entradas` : 'faltan las ventas'} />
          {/* 2. Entradas */}
          <Dato icono={<LogIn size={15} className="text-emerald-500" />} label={`Entradas${sufijoHora}`} valor={nf(metricas.entradas)} grande
            nota={metricas.nuevos + metricas.reingresos > 0 ? `${nf(metricas.nuevos)} clientes únicos · ${nf(metricas.reingresos)} volvieron` : undefined} />
          {/* 3. FPS */}
          <Dato icono={<Gauge size={15} className="text-sky-500" />} label="FPS" valor={cam && cam.online && cam.ok ? (Number(cam.fps) || 0).toFixed(1) : '—'}
            nota={cam ? (camaras.length > 1 ? cam.nombre : 'cuadros por segundo que analiza la IA') : undefined} />
          {/* 4. Transeúntes */}
          <Dato icono={<Footprints size={15} className="text-violet-500" />} label={horaSel != null ? `Transeúntes (${horaSel}h)` : 'Transeúntes'}
            valor={nf(metricas.transeuntes)} />
          {/* 5. Total hoy (arriba) */}
          <Dato icono={<Receipt size={15} className="text-amber-500" />} label={`Total${sufijoHora}`}
            valor={hayVentas && hayTotal ? nfMoneda(totVal) : '—'}
            nota={horaSel != null && hayVentas && hayTotal ? `acumulado hoy: ${nfMoneda(totalDia ?? 0)}` : 'acumulado del día'} />
          {/* 6. Objetivo hoy */}
          <Dato icono={<Target size={15} className="text-cyan-400" />} label="Objetivo hoy"
            valor={objetivo != null ? nfMoneda(objetivo) : '—'}
            nota={objetivo != null ? (horaSel != null && pctObj != null ? `esta hora aporta ${pctObj.toFixed(1)}% de la meta` : 'meta del día') : 'sin objetivo cargado'} />
          {/* 7. Tickets hoy (abajo) */}
          <Dato icono={<Receipt size={15} className="text-lime-500" />} label={`Tickets${sufijoHora}`}
            valor={hayVentas ? nf(tickets ?? 0) : '—'} />
          {/* 8. Diferencia entre Total y Objetivo */}
          <Dato icono={<TrendingUp size={15} className="text-amber-400" />} label={horaSel != null ? `Diferencia (${horaSel}h vs obj)` : 'Diferencia'}
            valor={dif != null ? `${dif >= 0 ? '+' : ''}${nfMoneda(dif)}` : '—'}
            valorColor={colorDif}
            nota={pctObj != null ? `${pctObj.toFixed(1)}% del objetivo` : undefined} />
        </div>

        <div className="rounded-2xl border border-line bg-surface p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-xs font-semibold text-ink">
              Entradas por hora <span className="font-normal text-sub">(tocá una hora para filtrar ventas, tickets y entradas)</span>
            </div>
            {horaSel != null && (
              <button type="button" onClick={() => onSelectHora(null)}
                className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300 hover:bg-emerald-500/20">
                Ver todo el día ×
              </button>
            )}
          </div>

          <div className="flex h-[155px] select-none items-end gap-1 border-b border-line/60 px-1 pb-1 pt-5">
            {horas.map(({ hora: h, entradas: val }) => {
              const pct = Math.max((val / maxEntradasHora) * 100, val > 0 ? 8 : 2)
              const sel = horaSel === h
              const barCls = sel
                ? 'bg-emerald-300 ring-2 ring-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.6)]'
                : horaSel != null
                  ? 'bg-emerald-500/45 hover:bg-emerald-400/80'
                  : 'bg-emerald-400 hover:bg-emerald-300'
              return (
                <button key={h} type="button" onClick={() => onSelectHora(h)}
                  className="group flex h-full flex-1 cursor-pointer flex-col items-center justify-end focus:outline-none"
                  title={`${h}:00 a ${h}:59 hs · ${nf(val)} entradas`}>
                  <span className={'mb-1 text-[10px] font-semibold tabular-nums ' + (sel ? 'scale-110 text-emerald-300' : 'text-ink')}>
                    {val > 0 ? nf(val) : ''}
                  </span>
                  <div className={'w-full rounded-t transition-all ' + barCls} style={{ height: `${pct}%` }} />
                  <span className={'mt-1.5 text-[10px] font-medium tabular-nums ' + (sel ? 'font-bold text-emerald-300' : 'text-ink/80')}>
                    {h}h
                  </span>
                </button>
              )
            })}
          </div>

          {horaSel != null && (
            <div className="mt-3 rounded-xl border border-emerald-500/30 bg-[#101016] p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-emerald-400">
                  Detalle de {horaSel}:00 a {horaSel}:59 hs en cada local
                </span>
                <span className="text-[11px] text-sub">
                  Total {horaSel}h: <strong className="text-ink">{nf(totHoraEntradas)}</strong> entradas
                  {ventasHoraPorLocal && (
                    <>
                      {' · '}<strong className="text-ink">{nf(ventasHoraPorLocal.generalTickets)}</strong> tickets
                      {hayTotal && <>{' · '}<strong className="text-ink">{nfMoneda(ventasHoraPorLocal.generalTotal)}</strong></>}
                    </>
                  )}
                </span>
              </div>
              <table className="w-full text-xs">
                <thead className="text-left text-[10px] uppercase tracking-wider text-sub">
                  <tr>
                    <th className="py-1 pr-2">Local</th>
                    <th className="py-1 pr-2 text-right">Entradas</th>
                    {hayVentas && <th className="py-1 pr-2 text-right">Tickets</th>}
                    {hayVentas && hayTotal && <th className="py-1 pr-2 text-right">Venta hora</th>}
                    <th className="py-1 text-right">{hayVentas ? 'Conversión' : '% de la hora'}</th>
                  </tr>
                </thead>
                <tbody>
                  {locales.map((loc) => {
                    const hObj = loc.horas.find((x) => x.hora === horaSel)
                    const eHora = hObj?.entradas ?? 0
                    const tkHora = ventasHoraPorLocal?.tickets.get(loc.local) ?? 0
                    const vHora = ventasHoraPorLocal?.totales.get(loc.local) ?? 0
                    const convHora = hayVentas
                      ? (eHora > 0 ? `${((100 * tkHora) / eHora).toFixed(1)}%` : '—')
                      : (totHoraEntradas > 0 ? `${((100 * eHora) / totHoraEntradas).toFixed(1)}%` : '—')
                    return (
                      <tr key={loc.local} onClick={() => onSelectLocal(loc.local)}
                        className={'cursor-pointer border-t border-line/60 hover:bg-surface2/60 ' + (loc.local === l.local ? 'bg-surface2/40' : '')}>
                        <td className="py-1.5 pr-2 font-medium text-ink">
                          {loc.local} <span className="text-[11px] font-normal text-sub">{nombres[loc.local]}</span>
                        </td>
                        <td className="py-1.5 pr-2 text-right font-semibold tabular-nums text-emerald-400">{nf(eHora)}</td>
                        {hayVentas && <td className="py-1.5 pr-2 text-right tabular-nums text-ink">{nf(tkHora)}</td>}
                        {hayVentas && hayTotal && <td className="py-1.5 pr-2 text-right tabular-nums text-amber-300">{nfMoneda(vHora)}</td>}
                        <td className="py-1.5 text-right font-semibold tabular-nums text-ink">{convHora}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
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

function VideoEnVivo({ base, camara, motivo }: { base: string | null; camara: string; motivo: string }) {
  const [estado, setEstado] = useState<'cargando' | 'ok' | 'error'>('cargando')
  const [aviso, setAviso] = useState<string | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [intento, setIntento] = useState(0)
  const [pausado, setPausado] = useState<null | 'oculto' | 'tiempo'>(null)
  const img = useRef<HTMLImageElement>(null)

  // Ahorro de internet (el video sale por la subida de la PC contadora):
  // se corta si la pestaña no está a la vista y a los 5 minutos de estar mirando.
  useEffect(() => {
    const alCambiar = () => { if (document.visibilityState === 'hidden') setPausado('oculto') }
    document.addEventListener('visibilitychange', alCambiar)
    return () => document.removeEventListener('visibilitychange', alCambiar)
  }, [])
  useEffect(() => {
    if (pausado || !base) return
    const t = setTimeout(() => setPausado('tiempo'), MINUTOS_VIDEO * 60000)
    return () => clearTimeout(t)
  }, [pausado, base, intento])

  // 1) pedir el pase temporal a la PC contadora (valida el usuario contra el hub)
  useEffect(() => {
    if (!base || pausado) return
    let vivo = true
    setEstado('cargando')
    setAviso(null)
    setUrl(null)
    pedirPase(base, camara, 'ver')
      .then((pase) => { if (vivo) setUrl(`${urlVideo(base, camara, pase)}&r=${intento}`) })
      .catch((e: unknown) => {
        if (!vivo) return
        setEstado('error')
        setAviso(e instanceof ErrorVideo ? e.message : 'No se pudo conectar con la PC contadora.')
      })
    return () => { vivo = false }
  }, [base, camara, intento, pausado])

  // 2) MJPEG: Chrome no siempre dispara onLoad en un stream continuo -> se mira si ya llegó el primer cuadro
  useEffect(() => {
    if (!url) return
    const inicio = Date.now()
    const t = setInterval(() => {
      if ((img.current?.naturalWidth ?? 0) > 0) { setEstado('ok'); clearInterval(t) }
      else if (Date.now() - inicio > 12000) {
        setEstado('error')
        setAviso('La PC contadora responde, pero la cámara no está enviando imagen. Revisá el DVR del local.')
        clearInterval(t)
      }
    }, 400)
    return () => clearInterval(t)
  }, [url])

  if (!base) {
    return (
      <div className="flex aspect-video flex-col items-center justify-center gap-2 rounded-xl bg-black/40 p-4 text-center text-sm text-sub">
        <VideoOff size={28} aria-hidden /> {motivo}
      </div>
    )
  }
  if (pausado) {
    return (
      <div className="flex aspect-video flex-col items-center justify-center gap-2 rounded-xl bg-black/60 p-4 text-center text-sm text-white/80">
        <VideoOff size={28} aria-hidden />
        {pausado === 'tiempo' ? `Video pausado después de ${MINUTOS_VIDEO} minutos para ahorrar internet.` : 'Video pausado mientras no mirabas esta pestaña.'}
        <button onClick={() => { setPausado(null); setIntento((n) => n + 1) }}
          className="mt-1 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white">Seguir viendo</button>
      </div>
    )
  }
  return (
    <div className="relative aspect-video overflow-hidden rounded-xl bg-black">
      {url && (
        <img key={url} ref={img} src={url} alt="Video en vivo de la puerta con el conteo"
          className="h-full w-full object-contain" onError={() => {
            setEstado('error')
            setAviso('La PC contadora responde, pero la cámara no está enviando imagen. Revisá el DVR del local.')
          }} />
      )}
      {estado !== 'ok' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 p-4 text-center text-sm text-white/80">
          {estado === 'cargando' ? <Loader2 size={24} className="animate-spin" aria-hidden /> : <VideoOff size={28} aria-hidden />}
          {estado === 'cargando' ? 'Conectando con la cámara…' : (
            <>
              No se pudo abrir el video.
              {aviso && <span className="text-xs text-white/60">{aviso}</span>}
              <button onClick={() => setIntento((n) => n + 1)} className="mt-1 rounded-lg border border-white/30 px-2 py-1 text-xs">Reintentar</button>
            </>
          )}
        </div>
      )}
      {estado === 'ok' && <span className="absolute left-2 top-2 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">EN VIVO</span>}
    </div>
  )
}

function Dato({
  icono, label, valor, nota, grande, valorColor,
}: {
  icono: React.ReactNode
  label: string
  valor: string
  nota?: string
  grande?: boolean
  valorColor?: string
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-3">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-sub/70">{icono} {label}</div>
      <div className={'font-display font-bold ' + (valorColor ?? 'text-ink') + ' ' + (grande ? 'text-3xl' : 'text-xl')}>{valor}</div>
      {nota && <div className="text-[11px] text-sub/70">{nota}</div>}
    </div>
  )
}
