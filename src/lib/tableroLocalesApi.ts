/**
 * Administración > Tablero locales (permiso 'tablero_locales.view'; el admin entra siempre).
 *
 *   POST /api/sql/tablero-locales  body:
 *     { hoja: 'caja',      desde, hasta, locales? }  -> por local: venta por día, valores, vendedores,
 *                                                       comprobantes de caja, arqueos, cierres + objetivos del hub
 *     { hoja: 'billetes',  local, arqueo }           -> billetes de un arqueo
 *     { hoja: 'errores',   desde, hasta, locales? }  -> cobros por comprobante de todos los locales pedidos
 *     { hoja: 'articulos', local, codigo }           -> renglones de un comprobante
 *
 * Los datos salen en vivo de la base Dragonfish de cada local por el Puente SQL
 * (accion 'tablero_locales', puente-sql/tablero-locales.js). Solo lectura.
 * Los objetivos se leen acá con la service role (RPC objetivos_locales_dia), así los ve
 * cualquiera con este permiso aunque no tenga el de Objetivos.
 */
import { postAlPuente } from './puenteRetry.js'
import { autorizado, tokenDe } from './apiAuth.js'

type Req = {
  method?: string
  headers: Record<string, string | string[] | undefined>
  body?: unknown
}

type Res = {
  status(code: number): Res
  setHeader(name: string, value: string): Res
  json(body: unknown): void
}

const PERMISO = 'tablero_locales.view'
const HOJAS = ['caja', 'billetes', 'errores', 'articulos'] as const
const FECHA = /^\d{4}-\d{2}-\d{2}$/
const COD = /^[A-Za-z0-9 _.-]{1,40}$/

async function urlDestino(): Promise<string> {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (url && service) {
    try {
      const res = await fetch(`${url}/rest/v1/sql_conexion?id=eq.1&select=logicapp_url`, {
        headers: { Authorization: `Bearer ${service}`, apikey: service },
      })
      if (res.ok) {
        const filas = (await res.json().catch(() => null)) as Array<{ logicapp_url?: string | null }> | null
        const deDb = filas?.[0]?.logicapp_url?.trim()
        if (deDb) return deDb
      }
    } catch {
      /* sigue con el env */
    }
  }
  return process.env.SQL_LOGICAPP_URL ?? ''
}

/** Objetivos de todos los locales en el rango: [{ local, fecha, objetivo }]. Si falla, vacío. */
async function objetivos(desde: string, hasta: string): Promise<Array<{ local: string; fecha: string; objetivo: number | null }>> {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !service) return []
  try {
    const res = await fetch(`${url}/rest/v1/rpc/objetivos_locales_dia`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${service}`, apikey: service, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_desde: desde, p_hasta: hasta }),
    })
    if (!res.ok) return []
    const filas = (await res.json().catch(() => null)) as Array<{ local?: string; fecha?: string; objetivo?: number | string | null }> | null
    return (filas ?? []).map((f) => ({
      local: String(f.local ?? '').toUpperCase(),
      fecha: String(f.fecha ?? '').slice(0, 10),
      objetivo: f.objetivo == null ? null : Number(f.objetivo),
    }))
  } catch {
    return []
  }
}

export default async function handler(req: Req, res: Res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })

  const token = tokenDe(req.headers.authorization as string | undefined)
  if (!token || !(await autorizado(token, [PERMISO]))) return res.status(401).json({ error: 'No autorizado' })

  let body: Record<string, unknown> = {}
  try {
    body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {}) as Record<string, unknown>
  } catch {
    return res.status(400).json({ error: 'Cuerpo inválido' })
  }
  const hoja = String(body.hoja ?? '') as (typeof HOJAS)[number]
  if (!HOJAS.includes(hoja)) return res.status(400).json({ error: 'Hoja inválida' })

  // Solo los campos conocidos viajan al puente (el puente los vuelve a validar)
  const pedido: Record<string, unknown> = { accion: 'tablero_locales', hoja }
  if (hoja === 'caja' || hoja === 'errores') {
    const desde = String(body.desde ?? '')
    const hasta = String(body.hasta ?? '')
    if (!FECHA.test(desde) || !FECHA.test(hasta)) return res.status(400).json({ error: 'Faltan las fechas desde/hasta (AAAA-MM-DD)' })
    const locales = Array.isArray(body.locales) ? body.locales.map(String).filter((l) => COD.test(l)).slice(0, 40) : []
    Object.assign(pedido, { desde, hasta, locales })
  } else {
    const local = String(body.local ?? '')
    const clave = hoja === 'billetes' ? 'arqueo' : 'codigo'
    const valor = String(body[clave] ?? '')
    if (!COD.test(local) || !COD.test(valor)) return res.status(400).json({ error: 'Pedido inválido' })
    Object.assign(pedido, { local, [clave]: valor })
  }

  const destino = await urlDestino()
  if (!destino) return res.status(500).json({ error: 'Falta configurar la URL del Puente SQL' })
  const tokenPuente = process.env.SQL_BRIDGE_TOKEN ?? ''
  if (!tokenPuente) return res.status(500).json({ error: 'Falta la variable SQL_BRIDGE_TOKEN en Vercel' })

  const [r0, objs] = await Promise.all([
    postAlPuente(
      destino,
      { headers: { 'Content-Type': 'application/json', 'X-Puente-Token': tokenPuente }, body: JSON.stringify(pedido) },
      { timeoutMs: 45_000, intentos: 2 },
    ),
    hoja === 'caja' ? objetivos(String(pedido.desde), String(pedido.hasta)) : Promise.resolve([]),
  ])
  if (!r0.ok) {
    return res.status(502).json({
      error: r0.motivo === 'timeout' ? 'El Puente SQL tardó demasiado' : 'No se pudo contactar el Puente SQL de la PC central',
    })
  }
  const cuerpo = (await r0.res.json().catch(() => null)) as Record<string, unknown> | null
  if (!r0.res.ok || !cuerpo) {
    let detalle = (cuerpo as { error?: string } | null)?.error ?? `respuesta ${r0.res.status}`
    if (/vista inválida|vista invalida/i.test(detalle)) detalle += ' — Puente SQL desactualizado: hay que reiniciarlo (acción "tablero_locales").'
    return res.status(502).json({ error: `Puente SQL: ${detalle}` })
  }
  return res.status(200).json(hoja === 'caja' ? { ...cuerpo, objetivos: objs } : cuerpo)
}
