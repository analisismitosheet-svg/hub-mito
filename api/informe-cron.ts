/**
 * Dispara los informes programados (modo 'diario').
 *
 *   GET/POST /api/informe-cron   (Authorization: Bearer $CRON_SECRET  ó  JWT de usuario)
 *
 * Lo llama Vercel Cron (con CRON_SECRET) y también la pantalla de Informes al
 * abrirse (con el JWT del usuario, como respaldo si el cron no corre seguido).
 * Recorre los informes activos en modo diario y envía los que ya pasaron su
 * hora (de Argentina) y todavía no se mandaron hoy.
 *
 * El "ya se mandó hoy" se resuelve con un PATCH condicional (reclamo atómico):
 * sólo el primero que logra mover `ultimo_envio` envía, así no se duplica.
 *
 * Variables de entorno en Vercel: CRON_SECRET, SUPABASE_URL,
 * SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, WHATSAPP_TOKEN, WHATSAPP_PHONE_ID.
 */
import { enviarInforme, tienePermiso, usuarioDe } from '../src/lib/informesServidor.js'
import type { Informe } from '../src/lib/informes.js'

type Req = {
  method?: string
  headers: { authorization?: string }
  query?: Record<string, string | string[] | undefined>
}

type Res = {
  status(code: number): Res
  setHeader(name: string, value: string): Res
  json(body: unknown): void
}

const DIAS_ES = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab']

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

function secretoDe(req: Req): string {
  const auth = req.headers.authorization ?? ''
  if (auth.startsWith('Bearer ')) return auth.slice(7)
  const q = req.query?.secret
  return (Array.isArray(q) ? q[0] : q) ?? ''
}

async function rest(ruta: string, init: RequestInit = {}): Promise<Response> {
  const url = process.env.SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return fetch(`${url}/rest/v1/${ruta}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
}

export default async function handler(req: Req, res: Res) {
  res.setHeader('Cache-Control', 'no-store')
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Falta la configuración de Supabase' })
  }

  // Autorización: el secreto del cron, o un usuario con permiso (respaldo desde la app).
  const token = secretoDe(req)
  const secreto = process.env.CRON_SECRET
  let autorizado = Boolean(secreto && token === secreto)
  if (!autorizado && token) {
    const uid = await usuarioDe(token)
    autorizado = Boolean(uid) && (await tienePermiso(token, ['sistemas.informes.view']))
  }
  if (!autorizado) return res.status(401).json({ error: 'No autorizado' })

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
