/**
 * Avisos push de PAUSAS del piso a los que autorizan (suena aunque el celular
 * esté bloqueado o la app cerrada).
 *
 *   GET  /api/push-pausa   -> { publicKey }  (clave VAPID pública para suscribirse)
 *   POST /api/push-pausa   -> manda el aviso de las pausas pendientes que pidió
 *                             el usuario del JWT y todavía no se avisaron (push_at)
 *
 * Flujo: Mi repo llama repo_solicitar_pausa / armado_solicitar_pausa y después
 * POST acá con su JWT. Con la service role se leen las pausas y las
 * suscripciones (sql/push_suscripciones.sql), se resuelven los autorizadores
 * (permiso mayorista.pausas.autorizar o admin) y se manda con web-push. Las
 * suscripciones vencidas (404/410) se borran.
 *
 * Variables de entorno en Vercel: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
 * VAPID_SUBJECT, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY.
 */
import webpush from 'web-push'

type Req = {
  method?: string
  headers: { authorization?: string }
}

type Res = {
  status(code: number): Res
  setHeader(name: string, value: string): Res
  json(body: unknown): void
}

interface Pausa {
  id: string
  tipo: string
  motivo: string
  detalle: string | null
  local: string | null
}

interface Suscripcion {
  endpoint: string
  usuario_id: string
  p256dh: string
  auth: string
}

const MOTIVO: Record<string, string> = {
  bano: 'Baño',
  otra_tarea: 'Me pidieron otra tarea',
  falta_mercaderia: 'Falta mercadería',
  equipo: 'Problema con el celular/escáner',
  otro: 'Otro motivo',
}

/** Id del usuario del JWT (o null si no es válido). */
async function usuarioDe(token: string): Promise<string | null> {
  const url = process.env.SUPABASE_URL
  const anon = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !anon) return null
  try {
    const r = await fetch(`${url}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: anon } })
    if (!r.ok) return null
    const u = (await r.json()) as { id?: string }
    return u.id ?? null
  } catch {
    return null
  }
}

/** PostgREST con la service role */
async function rest(ruta: string, init: RequestInit = {}): Promise<Response> {
  const url = process.env.SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return fetch(`${url}/rest/v1/${ruta}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
}

/** Usuarios que pueden autorizar pausas: admin + permiso directo o por rol. */
async function autorizadores(): Promise<string[]> {
  const ids = new Set<string>()
  const rA = await rest('usuarios?select=id&es_admin=eq.true')
  if (rA.ok) for (const u of (await rA.json()) as { id: string }[]) ids.add(u.id)

  const rR = await rest('rol_permisos?select=rol&permiso_clave=eq.mayorista.pausas.autorizar')
  if (rR.ok) {
    const roles = (await rR.json()) as { rol: string }[]
    if (roles.length) {
      const lista = roles.map((r) => `"${r.rol.replace(/"/g, '')}"`).join(',')
      const rU = await rest(`usuario_roles?select=usuario_id&rol_codigo=in.(${lista})`)
      if (rU.ok) for (const u of (await rU.json()) as { usuario_id: string }[]) ids.add(u.usuario_id)
    }
  }

  const rP = await rest('usuario_permisos?select=usuario_id,efecto&permiso_clave=eq.mayorista.pausas.autorizar')
  if (rP.ok) {
    for (const u of (await rP.json()) as { usuario_id: string; efecto: string }[]) {
      if (u.efecto === 'revoke') ids.delete(u.usuario_id)
      else ids.add(u.usuario_id)
    }
  }
  return [...ids]
}

export default async function handler(req: Req, res: Res) {
  res.setHeader('Cache-Control', 'no-store')
  const pub = process.env.VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  if (!pub || !priv) return res.status(500).json({ error: 'Faltan las claves VAPID en Vercel' })

  if (req.method === 'GET') return res.status(200).json({ publicKey: pub })
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })

  const auth = req.headers.authorization ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const uid = token ? await usuarioDe(token) : null
  if (!uid) return res.status(401).json({ error: 'No autorizado' })
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Falta la configuración de Supabase' })
  }

  // Pausas pendientes que pidió este usuario y todavía no se avisaron (últimas 2 h)
  const desde = new Date(Date.now() - 2 * 3600_000).toISOString()
  const rP = await rest(
    `piso_pausas?select=id,tipo,motivo,detalle,local` +
      `&estado=eq.pendiente&push_at=is.null&usuario_id=eq.${uid}&solicitada_at=gte.${desde}&order=solicitada_at.asc`,
  )
  if (!rP.ok) return res.status(502).json({ error: `No se pudieron leer las pausas (${rP.status})` })
  const pausas = (await rP.json()) as Pausa[]
  if (!pausas.length) return res.status(200).json({ enviados: 0, pausas: 0 })

  // Se marcan antes de mandar, así dos llamadas seguidas no avisan dos veces
  const ids = pausas.map((p) => p.id)
  await rest(`piso_pausas?id=in.(${ids.join(',')})`, {
    method: 'PATCH',
    body: JSON.stringify({ push_at: new Date().toISOString() }),
    headers: { Prefer: 'return=minimal' },
  })

  const uids = await autorizadores()
  if (!uids.length) return res.status(200).json({ enviados: 0, pausas: pausas.length, autorizadores: 0 })

  const rS = await rest(`push_suscripciones?select=endpoint,usuario_id,p256dh,auth&usuario_id=in.(${uids.join(',')})`)
  if (!rS.ok) return res.status(502).json({ error: `No se pudieron leer las suscripciones (${rS.status})` })
  const subs = (await rS.json()) as Suscripcion[]
  if (!subs.length) return res.status(200).json({ enviados: 0, pausas: pausas.length, suscripciones: 0 })

  /** Un aviso por pausa: si son varias, se resumen */
  const payloadDe = (p: Pausa) =>
    JSON.stringify({
      title: '⏸️ Pausa por autorizar',
      body: `${MOTIVO[p.motivo] ?? p.motivo}${p.local ? ` · ${p.local}` : ''}${p.detalle ? ` · ${p.detalle}` : ''}`,
      url: '/mayorista/pausas',
      urgente: true,
    })

  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'https://hub-mito.vercel.app', pub, priv)
  let enviados = 0
  const vencidas: string[] = []
  const usadas = new Set<string>()
  const envios: Promise<void>[] = []
  for (const p of pausas) {
    const payload = payloadDe(p)
    for (const s of subs) {
      envios.push(
        webpush
          .sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600, urgency: 'high' })
          .then(() => { enviados++; usadas.add(s.endpoint) })
          .catch((e: { statusCode?: number }) => {
            if (e.statusCode === 404 || e.statusCode === 410) vencidas.push(s.endpoint)
          }),
      )
    }
  }
  await Promise.all(envios)
  if (vencidas.length) {
    await rest(`push_suscripciones?endpoint=in.(${vencidas.map((v) => `"${v.replace(/"/g, '')}"`).join(',')})`, { method: 'DELETE' })
  }
  if (usadas.size) {
    await rest(`push_suscripciones?endpoint=in.(${subs.filter((s) => usadas.has(s.endpoint)).map((s) => `"${s.endpoint.replace(/"/g, '')}"`).join(',')})`, {
      method: 'PATCH',
      body: JSON.stringify({ usado_at: new Date().toISOString() }),
      headers: { Prefer: 'return=minimal' },
    })
  }
  return res.status(200).json({ enviados, pausas: pausas.length, autorizadores: uids.length, suscripciones: subs.length, vencidas: vencidas.length })
}
