/**
 * Avisos push de ARMADO DE PEDIDOS al celular de los legajos (suena aunque el
 * celular esté bloqueado o la app cerrada).
 *
 *   GET  /api/push-armado   -> { publicKey }  (clave VAPID pública para suscribirse)
 *   POST /api/push-armado   -> manda el aviso de los armados pendientes que pidió
 *                              el usuario del JWT y todavía no se avisaron (push_at)
 *
 * Flujo: Pedidos de venta llama pedir_armado y después POST acá con su JWT.
 * Con la service role se leen los armados y las suscripciones (sql/push_suscripciones.sql)
 * y se manda con web-push. Las suscripciones vencidas (404/410) se borran.
 *
 * Variables de entorno en Vercel: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT,
 * SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY.
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

interface Armado {
  id: string
  pedido_numero: number | null
  pedido_codigo: string
  cliente: string | null
  cliente_nombre: string | null
  prioridad: 'urgente' | 'normal' | 'baja'
  asignado_legajo: string | null
}

interface Suscripcion {
  endpoint: string
  usuario_id: string
  p256dh: string
  auth: string
}

const PRIORIDAD: Record<string, string> = { urgente: '🔴 URGENTE', normal: '🟡 Normal', baja: '🟢 Baja' }

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

  // Armados pendientes que pidió este usuario y todavía no se avisaron (últimas 2 h)
  const desde = new Date(Date.now() - 2 * 3600_000).toISOString()
  const rA = await rest(
    `mayorista_armados?select=id,pedido_numero,pedido_codigo,cliente,cliente_nombre,prioridad,asignado_legajo` +
      `&estado=eq.pendiente&push_at=is.null&creado_por=eq.${uid}&creado_at=gte.${desde}&order=creado_at.asc`,
  )
  if (!rA.ok) return res.status(502).json({ error: `No se pudieron leer los armados (${rA.status})` })
  const armados = (await rA.json()) as Armado[]
  if (!armados.length) return res.status(200).json({ enviados: 0, armados: 0 })

  // Se marcan antes de mandar, así dos llamadas seguidas no avisan dos veces
  const ids = armados.map((a) => a.id)
  await rest(`mayorista_armados?id=in.(${ids.join(',')})`, {
    method: 'PATCH',
    body: JSON.stringify({ push_at: new Date().toISOString() }),
    headers: { Prefer: 'return=minimal' },
  })

  const rS = await rest('push_suscripciones?select=endpoint,usuario_id,p256dh,auth')
  if (!rS.ok) return res.status(502).json({ error: `No se pudieron leer las suscripciones (${rS.status})` })
  const subs = (await rS.json()) as Suscripcion[]

  // Legajo de cada usuario suscripto: los armados asignados al responsable del local
  // (sql/armado_responsable.sql) le llegan solo a él; los sin asignar, a todos.
  const legajoDe = new Map<string, string>()
  const uids = [...new Set(subs.map((x) => x.usuario_id))]
  if (uids.length) {
    const rU = await rest(`usuarios?select=id,legajo&id=in.(${uids.join(',')})`)
    if (rU.ok) for (const u of (await rU.json()) as { id: string; legajo: string | null }[]) legajoDe.set(u.id, String(u.legajo ?? '').trim())
  }
  const grupos = new Map<string, Armado[]>() // '' = sin asignar
  for (const a of armados) {
    const k = String(a.asignado_legajo ?? '').trim()
    grupos.set(k, [...(grupos.get(k) ?? []), a])
  }

  /** Un aviso por tanda: si es uno, el detalle; si son varios, el resumen */
  const aviso = (lista: Armado[]) => {
    const a0 = lista[0]
    const urgente = lista.some((a) => a.prioridad === 'urgente')
    return JSON.stringify(
      lista.length === 1
        ? {
            title: `🔔 Pedido N° ${a0.pedido_numero ?? a0.pedido_codigo} a armar`,
            body: `${PRIORIDAD[a0.prioridad] ?? ''} · ${a0.cliente_nombre || a0.cliente || 'Cliente'}`,
            url: '/mayorista/mi-repo',
            urgente,
          }
        : {
            title: `🔔 ${lista.length} pedidos a armar`,
            body: lista.map((a) => `N° ${a.pedido_numero ?? a.pedido_codigo}`).join(' · '),
            url: '/mayorista/mi-repo',
            urgente,
          },
    )
  }

  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'https://hub-mito.vercel.app', pub, priv)
  let enviados = 0
  const vencidas: string[] = []
  const usadas = new Set<string>()
  const envios: Promise<void>[] = []
  for (const [legajo, lista] of grupos) {
    const payload = aviso(lista)
    for (const s of subs) {
      if (legajo && legajoDe.get(s.usuario_id) !== legajo) continue
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
  return res.status(200).json({ enviados, armados: armados.length, suscripciones: subs.length, vencidas: vencidas.length })
}
