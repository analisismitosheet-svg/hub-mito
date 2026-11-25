/**
 * Mock local de GET /api/sql/flexxus (Administración > Flexxus) para desarrollo.
 *
 *   1) Puente SQL corriendo (el de la PC en :3128, o una copia: PUENTE_URL=http://localhost:3199/)
 *   2) node scripts/mock-flexxus.mjs               (escucha en :4179)
 *   3) npm run dev                                 (vite proxyea /api/sql/flexxus a :4179)
 *
 * Hace lo mismo que src/lib/flexxusApi.ts: { accion: 'flexxus', consulta, desde, hasta } al puente.
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PUENTE = process.env.PUENTE_URL ?? 'http://localhost:3128/'
const PUERTO = Number(process.env.PUERTO_MOCK ?? 4179)

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
    const q = new URL(req.url ?? '/', 'http://x').searchParams
    try {
      const r = await fetch(PUENTE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Puente-Token': token },
        body: JSON.stringify({
          accion: 'flexxus',
          consulta: q.get('consulta'),
          desde: q.get('desde') ?? '',
          hasta: q.get('hasta') ?? '',
          forzar: q.get('forzar') === '1',
        }),
      })
      const cuerpo = await r.json().catch(() => null)
      if (!r.ok || !cuerpo) throw new Error(`Puente SQL: ${cuerpo?.error ?? r.status}`)
      res.end(JSON.stringify(cuerpo))
    } catch (e) {
      res.statusCode = 502
      res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }))
    }
  })
  .listen(PUERTO, () => console.log(`mock flexxus en :${PUERTO} -> ${PUENTE}`))
