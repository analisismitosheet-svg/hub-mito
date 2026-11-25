/**
 * Mock local de GET /api/sql/polo-bulto (Polo 52 > Mapeo de bultos) para desarrollo.
 *
 *   1) npx tsx scripts/mock-polo-bulto.mts         (escucha en :4180)
 *   2) npm run dev                                 (vite proxyea /api/sql/polo-bulto a :4180)
 *
 * Hace lo mismo que src/lib/poloBultoApi.ts (sin chequear la sesión), pero en vez de pasar por el
 * Puente corre puente-sql/poloBulto.js acá mismo con la conexión del puente-sql/.env (solo lectura).
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { parsearBulto } from '../src/lib/poloMapeo.ts'

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PUERTO = Number(process.env.PUERTO_MOCK ?? process.env.PORT ?? 4180)
const requerir = createRequire(path.join(raiz, 'puente-sql', 'server.js'))
const sql = requerir('mssql')
const { accionPoloBulto } = requerir('./poloBulto')

const env: Record<string, string> = {}
for (const l of fs.readFileSync(path.join(raiz, 'puente-sql', '.env'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const [host, puerto] = env.SQL_SERVER.split(/[:,]/)
const pool = new sql.ConnectionPool({
  server: host,
  port: Number(puerto || 1433),
  database: env.SQL_DATABASE,
  user: env.SQL_USER,
  password: env.SQL_PASSWORD,
  options: { encrypt: env.SQL_ENCRYPT === 'true', trustServerCertificate: env.SQL_TRUST_CERT !== 'false' },
})
const srv = { pool, sql }
let conectado: Promise<unknown> | null = null
const asegurar = () => (conectado ??= pool.connect())

http
  .createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json')
    const q = new URL(req.url ?? '/', 'http://x').searchParams
    const p = parsearBulto(q.get('codigo') ?? '')
    if (!p) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'No es un QR de bulto (se espera ORIGEN-NRO-DESTINO)' }))
      return
    }
    try {
      const cuerpo = await accionPoloBulto(srv, asegurar, { origen: p.origen, numeros: p.numeros })
      res.end(JSON.stringify({ ...cuerpo, bulto: p }))
    } catch (e) {
      res.statusCode = 502
      res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }))
    }
  })
  .listen(PUERTO, () => console.log(`mock polo-bulto en :${PUERTO} (Dragon directo)`))
