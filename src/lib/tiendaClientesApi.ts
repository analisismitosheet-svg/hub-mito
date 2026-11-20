/**
 * POST /api/sql/tienda-clientes  (clave X-Mayorista-Token, la de la tienda; la tienda controla quién es admin)
 *   { accion: 'registrar', telefono, comercio, contacto, cuit?, mail?, localidad? }
 *        -> alta PENDIENTE (si el número ya estaba, devuelve su estado) + aviso por Telegram a los admins
 *   { accion: 'estado', telefono }     -> la ficha de ese número (o null)
 *   { accion: 'listar' }               -> todas (pendientes primero)
 *   { accion: 'actualizar', id, estado?, marcas?, codigo_dragon?, por? } -> la ficha actualizada
 * Tabla public.tienda_clientes (sql/tienda_clientes.sql): cerrada, solo service_role.
 */
import { mismoSecreto } from './apiAuth.js'
import { claveTelefono } from './informes.js'
import { chatDe, enviarTelegram, telegramActivo } from './telegram.js'

type Req = { method?: string; headers: Record<string, string | string[] | undefined>; body?: unknown }
type Res = { status(code: number): Res; setHeader(name: string, value: string): Res; json(body: unknown): void }

const TIENDA = 'https://cf-zimith-mayorista.vercel.app/'
/** A quién avisar cuando se registra alguien (Telegram). */
const ADMINS = () => (process.env.TIENDA_ADMINS_TELEGRAM || '+543512400630').split(',').map((x) => x.trim()).filter(Boolean)
const MARCAS = new Set(['captainfin', 'zimith'])
const LISTAS: Record<string, string[]> = { captainfin: ['PR MAYORISTA', 'IMPORTADO', 'URUGUAY', 'RELOJES'], zimith: ['PR MAYORISTA'] }
const COLUMNAS = 'id,telefono,comercio,contacto,cuit,mail,localidad,estado,codigo_dragon,marcas,creado_at,revisado_at,revisado_por'

const primero = (q: string | string[] | undefined) => (Array.isArray(q) ? String(q[0] ?? '') : q ?? '')
const texto = (v: unknown, max: number) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max)

function rest(ruta: string, init: RequestInit = {}): Promise<Response> {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Falta SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  return fetch(`${url}/rest/v1/${ruta}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
}

async function porTelefono(tel: string) {
  const r = await rest(`tienda_clientes?select=${COLUMNAS}&telefono=eq.${tel}`)
  const filas = (await r.json().catch(() => [])) as unknown[]
  return filas[0] ?? null
}

export default async function tiendaClientes(req: Req, res: Res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })
  const clave = process.env.STOCK_MAYORISTA_TOKEN ?? ''
  if (!clave || !mismoSecreto(primero(req.headers['x-mayorista-token']), clave)) return res.status(401).json({ error: 'No autorizado' })
  let b: Record<string, unknown> = {}
  try {
    b = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body ?? {}) as Record<string, unknown>
  } catch {
    return res.status(400).json({ error: 'JSON inválido' })
  }

  if (b.accion === 'registrar' || b.accion === 'estado') {
    const tel = claveTelefono(String(b.telefono ?? ''))
    if (!/^\d{10,15}$/.test(tel)) return res.status(400).json({ error: 'Teléfono inválido' })
    const ya = await porTelefono(tel)
    if (b.accion === 'estado') return res.status(200).json({ cliente: ya })
    const vinculado = telegramActivo() ? (await chatDe(tel).catch(() => null)) !== null : false
    if (ya) return res.status(200).json({ cliente: ya, existente: true, vinculado })

    const comercio = texto(b.comercio, 80)
    const contacto = texto(b.contacto, 80)
    const cuit = String(b.cuit ?? '').replace(/\D/g, '')
    const mail = texto(b.mail, 120)
    const localidad = texto(b.localidad, 80)
    if (comercio.length < 2 || contacto.length < 2) return res.status(400).json({ error: 'Faltan el nombre del comercio y el de contacto' })
    if (cuit && cuit.length !== 11) return res.status(400).json({ error: 'El CUIT tiene 11 números' })
    if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return res.status(400).json({ error: 'Mail inválido' })
    const r = await rest('tienda_clientes', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ telefono: tel, comercio, contacto, cuit: cuit || null, mail: mail || null, localidad: localidad || null }),
    })
    if (!r.ok) return res.status(502).json({ error: 'No se pudo guardar el registro' })
    const [nuevo] = (await r.json()) as unknown[]
    // aviso a los admins (si falla, el registro igual queda)
    if (telegramActivo()) {
      const aviso = `Nuevo cliente para la tienda mayorista: ${comercio} (${contacto})${localidad ? ' · ' + localidad : ''} · Telegram +${tel}${cuit ? ' · CUIT ' + cuit : ''}. Entrá a la tienda como admin → Permisos para aprobarlo y elegir las marcas.`
      await Promise.all(ADMINS().map((a) => enviarTelegram(a, aviso, null, [[{ text: 'Abrir la tienda', url: TIENDA }]]).catch(() => null)))
    }
    return res.status(200).json({ cliente: nuevo, existente: false, vinculado })
  }

  if (b.accion === 'listar') {
    const r = await rest(`tienda_clientes?select=${COLUMNAS}&order=estado.desc,creado_at.desc&limit=1000`)
    if (!r.ok) return res.status(502).json({ error: 'No se pudo leer la base' })
    return res.status(200).json({ clientes: await r.json() })
  }

  if (b.accion === 'actualizar') {
    const id = String(b.id ?? '')
    if (!/^[0-9a-f-]{36}$/.test(id)) return res.status(400).json({ error: 'id inválido' })
    const cambios: Record<string, unknown> = { revisado_at: new Date().toISOString(), revisado_por: texto(b.por, 60) || null }
    if (b.estado !== undefined) {
      if (!['pendiente', 'aprobado', 'rechazado'].includes(String(b.estado))) return res.status(400).json({ error: 'Estado inválido' })
      cambios.estado = b.estado
    }
    if (b.codigo_dragon !== undefined) {
      const c = String(b.codigo_dragon ?? '').trim()
      if (c && !/^[A-Za-z0-9]{1,10}$/.test(c)) return res.status(400).json({ error: 'Código de Dragon inválido' })
      cambios.codigo_dragon = c || null
    }
    if (b.marcas !== undefined) {
      const m = (b.marcas ?? {}) as Record<string, unknown>
      const limpio: Record<string, string> = {}
      for (const [k, v] of Object.entries(m)) {
        if (!MARCAS.has(k) || !LISTAS[k].includes(String(v))) return res.status(400).json({ error: 'Marca o lista inválida' })
        limpio[k] = String(v)
      }
      cambios.marcas = limpio
    }
    const r = await rest(`tienda_clientes?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(cambios) })
    const filas = (await r.json().catch(() => [])) as unknown[]
    if (!r.ok || !filas[0]) return res.status(r.ok ? 404 : 502).json({ error: r.ok ? 'No existe' : 'No se pudo guardar' })
    return res.status(200).json({ cliente: filas[0] })
  }

  return res.status(400).json({ error: 'Acción no permitida' })
}
