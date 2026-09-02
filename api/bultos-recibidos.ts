/**
 * Proxy de lectura: devuelve los números de remito que POLO marcó como
 * RECIBIDO en la app de Transporte, para pintarlos en verde en
 * Facturación Fábrica.
 *
 * Flujo: PWA Mito (JWT Supabase) -> esta función -> edge function de Transporte
 *        (bultos-recibidos) -> Supabase de Transporte (tabla bultos)
 *
 * El endpoint apunta al proyecto de transporte (URL propia + anon key pública)
 * y lleva un secret compartido (MITO_CRUCE_KEY) que la edge function valida.
 * NUNCA se exponen secrets al navegador: solo viajan del server de Mito al server de transporte.
 *
 * Variables de entorno en Vercel (sin prefijo VITE_):
 *   TRANSPORTE_URL                 - URL base Supabase de transporte, ej https://lrizsqpefuprmrwbtbtu.supabase.co
 *   TRANSPORTE_ANON_KEY            - anon key de transporte (pública)
 *   MITO_CRUCE_KEY                 - secret compartido con la edge function de transporte
 */

type Req = {
  method?: string
  headers: { authorization?: string }
}

type Res = {
  status(code: number): Res
  setHeader(name: string, value: string): Res
  json(body: unknown): void
}

/** Valida el JWT de Mito contra /auth/v1/user. */
async function usuarioValido(token: string): Promise<boolean> {
  const url = process.env.SUPABASE_URL
  const anon = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !anon) return false
  try {
    const res = await fetch(`${url}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: anon },
    })
    return res.ok
  } catch {
    return false
  }
}

export default async function handler(req: Req, res: Res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' })
  }

  const auth = req.headers.authorization ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!token || !(await usuarioValido(token))) {
    return res.status(401).json({ error: 'No autorizado' })
  }

  const trUrl = process.env.TRANSPORTE_URL
  const trAnon = process.env.TRANSPORTE_ANON_KEY
  const secret = process.env.MITO_CRUCE_KEY
  if (!trUrl || !trAnon || !secret) {
    return res.status(500).json({ error: 'Falta configurar TRANSPORTE_URL / TRANSPORTE_ANON_KEY / MITO_CRUCE_KEY' })
  }

  try {
    const fnResp = await fetch(`${trUrl.replace(/\/$/, '')}/functions/v1/bultos-recibidos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: trAnon,
        Authorization: `Bearer ${trAnon}`,
        'x-mito-secret': secret,
      },
      body: JSON.stringify({}),
    })
    const body = (await fnResp.json().catch(() => ({}))) as { ok?: boolean; recibidos?: string[]; error?: string }
    if (!fnResp.ok) {
      return res.status(502).json({ error: body.error ?? `Error ${fnResp.status} llamando a transporte` })
    }
    return res.status(200).json({ ok: true, recibidos: body.recibidos ?? [] })
  } catch (e) {
    return res.status(502).json({ error: e instanceof Error ? e.message : String(e) })
  }
}
