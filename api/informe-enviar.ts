/**
 * Manda (o previsualiza) un informe del área Sistemas.
 *
 *   POST /api/informe-enviar   { id }                          -> envía el informe guardado
 *   POST /api/informe-enviar   { informe, preview: true }      -> devuelve el texto sin enviar
 *
 * Valida el JWT del usuario y su permiso. Lee el informe con service role y
 * llama al motor de src/lib/informesServidor.
 *
 * Variables de entorno en Vercel (sin prefijo VITE_): SUPABASE_URL,
 * SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, WHATSAPP_TOKEN, WHATSAPP_PHONE_ID.
 */
import { armarCuerpo, enviarInforme, tienePermiso, usuarioDe } from '../src/lib/informesServidor.js'
import type { Informe } from '../src/lib/informes.js'

type Req = {
  method?: string
  headers: { authorization?: string }
  body?: unknown
}

type Res = {
  status(code: number): Res
  setHeader(name: string, value: string): Res
  json(body: unknown): void
}

async function rest(ruta: string, init: RequestInit = {}): Promise<Response> {
  const url = process.env.SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return fetch(`${url}/rest/v1/${ruta}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
}

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

export default async function handler(req: Req, res: Res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })

  const auth = req.headers.authorization ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const uid = token ? await usuarioDe(token) : null
  if (!uid) return res.status(401).json({ error: 'No autorizado' })
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Falta la configuración de Supabase' })
  }

  const datos = cuerpo(req)
  const preview = datos.preview === true

  const permitido = await tienePermiso(token, preview ? ['sistemas.informes.view'] : ['sistemas.informes.edit'])
  if (!permitido) return res.status(403).json({ error: 'No tenés permiso para esta acción' })

  // --- Previsualizar: arma el texto desde el objeto que manda el formulario ---
  if (preview) {
    const informe = datos.informe as Informe | undefined
    if (!informe) return res.status(400).json({ error: 'Falta el informe' })
    try {
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
