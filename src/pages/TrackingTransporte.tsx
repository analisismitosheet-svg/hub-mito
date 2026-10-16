import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, Lock, Unlock, Loader2, MapPin, RefreshCw, Truck, X } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { supabase as sb } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { hoyIso, sumarDias } from '@/components/FiltroPeriodo'

/* ------------------------------------------------------------------ */
/*  Administradores > Tracking de transporte                            */
/*                                                                      */
/*  GPS: Traccar Client en el celular del chofer -> api/tracking.ts ->  */
/*  tracking_ubicaciones (se lee directo, RLS tracking.view).           */
/*  Cargas/entregas: api/tracking.ts?vista=hub lee en vivo la base de   */
/*  la app Transporte (bultos_historial).                               */
/*  Puntos de control = los locales (tracking_bases, con radio). A cada */
/*  vehículo se le asignan los que tiene que pasar (tracking_recorridos)*/
/*  y la RPC tracking_controles_dia dice cuándo entró el GPS al radio.  */
/* ------------------------------------------------------------------ */

interface Vehiculo {
  id: string
  nombre: string
  dispositivo: string
  usuario_transporte_id: string | null
  usuario_transporte_nombre: string | null
  color: string
  activo: boolean
}
interface Ubic {
  vehiculo_id: string
  at: string
  lat: number
  lng: number
  precision_m: number | null
  velocidad_kmh: number | null
  bateria: number | null
}
interface BaseUbic { base_id: string; nombre: string | null; direccion: string | null; lat: number; lng: number; radio_m: number }
interface Lugar { display_name: string; lat: string; lon: string }
interface Recorrido { vehiculo_id: string; base_id: string; dias: number[] | null; hora_limite: string | null }
interface Control { vehiculo_id: string; base_id: string; hora_limite: string | null; paso_at: string | null }
interface Ev { bulto: string; bulto_id: string; origen: string | null; destino: string | null; at: string; chofer_id?: string | null }
interface DatosTransporte {
  choferes: { id: string; nombre: string; base_id: string | null }[]
  bases: { base_id: string; nombre: string }[]
  cargas: Ev[]
  entregas: Ev[]
}

/** Fila de la lista: un vehículo con GPS, o un chofer de Transporte que todavía no tiene vehículo. */
interface Movil {
  key: string
  nombre: string
  color: string
  vehiculo: Vehiculo | null
  choferId: string | null
}

type Estado = { label: string; color: string }

interface EventoDia {
  at: string
  titulo: string
  det: string
  color: string
  tipo: 'carga' | 'entrega' | 'paso' | 'nopaso' | 'ubic'
  n?: number
  lugar?: string
}

/**
 * Una línea por hora, en el orden en que pasaron las cosas (siempre por hora, no por tipo):
 * los eventos seguidos del mismo tipo se juntan (ej. 11:06 Cargó 42 · 11:23 Entregó 66 en LIBED · 11:28 Cargó 18).
 */
function resumenHora(items: EventoDia[]): { partes: string[]; color: string } {
  const tramos: { tipo: EventoDia['tipo']; at: string; n: number; lugares: string[] }[] = []
  for (const e of items) {
    const t = tramos[tramos.length - 1]
    if (t && t.tipo === e.tipo && e.tipo !== 'ubic') {
      t.n += e.n ?? 0
      if (e.lugar && !t.lugares.includes(e.lugar)) t.lugares.push(e.lugar)
    } else {
      tramos.push({ tipo: e.tipo, at: e.at, n: e.n ?? 0, lugares: e.lugar ? [e.lugar] : [] })
    }
  }
  const texto: Record<EventoDia['tipo'], (t: (typeof tramos)[number]) => string> = {
    carga: (t) => `📦 Cargó ${t.n}`,
    entrega: (t) => `✅ Entregó ${t.n} en ${t.lugares.join(', ')}`,
    paso: (t) => `🏪 Pasó por ${t.lugares.join(', ')}`,
    nopaso: (t) => `⚠ No pasó por ${t.lugares.join(', ')}`,
    ubic: () => '📍 Última ubicación',
  }
  const partes = tramos.map((t) => `${tramos.length > 1 ? `${hora(t.at)} ` : ''}${texto[t.tipo](t)}`)
  const hay = (tipo: EventoDia['tipo']) => items.some((e) => e.tipo === tipo)
  const color = hay('nopaso') ? '#ef4444' : hay('entrega') ? '#22c55e' : hay('carga') ? '#38bdf8' : items[items.length - 1].color
  return { partes, color }
}

// La pantalla solo se abre logueado: Supabase siempre está configurado acá
const supabase = sb!

const COLORES = ['#2563eb', '#db2777', '#16a34a', '#ea580c', '#7c3aed', '#0891b2', '#ca8a04', '#dc2626']
const CENTRO: L.LatLngTuple = [-31.4167, -64.1833]
const URL_INGESTA = 'https://hub-mito.vercel.app/api/tracking'
const DIAS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'] // 1 = lunes … 7 = domingo

/** Vista fija del mapa (candado): la zona que el usuario quiere ver siempre. Se guarda en este navegador. */
interface VistaFija { lat: number; lng: number; zoom: number }
const CLAVE_VISTA = 'tracking-vista-fija'
function leerVistaFija(): VistaFija | null {
  try {
    const v = JSON.parse(localStorage.getItem(CLAVE_VISTA) ?? 'null') as VistaFija | null
    return v && Number.isFinite(v.lat) && Number.isFinite(v.lng) && Number.isFinite(v.zoom) ? v : null
  } catch {
    return null
  }
}
// Buscador de direcciones de OpenStreetMap (gratis, máx. 1 búsqueda por segundo); prioriza Córdoba
const NOMINATIM = 'https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=ar&limit=5&accept-language=es&viewbox=-64.40,-31.25,-63.95,-31.55'

const fmtFecha = (s: string) => { const [y, m, d] = s.split('-'); return `${d}/${m}/${y}` }
const hora = (iso: string) => new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })
const inicioDia = (fecha: string) => new Date(`${fecha}T00:00:00-03:00`)
function hace(iso: string | null): string {
  if (!iso) return 'sin datos'
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return 'hace menos de 1 min'
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  return h < 24 ? `hace ${h} h ${min % 60} min` : `el ${new Date(iso).toLocaleDateString('es-AR')}`
}
/** Identificador para Traccar: corto y fácil de tipear (ej. master-9588). Es lo que autoriza a mandar ubicaciones. */
const nuevoDispositivo = (nombre: string) => {
  const base = nombre.normalize('NFD').replace(/[^a-zA-Z0-9]/g, ' ').trim().split(/\s+/)[0]?.toLowerCase().slice(0, 12) || 'movil'
  const n = new Uint16Array(1)
  crypto.getRandomValues(n)
  return `${base.length >= 3 ? base : 'movil'}-${1000 + (n[0] % 9000)}`
}
const DISPOSITIVO_OK = /^[a-z0-9-]{8,60}$/

/** Metros entre dos puntos (haversine). */
function metros(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = (x: number) => (x * Math.PI) / 180
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.sqrt(h))
}

/**
 * Km recorridos en el día sumando la distancia entre ubicaciones de Traccar, sin ruido:
 * solo puntos precisos (≤ 50 m), sin saltos imposibles (> 150 km/h) y sin el temblequeo
 * del GPS cuando está quieto (tramos < 20 m se acumulan hasta superar esa distancia).
 * Mide en línea recta entre puntos (cada ~30 s): en curvas da apenas un poco menos.
 */
function kmDelDia(us: Ubic[]): number {
  let total = 0
  let ancla: Ubic | null = null
  for (const u of us) {
    if ((u.precision_m ?? 0) > 50) continue
    if (!ancla) { ancla = u; continue }
    const d = metros(ancla, u)
    if (d < 20) continue
    const seg = (new Date(u.at).getTime() - new Date(ancla.at).getTime()) / 1000
    if (seg > 0 && (d / seg) * 3.6 <= 150) total += d
    ancla = u
  }
  return total / 1000
}
const fmtKm = (km: number) => `${km.toLocaleString('es-AR', { maximumFractionDigits: km < 10 ? 1 : 0 })} km`

function estadoDe(ultima: Ubic | undefined, esHoy: boolean): Estado {
  if (!ultima) return { label: 'Sin GPS', color: '#94a3b8' }
  if (!esHoy) return { label: 'Recorrido del día', color: '#38bdf8' }
  const min = (Date.now() - new Date(ultima.at).getTime()) / 60000
  if (min > 15) return { label: 'Sin señal', color: '#ef4444' }
  if ((ultima.velocidad_kmh ?? 0) >= 5 && min <= 5) return { label: 'En ruta', color: '#22c55e' }
  return { label: 'Detenido', color: '#f59e0b' }
}

/** Agrupa eventos seguidos (menos de 15 min entre uno y otro) del mismo tipo/lugar. */
function agrupar(evs: Ev[], clave: (e: Ev) => string) {
  const grupos: { clave: string; desde: string; evs: Ev[] }[] = []
  for (const e of evs) {
    const g = grupos[grupos.length - 1]
    if (g && g.clave === clave(e) && new Date(e.at).getTime() - new Date(g.evs[g.evs.length - 1].at).getTime() < 15 * 60000) g.evs.push(e)
    else grupos.push({ clave: clave(e), desde: e.at, evs: [e] })
  }
  return grupos
}

export default function TrackingTransporte() {
  const { can, isAdmin } = useAuth()
  const gestiona = isAdmin || can('tracking.gestionar')

  const navigate = useNavigate()
  // ?fecha=AAAA-MM-DD: viene de Km recorridos (tocar un día)
  const [params] = useSearchParams()
  const [fecha, setFecha] = useState(() => {
    const f = params.get('fecha')
    return f && /^\d{4}-\d{2}-\d{2}$/.test(f) && f <= hoyIso() ? f : hoyIso()
  })
  const esHoy = fecha === hoyIso()
  const [vehiculos, setVehiculos] = useState<Vehiculo[]>([])
  const [ubics, setUbics] = useState<Ubic[]>([])
  const [recorridos, setRecorridos] = useState<Recorrido[]>([])
  const [conAvisos, setConAvisos] = useState<Set<string>>(new Set())
  const [controles, setControles] = useState<Control[]>([])
  const [basesUbic, setBasesUbic] = useState<BaseUbic[]>([])
  const [tr, setTr] = useState<DatosTransporte | null>(null)
  const [errTr, setErrTr] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [sel, setSel] = useState<string | null>(null)
  const [, setTick] = useState(0)

  // ----- carga -----
  const cargarHub = useCallback(async () => {
    const desde = inicioDia(fecha)
    const hasta = new Date(desde.getTime() + 86400000)
    const [v, p, b, ps] = await Promise.all([
      supabase.from('tracking_vehiculos').select('*').order('nombre'),
      supabase.from('tracking_recorridos').select('vehiculo_id,base_id,dias,hora_limite'),
      supabase.from('tracking_bases').select('*').order('base_id'),
      supabase.rpc('tracking_controles_dia', { p_fecha: fecha }),
    ])
    setVehiculos((v.data ?? []) as Vehiculo[])
    setRecorridos((p.data ?? []) as Recorrido[])
    const { data: av } = await supabase.from('tracking_push').select('usuario_transporte_id')
    setConAvisos(new Set((av ?? []).map((x) => (x as { usuario_transporte_id: string }).usuario_transporte_id)))
    setBasesUbic((b.data ?? []) as BaseUbic[])
    setControles((ps.data ?? []) as Control[])
    const filas: Ubic[] = []
    for (let i = 0; ; i += 1000) {
      const { data, error } = await supabase
        .from('tracking_ubicaciones')
        .select('vehiculo_id,at,lat,lng,precision_m,velocidad_kmh,bateria')
        .gte('at', desde.toISOString())
        .lt('at', hasta.toISOString())
        .order('at')
        .range(i, i + 999)
      if (error || !data?.length) break
      filas.push(...(data as Ubic[]))
      if (data.length < 1000) break
    }
    setUbics(filas)
  }, [fecha])

  const cargarTransporte = useCallback(async () => {
    try {
      const { data } = await supabase.auth.getSession()
      const r = await fetch(`/api/tracking?vista=hub&fecha=${fecha}`, {
        headers: { Authorization: `Bearer ${data.session?.access_token ?? ''}` },
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body.error ?? `Error ${r.status}`)
      setTr(body as DatosTransporte)
      setErrTr(null)
    } catch (e) {
      setErrTr(e instanceof Error ? e.message : String(e))
    }
  }, [fecha])

  const cargar = useCallback(async () => {
    setCargando(true)
    await Promise.all([cargarHub(), cargarTransporte()])
    setCargando(false)
  }, [cargarHub, cargarTransporte])

  useEffect(() => { void cargar() }, [cargar])
  // Hoy: se refresca solo cada 30 s (el celular manda cada ~30 s)
  useEffect(() => {
    if (!esHoy) return
    const t = setInterval(() => { void cargarHub(); void cargarTransporte(); setTick((x) => x + 1) }, 30000)
    return () => clearInterval(t)
  }, [esHoy, cargarHub, cargarTransporte])

  // Color del vehículo en el mapa (se cambia tocando el punto de color de su tarjeta)
  async function cambiarColor(v: Vehiculo, color: string) {
    const { error } = await supabase.from('tracking_vehiculos').update({ color }).eq('id', v.id)
    if (error) return alert(error.message)
    void cargarHub()
  }

  // ----- armado de la lista -----
  const moviles = useMemo<Movil[]>(() => {
    const out: Movil[] = vehiculos.filter((v) => v.activo).map((v) => ({
      key: v.id, nombre: v.nombre, color: v.color, vehiculo: v, choferId: v.usuario_transporte_id,
    }))
    for (const c of tr?.choferes ?? []) {
      if (!out.some((m) => m.choferId === c.id)) {
        out.push({ key: `c-${c.id}`, nombre: c.nombre, color: '#64748b', vehiculo: null, choferId: c.id })
      }
    }
    return out
  }, [vehiculos, tr])

  useEffect(() => {
    if (!sel && moviles.length) setSel(moviles[0].key)
  }, [moviles, sel])

  const ubicsDe = useMemo(() => {
    const m = new Map<string, Ubic[]>()
    for (const u of ubics) {
      if (!m.has(u.vehiculo_id)) m.set(u.vehiculo_id, [])
      m.get(u.vehiculo_id)!.push(u)
    }
    return m
  }, [ubics])

  /** Última vez del día que el GPS del vehículo estuvo en el local (dentro de su radio); null si no pasó o el local no está ubicado. */
  const ultimaVisitaLocal = useCallback((vehId: string, baseId: string): string | null => {
    const b = basesUbic.find((x) => x.base_id === baseId)
    if (!b) return null
    const us = ubicsDe.get(vehId) ?? []
    for (let i = us.length - 1; i >= 0; i--) {
      if (metros(us[i], b) <= b.radio_m + Math.min(us[i].precision_m ?? 0, 100)) return us[i].at
    }
    return null
  }, [basesUbic, ubicsDe])
  const pasoPorLocal = useCallback((vehId: string, baseId: string) => ultimaVisitaLocal(vehId, baseId) !== null, [ultimaVisitaLocal])

  // bulto -> chofer que lo cargó (última carga del día)
  const choferDeBulto = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of tr?.cargas ?? []) if (c.chofer_id) m.set(c.bulto_id, c.chofer_id)
    return m
  }, [tr])

  const resumen = useMemo(() => {
    const r = new Map<string, { cargas: Ev[]; entregas: Ev[]; aBordo: number; destinos: Map<string, { total: number; ok: number; proxima: number }> }>()
    for (const mv of moviles) {
      const cargas = (tr?.cargas ?? []).filter((c) => c.chofer_id === mv.choferId)
      const ids = new Set(cargas.map((c) => c.bulto_id))
      const entregas = (tr?.entregas ?? []).filter((e) => ids.has(e.bulto_id) && choferDeBulto.get(e.bulto_id) === mv.choferId)
      const entregadosIds = new Set(entregas.map((e) => e.bulto_id))
      // Momento en que estuvo en cada local (GPS; si no, la última recepción de ese local): lo que cargó
      // para ese local DESPUÉS de pasar va para la próxima vuelta y no cuenta como faltante de esa visita.
      const corte = new Map<string, string | null>()
      const corteDe = (d: string) => {
        if (!corte.has(d)) {
          const gps = mv.vehiculo ? ultimaVisitaLocal(mv.vehiculo.id, d) : null
          const recep = entregas.filter((e) => e.destino === d).reduce<string | null>((m, e) => (!m || e.at > m ? e.at : m), null)
          corte.set(d, gps ?? recep)
        }
        return corte.get(d) ?? null
      }
      const destinos = new Map<string, { total: number; ok: number; proxima: number }>()
      for (const id of ids) {
        const c = cargas.find((x) => x.bulto_id === id)!
        const d = c.destino ?? '?'
        const x = destinos.get(d) ?? { total: 0, ok: 0, proxima: 0 }
        if (entregadosIds.has(id)) {
          x.total++
          x.ok++
        } else {
          const t = corteDe(d)
          if (t && new Date(c.at).getTime() > new Date(t).getTime()) x.proxima++
          else x.total++
        }
        destinos.set(d, x)
      }
      r.set(mv.key, { cargas, entregas, aBordo: ids.size - entregadosIds.size, destinos })
    }
    return r
  }, [moviles, tr, choferDeBulto, ultimaVisitaLocal])

  const controlesDe = useCallback((vehId: string | undefined) => (vehId ? controles.filter((c) => c.vehiculo_id === vehId) : []), [controles])

  /** ¿Se le pasó la hora límite (o terminó el día) sin pasar? */
  const vencido = useCallback((c: Control) => {
    if (fecha < hoyIso()) return true
    if (!esHoy || !c.hora_limite) return false
    const [h, m] = c.hora_limite.split(':').map(Number)
    const ahora = new Date()
    return ahora.getHours() * 60 + ahora.getMinutes() > h * 60 + m
  }, [fecha, esHoy])

  const kpis = useMemo(() => {
    let enRuta = 0, sinSenal = 0, aBordo = 0, entregados = 0, pcOk = 0, pcTotal = 0, pcMal = 0, km = 0
    for (const mv of moviles) {
      const us = mv.vehiculo ? ubicsDe.get(mv.vehiculo.id) : undefined
      km += us ? kmDelDia(us) : 0
      const e = estadoDe(us?.[us.length - 1], esHoy).label
      if (e === 'En ruta' || e === 'Detenido') enRuta++
      if (e === 'Sin señal') sinSenal++
      const r = resumen.get(mv.key)
      aBordo += r?.aBordo ?? 0
      entregados += r ? new Set(r.entregas.map((x) => x.bulto_id)).size : 0
    }
    for (const c of controles) {
      pcTotal++
      if (c.paso_at) pcOk++
      else if (vencido(c)) pcMal++
    }
    return { enRuta, sinSenal, aBordo, entregados, pcOk, pcTotal, pcMal, km }
  }, [moviles, ubicsDe, resumen, controles, vencido, esHoy])

  const actual = moviles.find((m) => m.key === sel) ?? null

  // ----- línea del día del seleccionado -----
  const dia = useMemo(() => {
    if (!actual) return []
    const r = resumen.get(actual.key)
    const items: EventoDia[] = []
    for (const g of agrupar(r?.cargas ?? [], () => 'carga')) {
      const dest = [...new Set(g.evs.map((e) => e.destino ?? '?'))]
      items.push({ at: g.desde, titulo: `Cargó ${g.evs.length} bulto${g.evs.length === 1 ? '' : 's'}`, det: dest.join(', '), color: '#38bdf8', tipo: 'carga', n: g.evs.length })
    }
    for (const g of agrupar(r?.entregas ?? [], (e) => e.destino ?? '?')) {
      items.push({ at: g.desde, titulo: `Entregó ${g.evs.length} bulto${g.evs.length === 1 ? '' : 's'} en ${g.clave}`, det: 'recibidos por el local', color: '#22c55e', tipo: 'entrega', n: g.evs.length, lugar: g.clave })
    }
    for (const c of controlesDe(actual.vehiculo?.id)) {
      if (c.paso_at) items.push({ at: c.paso_at, titulo: `🏪 Pasó por ${c.base_id}`, det: 'local obligatorio ✓', color: '#fbbf24', tipo: 'paso', lugar: c.base_id })
      else if (vencido(c)) {
        const at = c.hora_limite ? `${fecha}T${c.hora_limite.slice(0, 5)}:00-03:00` : `${fecha}T23:59:00-03:00`
        items.push({ at, titulo: `⚠ No pasó por ${c.base_id}`, det: c.hora_limite ? `local obligatorio · hora límite ${c.hora_limite.slice(0, 5)}` : 'local obligatorio', color: '#ef4444', tipo: 'nopaso', lugar: c.base_id })
      }
    }
    const us = actual.vehiculo ? ubicsDe.get(actual.vehiculo.id) : undefined
    const ult = us?.[us.length - 1]
    if (ult) {
      const vel = ult.velocidad_kmh !== null ? `${Math.round(ult.velocidad_kmh)} km/h` : ''
      items.push({ at: ult.at, titulo: 'Última ubicación', det: [vel, ult.bateria !== null ? `batería ${Math.round(ult.bateria)}%` : '', esHoy ? hace(ult.at) : ''].filter(Boolean).join(' · '), color: estadoDe(ult, esHoy).color, tipo: 'ubic' })
    }
    return items.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
  }, [actual, resumen, controlesDe, vencido, ubicsDe, fecha, esHoy])

  // Resumen por hora (se despliega para ver el detalle)
  const porHora = useMemo(() => {
    const grupos: { hora: number; items: EventoDia[] }[] = []
    for (const e of dia) {
      const h = new Date(e.at).getHours()
      const g = grupos[grupos.length - 1]
      if (g && g.hora === h) g.items.push(e)
      else grupos.push({ hora: h, items: [e] })
    }
    return grupos
  }, [dia])
  const [horaAbierta, setHoraAbierta] = useState<Set<number>>(new Set())
  useEffect(() => { setHoraAbierta(new Set()) }, [sel, fecha])

  // ----- mapa -----
  const divMapa = useRef<HTMLDivElement>(null)
  const mapa = useRef<L.Map | null>(null)
  const capa = useRef<L.LayerGroup | null>(null)
  // Ubicar un local: se elige en la pestaña Locales y se toca el mapa
  const [modo, setModo] = useState<string | null>(null)
  const modoRef = useRef(modo)
  modoRef.current = modo
  useEffect(() => {
    if (modo) divMapa.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [modo])
  const guardarBaseRef = useRef<(base_id: string, lat: number, lng: number) => Promise<void>>(async () => {})

  useEffect(() => {
    if (!divMapa.current || mapa.current) return
    const fija = leerVistaFija()
    const m = L.map(divMapa.current, { zoomControl: true }).setView(fija ? [fija.lat, fija.lng] : CENTRO, fija?.zoom ?? 12)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(m)
    capa.current = L.layerGroup().addTo(m)
    m.on('click', (e: L.LeafletMouseEvent) => {
      if (modoRef.current) void guardarBaseRef.current(modoRef.current, e.latlng.lat, e.latlng.lng)
    })
    mapa.current = m
    // Si el contenedor todavía no tenía su ancho final, Leaflet deja franjas grises
    const t = setTimeout(() => m.invalidateSize(), 300)
    // y cada vez que cambia el tamaño del cuadro (es cuadrado: depende del ancho de la pantalla)
    const ro = new ResizeObserver(() => m.invalidateSize())
    ro.observe(divMapa.current)
    return () => { clearTimeout(t); ro.disconnect(); m.remove(); mapa.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const encuadrado = useRef<string>('')
  const [vistaFija, setVistaFija] = useState<VistaFija | null>(leerVistaFija)
  const vistaFijaRef = useRef(vistaFija)
  vistaFijaRef.current = vistaFija

  function alternarCandado() {
    const m = mapa.current
    if (!m) return
    if (vistaFija) {
      try { localStorage.removeItem(CLAVE_VISTA) } catch { /* sin storage */ }
      setVistaFija(null)
      encuadrado.current = '' // vuelve a encuadrar a todos
      setTick((x) => x + 1)
      return
    }
    const c = m.getCenter()
    const v = { lat: c.lat, lng: c.lng, zoom: m.getZoom() }
    try { localStorage.setItem(CLAVE_VISTA, JSON.stringify(v)) } catch { /* sin storage: vale mientras la pantalla esté abierta */ }
    setVistaFija(v)
  }
  useEffect(() => {
    const m = mapa.current
    const g = capa.current
    if (!m || !g) return
    g.clearLayers()
    const nombresBase = new Map((tr?.bases ?? []).map((b) => [b.base_id, b.nombre]))

    // locales: los obligatorios del vehículo elegido con su radio (verde pasó, amarillo pendiente, rojo no pasó)
    const r = actual ? resumen.get(actual.key) : undefined
    const ctl = new Map(controlesDe(actual?.vehiculo?.id).map((c) => [c.base_id, c]))
    for (const b of basesUbic) {
      const d = r?.destinos.get(b.base_id)
      const c = ctl.get(b.base_id)
      const nombre = b.nombre ?? nombresBase.get(b.base_id) ?? ''
      let estado = ''
      if (c) {
        const col = c.paso_at ? '#22c55e' : vencido(c) ? '#ef4444' : '#f59e0b'
        estado = c.paso_at ? ` · ✓ pasó ${hora(c.paso_at)}` : vencido(c) ? ' · ⚠ no pasó' : ` · pendiente${c.hora_limite ? ` (hasta ${c.hora_limite.slice(0, 5)})` : ''}`
        L.circle([b.lat, b.lng], { radius: b.radio_m, color: col, weight: 2, fillOpacity: 0.15 }).addTo(g)
      } else if (modo) {
        L.circle([b.lat, b.lng], { radius: b.radio_m, color: '#94a3b8', weight: 1, fillOpacity: 0.05 }).addTo(g)
      }
      const fuerte = !!c || !!d
      L.marker([b.lat, b.lng], {
        icon: L.divIcon({ html: `<div style="font-size:${fuerte ? 20 : 15}px;line-height:20px;filter:${fuerte ? 'none' : 'grayscale(1) opacity(.6)'}">🏪</div>`, className: '', iconSize: [20, 20], iconAnchor: [10, 10] }),
      })
        .bindTooltip(`${b.base_id} · ${nombre}${c ? ' · obligatorio' : ''}${estado}${d ? ` · ${d.ok}/${d.total} entregados` : ''}${b.direccion ? `<br>${b.direccion.replace(/</g, '&lt;')}` : ''}`)
        .addTo(g)
    }

    // Todos los vehículos juntos: solo dónde está cada uno (sin pintar el recorrido), con su nombre
    let bounds: L.LatLngBounds | null = null
    let conGps = 0
    for (const mv of moviles) {
      if (!mv.vehiculo) continue
      const us = ubicsDe.get(mv.vehiculo.id) ?? []
      if (!us.length) continue
      conGps++
      const esSel = mv.key === sel
      // la última con buena precisión; si no hay, la última que llegó
      const ult = [...us].reverse().find((u) => (u.precision_m ?? 0) <= 100) ?? us[us.length - 1]
      const est = estadoDe(us[us.length - 1], esHoy)
      L.circleMarker([ult.lat, ult.lng], { radius: esSel ? 11 : 9, color: '#fff', weight: 2, fillColor: mv.color, fillOpacity: 1 })
        .bindTooltip(`🚚 ${mv.nombre} · ${est.label} · ${esHoy ? hace(ult.at) : hora(ult.at)}`, { permanent: true, direction: 'top', offset: [0, -10] })
        .on('click', () => setSel(mv.key))
        .addTo(g)
      const punto = L.latLng(ult.lat, ult.lng)
      bounds = bounds ? bounds.extend(punto) : L.latLngBounds(punto, punto)
    }
    // encuadrar a todos solo al cambiar de día o cuando aparece otro vehículo (no en cada refresco)
    // (con el candado puesto el mapa se queda en la zona fija)
    const clave = `${fecha}|${conGps}`
    if (bounds && encuadrado.current !== clave && !vistaFijaRef.current) {
      m.fitBounds(bounds.pad(0.3), { maxZoom: 15 })
      encuadrado.current = clave
    }
  }, [controlesDe, basesUbic, moviles, ubicsDe, sel, actual, resumen, tr, esHoy, fecha, vencido, modo, vistaFija])

  // ----- gestión -----
  async function guardarBase(base_id: string, lat: number, lng: number) {
    const nombre = tr?.bases.find((b) => b.base_id === base_id)?.nombre ?? null
    const { error } = await supabase.from('tracking_bases').upsert({ base_id, nombre, lat, lng }, { onConflict: 'base_id' })
    if (error) return alert(error.message)
    setModo(null)
    void cargarHub()
  }
  guardarBaseRef.current = guardarBase

  return (
    <Layout>
      <BackButton />
      <header className="mb-4 mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">Tracking de transporte</h1>
          <p className="text-sm text-sub">Ubicación de los vehículos (Traccar en el celular del chofer) y escaneos de la app Transporte.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setFecha(sumarDias(fecha, -1))} className="btn-press grid h-10 w-10 place-items-center rounded-xl border border-line bg-surface text-sub hover:text-ink" aria-label="Día anterior">
            <ChevronLeft size={18} />
          </button>
          <input type="date" value={fecha} max={hoyIso()} onChange={(e) => e.target.value && setFecha(e.target.value)}
            className="h-10 rounded-xl border border-line bg-surface px-3 text-sm text-ink" />
          <button onClick={() => setFecha(sumarDias(fecha, 1))} disabled={esHoy} className="btn-press grid h-10 w-10 place-items-center rounded-xl border border-line bg-surface text-sub hover:text-ink disabled:opacity-40" aria-label="Día siguiente">
            <ChevronRight size={18} />
          </button>
          <button onClick={() => void cargar()} className="btn-press grid h-10 w-10 place-items-center rounded-xl border border-line bg-surface text-sub hover:text-ink" aria-label="Actualizar">
            {cargando ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />}
          </button>
        </div>
      </header>

      {errTr && (
        <div className="mb-3 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300">
          No se pudieron leer los escaneos de Transporte: {errTr}
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label={esHoy ? 'Con señal' : 'Con GPS'} valor={kpis.enRuta} sub={esHoy ? 'ubicación en los últimos 15 min' : `el ${fmtFecha(fecha)}`} color="#22c55e" />
        <Kpi label="Bultos a bordo" valor={kpis.aBordo} sub="cargados y sin recibir" color="#38bdf8" />
        <Kpi label="Entregados" valor={kpis.entregados} sub="recibidos en el local" color="#8b5cf6" />
        <Kpi label="Sin señal" valor={kpis.sinSenal} sub="más de 15 min sin ubicación" color="#ef4444" />
        <Kpi label="Km recorridos" valor={fmtKm(kpis.km)} sub={`entre todos ${esHoy ? 'hoy' : `el ${fmtFecha(fecha)}`} · ver estadísticas ›`} color="#0d9488"
          onClick={() => navigate('/administradores/tracking/km')} />
        <Kpi label="Locales obligatorios" valor={`${kpis.pcOk}/${kpis.pcTotal}`} sub={kpis.pcMal ? `${kpis.pcMal} sin pasar ⚠` : 'pasados'} color="#f59e0b" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <section className="rounded-2xl border border-line bg-surface p-3">
          <h2 className="mb-2 font-semibold text-ink">Vehículos</h2>
          {!moviles.length && !cargando && <p className="text-sm text-sub">Todavía no hay vehículos ni choferes.</p>}
          <div className="space-y-2">
            {moviles.map((mv) => {
              const us = mv.vehiculo ? ubicsDe.get(mv.vehiculo.id) : undefined
              const ult = us?.[us.length - 1]
              const est = mv.vehiculo ? estadoDe(ult, esHoy) : { label: 'Sin GPS configurado', color: '#94a3b8' }
              const r = resumen.get(mv.key)
              const ent = r ? new Set(r.entregas.map((x) => x.bulto_id)).size : 0
              const tot = ent + (r?.aBordo ?? 0)
              const ps = controlesDe(mv.vehiculo?.id)
              const psOk = ps.filter((c) => c.paso_at).length
              const psMal = ps.filter((c) => !c.paso_at && vencido(c)).length
              return (
                <div key={mv.key} role="button" tabIndex={0} onClick={() => setSel(mv.key)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSel(mv.key) } }}
                  className={`w-full cursor-pointer rounded-xl border p-2.5 text-left transition ${sel === mv.key ? 'border-sky-500 bg-sky-500/10' : 'border-line hover:bg-surface2'}`}>
                  <div className="flex items-center gap-2 font-semibold text-ink">
                    {gestiona && mv.vehiculo ? (
                      <label className="relative h-4 w-4 shrink-0 cursor-pointer rounded-full ring-2 ring-white/40" style={{ background: mv.color }}
                        title="Cambiar el color en el mapa" onClick={(e) => e.stopPropagation()}>
                        <input type="color" value={mv.color} onChange={(e) => void cambiarColor(mv.vehiculo!, e.target.value)}
                          className="absolute inset-0 h-full w-full cursor-pointer opacity-0" aria-label={`Color de ${mv.nombre}`} />
                      </label>
                    ) : (
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: mv.color }} />
                    )}
                    <span className="truncate">{mv.nombre}</span>
                  </div>
                  <div className="mt-1 text-xs">
                    <b style={{ color: est.color }}>● {est.label}</b>
                    {ult && <span className="text-sub"> · {esHoy ? hace(ult.at) : `última ${hora(ult.at)}`}{ult.velocidad_kmh !== null && esHoy ? ` · ${Math.round(ult.velocidad_kmh)} km/h` : ''}{ult.bateria !== null ? ` · 🔋${Math.round(ult.bateria)}%` : ''}</span>}
                  </div>
                  {tot > 0 && (
                    <div className="mt-1.5 flex h-1.5 overflow-hidden rounded bg-line">
                      <div style={{ width: `${(ent / tot) * 100}%`, background: '#22c55e' }} />
                      <div style={{ width: `${((r?.aBordo ?? 0) / tot) * 100}%`, background: '#38bdf8' }} />
                    </div>
                  )}
                  <div className="mt-1 text-[11px] text-sub">
                    {us && us.length > 1 && <>🛣️ {fmtKm(kmDelDia(us))} · </>}{ent} entregados · {r?.aBordo ?? 0} a bordo
                    {ps.length > 0 && <> · 🏪 {psOk}/{ps.length} obligatorios{psMal ? <b className="text-red-500"> · {psMal} ⚠</b> : ''}</>}
                  </div>
                  {r && r.destinos.size > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {[...r.destinos].map(([d, x]) => {
                        const paso = !!mv.vehiculo && pasoPorLocal(mv.vehiculo.id, d)
                        const todo = x.total > 0 && x.ok === x.total
                        const parte = x.ok > 0 && !todo
                        return (
                          <span key={d}
                            title={`${d}: ${x.ok} de ${x.total} bultos recibidos por el local${paso ? ' · el GPS pasó por el local' : ''}${x.proxima ? ` · ${x.proxima} cargado${x.proxima === 1 ? '' : 's'} después de pasar: para la próxima vuelta` : ''}`}
                            className={`rounded px-1.5 py-0.5 text-[11px] ${todo ? 'bg-green-500/15 text-green-600 dark:text-green-400' : parte ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' : 'bg-surface2 text-sub'}`}>
                            {paso ? '📍' : ''}{todo ? '✓ ' : ''}{d}{x.total > 1 ? ` ${x.ok}/${x.total}` : ''}{x.proxima ? <span className="ml-1 text-sky-500">+{x.proxima} próx.</span> : ''}
                          </span>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-line bg-surface p-3">
          {modo && (
            <div className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-ink">
              <span>🏪 Tocá el mapa justo donde está <b>{modo}</b> · ✕ si ya quedó bien</span>
              <button onClick={() => setModo(null)} className="text-sub hover:text-ink" aria-label="Cancelar"><X size={16} /></button>
            </div>
          )}
          {/* La clase del div del mapa no puede cambiar: React le pisaría las clases que agrega Leaflet */}
          <div className={`relative isolate mx-auto w-full max-w-[80vh] ${modo ? '[&_.leaflet-container]:cursor-crosshair' : ''}`}>
            <div ref={divMapa} className="aspect-square w-full overflow-hidden rounded-xl border border-line" style={{ zIndex: 0 }} />
            <button
              onClick={alternarCandado}
              className={`absolute right-3 top-3 z-[500] inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold shadow-soft ${vistaFija ? 'bg-amber-500 text-white' : 'bg-white text-slate-800'}`}
              title={vistaFija ? 'Soltar: el mapa vuelve a encuadrar a todos los vehículos' : 'Fijar esta zona: el mapa siempre abre acá'}
            >
              {vistaFija ? <Lock size={14} /> : <Unlock size={14} />}
              {vistaFija ? 'Zona fija' : 'Fijar zona'}
            </button>
            {vistaFija && (
              <button
                onClick={() => mapa.current?.setView([vistaFija.lat, vistaFija.lng], vistaFija.zoom)}
                className="absolute right-3 top-14 z-[500] rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-soft"
                title="Volver a la zona fija"
              >
                ↺ Volver a la zona
              </button>
            )}
          </div>
          <p className="mt-2 text-xs text-sub">
            Todos los vehículos juntos: el punto es dónde está cada uno ahora (el elegido, más grande) · 🏪 = locales · círculo = local obligatorio del vehículo elegido (verde pasó, amarillo pendiente, rojo no pasó).
          </p>
        </section>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="rounded-2xl border border-line bg-surface p-4">
          <h2 className="mb-3 font-semibold text-ink">{actual ? `El día de ${actual.nombre}` : 'El día'} · {fmtFecha(fecha)}</h2>
          {!dia.length && <p className="text-sm text-sub">Sin movimientos este día.</p>}
          <ol className="relative ml-2 border-l-2 border-line pl-4">
            {porHora.map((g) => {
              const abierta = horaAbierta.has(g.hora)
              const r = resumenHora(g.items)
              return (
                <li key={g.hora} className="relative mb-2">
                  <span className="absolute -left-[23px] top-2.5 h-3 w-3 rounded-full border-2 border-surface" style={{ background: r.color }} />
                  <button
                    onClick={() => setHoraAbierta((s) => { const n = new Set(s); if (n.has(g.hora)) n.delete(g.hora); else n.add(g.hora); return n })}
                    className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface2"
                    aria-expanded={abierta}
                  >
                    <span className="w-12 shrink-0 pt-0.5 text-xs font-bold text-sub">{String(g.hora).padStart(2, '0')}:00</span>
                    <span className="min-w-0 flex-1 text-sm text-ink">
                      {r.partes.map((p, i) => <span key={i} className="mr-2 inline-block">{p}</span>)}
                    </span>
                    <ChevronDown size={16} className={`mt-0.5 shrink-0 text-sub transition ${abierta ? 'rotate-180' : ''}`} />
                  </button>
                  {abierta && (
                    <ul className="mb-2 ml-14 mt-1 space-y-2 border-l border-line pl-3">
                      {g.items.map((e, i) => (
                        <li key={i}>
                          <div className="text-[11px] text-sub">{hora(e.at)}</div>
                          <div className="text-sm font-semibold text-ink">{e.titulo}</div>
                          {e.det && <div className="text-xs text-sub">{e.det}</div>}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ol>
        </section>

        {gestiona && (
          <Gestion
            vehiculos={vehiculos}
            recorridos={recorridos}
            conAvisos={conAvisos}
            choferes={tr?.choferes ?? []}
            bases={tr?.bases ?? []}
            basesUbic={basesUbic}
            setModo={setModo}
            vehSel={actual?.vehiculo?.id ?? null}
            centrar={(lat, lng) => mapa.current?.setView([lat, lng], 17)}
            recargar={() => void cargarHub()}
          />
        )}
      </div>
    </Layout>
  )
}

function Kpi({ label, valor, sub, color, onClick }: { label: string; valor: number | string; sub: string; color: string; onClick?: () => void }) {
  const contenido = (
    <>
      <div className="text-[10px] font-bold uppercase tracking-wide" style={{ color }}>{label}</div>
      <div className="text-2xl font-bold text-ink">{valor}</div>
      <div className="text-[11px] text-sub">{sub}</div>
    </>
  )
  if (onClick) {
    return (
      <button onClick={onClick} className="btn-press rounded-xl border bg-surface p-2.5 text-left transition hover:bg-surface2" style={{ borderColor: `${color}55` }}>
        {contenido}
      </button>
    )
  }
  return <div className="rounded-xl border bg-surface p-2.5" style={{ borderColor: `${color}55` }}>{contenido}</div>
}

/* ------------------------- Gestión (tracking.gestionar) ------------------------- */

function Gestion(props: {
  vehiculos: Vehiculo[]
  recorridos: Recorrido[]
  conAvisos: Set<string>
  choferes: { id: string; nombre: string }[]
  bases: { base_id: string; nombre: string }[]
  basesUbic: BaseUbic[]
  setModo: (base_id: string | null) => void
  vehSel: string | null
  centrar: (lat: number, lng: number) => void
  recargar: () => void
}) {
  const { vehiculos, recorridos, conAvisos, choferes, bases, basesUbic, setModo, vehSel, centrar, recargar } = props
  const [tab, setTab] = useState<'recorridos' | 'vehiculos' | 'locales'>('recorridos')
  const [veh, setVeh] = useState({ nombre: '', chofer: '', disp: '' })
  const [verDisp, setVerDisp] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [dir, setDir] = useState<{ base_id: string; texto: string; lugares: Lugar[] | null; buscando: boolean } | null>(null)
  const activos = vehiculos.filter((v) => v.activo)
  const [vehRec, setVehRec] = useState<string | null>(null)
  const vehElegido = activos.find((v) => v.id === vehRec) ?? activos.find((v) => v.id === vehSel) ?? activos[0] ?? null

  // ----- recorridos (locales obligatorios por vehículo) -----
  // Se ven en modo lectura; para cambiarlos hay que tocar «Editar» y después «Guardar»
  // (así no se modifica nada sin querer). El borrador es la lista del vehículo elegido.
  const [borrador, setBorrador] = useState<Recorrido[] | null>(null)
  const [guardando, setGuardando] = useState(false)
  const editando = borrador !== null
  const delVehiculo = vehElegido ? recorridos.filter((r) => r.vehiculo_id === vehElegido.id) : []
  const lista = borrador ?? delVehiculo

  function editar() {
    setBorrador(delVehiculo.map((r) => ({ ...r, dias: r.dias ? [...r.dias] : null })))
  }

  function cambiarBorrador(base_id: string, cambio: Partial<Recorrido> | null) {
    if (!vehElegido) return
    setBorrador((bs) => {
      const actual = bs ?? []
      if (cambio === null) return actual.filter((r) => r.base_id !== base_id)
      const existe = actual.some((r) => r.base_id === base_id)
      return existe
        ? actual.map((r) => (r.base_id === base_id ? { ...r, ...cambio } : r))
        : [...actual, { vehiculo_id: vehElegido.id, base_id, dias: null, hora_limite: null, ...cambio }]
    })
  }

  function cambiarDia(r: Recorrido, d: number) {
    const actuales = r.dias ?? [1, 2, 3, 4, 5, 6, 7]
    const nuevos = actuales.includes(d) ? actuales.filter((x) => x !== d) : [...actuales, d].sort()
    if (!nuevos.length) return alert('Tiene que quedar al menos un día. Para sacarlo del recorrido destildá el local.')
    cambiarBorrador(r.base_id, { dias: nuevos.length === 7 ? null : nuevos })
  }

  async function guardarRecorridos() {
    if (!vehElegido || !borrador) return
    setGuardando(true)
    const quedan = new Set(borrador.map((r) => r.base_id))
    const sacar = delVehiculo.filter((r) => !quedan.has(r.base_id)).map((r) => r.base_id)
    const q = supabase.from('tracking_recorridos')
    const r1 = sacar.length ? await q.delete().eq('vehiculo_id', vehElegido.id).in('base_id', sacar) : { error: null }
    const r2 = borrador.length
      ? await supabase.from('tracking_recorridos').upsert(
          borrador.map((r) => ({ vehiculo_id: vehElegido.id, base_id: r.base_id, dias: r.dias, hora_limite: r.hora_limite || null })),
          { onConflict: 'vehiculo_id,base_id' },
        )
      : { error: null }
    setGuardando(false)
    const error = r1.error ?? r2.error
    if (error) return alert(error.message)
    setBorrador(null)
    recargar()
  }

  // ----- vehículos -----
  async function crearVehiculo() {
    if (!veh.nombre.trim()) return
    const disp = veh.disp.trim().toLowerCase() || nuevoDispositivo(veh.nombre)
    if (!DISPOSITIVO_OK.test(disp)) return alert('Identificador: solo minúsculas, números y guiones, de 8 a 60 caracteres (ej. mercedes-4417).')
    const chofer = choferes.find((c) => c.id === veh.chofer)
    const usado = new Set(vehiculos.map((v) => v.color))
    const { data, error } = await supabase.from('tracking_vehiculos').insert({
      nombre: veh.nombre.trim(), dispositivo: disp,
      usuario_transporte_id: chofer?.id ?? null, usuario_transporte_nombre: chofer?.nombre ?? null,
      color: COLORES.find((c) => !usado.has(c)) ?? COLORES[vehiculos.length % COLORES.length],
    }).select('id').single()
    if (error) return alert(error.message.includes('usuario_transporte_id') ? 'Ese chofer ya tiene un vehículo.' : error.message.includes('dispositivo') ? 'Ese identificador ya lo usa otro vehículo.' : error.message)
    setVeh({ nombre: '', chofer: '', disp: '' })
    setVerDisp(data?.id ?? null)
    recargar()
  }

  async function cambiarVehiculo(v: Vehiculo, cambios: Partial<Vehiculo>) {
    const { error } = await supabase.from('tracking_vehiculos').update(cambios).eq('id', v.id)
    if (error) return alert(error.message.includes('usuario_transporte_id') ? 'Ese chofer ya tiene un vehículo.' : error.message)
    recargar()
  }

  // ----- locales -----
  async function cambiarRadio(base_id: string, radio_m: number) {
    const { error } = await supabase.from('tracking_bases').update({ radio_m: Math.max(20, Math.min(5000, radio_m || 150)) }).eq('base_id', base_id)
    if (error) return alert(error.message)
    recargar()
  }

  async function buscarDireccion() {
    if (!dir?.texto.trim()) return
    setDir({ ...dir, buscando: true, lugares: null })
    try {
      const r = await fetch(`${NOMINATIM}&q=${encodeURIComponent(dir.texto.trim())}`)
      const lugares = r.ok ? ((await r.json()) as Lugar[]) : []
      setDir((d) => (d ? { ...d, buscando: false, lugares } : d))
    } catch {
      setDir((d) => (d ? { ...d, buscando: false, lugares: [] } : d))
    }
  }

  async function elegirLugar(l: Lugar) {
    if (!dir) return
    const nombre = bases.find((b) => b.base_id === dir.base_id)?.nombre ?? null
    const { error } = await supabase.from('tracking_bases').upsert(
      { base_id: dir.base_id, nombre, direccion: dir.texto.trim(), lat: Number(l.lat), lng: Number(l.lon) },
      { onConflict: 'base_id' },
    )
    if (error) return alert(error.message)
    // OSM a veces da el medio de la calle (sin la altura): queda el mapa ahí para ajustar con un toque
    centrar(Number(l.lat), Number(l.lon))
    setModo(dir.base_id)
    setDir(null)
    recargar()
  }

  const tabCls = (t: string) => `rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === t ? 'bg-blue-600 text-white' : 'text-sub hover:text-ink'}`
  const inp = 'h-9 w-full rounded-lg border border-line bg-surface px-2 text-sm text-ink'
  const ubicada = new Map(basesUbic.map((b) => [b.base_id, b]))
  const filtro = busca.trim().toUpperCase()
  const listaBases = bases.filter((b) => !filtro || b.base_id.includes(filtro) || b.nombre.toUpperCase().includes(filtro))

  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <div className="mb-3 flex flex-wrap gap-1">
        <button className={tabCls('recorridos')} onClick={() => setTab('recorridos')}>🏪 Locales obligatorios</button>
        <button className={tabCls('vehiculos')} onClick={() => setTab('vehiculos')}>🚚 Vehículos</button>
        <button className={tabCls('locales')} onClick={() => setTab('locales')}>📍 Ubicar locales</button>
      </div>

      {tab === 'recorridos' && (
        <div>
          <p className="mb-2 text-xs text-sub">Locales por donde cada vehículo (chofer) tiene que pasar sí o sí. Cuenta como «pasó» cuando el GPS entra en el radio del local.</p>
          {!activos.length ? (
            <p className="text-xs text-sub">Primero cargá los vehículos en la pestaña 🚚 Vehículos.</p>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {activos.map((v) => {
                  const on = v.id === vehElegido?.id
                  const n = recorridos.filter((r) => r.vehiculo_id === v.id).length
                  return (
                    <button key={v.id} disabled={editando && !on} onClick={() => setVehRec(v.id)}
                      className={`rounded-lg border px-2 py-1 text-left text-xs transition disabled:opacity-40 ${on ? 'border-transparent text-white' : 'border-line text-sub hover:text-ink'}`}
                      style={on ? { background: v.color } : undefined}>
                      <div className="font-semibold">{v.nombre}</div>
                      <div className={on ? 'text-white/80' : ''}>{v.usuario_transporte_nombre ?? 'sin chofer'} · {n} local{n === 1 ? '' : 'es'}</div>
                    </button>
                  )
                })}
              </div>
              {!basesUbic.length && <p className="text-xs text-sub">Todavía no hay locales ubicados: cargalos en 📍 Ubicar locales.</p>}
              {vehElegido && basesUbic.length > 0 && (
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs text-sub">
                    {editando ? 'Editando: tildá los locales y tocá Guardar.' : `${delVehiculo.length} local${delVehiculo.length === 1 ? '' : 'es'} obligatorio${delVehiculo.length === 1 ? '' : 's'}`}
                  </span>
                  {editando ? (
                    <div className="flex gap-1.5">
                      <button onClick={() => setBorrador(null)} disabled={guardando} className="h-8 rounded-lg px-3 text-xs font-semibold text-sub hover:text-ink">Cancelar</button>
                      <button onClick={() => void guardarRecorridos()} disabled={guardando}
                        className="btn-press inline-flex h-8 items-center gap-1 rounded-lg bg-green-600 px-3 text-xs font-semibold text-white disabled:opacity-60">
                        {guardando ? <Loader2 size={13} className="animate-spin" /> : null} Guardar
                      </button>
                    </div>
                  ) : (
                    <button onClick={editar} className="h-8 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white">✏️ Editar</button>
                  )}
                </div>
              )}
              <ul className="max-h-[420px] divide-y divide-line overflow-y-auto text-sm">
                {basesUbic.filter((b) => editando || lista.some((x) => x.base_id === b.base_id)).map((b) => {
                  const r = lista.find((x) => x.base_id === b.base_id)
                  return (
                    <li key={b.base_id} className="py-2">
                      {editando ? (
                        <label className="flex cursor-pointer items-center gap-2">
                          <input type="checkbox" checked={!!r} onChange={(e) => cambiarBorrador(b.base_id, e.target.checked ? {} : null)} />
                          <span className="font-semibold text-ink">{b.base_id}</span>
                          <span className="truncate text-xs text-sub">{b.nombre}</span>
                        </label>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-ink">🏪 {b.base_id}</span>
                          <span className="truncate text-xs text-sub">{b.nombre}</span>
                        </div>
                      )}
                      {r && (
                        <div className="ml-6 mt-1.5 flex flex-wrap items-center gap-2">
                          <div className="flex gap-0.5">
                            {DIAS.map((d, i) => {
                              const on = !r.dias || r.dias.includes(i + 1)
                              return (
                                <button key={i} onClick={() => cambiarDia(r, i + 1)} disabled={!editando}
                                  className={`h-6 w-6 rounded text-[11px] font-bold ${on ? 'bg-blue-600 text-white' : 'bg-surface2 text-sub'} ${editando ? '' : 'cursor-default'}`}
                                  aria-label={`Día ${d}`}>{d}</button>
                              )
                            })}
                          </div>
                          {editando ? (
                            <label className="flex items-center gap-1 text-xs text-sub">
                              hasta
                              <input type="time" value={r.hora_limite?.slice(0, 5) ?? ''}
                                onChange={(e) => cambiarBorrador(b.base_id, { hora_limite: e.target.value || null })}
                                className="h-7 rounded border border-line bg-surface px-1 text-xs text-ink" />
                            </label>
                          ) : (
                            <span className="text-xs text-sub">{r.hora_limite ? `hasta las ${r.hora_limite.slice(0, 5)}` : 'sin hora límite'}</span>
                          )}
                        </div>
                      )}
                    </li>
                  )
                })}
                {!editando && vehElegido && basesUbic.length > 0 && !delVehiculo.length && (
                  <li className="py-2 text-xs text-sub">Sin locales obligatorios. Tocá «Editar» para asignarle.</li>
                )}
              </ul>
            </>
          )}
        </div>
      )}

      {tab === 'vehiculos' && (
        <div>
          <div className="mb-3 space-y-2 rounded-xl border border-line p-3">
            <input className={inp} placeholder="Nombre del vehículo (ej. Master blanca)" value={veh.nombre} onChange={(e) => setVeh({ ...veh, nombre: e.target.value })} />
            <input className={inp} placeholder="Identificador para Traccar (opcional, ej. mercedes-4417)" value={veh.disp}
              onChange={(e) => setVeh({ ...veh, disp: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })} />
            <select className={inp} value={veh.chofer} onChange={(e) => setVeh({ ...veh, chofer: e.target.value, nombre: veh.nombre || choferes.find((c) => c.id === e.target.value)?.nombre || '' })}>
              <option value="">Usuario de Transporte (chofer)…</option>
              {choferes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
            <button onClick={() => void crearVehiculo()} disabled={!veh.nombre.trim()} className="btn-press inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-sm font-semibold text-white disabled:opacity-50">
              <Truck size={16} /> Agregar vehículo
            </button>
          </div>
          <ul className="divide-y divide-line text-sm">
            {vehiculos.map((v) => (
              <li key={v.id} className="py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <input type="color" value={v.color} onChange={(e) => void cambiarVehiculo(v, { color: e.target.value })} className="h-6 w-6 cursor-pointer rounded border-0 bg-transparent p-0" aria-label="Color" />
                    <div className="min-w-0">
                      <div className={`truncate font-semibold ${v.activo ? 'text-ink' : 'text-sub line-through'}`}>{v.nombre}</div>
                      <div className="text-xs text-sub">
                        Chofer: {v.usuario_transporte_nombre ?? 'sin asignar'} · <code>{v.dispositivo}</code>
                        {v.usuario_transporte_id && (conAvisos.has(v.usuario_transporte_id)
                          ? <span className="text-green-600 dark:text-green-400"> · 🔔 avisos activados</span>
                          : <span className="text-amber-600 dark:text-amber-400"> · 🔕 sin avisos</span>)}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2 text-xs">
                    <button onClick={() => setVerDisp(verDisp === v.id ? null : v.id)} className="font-semibold text-blue-600">Configurar celular</button>
                    <button onClick={() => void cambiarVehiculo(v, { activo: !v.activo })} className="text-sub hover:text-ink">{v.activo ? 'Desactivar' : 'Activar'}</button>
                  </div>
                </div>
                {verDisp === v.id && (
                  <div className="mt-2 space-y-1 rounded-lg bg-surface2 p-3 text-xs text-ink">
                    <b>En el celular del chofer:</b>
                    <ol className="ml-4 list-decimal space-y-1 text-sub">
                      <li>Instalar <b className="text-ink">Traccar Client</b> (Play Store / App Store).</li>
                      <li>
                        Identificador del dispositivo: <code className="select-all rounded bg-surface px-1 text-ink">{v.dispositivo}</code>{' '}
                        <button onClick={() => {
                          const nuevo = prompt('Identificador (minúsculas, números y guiones; mínimo 8). Después hay que cambiarlo también en Traccar.', v.dispositivo)?.trim().toLowerCase()
                          if (!nuevo || nuevo === v.dispositivo) return
                          if (!DISPOSITIVO_OK.test(nuevo)) return alert('Usá solo minúsculas, números y guiones, de 8 a 60 caracteres (ej. master-9588).')
                          void cambiarVehiculo(v, { dispositivo: nuevo })
                        }} className="font-semibold text-blue-600">Cambiar</button>
                      </li>
                      <li>URL del servidor: <code className="select-all rounded bg-surface px-1 text-ink">{URL_INGESTA}</code></li>
                      <li>Frecuencia: 30 s · Precisión: alta. Prender «Estado del servicio».</li>
                      <li>Permiso de ubicación: <b className="text-ink">Permitir todo el tiempo</b>.</li>
                      <li>Android: Ajustes → Apps → Traccar Client → Batería → <b className="text-ink">Sin restricciones</b>.</li>
                    </ol>
                    <select className={`${inp} mt-2`} value={v.usuario_transporte_id ?? ''}
                      onChange={(e) => {
                        const c = choferes.find((x) => x.id === e.target.value)
                        void cambiarVehiculo(v, { usuario_transporte_id: c?.id ?? null, usuario_transporte_nombre: c?.nombre ?? null })
                      }}>
                      <option value="">Sin chofer (no bloquea escaneos)</option>
                      {choferes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                    </select>
                  </div>
                )}
              </li>
            ))}
            {!vehiculos.length && <li className="py-2 text-xs text-sub">Agregá un vehículo por cada celular de chofer.</li>}
          </ul>
        </div>
      )}

      {tab === 'locales' && (
        <div>
          <p className="mb-2 text-xs text-sub">
            Poné la dirección de cada local (o tocá el mapa con «Mapa»). El radio es la distancia que cuenta como «pasó por el local». {basesUbic.length} de {bases.length} ubicados.
          </p>
          <input className={`${inp} mb-2`} placeholder="Buscar local…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <ul className="max-h-[480px] divide-y divide-line overflow-y-auto text-sm">
            {listaBases.map((b) => {
              const u = ubicada.get(b.base_id)
              const abierto = dir?.base_id === b.base_id
              return (
                <li key={b.base_id} className="py-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-ink">{u ? '✓ ' : ''}{b.base_id} <span className="text-xs font-normal text-sub">{b.nombre}</span></div>
                      <div className="truncate text-xs text-sub">{u ? (u.direccion ?? 'ubicado en el mapa') : 'sin ubicar'}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {u && (
                        <label className="flex items-center gap-1 text-xs text-sub">
                          <input type="number" min={20} max={5000} defaultValue={u.radio_m} key={u.radio_m}
                            onBlur={(e) => Number(e.target.value) !== u.radio_m && void cambiarRadio(b.base_id, Number(e.target.value))}
                            className="h-7 w-14 rounded border border-line bg-surface px-1 text-xs text-ink" aria-label="Radio en metros" /> m
                        </label>
                      )}
                      <button onClick={() => setDir(abierto ? null : { base_id: b.base_id, texto: u?.direccion ?? '', lugares: null, buscando: false })}
                        className="rounded-lg bg-green-600 px-2 py-1 text-xs font-semibold text-white">Dirección</button>
                      <button onClick={() => setModo(b.base_id)} className="inline-flex items-center gap-0.5 rounded-lg border border-line px-2 py-1 text-xs font-semibold text-sub hover:text-ink">
                        <MapPin size={12} /> Mapa
                      </button>
                    </div>
                  </div>
                  {abierto && dir && (
                    <div className="mt-2 rounded-lg bg-surface2 p-2">
                      <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); void buscarDireccion() }}>
                        <input autoFocus className={inp} placeholder="Ej. Av. Colón 1234, Córdoba" value={dir.texto}
                          onChange={(e) => setDir({ ...dir, texto: e.target.value })} />
                        <button type="submit" disabled={dir.buscando || !dir.texto.trim()}
                          className="h-9 shrink-0 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white disabled:opacity-50">
                          {dir.buscando ? <Loader2 size={14} className="animate-spin" /> : 'Buscar'}
                        </button>
                      </form>
                      {dir.lugares && !dir.lugares.length && (
                        <p className="mt-2 text-xs text-sub">No se encontró. Probá con calle y altura más la ciudad, o ubicalo con «Mapa».</p>
                      )}
                      {dir.lugares && dir.lugares.length > 0 && (
                        <ul className="mt-2 space-y-1">
                          {dir.lugares.map((l, i) => (
                            <li key={i}>
                              <button onClick={() => void elegirLugar(l)} className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-left text-xs text-ink hover:border-green-500">
                                📍 {l.display_name}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      <p className="mt-1.5 text-[11px] text-sub">Elegí el resultado y después tocá el mapa justo en la puerta del local para dejarlo exacto.</p>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </section>
  )
}
