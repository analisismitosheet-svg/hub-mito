/**
 * Mock local de POST /api/sql/analisis-ventas (Compras > Análisis ventas) para desarrollo.
 *
 *   1) Puente SQL corriendo (el de la PC en :3128, o una copia: PUENTE_URL=http://localhost:3199/)
 *   2) node scripts/mock-analisis-ventas.mjs        (escucha en :4181)
 *   3) npm run dev                                  (vite proxyea /api/sql/analisis-ventas a :4181)
 *
 * Hace lo mismo que src/lib/analisisVentasApi.ts (sin revisar la sesión): { accion: 'analisis_ventas', ... } al puente.
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PUENTE = process.env.PUENTE_URL ?? 'http://localhost:3128/'
const PUERTO = Number(process.env.PUERTO_MOCK ?? 4181)

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
    // CORS solo para desarrollo (pantalla en otro puerto de localhost)
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type')
    if (req.method === 'OPTIONS') return res.end()
    let cuerpo = ''
    for await (const c of req) cuerpo += c
    try {
      const body = JSON.parse(cuerpo || '{}')
      const r = await fetch(PUENTE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Puente-Token': token },
        body: JSON.stringify({ ...body, accion: 'analisis_ventas' }),
      })
      res.statusCode = r.ok ? 200 : 502
      res.end(await r.text())
    } catch (e) {
      res.statusCode = 502
      res.end(JSON.stringify({ error: `Puente SQL: ${e.message}` }))
    }
  })
  .listen(PUERTO, () => console.log(`mock analisis-ventas en http://localhost:${PUERTO} -> ${PUENTE}`))
