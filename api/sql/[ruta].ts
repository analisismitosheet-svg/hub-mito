/**
 * Proxy de lectura al SQL Server (vía Logic App / Puente SQL), más el estado y el
 * explorador de la conexión. Un solo endpoint para los tres usos de /api/sql/*:
 *
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
 * Y ojo: el rewrite ruta=$1 entrega el segmento URL-encodificado (los ':' del alias de
 * servidor llegan como %3A). Hay que decodeURIComponent antes de comparar la whitelist.
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
 * En el rewrite de Vercel el segmento se inyecta como ruta=$1 y llega URL-encodificado:
 * los ':' del alias de servidor (DESKTOP-OA4GU6I:VISTAS_...) aparecen como %3A, y así
 * no matchean la whitelist ni el regex. Lo decodificamos antes de comparar.
 */
function decodificar(s: string): string {
  if (!s.includes('%')) return s
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

export default async function handler(req: Req, res: Res) {
  // ECHO TEMPORAL de diagnóstico (se quita): muestra qué entrega Vercel en req.query.
  if (primero(req.query.debug) === '1') {
    return res.status(200).json({
      debug: true,
      rutaCruda: req.query.ruta ?? null,
      query: req.query,
      url: (req as unknown as { url?: string }).url ?? null,
    })
  }

  const ruta = decodificar(primero(req.query.ruta))

  if (ruta === 'status') return status(req, res)
  if (ruta === 'catalogo') return catalogo(req, res)

  // Cualquier otro nombre es una vista: se la pasa como ?view= a la lógica de siempre,
  // pero con el MISMO req (jamás un spread: se perdería req.headers y crashearía).
  req.query.view = ruta
  return vista(req, res)
}