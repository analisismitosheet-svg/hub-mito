/**
 * Comparativa de precios: lee los precios de la web de la marca y los guarda en
 * public.precios_web. Va POR TANDAS porque son ~1700 códigos y la función corta a los 60 s:
 *
 *   POST /api/precios-sync?marca=vans&desde=0     -> lee desde el código 0 hasta donde
 *        llegue en ~42 s y responde { desde, hasta, total, ... }; se vuelve a llamar con
 *        desde=hasta hasta que hasta >= total.
 *
 * Quién puede:
 *   - el botón "Actualizar ahora" (admin): Authorization: Bearer <JWT de Supabase>
 *   - el cron semanal (pg_cron + pg_net en Supabase): header X-Sync-Token con la clave
 *     de sync 'precios' (guardada en el Vault; en la base solo está el hash).
 * La validación la hacen las RPC (private.precios_sync_ok): acá no hay service role, así
 * que alcanza con la URL y la anon key, que también están en los previews.
 *
 * La lectura de la web está en src/lib/preciosWeb.ts (la misma que usa scripts/precios-sync.ts).
 */
import { MARCAS, leerTanda } from '../src/lib/preciosWeb.js'

type Req = {
  method?: string
  headers: { authorization?: string; 'x-sync-token'?: string }
  query?: Record<string, string | string[] | undefined>
}

type Res = {
  status(code: number): Res
  setHeader(name: string, value: string): Res
  json(body: unknown): void
}

/** Tiempo para leer la web; el resto queda para traer los códigos y guardar. */
const PRESUPUESTO_MS = 42_000

const uno = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''

export default async function handler(req: Req, res: Res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })
  const inicio = Date.now()

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const anon = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !anon) return res.status(500).json({ error: 'Falta la configuración de Supabase en Vercel' })

  const marca = uno(req.query?.marca) || 'vans'
  if (!MARCAS[marca]) return res.status(400).json({ error: `Marca no soportada: ${marca}` })
  const desde = Math.max(0, Number(uno(req.query?.desde)) || 0)

  const jwt = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
  const claveSync = req.headers['x-sync-token'] ?? null
  if (!jwt && !claveSync) return res.status(401).json({ error: 'No autorizado' })

  const rpc = async (fn: string, cuerpo: Record<string, unknown>) => {
    const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: anon,
        Authorization: `Bearer ${jwt || anon}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...cuerpo, p_token: claveSync }),
    })
    const datos = (await r.json().catch(() => null)) as unknown
    if (!r.ok) {
      const msg = (datos as { message?: string } | null)?.message ?? `Error ${r.status}`
      throw Object.assign(new Error(msg), { status: /autorizado/i.test(msg) ? 401 : 502 })
    }
    return datos
  }

  try {
    const codigos = (await rpc('precios_web_codigos', { p_marca: marca })) as string[]
    const total = codigos.length
    const tanda = codigos.slice(desde)
    const { filas, errores, procesados } = await leerTanda(marca, tanda, inicio + PRESUPUESTO_MS)
    const hasta = desde + procesados
    const sync = await rpc('precios_web_guardar', {
      p_marca: marca, p_filas: filas, p_desde: desde, p_hasta: hasta, p_total: total, p_errores: errores,
    })
    return res.status(200).json({
      ok: true, desde, hasta, total, fin: hasta >= total,
      encontrados: filas.filter((f) => f.encontrado).length, errores, sync,
    })
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500
    return res.status(status).json({ error: e instanceof Error ? e.message : 'Error leyendo precios' })
  }
}
