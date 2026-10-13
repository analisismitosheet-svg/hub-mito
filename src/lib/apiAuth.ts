/**
 * Autorización de las funciones de Vercel (api/*). Antes varias solo comprobaban que el
 * JWT fuera válido (/auth/v1/user), y como el registro es abierto, una cuenta recién
 * creada ('pendiente') ya podía usarlas. Ahora se le pregunta a la base con el JWT del
 * usuario (RPC public.api_autorizado, sql/seguridad_2026_10.sql): usuario aprobado o admin
 * y, si se pasan claves, con al menos uno de esos permisos.
 *
 * Solo servidor: lo usan las funciones de Vercel y src/lib/sql*.ts.
 */
import { createHash, timingSafeEqual } from 'node:crypto'

/** Token Bearer del header Authorization ('' si no hay). */
export function tokenDe(authorization: string | undefined): string {
  const a = authorization ?? ''
  return a.startsWith('Bearer ') ? a.slice(7).trim() : ''
}

/** ¿El usuario del JWT está aprobado y tiene alguno de los permisos? (sin claves = solo aprobado) */
export async function autorizado(token: string, claves: string[] = []): Promise<boolean> {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const anon = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
  if (!token || !url || !anon) return false
  try {
    const r = await fetch(`${url}/rest/v1/rpc/api_autorizado`, {
      method: 'POST',
      headers: { apikey: anon, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_claves: claves }),
    })
    if (!r.ok) return false
    return (await r.json().catch(() => false)) === true
  } catch {
    return false
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** ¿Es un UUID? (para ids que se pegan en filtros de PostgREST) */
export const esUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)

/** Compara secretos en tiempo constante (con === se puede adivinar de a un carácter midiendo tiempos). */
export function mismoSecreto(a: string, b: string): boolean {
  if (!a || !b) return false
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}
