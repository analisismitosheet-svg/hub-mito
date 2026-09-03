/**
 * Envía las transferencias de un lote por mail automáticamente.
 *
 * Flujo: PWA (JWT Supabase) -> esta función -> Microsoft Graph API (sendMail) -> cada local
 *
 * La función:
 *  1. Valida el JWT del usuario (debe tener permiso de importar transferencias).
 *  2. Recibe { lote_id } y lee el lote + sus ítems con service role.
 *  3. Agrupa los ítems por ORIGEN (cada hoja = un local origen).
 *  4. Busca el email de los usuarios aprobados cuyo local = origen (con/sin "d"/"2").
 *  5. Envía un mail por local origen con el contenido de su hoja vía Microsoft Graph.
 *     El reply-to se setea al mail del usuario logueado (si el local responde, va directo a él)
 *     y el cuerpo lleva una firma "Enviado por: [nombre] <email>".
 *
 * Variables de entorno en Vercel (sin prefijo VITE_):
 *   SUPABASE_URL                  - proyecto Supabase
 *   SUPABASE_ANON_KEY             - anon (validar JWT)
 *   SUPABASE_SERVICE_ROLE_KEY     - service role (leer lote/items/usuarios)
 *   AZURE_TENANT_ID               - Id. de directorio (inquilino) de Microsoft Entra ID
 *   AZURE_CLIENT_ID               - Id. de aplicación registrada en Entra ID
 *   AZURE_CLIENT_SECRET           - secreto de cliente de la app registrada
 *   MAIL_FROM                     - email remitente de los mails (debe tener permiso Mail.Send)
 */

type Req = {
  method?: string
  headers: { authorization?: string }
  body?: string | Record<string, unknown>
}

type Res = {
  status(code: number): Res
  setHeader(name: string, value: string): Res
  json(body: unknown): void
}

interface TransItem {
  id: string
  lote_id: string
  origen: string | null
  destino: string | null
  articulo: string | null
  descripcion: string | null
  color: string | null
  talle: string | null
  cantidad: number | null
}

interface Lote {
  id: string
  nombre: string | null
  motivo: string | null
  fecha: string | null
}

/** Valida el JWT de Supabase contra /auth/v1/user y devuelve email + nombre del usuario (o null si inválido). */
async function usuarioAutenticado(token: string): Promise<{ email: string; nombre: string } | null> {
  const url = process.env.SUPABASE_URL
  const anon = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !anon) return null
  try {
    const res = await fetch(`${url}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: anon },
    })
    if (!res.ok) return null
    const user = (await res.json()) as {
      email?: string | null
      user_metadata?: Record<string, unknown>
      app_metadata?: Record<string, unknown>
    }
    const email = (user.email ?? '').trim()
    if (!email) return null
    const meta = { ...(user.user_metadata ?? {}), ...(user.app_metadata ?? {}) }
    const nombre = (meta.full_name ?? meta.name ?? meta.nombre ?? '').toString().trim()
    return { email, nombre }
  } catch {
    return null
  }
}

function serviceHeaders(): Record<string, string> | null {
  const url = process.env.SUPABASE_URL
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !service) return null
  return { Authorization: `Bearer ${service}`, apikey: service }
}

/** Alias de local: agrupa nombres que corresponden al mismo local (depósito). El canónico es INDOD. */
const ALIAS_LOCAL: Record<string, string> = {
  DEPO: 'INDOD',
  DEPOSITO: 'INDOD',
  INDO: 'INDOD',
  INDOD: 'INDOD',
}

/** Normaliza el código de un local aplicando los alias (solo afecta depósito). */
function canonLocal(local: string): string {
  return ALIAS_LOCAL[(local ?? '').trim().toUpperCase()] ?? (local ?? '').trim().toUpperCase()
}

/** Variantes de un local para matchear el mail del usuario (con/sin "d"/"2"), sobre el canónico. */
function variantesLocal(local: string): string[] {
  const base = canonLocal(local)
  const out = [base]
  const ayadir = (s: string) => { if (!out.includes(s)) out.push(s) }
  if (base.endsWith('D') && base.length > 1) ayadir(base.slice(0, -1))
  else ayadir(base + 'D')
  if (base.endsWith('2') && base.length > 1) ayadir(base.slice(0, -1))
  else ayadir(base + '2')
  return out
}

/** Contenido del mail para un local origen (matriz artículos -> destinos). */
function construirMail(origen: string, items: TransItem[], lote: Lote): string {
  const destinos = Array.from(new Set(items.map((i) => i.destino ?? '').filter(Boolean))).sort((a, b) => a.localeCompare(b, 'es'))
  const lineas: string[] = []
  lineas.push(`TRANSFERENCIA — ${origen}`)
  lineas.push(`Archivo: ${lote.nombre ?? ''} · ${lote.fecha ?? ''}`)
  lineas.push('')
  lineas.push('ARTICULO          | DESCRIPCION            | COLOR | TALLE | ' + destinos.map((d) => d.padEnd(9)).join('| ') + '| TOTAL')
  lineas.push('-'.repeat(80))
  const porArt = new Map<string, TransItem[]>()
  for (const i of items) {
    const k = [i.articulo ?? '', i.descripcion ?? '', i.color ?? '', i.talle ?? ''].join('¦')
    const a = porArt.get(k) ?? []
    a.push(i)
    porArt.set(k, a)
  }
  for (const [, grup] of porArt) {
    const art = grup[0].articulo ?? ''
    const desc = grup[0].descripcion ?? ''
    const color = grup[0].color ?? ''
    const talle = grup[0].talle ?? ''
    const total = grup.reduce((s, i) => s + (i.cantidad || 1), 0)
    const celdas = destinos.map((d) => {
      const q = grup.filter((i) => i.destino === d).reduce((s, i) => s + (i.cantidad || 1), 0)
      return q ? String(q) : ''
    })
    const fila =
      art.padEnd(16).slice(0, 16) +
      desc.padEnd(20).slice(0, 20) +
      color.padEnd(6).slice(0, 6) +
      talle.padEnd(6).slice(0, 6) +
      celdas.map((c) => c.padStart(9)).join('| ') +
      String(total).padStart(9)
    lineas.push(fila)
  }
  lineas.push('')
  lineas.push(`Total: ${items.reduce((s, i) => s + (i.cantidad || 1), 0)} unidades a ${destinos.length} destinos.`)
  return lineas.join('\n')
}

function graphConfig() {
  const tenant = process.env.AZURE_TENANT_ID
  const client = process.env.AZURE_CLIENT_ID
  const secret = process.env.AZURE_CLIENT_SECRET
  const from = process.env.MAIL_FROM
  if (!tenant || !client || !secret || !from) return null
  return { tenant, client, secret, from }
}

/** Obtiene un access token OAuth de aplicación (client_credentials) para Graph. */
async function obtenerGraphToken(cfg: { tenant: string; client: string; secret: string }): Promise<string | null> {
  const body = new URLSearchParams({
    client_id: cfg.client,
    client_secret: cfg.secret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  })
  try {
    const r = await fetch(`https://login.microsoftonline.com/${cfg.tenant}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
    const j = (await r.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string }
    if (!r.ok) throw new Error(j.error_description || j.error || `Token error ${r.status}`)
    return j.access_token ?? null
  } catch (e) {
    throw new Error(`No se pudo obtener token Graph: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/** Envía un mail vía Microsoft Graph (application permission Mail.Send). replyTo hace que responder vaya al usuario. */
async function enviarMailGraph(
  token: string,
  cfg: { from: string },
  to: string[],
  subject: string,
  text: string,
  replyTo?: string,
): Promise<void> {
  const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(cfg.from)}/sendMail`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: 'text', content: text },
        toRecipients: to.map((email) => ({ emailAddress: { address: email } })),
        ...(replyTo ? { replyTo: [{ emailAddress: { address: replyTo } }] } : {}),
      },
      saveToSentItems: true,
    }),
  })
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { error?: { message?: string } }
    throw new Error(j.error?.message ?? `Graph error ${r.status}`)
  }
}

function leerJson(body: string | Record<string, unknown> | undefined, res: Res): Record<string, unknown> | null {
  if (body == null || body === '') { res.status(400).json({ error: 'Body vacío' }); return null }
  try {
    const obj = typeof body === 'string' ? JSON.parse(body) : body
    if (typeof obj !== 'object' || obj === null) { res.status(400).json({ error: 'JSON inválido' }); return null }
    return obj as Record<string, unknown>
  } catch {
    res.status(400).json({ error: 'JSON inválido' })
    return null
  }
}

export default async function handler(req: Req, res: Res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' })
  }

  const auth = req.headers.authorization ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const autor = await usuarioAutenticado(token)
  if (!autor) {
    return res.status(401).json({ error: 'No autorizado' })
  }

  const body = leerJson(req.body, res)
  if (!body) return

  const loteId = typeof body.lote_id === 'string' ? body.lote_id.trim() : ''
  if (!loteId) return res.status(400).json({ error: 'Falta lote_id' })

  const dryRun = body.dry_run === true || body.dry_run === 'true'

  const headers = serviceHeaders()
  if (!headers) return res.status(500).json({ error: 'Falta configurar SUPABASE_SERVICE_ROLE_KEY' })
  const base = process.env.SUPABASE_URL!

  // Leer lote
  let loteResp: Response
  try {
    loteResp = await fetch(`${base}/rest/v1/transfer_lotes?id=eq.${loteId}&select=id,nombre,motivo,fecha`, { headers })
  } catch {
    return res.status(502).json({ error: 'No se pudo leer el lote' })
  }
  if (!loteResp.ok) return res.status(502).json({ error: 'No se pudo leer el lote' })
  const lote = ((await loteResp.json()) as Lote[])?.[0]
  if (!lote) return res.status(404).json({ error: 'Lote no encontrado' })

  // Leer ítems
  let itemsResp: Response
  try {
    itemsResp = await fetch(`${base}/rest/v1/transfer_items?lote_id=eq.${loteId}&select=id,lote_id,origen,destino,articulo,descripcion,color,talle,cantidad`, { headers })
  } catch {
    return res.status(502).json({ error: 'No se pudieron leer los ítems' })
  }
  if (!itemsResp.ok) return res.status(502).json({ error: 'No se pudieron leer los ítems' })
  const items = (await itemsResp.json()) as TransItem[]

  // Leer usuarios aprobados con local
  let usersResp: Response
  try {
    usersResp = await fetch(`${base}/rest/v1/usuarios?estado=eq.aprobado&select=email,local&local=not.is.null`, { headers })
  } catch {
    return res.status(502).json({ error: 'No se pudieron leer los usuarios' })
  }
  if (!usersResp.ok) return res.status(502).json({ error: 'No se pudieron leer los usuarios' })
  const usuarios = (await usersResp.json()) as { email: string; local: string | null }[]

  // Agrupar por origen
  const porOrigen = new Map<string, TransItem[]>()
  for (const it of items) {
    const o = (it.origen ?? '').trim()
    if (!o) continue
    const a = porOrigen.get(o) ?? []
    a.push(it)
    porOrigen.set(o, a)
  }

  const enviados: string[] = []
  const sinMail: string[] = []
  const errores: string[] = []
  const total = porOrigen.size

  if (total === 0) return res.status(400).json({ error: 'El lote no tiene ítems con origen' })

  // Calcula los destinatarios de cada origen (mismo matcheo que el envío real).
  const detalle = Array.from(porOrigen.entries()).map(([origen, its]) => {
    const variantes = variantesLocal(origen)
    const mails = usuarios
      .filter((u) => u.local && variantes.includes(canonLocal(u.local)))
      .map((u) => u.email)
      .filter((e, i, ar) => e && ar.indexOf(e) === i)
    return { origen, mails, items: its }
  })

  // Modo "solo visión": resuelve los destinatarios sin enviar (para que la UI
  // muestre a quién le llegaría, evitando la RLS de la tabla usuarios del front).
  if (dryRun) {
    return res.status(200).json({
      dry: true,
      destinatarios: detalle.map(({ origen, mails }) => ({ origen, mails, sinMail: mails.length === 0 })),
      conMail: detalle.filter((d) => d.mails.length > 0).map((d) => d.origen),
      sinMail: detalle.filter((d) => d.mails.length === 0).map((d) => d.origen),
      resumen: `Destinos con mail ${detalle.filter((d) => d.mails.length > 0).length}, sin mail ${detalle.filter((d) => d.mails.length === 0).length} de ${total} locales`,
    })
  }

  const cfg = graphConfig()
  if (!cfg) return res.status(500).json({ error: 'Falta configurar Azure AD (tenant/client/secret) o MAIL_FROM' })

  const graphToken = await obtenerGraphToken(cfg)
  if (!graphToken) return res.status(502).json({ error: 'No se pudo autenticar en Microsoft Graph' })

  for (const { origen, mails, items: its } of detalle) {
    if (mails.length === 0) {
      sinMail.push(origen)
      continue
    }

    const contenido = construirMail(origen, its, lote) +
      `\n\n\n---\nEnviado por: ${autor.nombre ? autor.nombre + ' ' : ''}<${autor.email}>\nResponder a este correo irá directo a quien lo envió.`
    try {
      await enviarMailGraph(graphToken, cfg, mails, `TRANSFERENCIA — ${origen} — ${lote.nombre ?? ''}`, contenido, autor.email)
      enviados.push(`${origen}→${mails.join(',')}`)
    } catch (e) {
      errores.push(`${origen}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return res.status(200).json({
    enviados,
    sinMail,
    errores,
    resumen: `Enviados ${enviados.length}, sin mail ${sinMail.length}, errores ${errores.length} de ${total} locales`,
  })
}
