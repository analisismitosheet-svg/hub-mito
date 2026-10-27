/**
 * Mock local de GET /api/sql/stock-valorizado para desarrollo sin desplegar a Vercel.
 *
 *   1) node scripts/mock-stock-valorizado.mjs   (puente SQL corriendo en :3128)
 *   2) npm run dev                              (vite proxyea /api/sql/stock-valorizado a :4175)
 *
 * Pega la misma respuesta que src/lib/stockValorizadoApi.ts: llama al Puente SQL
 * con { accion: 'stock_valorizado' } y devuelve el JSON tal cual. Sin el puente
 * responde 502 con el mensaje de error, igual que en producción.
 *
 * Con PUENTE_URL se apunta a otra instancia (p. ej. una de prueba en :3129).
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PUENTE = process.env.PUENTE_URL ?? 'http://localhost:3128/'

/** Token del Puente: el de puente-sql/.env (o PUENTE_TOKEN en el entorno). */
function tokenPuente() {
  if (process.env.PUENTE_TOKEN) return process.env.PUENTE_TOKEN
  const archivo = path.join(raiz, 'puente-sql', '.env')
  if (fs.existsSync(archivo)) {
    for (const linea of fs.readFileSync(archivo, 'utf8').split(/\r?\n/)) {
      const m = linea.match(/^\s*PUENTE_TOKEN\s*=\s*(.*)\s*$/)
      if (m) return m[1].replace(/^["']|["']$/g, '')
    }
  }
  return ''
}

async function traer(token, forzar) {
  let res
  try {
    res = await fetch(PUENTE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Puente-Token': token },
      body: JSON.stringify({ accion: 'stock_valorizado', forzar }),
    })
  } catch {
    throw new Error(`No se pudo contactar el Puente SQL (${PUENTE})`)
  }
  const cuerpo = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`Puente SQL: ${cuerpo?.error ?? res.status}`)
  if (!Array.isArray(cuerpo?.bases)) throw new Error('Respuesta inesperada del Puente SQL')
  return cuerpo
}

const PUERTO = Number(process.env.PUERTO_MOCK ?? 4175)
const token = tokenPuente()

const servidor = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end()
    return
  }
  if (!token) {
    res.writeHead(500).end(JSON.stringify({ error: 'Falta PUENTE_TOKEN (revisá puente-sql/.env)' }))
    return
  }
  try {
    const forzar = /[?&]forzar=1/.test(req.url ?? '')
    res.writeHead(200).end(JSON.stringify(await traer(token, forzar)))
  } catch (e) {
    res.writeHead(502).end(JSON.stringify({ error: e.message }))
  }
})

servidor.listen(PUERTO, () => console.log(`mock /api/sql/stock-valorizado -> http://localhost:${PUERTO}`))
