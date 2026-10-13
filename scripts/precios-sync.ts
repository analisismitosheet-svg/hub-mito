/**
 * Corrida completa del sync de Comparativa de precios desde una PC (sin el tope de 60 s
 * de Vercel). Misma lógica y mismas RPC que api/precios-sync.ts.
 *
 *   PRECIOS_SYNC_TOKEN=<clave 'precios' del Vault> node scripts/precios-sync.ts [vans]
 *
 * Lee VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY de .env.local / .env.
 */
import { readFileSync } from 'node:fs'
import { leerTanda } from '../src/lib/preciosWeb.ts'

function env(clave: string): string {
  if (process.env[clave]) return process.env[clave] as string
  for (const archivo of ['.env.local', '.env']) {
    try {
      const m = readFileSync(archivo, 'utf8').match(new RegExp(`^${clave}=(.*)$`, 'm'))
      if (m) return m[1].trim().replace(/^["']|["']$/g, '')
    } catch { /* no está */ }
  }
  throw new Error(`Falta ${clave}`)
}

const url = env('VITE_SUPABASE_URL')
const anon = env('VITE_SUPABASE_ANON_KEY')
const token = env('PRECIOS_SYNC_TOKEN')
const marca = process.argv[2] ?? 'vans'

async function rpc(fn: string, cuerpo: Record<string, unknown>) {
  const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: anon, Authorization: `Bearer ${anon}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...cuerpo, p_token: token }),
  })
  const datos = await r.json().catch(() => null)
  if (!r.ok) throw new Error(`${fn}: ${(datos as { message?: string } | null)?.message ?? r.status}`)
  return datos
}

const codigos = (await rpc('precios_web_codigos', { p_marca: marca })) as string[]
console.log(`${codigos.length} códigos para ${marca}`)
const TANDA = 150
let encontrados = 0
for (let desde = 0; desde < codigos.length; desde += TANDA) {
  const { filas, errores, procesados } = await leerTanda(marca, codigos.slice(desde, desde + TANDA))
  encontrados += filas.filter((f) => f.encontrado).length
  await rpc('precios_web_guardar', {
    p_marca: marca, p_filas: filas, p_desde: desde, p_hasta: desde + procesados, p_total: codigos.length, p_errores: errores,
  })
  console.log(`${desde + procesados}/${codigos.length} · encontrados ${encontrados}${errores ? ` · errores ${errores}` : ''}`)
}
