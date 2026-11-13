/**
 * Mock local de /api/sql/repo-diaria para ver Compras > Repo diaria y Cascada sin desplegar.
 *
 *   1) Puente SQL corriendo (por defecto una copia en :3199:
 *        cd puente-sql && PUENTE_PORT=3199 PUENTE_PROGRAMADOR=0 node server.js)
 *   2) node scripts/mock-repo-diaria.mjs        (escucha en :4176)
 *   3) npm run dev                              (vite proxyea /api/sql/repo-diaria a :4176)
 *
 * Hace lo mismo que src/lib/repoDiariaApi.ts pero sin sesión ni Supabase (parámetros
 * guardados = los de siempre). NUNCA carga en Dragon: el modo 'cargar' se rechaza.
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PUENTE = process.env.PUENTE_URL ?? 'http://localhost:3199/'

function tokenPuente() {
  if (process.env.PUENTE_TOKEN) return process.env.PUENTE_TOKEN
  const archivo = path.join(raiz, 'puente-sql', '.env')
  for (const linea of fs.readFileSync(archivo, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*PUENTE_TOKEN\s*=\s*(.*)\s*$/)
    if (m) return m[1].replace(/^["']|["']$/g, '')
  }
  return ''
}
const token = tokenPuente()

async function alPuente(cuerpo) {
  const r = await fetch(PUENTE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Puente-Token': token },
    body: JSON.stringify(cuerpo),
  })
  return { status: r.status, body: await r.text() }
}

const leer = (req) => new Promise((ok) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => ok(d)) })

http
  .createServer(async (req, res) => {
    const enviar = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(typeof body === 'string' ? body : JSON.stringify(body))
    }
    try {
      const url = new URL(req.url, 'http://x')
      if (req.method === 'GET') {
        const fechas = (url.searchParams.get('fechas') ?? '').split(',').filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f))
        const r = await alPuente({ accion: 'repo_diaria', fechas, forzar: url.searchParams.get('forzar') === '1', params: {} })
        return enviar(r.status, r.body)
      }
      const b = JSON.parse((await leer(req)) || '{}')
      if (b.modo === 'cascada') {
        const r = await alPuente({ accion: 'repo_diaria_cascada', fechas: b.fechas ?? [], foto: b.foto ?? '', params: b.params ?? {} })
        return enviar(r.status, r.body)
      }
      if (b.modo === 'revisar' || b.modo === 'estado') {
        const r = await alPuente({ accion: 'repo_diaria_dragon', modo: b.modo, fechas: b.fechas ?? [], foto: b.foto ?? '' })
        return enviar(r.status, r.body)
      }
      return enviar(400, { error: 'En la vista local no se carga nada en Dragon.' })
    } catch (e) {
      return enviar(502, { error: `Mock repo diaria: ${e.message}` })
    }
  })
  .listen(4176, () => console.log(`Mock /api/sql/repo-diaria en :4176 → ${PUENTE}`))
