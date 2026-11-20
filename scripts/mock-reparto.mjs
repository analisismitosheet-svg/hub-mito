/**
 * Mock local de /api/sql/reparto para ver Reposiciones / Transferencias > Reparto manual sin desplegar.
 *
 *   1) Copia del Puente SQL en :3199 (launch.json «puente-copia»: PUENTE_PORT=3199 PUENTE_PROGRAMADOR=0)
 *   2) node scripts/mock-reparto.mjs            (escucha en :4177)
 *   3) npm run dev                              (vite proxyea /api/sql/reparto a :4177)
 *
 * Hace lo mismo que src/lib/repartoApi.ts pero sin sesión. Solo lectura: el Puente solo lee.
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PUENTE = process.env.PUENTE_URL ?? 'http://localhost:3199/'

function tokenPuente() {
  if (process.env.PUENTE_TOKEN) return process.env.PUENTE_TOKEN
  for (const linea of fs.readFileSync(path.join(raiz, 'puente-sql', '.env'), 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*PUENTE_TOKEN\s*=\s*(.*)\s*$/)
    if (m) return m[1].replace(/^["']|["']$/g, '')
  }
  return ''
}
const token = tokenPuente()
const leer = (req) => new Promise((ok) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => ok(d)) })

http
  .createServer(async (req, res) => {
    const enviar = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(typeof body === 'string' ? body : JSON.stringify(body))
    }
    try {
      let cuerpo
      if (req.method === 'GET') cuerpo = /[?&]articulos=/.test(req.url ?? '') ? { accion: 'reparto_opciones', articulos: true } : { accion: 'reparto_opciones' }
      else {
        const b = JSON.parse((await leer(req)) || '{}')
        cuerpo = b.dragon
          ? { accion: 'reparto_dragon', modo: b.modo, motivo: b.motivo, obs: b.obs, pedidos: b.pedidos, confirmo: b.confirmo }
          : { accion: 'reparto_stock', filtros: b.filtros ?? {}, desde: b.desde ?? '', hasta: b.hasta ?? '', forzar: !!b.forzar }
      }
      const r = await fetch(PUENTE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Puente-Token': token },
        body: JSON.stringify(cuerpo),
      })
      return enviar(r.status, await r.text())
    } catch (e) {
      return enviar(502, { error: `Mock reparto: ${e.message}` })
    }
  })
  .listen(4177, () => console.log(`Mock /api/sql/reparto en :4177 → ${PUENTE}`))
