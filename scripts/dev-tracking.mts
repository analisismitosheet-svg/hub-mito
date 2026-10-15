/**
 * Solo para desarrollo: sirve api/tracking.ts en :4174 para previsualizar
 * Administradores > Tracking con `npm run dev` (vite hace proxy de /api/tracking).
 * Toma las claves de .env del hub y de ../PWA/transporte-pwa/.env.local.
 * Uso:  npx tsx scripts/dev-tracking.mts
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const leer = (f: string) => Object.fromEntries(
  (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '').split(/\r?\n/).map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map((m) => [m![1], m![2].trim().replace(/^"|"$/g, '')]),
)
const hub = leer(path.resolve('.env'))
const tr = leer(path.resolve('../PWA/transporte-pwa/.env.local'))
process.env.SUPABASE_URL ??= hub.VITE_SUPABASE_URL
process.env.SUPABASE_ANON_KEY ??= hub.VITE_SUPABASE_ANON_KEY
process.env.TRANSPORTE_URL ??= tr.VITE_SUPABASE_URL
process.env.TRANSPORTE_ANON_KEY ??= tr.VITE_SUPABASE_ANON_KEY
process.env.TRANSPORTE_SERVICE_ROLE_KEY ??= tr.SUPABASE_SERVICE_ROLE_KEY

const { default: handler } = await import('../api/tracking.ts')

http.createServer((req, res) => {
  let cuerpo = ''
  req.on('data', (c) => (cuerpo += c))
  req.on('end', async () => {
    const url = new URL(req.url ?? '/', 'http://x')
    let estado = 200
    const r = {
      status(c: number) { estado = c; return r },
      setHeader(k: string, v: string) { res.setHeader(k, v); return r },
      json(b: unknown) { res.writeHead(estado, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)) },
      end() { res.writeHead(estado); res.end() },
    }
    const ct = String(req.headers['content-type'] ?? '')
    const body = ct.includes('json') ? JSON.parse(cuerpo || 'null') : ct.includes('urlencoded') ? Object.fromEntries(new URLSearchParams(cuerpo)) : cuerpo
    await handler({ method: req.method, headers: req.headers, query: Object.fromEntries(url.searchParams), body }, r)
  })
}).listen(4174, () => console.log('api/tracking en http://localhost:4174'))
