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
 */
import vista from '../../src/lib/sqlVista.js'
import status from '../../src/lib/sqlStatus.js'
import catalogo from '../../src/lib/sqlCatalogo.js'

type Req = {
  method?: string
  headers: { authorization?: string }
  query: Record<string, string | string[] | undefined>
}

type Res = {
  status(code: number): Res
  setHeader(name: string, value: string): Res
  json(body: unknown): void
}

/** Los segmentos de la ruta dinámica ([...ruta]) siempre como lista. */
function segmentos(q: string | string[] | undefined): string[] {
  if (Array.isArray(q)) return q
  return q ? [q] : []
}

export default async function handler(req: Req, res: Res) {
  const ruta = segmentos(req.query.ruta)
  const primero = ruta[0] ?? ''

  if (primero === 'status') return status(req, res)
  if (primero === 'catalogo') return catalogo(req, res)

  // Cualquier otro nombre es una vista: se le pasa como ?view= a la lógica de siempre.
  return vista({ ...req, query: { ...req.query, view: primero } }, res)
}
