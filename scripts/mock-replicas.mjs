/**
 * Mock local de GET /api/replicas para desarrollo sin desplegar a Vercel.
 *
 *   1) node scripts/mock-replicas.mjs      (puente SQL corriendo en :3128)
 *   2) npm run dev                         (vite proxyea /api/replicas a :4173)
 *
 * Pega la misma respuesta que api/replicas.ts: llama al Puente SQL con
 * { accion: 'replicas' } (Replicador SQL de la PC central) y agrega `consultado`.
 * Sin el puente responde 502 con el mensaje de error, igual que en producción.
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

async function traerReplicas(token) {
  let res
  try {
    res = await fetch(PUENTE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Puente-Token': token },
      body: JSON.stringify({ accion: 'replicas' }),
    })
  } catch {
    throw new Error('No se pudo contactar el Puente SQL (¿está corriendo en :3128?)')
  }
  const cuerpo = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`Puente SQL: ${cuerpo?.error ?? res.status}`)
  if (!Array.isArray(cuerpo?.replicas)) throw new Error('Respuesta inesperada del Puente SQL')
  return {
    servidor: cuerpo.servidor ?? '',
    replicas: cuerpo.replicas,
    agente: cuerpo.agente ?? { vivo: false, ultimo_latido: null },
    consultado: new Date().toISOString(),
  }
}

const PUERTO = Number(process.env.PUERTO_MOCK ?? 4173)
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
    res.writeHead(200).end(JSON.stringify(await traerReplicas(token)))
  } catch (e) {
    res.writeHead(502).end(JSON.stringify({ error: e.message }))
  }
})

servidor.listen(PUERTO, () => console.log(`mock /api/replicas -> http://localhost:${PUERTO}`))
