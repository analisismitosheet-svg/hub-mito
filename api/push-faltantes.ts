/**
 * Avisos push de FALTANTES DE STOCK al cerrar un armado (suenan aunque el
 * celular esté bloqueado o la app cerrada).
 *
 *   GET  /api/push-faltantes   -> { publicKey }  (clave VAPID pública para suscribirse)
 *   POST /api/push-faltantes   -> aviso para el armado_id del body: cuando un
 *                                 legajo cierra un armado con faltantes, a
 *                                 los que pueden ver los faltantes (permiso
 *                                 mayorista.faltantes.ver o admin).
 *
 * Flujo: ArmadoPedido llama armado_finalizar y, si quedaron faltantes, POST
 * acá con su JWT ({ armado_id }). Con la service role se leen el armado y sus
 * renglones 'faltante' (sql/mayorista_armados.sql), se resuelven los
 * receptores (permiso mayorista.faltantes.ver o admin) y se manda con
 * web-push. Las suscripciones vencidas (404/410) se borran.
 *
 * Variables de entorno en Vercel: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
 * VAPID_SUBJECT, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY.
 */
import webpush from 'web-push'

type Req = {
  method?: string
  headers: { authorization?: string }
  body?: string
}

type Res = {
  status(code: number): Res
  setHeader(name: string, value: string): Res
  json(body: unknown): void
}

interface Armado {
  id: string
  pedido_codigo: string
  pedido_numero: number | null
  cliente: string | null
  aceptado_legajo: string | null
  aceptado_nombre: string | null
  faltantes: number
}

interface Faltante {
  articulo: string | null
  descripcion: string | null
  color: string | null
  talle: string | null
  cantidad: number
  escaneadas: number
}

interface Suscripcion {
  endpoint: string
  usuario_id: string
  p256dh: string
  auth: string
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

/** Quiénes reciben los avisos de faltantes: admin + permiso directo (o por rol). */
async function receptores(): Promise<string[]> {
  const ids = new Set<string>()
  const rA = await rest('usuarios?select=id&es_admin=eq.true')
  if (rA.ok) for (const u of (await rA.json()) as { id: string }[]) ids.add(u.id)

  const rR = await rest('rol_permisos?select=rol&permiso_clave=eq.mayorista.faltantes.ver')
  if (rR.ok) {
    const roles = (await rR.json()) as { rol: string }[]
    if (roles.length) {
      const lista = roles.map((r) => `"${r.rol.replace(/"/g, '')}"`).join(',')
      const rU = await rest(`usuario_roles?select=usuario_id&rol_codigo=in.(${lista})`)
      if (rU.ok) for (const u of (await rU.json()) as { usuario_id: string }[]) ids.add(u.usuario_id)
    }
  }

  const rP = await rest('usuario_permisos?select=usuario_id,efecto&permiso_clave=eq.mayorista.faltantes.ver')
  if (rP.ok) {
    for (const u of (await rP.json()) as { usuario_id: string; efecto: string }[]) {
      if (u.efecto === 'revoke') ids.delete(u.usuario_id)
      else ids.add(u.usuario_id)
    }
  }
  return [...ids]
}

/** Corta la lista de artículos que faltan para el texto del aviso. */
function resumir(faltantes: Faltante[]): string {
  if (faltantes.length === 0) return ''
  const partes = faltantes.slice(0, 3).map((f) => {
    const falta = Math.max((f.cantidad || 0) - Math.min(f.escaneadas || 0, f.cantidad || 0), 0)
    const nombre = [f.articulo, f.color, f.talle].filter(Boolean).join(' · ') || f.descripcion || 'Artículo'
    return `${nombre} (faltan ${falta})`
  })
  const res = partes.join(' — ')
  return faltantes.length > 3 ? `${res} · y ${faltantes.length - 3} más` : res
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

  let armadoId = ''
  try {
    armadoId = String(JSON.parse(req.body ?? '{}').armado_id ?? '')
  } catch {
    armadoId = ''
  }
  if (!armadoId) return res.status(400).json({ error: 'Falta armado_id' })

  // El armado que se acaba de cerrar: solo se avisa si quedaron faltantes
  const rA = await rest(`mayorista_armados?select=id,pedido_codigo,pedido_numero,cliente,aceptado_legajo,aceptado_nombre,faltantes&id=eq.${armadoId}`)
  if (!rA.ok) return res.status(502).json({ error: `No se pudo leer el armado (${rA.status})` })
  const armados = (await rA.json()) as Armado[]
  const armado = armados[0]
  if (!armado || !armado.faltantes || armado.faltantes <= 0) {
    return res.status(200).json({ enviados: 0, faltantes: 0 })
  }

  const rF = await rest(
    `mayorista_armados_items?select=articulo,descripcion,color,talle,cantidad,escaneadas` +
      `&armado_id=eq.${armadoId}&estado=eq.faltante&order=linea.asc`,
  )
  if (!rF.ok) return res.status(502).json({ error: `No se pudieron leer los faltantes (${rF.status})` })
  const faltantes = (await rF.json()) as Faltante[]

  const uids = await receptores()
  if (!uids.length) return res.status(200).json({ enviados: 0, faltantes: faltantes.length, receptores: 0 })

  const rS = await rest(`push_suscripciones?select=endpoint,usuario_id,p256dh,auth&usuario_id=in.(${uids.join(',')})`)
  if (!rS.ok) return res.status(502).json({ error: `No se pudieron leer las suscripciones (${rS.status})` })
  const subs = (await rS.json()) as Suscripcion[]
  if (!subs.length) return res.status(200).json({ enviados: 0, faltantes: faltantes.length, suscripciones: 0 })

  const quien = armado.aceptado_nombre
    ? ` por ${armado.aceptado_nombre}${armado.aceptado_legajo ? ` (#${armado.aceptado_legajo})` : ''}`
    : ''
  const payload = JSON.stringify({
    title: `⚠️ Faltantes de stock · Pedido N° ${armado.pedido_numero ?? armado.pedido_codigo}`,
    body: `Faltan ${armado.faltantes} u.${quien}. ${resumir(faltantes)}`,
    url: `/mayorista/pedidos-venta?abrir=${encodeURIComponent(armado.pedido_codigo)}`,
    urgente: true,
  })

  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'https://hub-mito.vercel.app', pub, priv)
  let enviados = 0
  const vencidas: string[] = []
  const usadas = new Set<string>()
  const envios: Promise<void>[] = []
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
  return res.status(200).json({ enviados, faltantes: faltantes.length, receptores: uids.length, suscripciones: subs.length, vencidas: vencidas.length })
}