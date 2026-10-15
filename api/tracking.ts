/**
 * Tracking de transporte (área Administradores). Una sola función para no pasar el
 * límite de funciones de Vercel Hobby; el modo sale de la query / del body:
 *
 * 1) Ingesta de Traccar Client (celular del chofer, corre en segundo plano):
 *      URL del servidor en la app: https://hub-mito.vercel.app/api/tracking
 *      - protocolo OsmAnd (Traccar Client clásico): ?id=<disp>&lat=&lon=&timestamp=&speed(nudos)&bearing&accuracy&batt
 *      - JSON (Traccar Client 9+): { device_id, location: { timestamp, coords: {...}, battery: { level } } }
 *    El identificador del dispositivo (largo y al azar) tiene que estar en tracking_vehiculos:
 *    es lo único que autoriza a escribir, y solo puede escribir ubicaciones de su vehículo.
 *
 * 2) GET ?vista=hub&fecha=AAAA-MM-DD  (JWT del hub con tracking.view)
 *    Lee en vivo de la base de Transporte las cargas (bultos que escaneó cada TRANSPORTISTA)
 *    y las entregas (recepción en el local) del día. Las ubicaciones las lee el hub directo (RLS).
 *
 * 3) GET ?vista=chofer  (JWT de la app Transporte; CORS para su dominio)
 *    ¿El vehículo del chofer mandó ubicación hace poco? La app Transporte no deja escanear si no.
 *
 * Variables de entorno en Vercel (sin prefijo VITE_):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY            - hub
 *   TRANSPORTE_URL, TRANSPORTE_ANON_KEY                 - ya estaban (bultos-recibidos)
 *   TRANSPORTE_SERVICE_ROLE_KEY                         - lectura de sesiones/bultos de Transporte
 */
import { autorizado, tokenDe } from '../src/lib/apiAuth.js'

type Req = {
  method?: string
  headers: Record<string, string | string[] | undefined>
  query?: Record<string, string | string[] | undefined>
  body?: unknown
}

type Res = {
  status(code: number): Res
  setHeader(name: string, value: string): Res
  json(body: unknown): void
  end(): void
}

/** Pasado este tiempo sin ubicación, la app Transporte bloquea el escaneo del chofer. */
const MIN_SIN_UBICACION = 10

const ORIGENES_TRANSPORTE = [
  'https://project-r4hl5.vercel.app',
  'http://localhost:5173',
  'http://localhost:5174',
]

const q = (req: Req, k: string): string => {
  const v = req.query?.[k]
  return ((Array.isArray(v) ? v[0] : v) ?? '').toString()
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function cabecera(req: Req, nombre: string): string {
  const v = req.headers[nombre.toLowerCase()]
  return (Array.isArray(v) ? v[0] : v) ?? ''
}

/** Variable de entorno sin espacios ni BOM (PowerShell lo agrega al cargarla por la CLI de Vercel). */
const env = (k: string) => process.env[k]?.replace(/^\uFEFF/, '').trim() || undefined

function hub() {
  const url = env('SUPABASE_URL')?.replace(/\/$/, '')
  const key = env('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw new Error('Falta SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  return { url, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } }
}

function transporte() {
  const url = env('TRANSPORTE_URL')?.replace(/\/$/, '')
  const key = env('TRANSPORTE_SERVICE_ROLE_KEY')
  if (!url || !key) throw new Error('Falta TRANSPORTE_URL / TRANSPORTE_SERVICE_ROLE_KEY')
  return { url, headers: { apikey: key, Authorization: `Bearer ${key}` } }
}

async function getJson<T>(url: string, headers: Record<string, string>): Promise<T> {
  const r = await fetch(url, { headers })
  if (!r.ok) throw new Error(`Error ${r.status} leyendo ${url.split('?')[0].split('/').pop()}`)
  return (await r.json()) as T
}

// ---------- 1) Ingesta de Traccar ----------

interface Punto {
  dispositivo: string
  at: string
  lat: number
  lng: number
  precision_m: number | null
  velocidad_kmh: number | null
  rumbo: number | null
  bateria: number | null
}

function fechaDe(v: unknown): Date | null {
  if (v === null || v === undefined || v === '') return new Date()
  const n = Number(v)
  // OsmAnd manda segundos unix (a veces milisegundos); Traccar 9 manda ISO
  const d = Number.isFinite(n) ? new Date(n > 1e12 ? n : n * 1000) : new Date(String(v))
  return isNaN(d.getTime()) ? null : d
}

/** Saca los puntos del pedido (OsmAnd por query/form o JSON de Traccar 9, uno o varios). */
function puntosDe(req: Req): Punto[] {
  const out: Punto[] = []
  const body = (typeof req.body === 'string' ? safeJson(req.body) : req.body) as Record<string, unknown> | null
  const plano: Record<string, unknown> = { ...(body && typeof body === 'object' && !('location' in body) ? body : {}), ...(req.query ?? {}) }

  // OsmAnd: id, lat, lon, timestamp, speed (nudos), bearing, accuracy, batt (%)
  if (plano.id && plano.lat !== undefined && (plano.lon ?? plano.lng) !== undefined) {
    const at = fechaDe(plano.timestamp)
    const lat = num(plano.lat)
    const lng = num(plano.lon ?? plano.lng)
    const nudos = num(plano.speed)
    const batt = num(plano.batt)
    if (at && lat !== null && lng !== null) {
      out.push({
        dispositivo: String(plano.id), at: at.toISOString(), lat, lng,
        precision_m: num(plano.accuracy), velocidad_kmh: nudos === null ? null : nudos * 1.852,
        rumbo: num(plano.bearing), bateria: batt,
      })
    }
  }

  // Traccar Client 9: { device_id, location: {...} | [...] }
  if (body && typeof body === 'object' && 'location' in body) {
    const disp = String((body as Record<string, unknown>).device_id ?? '')
    const locs = (body as Record<string, unknown>).location
    for (const l of (Array.isArray(locs) ? locs : [locs]) as Record<string, unknown>[]) {
      const c = (l?.coords ?? {}) as Record<string, unknown>
      const at = fechaDe(l?.timestamp)
      const lat = num(c.latitude)
      const lng = num(c.longitude)
      const ms = num(c.speed)
      const nivel = num((l?.battery as Record<string, unknown> | undefined)?.level)
      if (!disp || !at || lat === null || lng === null) continue
      out.push({
        dispositivo: disp, at: at.toISOString(), lat, lng,
        precision_m: num(c.accuracy), velocidad_kmh: ms === null || ms < 0 ? null : ms * 3.6,
        rumbo: num(c.heading), bateria: nivel === null ? null : nivel <= 1 ? Math.round(nivel * 100) : nivel,
      })
    }
  }
  return out
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s) } catch { return null }
}

async function ingesta(req: Req, res: Res) {
  const puntos = puntosDe(req)
  if (!puntos.length) return res.status(400).json({ error: 'Sin ubicación' })
  const disp = puntos[0].dispositivo.trim()
  if (disp.length < 12 || disp.length > 120 || puntos.some((p) => p.dispositivo.trim() !== disp)) {
    return res.status(400).json({ error: 'Dispositivo inválido' })
  }
  const h = hub()
  const veh = await getJson<{ id: string }[]>(
    `${h.url}/rest/v1/tracking_vehiculos?select=id&activo=eq.true&dispositivo=eq.${encodeURIComponent(disp)}`,
    h.headers,
  )
  if (!veh.length) return res.status(404).json({ error: 'Dispositivo no registrado' })

  const ahora = Date.now()
  const filas = puntos
    .filter((p) => {
      const t = new Date(p.at).getTime()
      return t < ahora + 5 * 60_000 && t > ahora - 7 * 86_400_000 && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180
    })
    .slice(0, 500)
    .map((p) => ({
      vehiculo_id: veh[0].id, at: p.at, lat: p.lat, lng: p.lng,
      precision_m: p.precision_m, velocidad_kmh: p.velocidad_kmh, rumbo: p.rumbo, bateria: p.bateria,
    }))
  if (filas.length) {
    const r = await fetch(`${h.url}/rest/v1/tracking_ubicaciones`, {
      method: 'POST',
      headers: { ...h.headers, Prefer: 'return=minimal' },
      body: JSON.stringify(filas),
    })
    if (!r.ok) return res.status(500).json({ error: `No se pudo guardar (${r.status})` })
  }
  return res.status(200).json({ ok: true, guardados: filas.length })
}

// ---------- 2) Datos de Transporte para el hub ----------

interface Hist {
  bulto_id: string
  codigo: string
  origen_base_id: string | null
  destino_base_id: string | null
  estado: string
  usuario_registro_id: string | null
  registrado_en: string
}

/** Inicio del día en Córdoba (UTC-3, sin horario de verano). */
const inicioDia = (fecha: string) => new Date(`${fecha}T00:00:00-03:00`)

async function vistaHub(req: Req, res: Res) {
  if (!(await autorizado(tokenDe(cabecera(req, 'authorization')), ['tracking.view', 'tracking.gestionar']))) {
    return res.status(401).json({ error: 'No autorizado' })
  }
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(q(req, 'fecha')) ? q(req, 'fecha') : new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)
  const desde = inicioDia(fecha)
  const hasta = new Date(desde.getTime() + 86_400_000)
  const t = transporte()

  const [choferes, bases] = await Promise.all([
    getJson<{ id: string; nombre: string; base_id: string | null }[]>(
      `${t.url}/rest/v1/usuarios?select=id,nombre,base_id&rol=eq.TRANSPORTISTA&activo=eq.true&order=nombre`, t.headers),
    getJson<{ base_id: string; nombre: string }[]>(`${t.url}/rest/v1/bases?select=base_id,nombre&activo=eq.true&order=base_id`, t.headers),
  ])

  const sel = 'select=bulto_id,codigo,origen_base_id,destino_base_id,estado,usuario_registro_id,registrado_en'
  const ids = choferes.map((c) => c.id)
  const cargas = ids.length
    ? await getJson<Hist[]>(
        `${t.url}/rest/v1/bultos_historial?${sel}&usuario_registro_id=in.(${ids.join(',')})` +
          `&registrado_en=gte.${desde.toISOString()}&registrado_en=lt.${hasta.toISOString()}&order=registrado_en&limit=5000`,
        t.headers)
    : []

  // Entregas: cuando el local recibió esos bultos (puede ser después del día de la carga)
  const bultoIds = [...new Set(cargas.map((c) => c.bulto_id))]
  const entregas: Hist[] = []
  for (let i = 0; i < bultoIds.length; i += 120) {
    const lote = bultoIds.slice(i, i + 120)
    entregas.push(...(await getJson<Hist[]>(
      `${t.url}/rest/v1/bultos_historial?${sel}&bulto_id=in.(${lote.join(',')})&estado=eq.RECIBIDO` +
        `&registrado_en=gte.${desde.toISOString()}&order=registrado_en&limit=5000`,
      t.headers)))
  }

  const ev = (h: Hist) => ({ bulto: h.codigo, origen: h.origen_base_id, destino: h.destino_base_id, at: h.registrado_en, bulto_id: h.bulto_id })
  return res.status(200).json({
    ok: true,
    fecha,
    choferes,
    bases,
    cargas: cargas.filter((c) => c.estado === 'EN_CAMINO').map((c) => ({ ...ev(c), chofer_id: c.usuario_registro_id })),
    entregas: entregas.map(ev),
  })
}

// ---------- 3) Chequeo del chofer (app Transporte) ----------

async function vistaChofer(req: Req, res: Res) {
  const token = tokenDe(cabecera(req, 'authorization'))
  const trUrl = env('TRANSPORTE_URL')?.replace(/\/$/, '')
  const trAnon = env('TRANSPORTE_ANON_KEY')
  if (!token || !trUrl || !trAnon) return res.status(401).json({ error: 'No autorizado' })
  const u = await fetch(`${trUrl}/auth/v1/user`, { headers: { apikey: trAnon, Authorization: `Bearer ${token}` } })
  if (!u.ok) return res.status(401).json({ error: 'Sesión de Transporte inválida' })
  const { id } = (await u.json()) as { id?: string }
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return res.status(401).json({ error: 'No autorizado' })

  const h = hub()
  const veh = await getJson<{ id: string; nombre: string }[]>(
    `${h.url}/rest/v1/tracking_vehiculos?select=id,nombre&activo=eq.true&usuario_transporte_id=eq.${id}`, h.headers)
  if (!veh.length) return res.status(200).json({ ok: true, configurado: false })

  const ult = await getJson<{ at: string; recibido_at: string }[]>(
    `${h.url}/rest/v1/tracking_ubicaciones?select=at,recibido_at&vehiculo_id=eq.${veh[0].id}&order=at.desc&limit=1`, h.headers)
  const ultima = ult[0]?.recibido_at ?? null
  const minutos = ultima ? Math.floor((Date.now() - new Date(ultima).getTime()) / 60_000) : null
  return res.status(200).json({
    ok: true,
    configurado: true,
    vehiculo: veh[0].nombre,
    ultima,
    minutos,
    habilitado: minutos !== null && minutos <= MIN_SIN_UBICACION,
    limite_min: MIN_SIN_UBICACION,
  })
}

export default async function handler(req: Req, res: Res) {
  res.setHeader('Cache-Control', 'no-store')
  const vista = q(req, 'vista')

  if (vista === 'chofer') {
    const origen = cabecera(req, 'origin')
    if (ORIGENES_TRANSPORTE.includes(origen)) {
      res.setHeader('Access-Control-Allow-Origin', origen)
      res.setHeader('Vary', 'Origin')
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
    }
    if (req.method === 'OPTIONS') return res.status(204).end()
  }

  try {
    if (vista === 'hub' && req.method === 'GET') return await vistaHub(req, res)
    if (vista === 'chofer' && req.method === 'GET') return await vistaChofer(req, res)
    if (req.method === 'POST' || req.method === 'GET') return await ingesta(req, res)
    return res.status(405).json({ error: 'Método no permitido' })
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : String(e) })
  }
}
