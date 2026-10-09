/**
 * Motor del "creador de informes": arma el cuerpo según la fuente elegida y lo
 * manda por WhatsApp Cloud API (Meta).
 *
 * Este archivo SOLO lo usan las funciones de Vercel (Node): usa `process.env`,
 * nunca `import.meta.env`. Mismo criterio que `puenteRetry.ts`.
 *
 * Variables de entorno en Vercel (sin prefijo VITE_):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   WHATSAPP_TOKEN      - token de acceso de la app de Meta
 *   WHATSAPP_PHONE_ID   - id del número emisor (Phone number ID)
 *   WHATSAPP_VERSION     - opcional, default v21.0
 *   SQL_LOGICAPP_URL / SQL_BRIDGE_TOKEN / SQL_VIEWS / SQL_MAX_ROWS (para la fuente "vista")
 */
import { postAlPuente } from './puenteRetry.js'
import {
  normalizarTelefono,
  type ConfigApp,
  type ConfigTexto,
  type ConfigVista,
  type Destinatario,
  type Informe,
} from './informes.js'

const TZ_AR = 'America/Argentina/Buenos_Aires'

// ---------------------------------------------------------------------------
// Fechas y variables
// ---------------------------------------------------------------------------

const DIAS_ES = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab']

/** Hora de Argentina (UTC-3 todo el año, sin horario de verano). */
function ahoraAr(now = new Date()) {
  const ar = new Date(now.getTime() - 3 * 3600_000)
  const hh = String(ar.getUTCHours()).padStart(2, '0')
  const mm = String(ar.getUTCMinutes()).padStart(2, '0')
  return {
    fecha: ar.toISOString().slice(0, 10),
    hora: `${hh}:${mm}`,
    dia: DIAS_ES[ar.getUTCDay()],
    fechaLarga: new Intl.DateTimeFormat('es-AR', { timeZone: TZ_AR, dateStyle: 'long' }).format(now),
  }
}

/** Reemplaza {fecha}, {fechaHora}, {hora} y {dia} en un texto. */
export function conVariables(texto: string, now = new Date()): string {
  const d = ahoraAr(now)
  return (texto || '')
    .replace(/\{fechaHora\}/g, `${d.fecha} ${d.hora}`)
    .replace(/\{fecha\}/g, d.fecha)
    .replace(/\{hora\}/g, d.hora)
    .replace(/\{dia\}/g, d.dia)
}

// ---------------------------------------------------------------------------
// Supabase con service role
// ---------------------------------------------------------------------------

function restUrl(ruta: string): string | null {
  const url = process.env.SUPABASE_URL
  if (!url) return null
  return `${url}/rest/v1/${ruta}`
}

function anonKey(): string | undefined {
  return process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
}

/** Id del usuario del JWT (o null si no sirve). */
export async function usuarioDe(token: string): Promise<string | null> {
  const url = process.env.SUPABASE_URL
  const anon = anonKey()
  if (!url || !anon || !token) return null
  try {
    const r = await fetch(`${url}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: anon } })
    if (!r.ok) return null
    const u = (await r.json()) as { id?: string }
    return u.id ?? null
  } catch {
    return null
  }
}

/** ¿El usuario del JWT tiene alguno de esos permisos (o es admin)? */
export async function tienePermiso(token: string, permisos: string[]): Promise<boolean> {
  const url = process.env.SUPABASE_URL
  const anon = anonKey()
  if (!url || !anon || !token) return false
  const headers = { apikey: anon, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  try {
    const admin = (await (await fetch(`${url}/rest/v1/rpc/soy_admin`, { method: 'POST', headers, body: '{}' })).json()) as boolean
    if (admin === true) return true
  } catch {
    /* sigue con permisos */
  }
  try {
    const lista = (await (await fetch(`${url}/rest/v1/rpc/mis_permisos`, { method: 'POST', headers, body: '{}' })).json()) as Array<{ clave?: string }>
    const claves = Array.isArray(lista) ? lista.map((p) => p.clave) : []
    return permisos.some((p) => claves.includes(p))
  } catch {
    return false
  }
}

async function rest(ruta: string, init: RequestInit = {}): Promise<Response> {
  const url = restUrl(ruta)
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Falta SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  return fetch(url, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
}

// ---------------------------------------------------------------------------
// Fuente: vista del SQL Server
// ---------------------------------------------------------------------------

const SQL_MAX_ROWS = Number(process.env.SQL_MAX_ROWS ?? 1000) || 1000
const SQL_VIEWS = (process.env.SQL_VIEWS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const SQL_FILTER_COLS = (process.env.SQL_FILTER_COLS ?? 'ARTCOD,ID_ARTICULO,ARTICULO,NOMBRE_COMPLETO,DESCRIPCION,ARTDES,ARTDESADIC')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

async function vistasDeDb(): Promise<string[]> {
  try {
    const r = await rest('config_app?clave=eq.sql_vistas&select=valor')
    if (!r.ok) return []
    const filas = (await r.json()) as Array<{ valor?: unknown }>
    const raw = filas?.[0]?.valor
    const lista = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!Array.isArray(lista)) return []
    return lista
      .map((v) => (typeof v === 'object' && v !== null ? String((v as Record<string, unknown>).vista ?? '') : ''))
      .filter(Boolean)
  } catch {
    return []
  }
}

async function logicUrlDeDb(): Promise<string | null> {
  try {
    const r = await rest('sql_conexion?id=eq.1&select=logicapp_url,max_rows')
    if (!r.ok) return null
    const filas = (await r.json()) as Array<{ logicapp_url?: string | null }>
    return filas?.[0]?.logicapp_url?.trim() || process.env.SQL_LOGICAPP_URL || null
  } catch {
    return process.env.SQL_LOGICAPP_URL ?? null
  }
}

/** Igual que api/sql/[view].ts: lee una vista por el Puente SQL / Logic App. */
async function leerVistaRemota(vista: string, cfg: ConfigVista): Promise<Record<string, unknown>[]> {
  if (!/^([A-Za-z0-9_-]+:)?[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+){0,2}$/.test(vista)) {
    throw new Error('Nombre de vista inválido')
  }
  const habilitadas = new Set([...SQL_VIEWS, ...(await vistasDeDb())])
  if (!habilitadas.has(vista)) throw new Error(`La vista ${vista} no está habilitada en Datos SQL`)

  const logicUrl = await logicUrlDeDb()
  if (!logicUrl) throw new Error('Falta la URL del Logic App / Puente SQL')

  const donde = (cfg.donde ?? [])
    .map((c) => SQL_FILTER_COLS.find((w) => w.toLowerCase() === String(c).trim().toLowerCase()))
    .filter((c): c is string => !!c)
  const valor = (cfg.valor ?? '').trim()
  const filtro = valor && donde.length ? { donde: donde.join(','), valor, coincide: cfg.coincide === 'contiene' ? 'contiene' : 'igual' } : null

  const top = Math.min(Math.max(Number(cfg.tope) || 50, 1), SQL_MAX_ROWS)
  const r = await postAlPuente(
    logicUrl,
    {
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.SQL_BRIDGE_TOKEN ? { 'X-Puente-Token': process.env.SQL_BRIDGE_TOKEN } : {}),
      },
      body: JSON.stringify({ vista, top, ...(filtro ?? {}) }),
    },
    { timeoutMs: 60_000 },
  )
  if (!r.ok) throw new Error(r.motivo === 'timeout' ? 'El Puente SQL tardó demasiado' : 'No se pudo contactar el Puente SQL')
  if (!r.res.ok) {
    const detalle = (await r.res.text().catch(() => '')).slice(0, 200)
    throw new Error(`El Puente SQL respondió ${r.res.status}${detalle ? ` — ${detalle}` : ''}`)
  }
  let filas: unknown = await r.res.json().catch(() => null)
  if (filas && typeof filas === 'object' && !Array.isArray(filas)) {
    const rs = (filas as Record<string, unknown>).ResultSets ?? (filas as Record<string, unknown>).resultSets
    if (Array.isArray(rs)) filas = rs
  }
  if (!Array.isArray(filas)) throw new Error('Respuesta inesperada del Puente SQL')
  return filas as Record<string, unknown>[]
}

/** Tabla en texto, en bloque monoespaciado (WhatsApp lo respeta con ```). */
function tablaTexto(filas: Record<string, unknown>[], columnas: string[], maxFilas = 60): string {
  const cols = columnas.length ? columnas : Object.keys(filas[0] ?? {}).slice(0, 8)
  if (!cols.length) return '_(sin columnas)_'
  const usadas = filas.slice(0, maxFilas)
  const val = (v: unknown) => (v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').slice(0, 28))
  const ancho = cols.map((c) => Math.min(Math.max(c.length, ...usadas.map((f) => val(f[c]).length)), 28))
  const linea = (vals: string[]) => vals.map((v, i) => v.padEnd(ancho[i])).join(' │ ').trimEnd()
  const out = [linea(cols), ancho.map((n) => '─'.repeat(n)).join('─┼─'), ...usadas.map((f) => linea(cols.map((c) => val(f[c]))))]
  const restantes = filas.length - usadas.length
  if (restantes > 0) out.push(`… y ${restantes} línea(s) más`)
  return '```\n' + out.join('\n') + '\n```'
}

async function cuerpoVista(cfg: ConfigVista): Promise<string> {
  const vista = String(cfg.vista ?? '').trim()
  if (!vista) throw new Error('Falta elegir la vista')
  const filas = await leerVistaRemota(vista, cfg)
  if (!filas.length) return `${vista}: sin datos.`
  return `${vista} — ${filas.length} línea(s)\n\n${tablaTexto(filas, cfg.columnas ?? [])}`
}

// ---------------------------------------------------------------------------
// Fuente: datos de la app (Supabase)
// ---------------------------------------------------------------------------

const nAR = (n: number | null | undefined) =>
  n === null || n === undefined ? '0' : n.toLocaleString('es-AR')

async function jsonDe<T>(ruta: string): Promise<T[]> {
  const r = await rest(ruta)
  if (!r.ok) throw new Error(`No se pudieron leer los datos (${r.status})`)
  return (await r.json()) as T[]
}

async function cuerpoApp(cfg: ConfigApp): Promise<string> {
  switch (cfg.tipo) {
    case 'recepcion_indo': {
      const filas = await jsonDe<{ proveedor: string; n_remito: string; n_oc: string; fecha_ingreso: string | null; estado: string }>(
        'recepcion_indo?select=proveedor,n_remito,n_oc,fecha_ingreso,estado&fecha_controlada=is.null&order=fecha_ingreso.asc&limit=500',
      )
      if (!filas.length) return 'Recepción INDO: no hay remitos pendientes de controlar. 🎉'
      const porEstado = new Map<string, number>()
      for (const f of filas) porEstado.set(f.estado || '(sin estado)', (porEstado.get(f.estado || '(sin estado)') ?? 0) + 1)
      const estados = [...porEstado.entries()].map(([e, n]) => `• ${e}: ${n}`).join('\n')
      const detalle = filas
        .slice(0, 15)
        .map((f) => `• ${f.proveedor || '—'} · remito ${f.n_remito || '—'} · ingreso ${f.fecha_ingreso || '—'}`)
        .join('\n')
      return `*Recepción INDO — pendientes de controlar:* ${filas.length}\n\n${estados}\n\n_Detalle (${Math.min(filas.length, 15)}):_\n${detalle}`
    }
    case 'armados': {
      const filas = await jsonDe<{ pedido_numero: number | null; cliente_nombre: string | null; prioridad: string; estado: string; aceptado_nombre: string | null }>(
        'mayorista_armados?select=pedido_numero,cliente_nombre,prioridad,estado,aceptado_nombre&estado=in.(pendiente,aceptado)&order=creado_at.asc&limit=500',
      )
      if (!filas.length) return 'Armados: no hay pedidos pendientes ni en curso. 🎉'
      const pend = filas.filter((f) => f.estado === 'pendiente')
      const enCurso = filas.filter((f) => f.estado === 'aceptado')
      const listado = filas
        .slice(0, 15)
        .map((f) => `• N° ${f.pedido_numero ?? '—'} · ${f.cliente_nombre || 'Cliente'} · ${f.prioridad}${f.aceptado_nombre ? ` · ${f.aceptado_nombre}` : ''}`)
        .join('\n')
      return `*Armados de pedidos:* ${filas.length} (${pend.length} sin tomar, ${enCurso.length} en curso)\n\n_Detalle (${Math.min(filas.length, 15)}):_\n${listado}`
    }
    case 'pedidos_compra': {
      const desde = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10)
      const filas = await jsonDe<{ numero: number | null; proveedor_nombre: string | null; total: number | null; fecha: string | null }>(
        `pedidos_compra?select=numero,proveedor_nombre,total,fecha&fecha=gte.${desde}&anulado=eq.false&order=fecha.desc&limit=500`,
      )
      if (!filas.length) return `Pedidos de compra: no hubo OCs desde el ${desde}.`
      const total = filas.reduce((s, f) => s + (Number(f.total) || 0), 0)
      const listado = filas
        .slice(0, 12)
        .map((f) => `• N° ${f.numero ?? '—'} · ${f.proveedor_nombre || '—'} · $ ${nAR(Number(f.total) || 0)}`)
        .join('\n')
      return `*Pedidos de compra (desde ${desde}):* ${filas.length} OC\nTotal: $ ${nAR(total)}\n\n_Últimas:_\n${listado}`
    }
    default:
      throw new Error('Tipo de informe desconocido')
  }
}

// ---------------------------------------------------------------------------
// Cuerpo completo
// ---------------------------------------------------------------------------

/** Arma el texto final: encabezado + cuerpo de la fuente + pie, con variables. */
export async function armarCuerpo(informe: Informe): Promise<string> {
  let cuerpo: string
  switch (informe.fuente) {
    case 'texto':
      cuerpo = conVariables(String((informe.config as unknown as ConfigTexto)?.plantilla ?? '')).trim()
      if (!cuerpo) throw new Error('El texto libre está vacío')
      break
    case 'vista':
      cuerpo = await cuerpoVista(informe.config as unknown as ConfigVista)
      break
    case 'app':
      cuerpo = await cuerpoApp(informe.config as unknown as ConfigApp)
      break
    default:
      throw new Error('Fuente desconocida')
  }
  const partes = [
    informe.encabezado ? conVariables(informe.encabezado).trim() : '',
    cuerpo,
    informe.pie ? conVariables(informe.pie).trim() : '',
  ].filter(Boolean)
  return partes.join('\n\n')
}

// ---------------------------------------------------------------------------
// WhatsApp Cloud API (Meta)
// ---------------------------------------------------------------------------

export function whatsappConfigurado(): boolean {
  return Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID)
}

export async function enviarWhatsapp(telefono: string, texto: string): Promise<{ ok: boolean; detalle: string }> {
  const token = process.env.WHATSAPP_TOKEN
  const phoneId = process.env.WHATSAPP_PHONE_ID
  if (!token || !phoneId) {
    return { ok: false, detalle: 'WhatsApp no configurado: faltan WHATSAPP_TOKEN y/o WHATSAPP_PHONE_ID en Vercel' }
  }
  const version = process.env.WHATSAPP_VERSION || 'v21.0'
  const destino = normalizarTelefono(telefono)
  if (!destino) return { ok: false, detalle: 'Teléfono vacío o inválido' }
  try {
    const r = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: destino,
        type: 'text',
        text: { preview_url: false, body: texto.slice(0, 4096) },
      }),
    })
    const body = (await r.json().catch(() => null)) as
      | { messages?: Array<{ id?: string }>; error?: { message?: string } }
      | null
    if (!r.ok) return { ok: false, detalle: body?.error?.message || `WhatsApp respondió ${r.status}` }
    return { ok: true, detalle: body?.messages?.[0]?.id ? `id ${body.messages[0].id}` : 'enviado' }
  } catch (e) {
    return { ok: false, detalle: `No se pudo contactar WhatsApp: ${(e as Error).message}` }
  }
}

// ---------------------------------------------------------------------------
// Orquestación: enviar un informe y registrar el resultado
// ---------------------------------------------------------------------------

export interface ResultadoEnvio {
  ok: boolean
  texto: string
  enviados: number
  detalle: string
}

export async function enviarInforme(informe: Informe & { id?: string }, origen: 'manual' | 'cron' | 'prueba'): Promise<ResultadoEnvio> {
  const destinos = (informe.destinatarios ?? []).filter((d: Destinatario) => d.telefono && normalizarTelefono(d.telefono))
  let texto: string
  try {
    texto = await armarCuerpo(informe)
  } catch (e) {
    const detalle = `No se pudo armar el informe: ${(e as Error).message}`
    return { ok: false, texto: '', enviados: 0, detalle }
  }
  if (!destinos.length) {
    return { ok: false, texto, enviados: 0, detalle: 'El informe no tiene destinatarios' }
  }

  let enviados = 0
  const detalles: string[] = []
  for (const d of destinos) {
    const r = await enviarWhatsapp(d.telefono, texto)
    if (r.ok) enviados++
    detalles.push(`${d.nombre || d.telefono}: ${r.ok ? 'OK' : r.detalle}`)
    if (informe.id) {
      await rest('informes_envios', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          informe_id: informe.id,
          destino: d.nombre ? `${d.nombre} (${normalizarTelefono(d.telefono)})` : normalizarTelefono(d.telefono),
          ok: r.ok,
          detalle: r.detalle,
          origen,
        }),
      }).catch(() => undefined)
    }
  }
  const ok = enviados === destinos.length
  const detalle = detalles.join(' · ')
  if (informe.id) {
    await rest(`informes?id=eq.${informe.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ ultimo_envio: new Date().toISOString(), ultimo_ok: ok, ultimo_detalle: detalle.slice(0, 500) }),
    }).catch(() => undefined)
  }
  return { ok, texto, enviados, detalle }
}
