/**
 * Proxy de lectura al SQL Server (vía Logic App / Puente SQL), más el estado y el
 * explorador de la conexión. Un solo endpoint para los tres usos de /api/sql/*:
 *
 *   GET /api/sql/ping                          -> { ok }: el puente responde desde afuera (vigilante)
 *   GET /api/sql/status                        -> estado de la conexión (Configuraciones > Conexión SQL)
 *   GET /api/sql/catalogo?...                  -> explorador de bases/objetos (solo admins)
 *   GET /api/sql/<vista>[?where=&value=&limit=] -> filas de una vista habilitada
 *
 * Antes eran tres funciones (sql/[view], sql/status, sql/catalogo); se unificaron para
 * no pasar el tope de 12 Serverless Functions del plan Hobby de Vercel. La lógica de
 * cada una vive en src/lib/sqlVista.ts, src/lib/sqlStatus.ts y src/lib/sqlCatalogo.ts.
 *
 * Ojo con Vercel (lección aprendida 2026-10): usar catch-all `[...ruta].ts` NO anda —
 * Vercel no puebla req.query con el segmento de un catch-all en /api, así que todo
 * caía en la rama de "vista" y daba 500. Con `[ruta].ts` (segmento dinámico simple,
 * como el viejo [view].ts) Vercel sí deja el segmento en req.query.ruta.
 * Además NO construir el req de la vista con spread ({ ...req }): el req del runtime
 * tiene propiedades no enumerables (headers) que el spread pierde, y sqlVista explota.
 * Se reutiliza el mismo req y solo se setea req.query.view.
 */
import vista from '../../src/lib/sqlVista.js'
import status from '../../src/lib/sqlStatus.js'
import catalogo from '../../src/lib/sqlCatalogo.js'

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

/** El segmento de [ruta]: string o lista, según cómo lo entregue el runtime. */
function primero(q: string | string[] | undefined): string {
  if (Array.isArray(q)) return typeof q[0] === 'string' ? q[0] : ''
  return q ?? ''
}

/**
 * GET /api/sql/ping -> { ok } : ¿el puente responde desde afuera? (Vercel -> Funnel -> puente)
 * Sin datos ni secretos, sin sesión: lo usa el vigilante de la PC del puente
 * (puente-sql/scripts/vigilante.ps1) para detectar el Funnel caído y reactivarlo.
 */
async function ping(res: Res) {
  res.setHeader('Cache-Control', 'no-store')
  const url = process.env.SUPABASE_URL
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
  let destino = process.env.SQL_LOGICAPP_URL?.trim() || ''
  if (url && service) {
    try {
      const r = await fetch(`${url}/rest/v1/sql_conexion?id=eq.1&select=logicapp_url`, {
        headers: { Authorization: `Bearer ${service}`, apikey: service },
      })
      const filas = (await r.json().catch(() => null)) as Array<{ logicapp_url?: string | null }> | null
      destino = filas?.[0]?.logicapp_url?.trim() || destino
    } catch {
      /* respaldo: env */
    }
  }
  if (!destino) return res.status(500).json({ ok: false })
  // La URL guardada termina en /health (o se le agrega): GET sin token
  const salud = /\/health\/?$/.test(destino) ? destino : destino.replace(/\/?$/, '/health')
  try {
    const r = await fetch(salud, { signal: AbortSignal.timeout(8000) })
    return res.status(r.ok ? 200 : 502).json({ ok: r.ok })
  } catch {
    return res.status(504).json({ ok: false })
  }
}

export default async function handler(req: Req, res: Res) {
  const ruta = primero(req.query.ruta)

  if (ruta === 'ping') return ping(res)

  if (ruta === 'status') return status(req, res)
  if (ruta === 'catalogo') return catalogo(req, res)

  // Cualquier otro nombre es una vista: se la pasa como ?view= a la lógica de siempre,
  // pero con el MISMO req (jamás un spread: se perdería req.headers y crashearía).
  req.query.view = ruta
  return vista(req, res)
}