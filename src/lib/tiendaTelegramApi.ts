/**
 * POST /api/sql/tienda-telegram  (clave X-Mayorista-Token, la misma del stock de la tienda)
 *   { telefono, url }  -> manda por el bot del hub (@informes_mito_bot) el link para entrar a la tienda mayorista.
 *
 * Para que la clave no sirva para mandar cualquier cosa: el texto es fijo y el link tiene que ser de la tienda
 * (https://cf-zimith-mayorista.vercel.app/). Solo le llega a quien ya vinculó su número con el bot
 * («Compartir mi número»); la tienda decide qué números pueden pedir link.
 */
import { mismoSecreto } from './apiAuth.js'
import { enviarTelegram, telegramActivo } from './telegram.js'

type Req = { method?: string; headers: Record<string, string | string[] | undefined>; body?: unknown }
type Res = { status(code: number): Res; setHeader(name: string, value: string): Res; json(body: unknown): void }

const TIENDA = 'https://cf-zimith-mayorista.vercel.app/'
const primero = (q: string | string[] | undefined) => (Array.isArray(q) ? String(q[0] ?? '') : q ?? '')

export default async function tiendaTelegram(req: Req, res: Res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })
  const clave = process.env.STOCK_MAYORISTA_TOKEN ?? ''
  if (!clave || !mismoSecreto(primero(req.headers['x-mayorista-token']), clave)) return res.status(401).json({ error: 'No autorizado' })
  if (!telegramActivo()) return res.status(500).json({ error: 'El bot de Telegram no está configurado en el hub' })

  let b: { telefono?: unknown; url?: unknown } = {}
  try {
    b = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body ?? {}) as typeof b
  } catch {
    return res.status(400).json({ error: 'JSON inválido' })
  }
  const telefono = String(b.telefono ?? '').replace(/[^\d+]/g, '')
  const url = String(b.url ?? '')
  if (!/^\+?\d{10,15}$/.test(telefono)) return res.status(400).json({ error: 'Teléfono inválido' })
  if (!url.startsWith(TIENDA) || url.length > 600) return res.status(400).json({ error: 'Link inválido' })

  const r = await enviarTelegram(
    telefono,
    'Tu link para entrar a la tienda mayorista Captain Fin + Zimith. Vence en 10 minutos. Si no lo pediste, ignoralo.',
    null,
    [[{ text: 'Entrar a la tienda', url }]],
  )
  if (r.sinVinculo) return res.status(409).json({ error: 'sin_vinculo' })
  return r.ok ? res.status(200).json({ ok: true }) : res.status(502).json({ error: r.detalle })
}
