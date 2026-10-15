/**
 * Tracking de transporte (área Administradores). Una sola función para no pasar el
 * límite de funciones de Vercel Hobby; el modo sale de la query / del body:
 *
 * 1) Ingesta de Traccar Client (celular del chofer, corre en segundo plano):
 *      URL del servidor en la app: https://hub-mito.vercel.app/api/tracking
 *      - protocolo OsmAnd (Traccar Client clásico): ?id=<disp>&lat=&lon=&timestamp=&speed(nudos)&bearing&accuracy&batt
 *      - JSON (Traccar Client 9+): { device_id, location: { timestamp, coords: {...}, battery: { level } } }
 *    El identificador del dispositivo (ej. master-9588, nombre + 4 números) tiene que estar en tracking_vehiculos:
 *    es lo único que autoriza a escribir, y solo puede escribir ubicaciones de su vehículo.
 *
 * 2) GET ?vista=hub&fecha=AAAA-MM-DD  (JWT del hub con tracking.view)
 *    Lee en vivo de la base de Transporte las cargas (bultos que escaneó cada TRANSPORTISTA)
 *    y las entregas (recepción en el local) del día. Las ubicaciones las lee el hub directo (RLS).
 *
 * 3) GET ?vista=chofer  (JWT de la app Transporte; CORS para su dominio)
 *    ¿El vehículo del chofer mandó ubicación hace poco? La app Transporte no deja escanear si no.
 *    POST ?vista=push  (JWT de la app Transporte): guarda la suscripción a notificaciones del celular.
 *
 * 4) GET ?vista=alertas  (pg_cron cada 2 min, sql/tracking_transporte.sql)
 *    Al chofer cuyo vehículo dejó de mandar ubicación le suena una notificación, repetida cada
 *    2 min mientras siga así. Solo en jornada (lunes a sábado 6-21 h y si ya escaneó algo hoy).
 *    Sin secreto a propósito: cada chofer recibe a lo sumo un aviso cada ~2 min (ultimo_aviso),
 *    así que llamarlo de más no manda nada de más.
 *
 * Variables de entorno en Vercel (sin prefijo VITE_):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY            - hub
 *   TRANSPORTE_URL, TRANSPORTE_ANON_KEY                 - ya estaban (bultos-recibidos)
 *   TRANSPORTE_SERVICE_ROLE_KEY                         - lectura de sesiones/bultos de Transporte
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (VAPID_SUBJECT) - las mismas de api/push.ts
 */
import webpush from 'web-push'
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
/** Pasado este tiempo sin ubicación, al chofer le suena el aviso (y se repite cada 2 min). */
const MIN_AVISO = 3

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

/** Deja en los logs de Vercel qué mandó el celular cuando se rechaza (para configurar Traccar). */
function rechazo(req: Req, res: Res, codigo: number, error: string) {
  const cuerpo = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? null)
  console.warn(`[tracking] ${codigo} ${error} · ${req.method} ct=${cabecera(req, 'content-type')} q=${JSON.stringify(req.query ?? {}).slice(0, 200)} body=${(cuerpo ?? '').slice(0, 300)}`)
  return res.status(codigo).json({ error })
}

async function ingesta(req: Req, res: Res) {
  const puntos = puntosDe(req)
  // Traccar Client manda al conectarse su token de notificaciones (sin ubicación): se acepta y se ignora
  const plano = { ...(typeof req.body === 'object' && req.body ? req.body : {}), ...(req.query ?? {}) } as Record<string, unknown>
  if (!puntos.length && plano.id && plano.notificationToken) return res.status(200).json({ ok: true })
  if (!puntos.length) return rechazo(req, res, 400, 'Sin ubicación')
  // Corto y fácil de tipear (ej. master-9588): se compara sin mayúsculas ni espacios
  const disp = puntos[0].dispositivo.trim().toLowerCase()
  if (!/^[a-z0-9-]{8,60}$/.test(disp) || puntos.some((p) => p.dispositivo.trim().toLowerCase() !== disp)) {
    return rechazo(req, res, 400, 'Dispositivo inválido')
  }
  const h = hub()
  const veh = await getJson<{ id: string }[]>(
    `${h.url}/rest/v1/tracking_vehiculos?select=id&activo=eq.true&dispositivo=eq.${encodeURIComponent(disp)}`,
    h.headers,
  )
  if (!veh.length) return rechazo(req, res, 404, 'Dispositivo no registrado')

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
  console.log(`[tracking] ok ${disp} · ${filas.length} punto(s)`)
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

// ---------- 3) Chofer (app Transporte) ----------

/** Usuario de Transporte del JWT (null si no es válido). */
async function usuarioTransporte(req: Req): Promise<string | null> {
  const token = tokenDe(cabecera(req, 'authorization'))
  const trUrl = env('TRANSPORTE_URL')?.replace(/\/$/, '')
  const trAnon = env('TRANSPORTE_ANON_KEY')
  if (!token || !trUrl || !trAnon) return null
  const u = await fetch(`${trUrl}/auth/v1/user`, { headers: { apikey: trAnon, Authorization: `Bearer ${token}` } })
  if (!u.ok) return null
  const { id } = (await u.json()) as { id?: string }
  return id && /^[0-9a-f-]{36}$/i.test(id) ? id : null
}

async function vistaChofer(req: Req, res: Res) {
  const id = await usuarioTransporte(req)
  if (!id) return res.status(401).json({ error: 'Sesión de Transporte inválida' })

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
    vapid: env('VAPID_PUBLIC_KEY') ?? null,
  })
}

/** Guarda la suscripción a notificaciones del celular del chofer. */
async function vistaPush(req: Req, res: Res) {
  const id = await usuarioTransporte(req)
  if (!id) return res.status(401).json({ error: 'Sesión de Transporte inválida' })
  const body = (typeof req.body === 'string' ? safeJson(req.body) : req.body) as { endpoint?: string; keys?: { p256dh?: string; auth?: string } } | null
  const endpoint = body?.endpoint ?? ''
  const p256dh = body?.keys?.p256dh ?? ''
  const auth = body?.keys?.auth ?? ''
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || !p256dh || !auth || p256dh.length > 200 || auth.length > 100) {
    return res.status(400).json({ error: 'Suscripción inválida' })
  }
  const h = hub()
  const r = await fetch(`${h.url}/rest/v1/tracking_push?on_conflict=endpoint`, {
    method: 'POST',
    headers: { ...h.headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ endpoint, usuario_transporte_id: id, p256dh, auth }),
  })
  if (!r.ok) return res.status(500).json({ error: `No se pudo guardar (${r.status})` })
  return res.status(200).json({ ok: true })
}

// ---------- 4) Avisos que suenan cuando se corta la ubicación ----------

async function vistaAlertas(res: Res) {
  // Jornada: lunes a sábado de 6 a 21 h de Córdoba (UTC-3)
  const ar = new Date(Date.now() - 3 * 3600_000)
  const dia = ar.getUTCDay()
  const hora = ar.getUTCHours()
  if (dia === 0 || hora < 6 || hora >= 21) return res.status(200).json({ ok: true, avisos: 0, motivo: 'fuera de horario' })

  const pub = env('VAPID_PUBLIC_KEY')
  const priv = env('VAPID_PRIVATE_KEY')
  if (!pub || !priv) return res.status(500).json({ error: 'Faltan VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY' })
  webpush.setVapidDetails(env('VAPID_SUBJECT') || 'https://hub-mito.vercel.app', pub, priv)

  const h = hub()
  const t = transporte()
  const ahora = Date.now()
  const vehs = await getJson<{ id: string; nombre: string; usuario_transporte_id: string; ultimo_aviso: string | null }[]>(
    `${h.url}/rest/v1/tracking_vehiculos?select=id,nombre,usuario_transporte_id,ultimo_aviso&activo=eq.true&usuario_transporte_id=not.is.null`, h.headers)
  const inicioHoy = new Date(Date.UTC(ar.getUTCFullYear(), ar.getUTCMonth(), ar.getUTCDate()) + 3 * 3600_000).toISOString()

  let avisos = 0
  for (const v of vehs) {
    if (v.ultimo_aviso && ahora - new Date(v.ultimo_aviso).getTime() < 110_000) continue
    const ult = await getJson<{ recibido_at: string }[]>(
      `${h.url}/rest/v1/tracking_ubicaciones?select=recibido_at&vehiculo_id=eq.${v.id}&order=recibido_at.desc&limit=1`, h.headers)
    const min = ult[0] ? (ahora - new Date(ult[0].recibido_at).getTime()) / 60_000 : null
    if (min !== null && min < MIN_AVISO) continue
    // Solo si ya arrancó la jornada (escaneó algo hoy): no molestar en días que no trabaja
    const hoy = await getJson<unknown[]>(
      `${t.url}/rest/v1/bultos_historial?select=id&usuario_registro_id=eq.${v.usuario_transporte_id}&registrado_en=gte.${inicioHoy}&limit=1`, t.headers)
    if (!hoy.length) continue
    const subs = await getJson<{ endpoint: string; p256dh: string; auth: string }[]>(
      `${h.url}/rest/v1/tracking_push?select=endpoint,p256dh,auth&usuario_transporte_id=eq.${v.usuario_transporte_id}`, h.headers)
    if (!subs.length) continue
    const payload = JSON.stringify({
      title: '📍 Activá la ubicación',
      body: min === null
        ? `No llega la ubicación de ${v.nombre}. Abrí Traccar Client y prendé el servicio.`
        : `Hace ${Math.floor(min)} min que no llega la ubicación de ${v.nombre}. Abrí Traccar Client y prendé el servicio.`,
      tag: 'ubicacion-transporte',
    })
    await Promise.all(subs.map(async (sub) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, { TTL: 120, urgency: 'high' })
        avisos++
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode
        // Suscripción vencida (desinstaló la app, borró datos): se descarta
        if (code === 404 || code === 410) {
          await fetch(`${h.url}/rest/v1/tracking_push?endpoint=eq.${encodeURIComponent(sub.endpoint)}`, { method: 'DELETE', headers: h.headers })
        }
      }
    }))
    await fetch(`${h.url}/rest/v1/tracking_vehiculos?id=eq.${v.id}`, {
      method: 'PATCH', headers: { ...h.headers, Prefer: 'return=minimal' }, body: JSON.stringify({ ultimo_aviso: new Date().toISOString() }),
    })
  }
  return res.status(200).json({ ok: true, avisos })
}

export default async function handler(req: Req, res: Res) {
  res.setHeader('Cache-Control', 'no-store')
  const vista = q(req, 'vista')

  if (vista === 'chofer' || vista === 'push') {
    const origen = cabecera(req, 'origin')
    if (ORIGENES_TRANSPORTE.includes(origen)) {
      res.setHeader('Access-Control-Allow-Origin', origen)
      res.setHeader('Vary', 'Origin')
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    }
    if (req.method === 'OPTIONS') return res.status(204).end()
  }

  try {
    if (vista === 'hub' && req.method === 'GET') return await vistaHub(req, res)
    if (vista === 'chofer' && req.method === 'GET') return await vistaChofer(req, res)
    if (vista === 'push' && req.method === 'POST') return await vistaPush(req, res)
    if (vista === 'alertas') return await vistaAlertas(res)
    if (req.method === 'POST' || req.method === 'GET') return await ingesta(req, res)
    return res.status(405).json({ error: 'Método no permitido' })
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : String(e) })
  }
}
