/**
 * Mock local de GET /api/sql/stock-mayorista (Mayorista > Stock) para desarrollo.
 *
 *   1) Puente SQL corriendo (el de la PC en :3128, o una copia: PUENTE_URL=http://localhost:3199/)
 *   2) node scripts/mock-stock-mayorista.mjs       (escucha en :4178)
 *   3) npm run dev                                 (vite proxyea /api/sql/stock-mayorista a :4178)
 *
 * Hace lo mismo que src/lib/stockMayoristaApi.ts: { accion: 'stock_mayorista' } al puente.
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PUENTE = process.env.PUENTE_URL ?? 'http://localhost:3128/'
const PUERTO = Number(process.env.PUERTO_MOCK ?? 4178)

function tokenPuente() {
  if (process.env.PUENTE_TOKEN) return process.env.PUENTE_TOKEN
  const archivo = path.join(raiz, 'puente-sql', '.env')
  for (const linea of fs.existsSync(archivo) ? fs.readFileSync(archivo, 'utf8').split(/\r?\n/) : []) {
    const m = linea.match(/^\s*PUENTE_TOKEN\s*=\s*(.*)\s*$/)
    if (m) return m[1].replace(/^["']|["']$/g, '')
  }
  return ''
}
const token = tokenPuente()

http
  .createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json')
    const forzar = new URL(req.url ?? '/', 'http://x').searchParams.get('forzar') === '1'
    try {
      const r = await fetch(PUENTE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Puente-Token': token },
        body: JSON.stringify({ accion: 'stock_mayorista', forzar }),
      })
      const cuerpo = await r.json().catch(() => null)
      if (!r.ok || !Array.isArray(cuerpo?.deposito)) throw new Error(`Puente SQL: ${cuerpo?.error ?? r.status}`)
      res.end(JSON.stringify(cuerpo))
    } catch (e) {
      res.statusCode = 502
      res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }))
    }
  })
  .listen(PUERTO, () => console.log(`mock stock-mayorista en :${PUERTO} -> ${PUENTE}`))
