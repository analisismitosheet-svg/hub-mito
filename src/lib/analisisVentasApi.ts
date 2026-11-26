/**
 * Compras > Análisis ventas (solo admin).
 *
 *   POST /api/sql/analisis-ventas  body: { desde, hasta, comparar, gran, dim, camino, filtros, corte, opciones? }
 *     -> lo que arma el Puente SQL (accion 'analisis_ventas', puente-sql/analisis-ventas.js): KPIs, serie,
 *        día de la semana, tabla «Abrir por», ticket promedio del año y Marcas vs Zimith/Captain Fin.
 *
 * La venta por ticket queda guardada por día en la PC del puente (D:\memoria ia\analisis): la
 * respuesta sale en menos de un segundo, sin ir al SQL. Solo lectura.
 * Permiso 'analisis_ventas.view' (no se le da a ningún rol: entra el admin).
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

const PERMISO = 'analisis_ventas.view'

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

export default async function handler(req: Req, res: Res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })

  const token = tokenDe(req.headers.authorization as string | undefined)
  if (!token || !(await autorizado(token, [PERMISO]))) return res.status(401).json({ error: 'No autorizado' })

  const destino = await urlDestino()
  if (!destino) return res.status(500).json({ error: 'Falta configurar la URL del Puente SQL' })
  const tokenPuente = process.env.SQL_BRIDGE_TOKEN ?? ''
  if (!tokenPuente) return res.status(500).json({ error: 'Falta la variable SQL_BRIDGE_TOKEN en Vercel' })

  let body: Record<string, unknown> = {}
  try {
    body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {}) as Record<string, unknown>
  } catch {
    return res.status(400).json({ error: 'Cuerpo inválido' })
  }
  // Solo los campos conocidos viajan al puente (el puente los vuelve a validar)
  const pedido = {
    accion: 'analisis_ventas',
    desde: body.desde,
    hasta: body.hasta,
    comparar: body.comparar,
    gran: body.gran,
    dim: body.dim,
    camino: body.camino,
    filtros: body.filtros,
    corte: body.corte,
    opciones: body.opciones === true,
  }

  const r0 = await postAlPuente(
    destino,
    { headers: { 'Content-Type': 'application/json', 'X-Puente-Token': tokenPuente }, body: JSON.stringify(pedido) },
    { timeoutMs: 40_000, intentos: 2 },
  )
  if (!r0.ok) {
    return res.status(502).json({
      error: r0.motivo === 'timeout' ? 'El Puente SQL tardó demasiado' : 'No se pudo contactar el Puente SQL de la PC central',
    })
  }
  const cuerpo = (await r0.res.json().catch(() => null)) as { error?: string; estado?: string } | null
  if (!r0.res.ok || !cuerpo) {
    let detalle = cuerpo?.error ?? `respuesta ${r0.res.status}`
    if (/vista inválida|vista invalida/i.test(detalle)) detalle += ' — Puente SQL desactualizado: hay que reiniciarlo (acción "analisis_ventas").'
    return res.status(502).json({ error: `Puente SQL: ${detalle}` })
  }
  return res.status(200).json(cuerpo)
}
