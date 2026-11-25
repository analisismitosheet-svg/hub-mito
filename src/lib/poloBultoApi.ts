/**
 * Polo 52 > Mapeo de bultos: artículos de un bulto que llegó a Polo 52, en vivo de Dragon.
 *
 *   GET /api/sql/polo-bulto?codigo=<QR del bulto>  -> { remitos, items, aviso?, error? }
 *
 * Parsea el QR (ORIGEN-NRO-DESTINO de Transporte) y le pide al Puente SQL la acción
 * `polo_bulto` (puente-sql/poloBulto.js: MTRANS/DETMTRANS de DRAGONFISH_POLO52). Solo lectura.
 * Vive colgado del router api/sql/[ruta].ts.
 */

import { postAlPuente } from './puenteRetry.js'
import { autorizado, tokenDe } from './apiAuth.js'
import { parsearBulto } from './poloMapeo.js'

type Req = {
  method?: string
  headers: Record<string, string | string[] | undefined>
  query: Record<string, string | string[] | undefined>
}

type Res = {
  status(code: number): Res
  setHeader(name: string, value: string): Res
  json(body: unknown): void
}

const PERMISOS = ['polo52.mapeo.escanear', 'polo52.mapeo.view']

/** URL efectiva del Puente: la guardada en sql_conexion, si no el env. */
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

function primero(q: string | string[] | undefined): string {
  if (Array.isArray(q)) return typeof q[0] === 'string' ? q[0] : ''
  return q ?? ''
}

export default async function handler(req: Req, res: Res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' })

  const token = tokenDe(req.headers.authorization as string | undefined)
  if (!token || !(await autorizado(token, PERMISOS))) return res.status(401).json({ error: 'No autorizado' })

  const p = parsearBulto(primero(req.query.codigo).slice(0, 80))
  if (!p) return res.status(400).json({ error: 'No es un QR de bulto (se espera ORIGEN-NRO-DESTINO)' })

  const destino = await urlDestino()
  if (!destino) return res.status(500).json({ error: 'Falta configurar la URL del Puente SQL' })
  const tokenPuente = process.env.SQL_BRIDGE_TOKEN ?? ''
  if (!tokenPuente) return res.status(500).json({ error: 'Falta la variable SQL_BRIDGE_TOKEN en Vercel' })

  const r0 = await postAlPuente(
    destino,
    {
      headers: { 'Content-Type': 'application/json', 'X-Puente-Token': tokenPuente },
      body: JSON.stringify({ accion: 'polo_bulto', origen: p.origen, numeros: p.numeros }),
    },
    { timeoutMs: 20_000, intentos: 2 },
  )
  if (!r0.ok) {
    return res.status(502).json({
      error: r0.motivo === 'timeout' ? 'El Puente SQL tardó demasiado' : 'No se pudo contactar la PC del SQL (¿está prendida?)',
    })
  }
  const cuerpo = (await r0.res.json().catch(() => null)) as { error?: string; items?: unknown } | null
  if (!r0.res.ok) {
    let detalle = cuerpo?.error ?? `respuesta ${r0.res.status}`
    if (/vista inválida|vista invalida/i.test(detalle)) detalle += ' — Puente SQL desactualizado: hay que reiniciarlo.'
    return res.status(502).json({ error: `Puente SQL: ${detalle}` })
  }
  if (!cuerpo || !Array.isArray(cuerpo.items)) {
    return res.status(502).json({ error: 'Respuesta inesperada del Puente SQL (¿falta reiniciarlo?)' })
  }
  return res.status(200).json({ ...cuerpo, bulto: p })
}
