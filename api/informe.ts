/**
 * Informes del área Sistemas: envío manual y disparo de los programados.
 *
 *   POST /api/informe   { id }                        -> envía el informe guardado
 *   POST /api/informe   { informe, preview: true }     -> devuelve el texto sin enviar
 *   POST /api/informe   { estado: true }               -> ¿WhatsApp conectado? (número y nombre en Meta)
 *   GET  /api/informe   (Bearer $CRON_SECRET ó JWT)    -> dispara los diarios vencidos
 *   GET  /api/informe?evento=repo                      -> si la repo del día llegó al 100%, manda los
 *        informes "al completar la repo" que no salieron hoy (lo llama pg_cron cada 5 min; sin datos sensibles)
 *
 * Antes eran dos funciones (informe-enviar e informe-cron); se unificaron para no
 * pasar el tope de 12 Serverless Functions del plan Hobby de Vercel. El método
 * distingue: GET = cron (Vercel Cron y respaldo al abrir la pantalla), POST = envío manual.
 *
 * Variables de entorno en Vercel (sin prefijo VITE_): CRON_SECRET, SUPABASE_URL,
 * SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, WHATSAPP_TOKEN, WHATSAPP_PHONE_ID.
 */
import { armarCuerpo, enviarInforme, estadoWhatsapp, generarImagenInforme, repoCompleta, tienePermiso, usuarioDe } from '../src/lib/informesServidor.js'
import { formatoDe, type Informe } from '../src/lib/informes.js'
import { mismoSecreto } from '../src/lib/apiAuth.js'

type Req = {
  method?: string
  headers: { authorization?: string }
  body?: unknown
  query?: Record<string, string | string[] | undefined>
}

type Res = {
  status(code: number): Res
  setHeader(name: string, value: string): Res
  json(body: unknown): void
}

const DIAS_ES = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab']

function rest(ruta: string, init: RequestInit = {}): Promise<Response> {
  const url = process.env.SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return fetch(`${url}/rest/v1/${ruta}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
}

/* ------------------------------------------------------------------ */
/*  GET: cron (informes programados)                                    */
/* ------------------------------------------------------------------ */

/** Fecha/hora/día de Argentina (UTC-3). */
function ahoraAr() {
  const ar = new Date(Date.now() - 3 * 3600_000)
  const hh = String(ar.getUTCHours()).padStart(2, '0')
  const mm = String(ar.getUTCMinutes()).padStart(2, '0')
  return { fecha: ar.toISOString().slice(0, 10), hora: `${hh}:${mm}`, dia: DIAS_ES[ar.getUTCDay()] }
}

/** Instante UTC de hoy a las 00:00 (hora de Argentina). */
function inicioHoyUtc(): string {
  const ar = new Date(Date.now() - 3 * 3600_000)
  const arStart = Date.UTC(ar.getUTCFullYear(), ar.getUTCMonth(), ar.getUTCDate())
  return new Date(arStart + 3 * 3600_000).toISOString()
}

/** Solo por header (Vercel Cron manda Authorization: Bearer $CRON_SECRET): por query quedaba en logs. */
function secretoDe(req: Req): string {
  const auth = req.headers.authorization ?? ''
  return auth.startsWith('Bearer ') ? auth.slice(7) : ''
}

/** Reclamo atómico del envío de hoy: devuelve true sólo si este proceso lo ganó. */
async function reclamarHoy(id: string): Promise<boolean> {
  const corte = inicioHoyUtc()
  const claim = await rest(
    `informes?id=eq.${id}&or=(ultimo_envio.is.null,ultimo_envio.lt.${encodeURIComponent(corte)})`,
    { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ ultimo_envio: new Date().toISOString() }) },
  )
  if (!claim.ok) return false
  const reclamados = (await claim.json().catch(() => [])) as Informe[]
  return Array.isArray(reclamados) && reclamados.length > 0
}

/**
 * Disparo "al completar la repo": sin autenticación porque no recibe nada ni devuelve datos;
 * sólo manda (una vez por día) lo que ya está configurado, y únicamente si la repo terminó.
 */
async function eventoRepo(res: Res) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: 'Falta la configuración de Supabase' })
  const rI = await rest('informes?select=*&activo=eq.true&modo=eq.repo_completa')
  if (!rI.ok) return res.status(502).json({ error: 'No se pudieron leer los informes' })
  const informes = ((await rI.json()) as Informe[]).filter((i) => {
    const corte = inicioHoyUtc()
    return !i.ultimo_envio || i.ultimo_envio < corte
  })
  if (!informes.length) return res.status(200).json({ pendientes: 0 })
  const { fecha, dia } = ahoraAr()
  let completa = false
  try {
    completa = await repoCompleta(fecha)
  } catch (e) {
    return res.status(200).json({ pendientes: informes.length, completa: false, error: (e as Error).message })
  }
  if (!completa) return res.status(200).json({ pendientes: informes.length, completa: false })
  let enviados = 0
  for (const i of informes) {
    if (i.dias?.length && !i.dias.includes(dia)) continue
    if (!(await reclamarHoy(i.id))) continue
    const r = await enviarInforme(i, 'cron')
    if (r.ok) enviados++
    // Si no salió (plantilla todavía en revisión, falta de pago, etc.) se libera para reintentar en 5 min
    else await rest(`informes?id=eq.${i.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ ultimo_envio: null }) }).catch(() => undefined)
  }
  return res.status(200).json({ pendientes: informes.length, completa: true, enviados })
}

async function cron(req: Req, res: Res) {
  if (req.query?.evento === 'repo') return eventoRepo(res)
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Falta la configuración de Supabase' })
  }

  // ?evento=diarios: pg_cron cada 5 min (sql/informes_diarios_cron.sql), para que salgan a su hora
  // (el cron de Vercel Hobby es uno por día). Sin autenticación, igual que ?evento=repo: no recibe
  // nada ni devuelve datos, y solo manda los diarios ya vencidos, una vez por día (reclamo atómico).
  if (req.query?.evento !== 'diarios') {
    // Autorización: el secreto del cron, o un usuario con permiso (respaldo desde la app).
    const token = secretoDe(req)
    const secreto = process.env.CRON_SECRET
    let autorizado = Boolean(secreto) && mismoSecreto(token, secreto ?? '')
    if (!autorizado && token) {
      const uid = await usuarioDe(token)
      autorizado = Boolean(uid) && (await tienePermiso(token, ['sistemas.informes.view']))
    }
    if (!autorizado) return res.status(401).json({ error: 'No autorizado' })
  }

  const rI = await rest('informes?select=*&activo=eq.true&modo=eq.diario')
  if (!rI.ok) return res.status(502).json({ error: `No se pudieron leer los informes (${rI.status})` })
  const informes = (await rI.json()) as Informe[]

  const { fecha, hora, dia } = ahoraAr()
  const corte = inicioHoyUtc()
  const enviados: Array<{ nombre: string; ok: boolean; detalle: string }> = []

  for (const i of informes) {
    const suHora = (i.hora ?? '').trim()
    if (!/^\d{2}:\d{2}$/.test(suHora)) continue
    if (hora < suHora) continue // todavía no es la hora
    if (i.dias?.length && !i.dias.includes(dia)) continue // no toca hoy

    // Reclamo atómico: sólo pasa si no se mandó hoy todavía.
    const claim = await rest(
      `informes?id=eq.${i.id}&or=(ultimo_envio.is.null,ultimo_envio.lt.${encodeURIComponent(corte)})`,
      { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ ultimo_envio: new Date().toISOString() }) },
    )
    if (!claim.ok) continue
    const reclamados = (await claim.json().catch(() => [])) as Informe[]
    if (!Array.isArray(reclamados) || reclamados.length === 0) continue // ya se mandó hoy

    const r = await enviarInforme(i, 'cron')
    enviados.push({ nombre: i.nombre, ok: r.ok, detalle: r.detalle })
  }

  return res.status(200).json({ fecha, hora, dia, informes: informes.length, procesados: enviados.length, enviados })
}

/* ------------------------------------------------------------------ */
/*  POST: envío manual (o previsualización)                             */
/* ------------------------------------------------------------------ */

function cuerpo(req: Req): Record<string, unknown> {
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body) as Record<string, unknown>
    } catch {
      return {}
    }
  }
  return (req.body as Record<string, unknown>) ?? {}
}

async function manual(req: Req, res: Res) {
  const auth = req.headers.authorization ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const uid = token ? await usuarioDe(token) : null
  if (!uid) return res.status(401).json({ error: 'No autorizado' })
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Falta la configuración de Supabase' })
  }

  const datos = cuerpo(req)
  const preview = datos.preview === true

  // --- Estado de la conexión con WhatsApp (Meta) ---
  if (datos.estado === true) {
    if (!(await tienePermiso(token, ['sistemas.informes.view']))) return res.status(403).json({ error: 'No tenés permiso para esta acción' })
    return res.status(200).json(await estadoWhatsapp())
  }

  const permitido = await tienePermiso(token, preview ? ['sistemas.informes.view'] : ['sistemas.informes.edit'])
  if (!permitido) return res.status(403).json({ error: 'No tenés permiso para esta acción' })

  // --- Previsualizar: arma el texto desde el objeto que manda el formulario ---
  if (preview) {
    const informe = datos.informe as Informe | undefined
    if (!informe) return res.status(400).json({ error: 'Falta el informe' })
    try {
      if (formatoDe(informe) === 'imagen') {
        const { png, caption } = await generarImagenInforme(informe)
        return res.status(200).json({ ok: true, texto: caption, imagen: `data:image/png;base64,${png.toString('base64')}` })
      }
      const texto = await armarCuerpo(informe)
      return res.status(200).json({ ok: true, texto })
    } catch (e) {
      return res.status(200).json({ ok: false, error: (e as Error).message })
    }
  }

  // --- Enviar un informe guardado por id ---
  const id = typeof datos.id === 'string' ? datos.id : ''
  if (!id) return res.status(400).json({ error: 'Falta el id del informe' })

  const rI = await rest(`informes?select=*&id=eq.${id}`)
  if (!rI.ok) return res.status(502).json({ error: `No se pudo leer el informe (${rI.status})` })
  const filas = (await rI.json()) as Informe[]
  const informe = filas?.[0]
  if (!informe) return res.status(404).json({ error: 'Informe no encontrado' })

  const resultado = await enviarInforme(informe, 'manual')
  return res.status(200).json(resultado)
}

export default async function handler(req: Req, res: Res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method === 'GET') return cron(req, res)
  if (req.method === 'POST') return manual(req, res)
  return res.status(405).json({ error: 'Método no permitido' })
}
