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
 *   WHATSAPP_VERSION     - opcional, default v23.0
 *   SQL_LOGICAPP_URL / SQL_BRIDGE_TOKEN / SQL_VIEWS / SQL_MAX_ROWS (para la fuente "vista")
 */
import { postAlPuente } from './puenteRetry.js'
import { renderReporteImagen, type BloqueImagen, type ReporteImagen } from './informesImagen.js'
import { bloquesEficiencia, corta, porcentajes, type AvanceVtd, type FilaPiso, type FilaVtd } from './informeEficiencia.js'
import { bloquesConversion, type DatosConversion } from './informeConversion.js'
import { bloquesKm,type FilaKmInforme, type FilaLocalesInforme, type FilaParadaInforme, type VehiculoInforme } from './informeKmTransporte.js'
import {
  formatoDe,
  normalizarTelefono,
  plantillaMetaDe,
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
async function leerVistaRemota(vista: string, cfg: ConfigVista, maxFilas = SQL_MAX_ROWS): Promise<Record<string, unknown>[]> {
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

  const top = Math.min(Math.max(Number(cfg.tope) || 50, 1), maxFilas)
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
    case 'eficiencia_mayorista': {
      const d = await datosEficiencia(ahoraAr().fecha)
      const { subtitulo } = bloquesEficiencia(d)
      const tot = d.vtd.reduce((s, f) => ({ venta: s.venta + Number(f.venta), repo: s.repo + Number(f.repo) }), { venta: 0, repo: 0 })
      return `*Eficiencia mayorista*\n${subtitulo}\nVenta ${nAR(tot.venta)} · repo ${nAR(tot.repo)}`
    }
    case 'km_transporte':
      return bloquesKm(await datosKm(ahoraAr().fecha)).texto
    case 'tasa_conversion':
      return bloquesConversion(await datosConversion(ahoraAr().fecha)).texto
    default:
      throw new Error('Tipo de informe desconocido')
  }
}

// ---------------------------------------------------------------------------
// Eficiencia mayorista (repo del día)
// ---------------------------------------------------------------------------

async function rpc<T>(nombre: string, args: Record<string, unknown>): Promise<T[]> {
  const r = await rest(`rpc/${nombre}`, { method: 'POST', body: JSON.stringify(args) })
  if (!r.ok) throw new Error(`No se pudo leer ${nombre} (${r.status}): ${(await r.text().catch(() => '')).slice(0, 160)}`)
  return (await r.json()) as T[]
}

/** Avance de la venta diaria (VTD) del día: total, mandadas y no mandadas. */
async function avanceVtd(fecha: string): Promise<AvanceVtd | null> {
  const filas = await rpc<AvanceVtd & { motivo: string }>('avance_vtd_rep', { p_desde: fecha, p_hasta: fecha })
  const a = filas.find((f) => f.motivo === 'VTD')
  return a ? { unidades: Number(a.unidades) || 0, unidades_ok: Number(a.unidades_ok) || 0, no_mandados: Number(a.no_mandados) || 0 } : null
}

/** ¿La repo del día llegó al 100% (todo mandado o marcado como no mandado)? */
export async function repoCompleta(fecha: string): Promise<boolean> {
  const a = await avanceVtd(fecha)
  return Boolean(a && a.unidades > 0 && porcentajes(a.unidades, a.unidades_ok, a.no_mandados).terminado)
}

async function datosEficiencia(fecha: string): Promise<{ fecha: string; vtd: FilaVtd[]; piso: FilaPiso[]; avance: AvanceVtd | null }> {
  const [vtd, avance, tiempos] = await Promise.all([
    rpc<FilaVtd>('estadistica_vtd', { p_desde: fecha, p_hasta: fecha }),
    avanceVtd(fecha),
    jsonDe<{ empleado_id: string | null; repos: number; unidades: number; segundos: number; pendientes_fin: number }>(
      `vw_tiempos_piso_motivo?select=empleado_id,repos,unidades,segundos,pendientes_fin&fecha=eq.${fecha}&motivo=eq.VTD`,
    ),
  ])
  const ids = [...new Set(tiempos.map((t) => t.empleado_id).filter((x): x is string => !!x))]
  const emps = ids.length
    ? await jsonDe<{ id: string; legajo: string | null; nombre: string | null }>(`empleados?select=id,legajo,nombre&id=in.(${ids.join(',')})`)
    : []
  const porId = new Map(emps.map((e) => [e.id, e]))

  // Empleados marcados con "Cuenta en los informes" en NO (sql/empleados_cuenta_informes.sql):
  // no salen en piso, no figuran como responsables y no suman en el KPI Personas.
  const fuera = new Set(
    (await jsonDe<{ id: string }>('empleados?select=id&cuenta_informes=is.false')).map((e) => e.id),
  )

  const piso: FilaPiso[] = tiempos
    .filter((t) => !t.empleado_id || !fuera.has(t.empleado_id))
    .map((t) => ({ ...t, legajo: porId.get(t.empleado_id ?? '')?.legajo ?? null, nombre: porId.get(t.empleado_id ?? '')?.nombre ?? null }))
  const vtdSinFuera = fuera.size
    ? vtd.map((f) => (f.responsable_id && fuera.has(f.responsable_id) ? { ...f, responsable: null, responsable_id: null } : f))
    : vtd
  return { fecha, vtd: vtdSinFuera, piso, avance }
}

// ---------------------------------------------------------------------------
// Tasa de conversión (Locales > Tasa de conversión)
// ---------------------------------------------------------------------------

/** Entradas por local de un día (hora de Argentina) de contador_visitas. */
async function entradasDelDia(fecha: string): Promise<Map<string, number>> {
  const desde = new Date(`${fecha}T00:00:00-03:00`).toISOString()
  const hasta = new Date(new Date(`${fecha}T00:00:00-03:00`).getTime() + 86_400_000).toISOString()
  const m = new Map<string, number>()
  for (let offset = 0; offset < 50_000; offset += 1000) {
    const lote = await jsonDe<{ local: string; entradas: number }>(
      `contador_visitas?select=local,entradas&desde=gte.${encodeURIComponent(desde)}&desde=lt.${encodeURIComponent(hasta)}&order=local,camara,desde&limit=1000&offset=${offset}`,
    )
    for (const f of lote) m.set(f.local, (m.get(f.local) ?? 0) + (Number(f.entradas) || 0))
    if (lote.length < 1000) break
  }
  return m
}

/** Hoy y el mismo día de la semana anterior: entradas, tickets y facturado por local. */
async function datosConversion(fecha: string): Promise<DatosConversion> {
  const d = new Date(`${fecha}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 7)
  const antes = d.toISOString().slice(0, 10)
  const cfgVista = await jsonDe<{ valor: unknown }>('config_app?clave=eq.contador_vista_ventas&select=valor')
  const vista = typeof cfgVista[0]?.valor === 'string' ? (cfgVista[0].valor as string) : ''
  if (!vista) throw new Error('Falta configurar la vista de ventas del contador (config_app contador_vista_ventas)')
  const [entradas, entradasAntes, filasVentas, locales, filasObj] = await Promise.all([
    entradasDelDia(fecha),
    entradasDelDia(antes),
    // Una fila por local y día (180 días, ~1.200 filas): se pide entera, sin el tope general
    leerVistaRemota(vista, { vista, tope: 20_000 }, 20_000),
    jsonDe<{ codigo: string; nombre: string | null }>('locales?select=codigo,nombre'),
    // Objetivo del día (Locales → Objetivo); si falla, el informe sale sin esas columnas
    rpc<{ local: string; objetivo: number | null }>('objetivos_locales_dia', { p_desde: fecha, p_hasta: fecha }).catch(() => []),
  ])
  const objetivos = new Map<string, number>()
  for (const f of filasObj) {
    if (f.local && f.objetivo != null && Number.isFinite(Number(f.objetivo))) objetivos.set(String(f.local).trim().toUpperCase(), Number(f.objetivo))
  }
  const ventas = new Map<string, { tickets: number; total: number }>()
  const ventasAntes = new Map<string, { tickets: number; total: number }>()
  const val = (f: Record<string, unknown>, k: string) => f[k] ?? f[k.toUpperCase()]
  for (const f of filasVentas) {
    const dia = String(val(f, 'fecha') ?? '').slice(0, 10)
    const destino = dia === fecha ? ventas : dia === antes ? ventasAntes : null
    if (!destino) continue
    const local = String(val(f, 'local') ?? '').trim().toUpperCase()
    const v = destino.get(local) ?? { tickets: 0, total: 0 }
    v.tickets += Number(val(f, 'tickets')) || 0
    v.total += Number(val(f, 'total')) || 0
    destino.set(local, v)
  }
  const nombres = Object.fromEntries(locales.map((l) => [l.codigo, l.nombre ?? '']))
  return { fecha, antes, entradas, entradasAntes, ventas, ventasAntes, nombres, objetivos }
}

// ---------------------------------------------------------------------------
// Km recorridos del transporte (Administradores > Tracking > Km recorridos)
// ---------------------------------------------------------------------------

/**
 * Dirección de un punto (OpenStreetMap, el mismo buscador con el que se ubican
 * los locales). Son una o dos paradas por día: de a una y con pausa, como pide
 * Nominatim. Si no contesta, el informe muestra las coordenadas.
 */
async function direccionDe(lat: number, lng: number): Promise<string | null> {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&accept-language=es&zoom=18&lat=${lat}&lon=${lng}`
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'hub-mito/1.0 (informe de km del transporte)' },
      signal: AbortSignal.timeout(6000),
    })
    if (!r.ok) return null
    const d = (await r.json()) as { address?: Record<string, string>; display_name?: string }
    const a = d.address ?? {}
    const calle = [a.road, a.house_number].filter(Boolean).join(' ')
    const zona = a.neighbourhood || a.suburb || a.quarter || a.city_district || ''
    // La ciudad solo si salió de Córdoba (Carlos Paz, Alta Gracia…): ahí importa
    const ciudad = a.city || a.town || a.village || ''
    const corto = [calle, zona, /c[oó]rdoba/i.test(ciudad) ? '' : ciudad].filter(Boolean).join(', ')
    return corto || (d.display_name ? d.display_name.split(',').slice(0, 3).join(',') : null)
  } catch {
    return null
  }
}

/**
 * Bultos distintos que cargó cada chofer ese día (clave: usuario de Transporte).
 * Sale de la base de **Transporte** con su service role, igual que
 * api/tracking?vista=bultos, que es lo que muestra Tracking > Km recorridos.
 * Sin esas credenciales devuelve vacío y el informe sale sin la columna.
 */
async function bultosDelDia(fecha: string): Promise<Map<string, number>> {
  const url = process.env.TRANSPORTE_URL?.replace(/\/$/, '')
  const key = process.env.TRANSPORTE_SERVICE_ROLE_KEY
  const porChofer = new Map<string, Set<string>>()
  if (!url || !key) return new Map()
  const desde = new Date(`${fecha}T00:00:00-03:00`)
  const hasta = new Date(desde.getTime() + 86_400_000)
  try {
    for (let offset = 0; offset < 20_000; offset += 1000) {
      const r = await fetch(
        `${url}/rest/v1/bultos_historial?select=bulto_id,usuario_registro_id` +
          `&estado=eq.EN_CAMINO&usuario_registro_id=not.is.null` +
          `&registrado_en=gte.${desde.toISOString()}&registrado_en=lt.${hasta.toISOString()}` +
          `&order=registrado_en,bulto_id&limit=1000&offset=${offset}`,
        { headers: { apikey: key, Authorization: `Bearer ${key}` } },
      )
      if (!r.ok) break
      const lote = (await r.json()) as { bulto_id: string | null; usuario_registro_id: string | null }[]
      for (const b of lote) {
        if (!b.bulto_id || !b.usuario_registro_id) continue
        const s = porChofer.get(b.usuario_registro_id) ?? new Set<string>()
        s.add(b.bulto_id)
        porChofer.set(b.usuario_registro_id, s)
      }
      if (lote.length < 1000) break
    }
  } catch {
    return new Map()
  }
  return new Map([...porChofer].map(([id, s]) => [id, s.size]))
}

/** Le agrega a cada parada dónde fue (sin cortar el informe si el buscador falla) */
async function conDireccion(paradas: FilaParadaInforme[]): Promise<FilaParadaInforme[]> {
  const salida: FilaParadaInforme[] = []
  for (const [i, p] of paradas.entries()) {
    if (i > 0) await new Promise((ok) => setTimeout(ok, 1100))
    salida.push({ ...p, lugar: await direccionDe(p.lat, p.lng) })
  }
  return salida
}

/** Km del día y del último día anterior en que anduvieron (para comparar; los domingos no hay). */
async function datosKm(fecha: string): Promise<{
  fecha: string; hoy: FilaKmInforme[]; ayer: FilaKmInforme[]; ayerFecha: string | null; vehiculos: VehiculoInforme[]
  locales: FilaLocalesInforme[]
  paradas: FilaParadaInforme[]
  bultos: Map<string, number>
  semana: { desde: string; filas: FilaKmInforme[]; anterior: FilaKmInforme[] }
}> {
  const dia = (n: number, base = fecha) => { const d = new Date(`${base}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
  // Semana: del lunes hasta ese día, contra los mismos días de la semana anterior
  const dow = new Date(`${fecha}T12:00:00Z`).getUTCDay()
  const lunes = dia(-((dow + 6) % 7))
  const [hoy, previos, vehiculos, semana, semanaAnt, locales, paradas, bultos] = await Promise.all([
    rpc<FilaKmInforme>('tracking_km', { p_desde: fecha, p_hasta: fecha }),
    rpc<FilaKmInforme>('tracking_km', { p_desde: dia(-7), p_hasta: dia(-1) }),
    jsonDe<VehiculoInforme>('tracking_vehiculos?select=id,nombre,usuario_transporte_id,usuario_transporte_nombre,activo&order=nombre'),
    rpc<FilaKmInforme>('tracking_km', { p_desde: lunes, p_hasta: fecha }),
    rpc<FilaKmInforme>('tracking_km', { p_desde: dia(-7, lunes), p_hasta: dia(-7) }),
    // Locales distintos por los que pasó cada vehículo (sql/tracking_locales_dia.sql)
    rpc<FilaLocalesInforme>('tracking_locales_dia', { p_desde: fecha, p_hasta: fecha }),
    // Dónde se quedó quieto lejos de todo local o depósito (sql/tracking_paradas_fuera.sql)
    rpc<FilaParadaInforme>('tracking_paradas_fuera', { p_desde: fecha, p_hasta: fecha, p_min_min: 10 }),
    // Bultos que cargó cada chofer (base de Transporte)
    bultosDelDia(fecha),
  ])
  const ayerFecha = [...new Set(previos.filter((f) => Number(f.km) >= 1).map((f) => f.dia))].sort().pop() ?? null
  return {
    fecha, hoy, ayer: previos.filter((f) => f.dia === ayerFecha), ayerFecha, vehiculos, locales,
    paradas: await conDireccion(paradas),
    bultos,
    semana: { desde: lunes, filas: semana, anterior: semanaAnt },
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
// Imagen del informe (PNG)
// ---------------------------------------------------------------------------

/** Saca los adornos de WhatsApp (*negrita*) y los emojis, que la imagen no dibuja. */
function limpiarParaImagen(texto: string): string {
  return (texto || '')
    .replace(/\*/g, '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{FE0F}\u{200D}]/gu, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}

/** Arma el contenido de la imagen (título, subtítulo, bloques y pie). */
async function construirReporteImagen(informe: Informe): Promise<{ reporte: ReporteImagen; caption: string }> {
  const d = ahoraAr()
  const enc = informe.encabezado ? conVariables(informe.encabezado).trim() : ''
  const titulo = limpiarParaImagen(enc || informe.nombre || 'Informe')
  const subtitulo = `${d.fechaLarga} · ${d.hora}`
  const pie = limpiarParaImagen((informe.pie ? conVariables(informe.pie).trim() : '') || 'Hub Mito · Sistemas')
  const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v))

  let bloques: BloqueImagen[]
  switch (informe.fuente) {
    case 'vista': {
      const cfg = informe.config as unknown as ConfigVista
      const vista = String(cfg.vista ?? '').trim()
      if (!vista) throw new Error('Falta elegir la vista')
      const filas = await leerVistaRemota(vista, cfg)
      if (!filas.length) {
        bloques = [{ tipo: 'texto', texto: `${vista}: sin datos.` }]
      } else {
        const columnas = (cfg.columnas?.length ? cfg.columnas : Object.keys(filas[0] ?? {})).slice(0, 9)
        bloques = [
          { tipo: 'texto', texto: `${vista} — ${filas.length} línea(s)` },
          { tipo: 'tabla', columnas, filas: filas.map((f) => columnas.map((c) => txt(f[c]))) },
        ]
      }
      break
    }
    case 'app': {
      const cfg = informe.config as unknown as ConfigApp
      if (cfg.tipo === 'km_transporte') {
        const r = bloquesKm(await datosKm(d.fecha))
        return {
          reporte: { titulo: limpiarParaImagen(enc || 'Km recorridos del transporte'), subtitulo: r.subtitulo, pie, bloques: r.bloques },
          caption: limpiarParaImagen(enc || informe.nombre || 'Km recorridos del transporte').slice(0, 900),
        }
      }
      if (cfg.tipo === 'tasa_conversion') {
        const r = bloquesConversion(await datosConversion(d.fecha))
        return {
          reporte: { titulo: limpiarParaImagen(enc || 'Tasa de conversión'), subtitulo: r.subtitulo, pie, bloques: r.bloques },
          caption: limpiarParaImagen(enc || informe.nombre || 'Tasa de conversión').slice(0, 900),
        }
      }
      if (cfg.tipo === 'eficiencia_mayorista') {
        const r = bloquesEficiencia(await datosEficiencia(d.fecha))
        return {
          reporte: { titulo: limpiarParaImagen(enc || 'Eficiencia mayorista'), subtitulo: r.subtitulo, pie, bloques: r.bloques },
          caption: limpiarParaImagen(enc || informe.nombre || 'Eficiencia mayorista').slice(0, 900),
        }
      }
      bloques = [{ tipo: 'texto', texto: limpiarParaImagen(await cuerpoApp(cfg)) }]
      break
    }
    case 'texto': {
      const t = conVariables(String((informe.config as unknown as ConfigTexto)?.plantilla ?? '')).trim()
      if (!t) throw new Error('El texto libre está vacío')
      bloques = [{ tipo: 'texto', texto: limpiarParaImagen(t) }]
      break
    }
    default:
      throw new Error('Fuente desconocida')
  }

  return {
    reporte: { titulo, subtitulo, pie, bloques },
    caption: limpiarParaImagen(enc || informe.nombre || 'Informe').slice(0, 900),
  }
}

/** Genera el PNG del informe (lo usan la vista previa y el envío). */
export async function generarImagenInforme(informe: Informe): Promise<{ png: Buffer; caption: string }> {
  const { reporte, caption } = await construirReporteImagen(informe)
  const png = await renderReporteImagen(reporte)
  return { png, caption }
}

// ---------------------------------------------------------------------------
// WhatsApp Cloud API (Meta)
// ---------------------------------------------------------------------------

export function whatsappConfigurado(): boolean {
  return Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID)
}

/**
 * Estado real de la conexión: le pregunta a Meta por el número configurado.
 * Si el token o el ID están mal, Meta lo dice. No devuelve nunca el token.
 */
export async function estadoWhatsapp(): Promise<{
  configurado: boolean
  ok: boolean
  numero?: string
  nombre?: string
  calidad?: string
  error?: string
}> {
  const token = process.env.WHATSAPP_TOKEN
  const phoneId = process.env.WHATSAPP_PHONE_ID
  if (!token || !phoneId) {
    return { configurado: false, ok: false, error: 'Faltan WHATSAPP_TOKEN y/o WHATSAPP_PHONE_ID en Vercel' }
  }
  const version = process.env.WHATSAPP_VERSION || 'v23.0'
  try {
    const r = await fetch(
      `https://graph.facebook.com/${version}/${encodeURIComponent(phoneId)}?fields=display_phone_number,verified_name,quality_rating`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) },
    )
    const j = (await r.json().catch(() => null)) as
      | { display_phone_number?: string; verified_name?: string; quality_rating?: string; error?: { message?: string } }
      | null
    if (!r.ok) return { configurado: true, ok: false, error: j?.error?.message ?? `Meta respondió ${r.status}` }
    return { configurado: true, ok: true, numero: j?.display_phone_number, nombre: j?.verified_name, calidad: j?.quality_rating }
  } catch (e) {
    return { configurado: true, ok: false, error: `No se pudo contactar a Meta: ${(e as Error).message}` }
  }
}

export async function enviarWhatsapp(telefono: string, texto: string): Promise<{ ok: boolean; detalle: string }> {
  const token = process.env.WHATSAPP_TOKEN
  const phoneId = process.env.WHATSAPP_PHONE_ID
  if (!token || !phoneId) {
    return { ok: false, detalle: 'WhatsApp no configurado: faltan WHATSAPP_TOKEN y/o WHATSAPP_PHONE_ID en Vercel' }
  }
  const version = process.env.WHATSAPP_VERSION || 'v23.0'
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

/**
 * Manda una imagen PNG: primero la sube a Meta (endpoint /media) y después manda
 * el mensaje de tipo "image" con ese id. Mismo criterio de "no configurado" que el texto.
 */
/** Plantilla de Meta a usar en el envío: nombre, idioma y valores de {{1}}, {{2}}… del cuerpo. */
export interface PlantillaEnvio {
  nombre: string
  idioma: string
  parametros: string[]
}

function componentesPlantilla(p: PlantillaEnvio, imagenId?: string) {
  const comps: Array<Record<string, unknown>> = []
  if (imagenId) comps.push({ type: 'header', parameters: [{ type: 'image', image: { id: imagenId } }] })
  if (p.parametros.length) comps.push({ type: 'body', parameters: p.parametros.map((t) => ({ type: 'text', text: t.slice(0, 900) || '-' })) })
  return comps
}

/** Manda una plantilla aprobada (sin imagen): llega aunque no haya ventana de 24 h. */
export async function enviarWhatsappPlantilla(telefono: string, p: PlantillaEnvio): Promise<{ ok: boolean; detalle: string }> {
  const token = process.env.WHATSAPP_TOKEN
  const phoneId = process.env.WHATSAPP_PHONE_ID
  if (!token || !phoneId) return { ok: false, detalle: 'WhatsApp no configurado: faltan WHATSAPP_TOKEN y/o WHATSAPP_PHONE_ID en Vercel' }
  const version = process.env.WHATSAPP_VERSION || 'v23.0'
  const destino = normalizarTelefono(telefono)
  if (!destino) return { ok: false, detalle: 'Teléfono vacío o inválido' }
  try {
    const r = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: destino,
        type: 'template',
        template: { name: p.nombre, language: { code: p.idioma }, components: componentesPlantilla(p) },
      }),
    })
    const body = (await r.json().catch(() => null)) as { messages?: Array<{ id?: string }>; error?: { message?: string } } | null
    if (!r.ok) return { ok: false, detalle: body?.error?.message || `WhatsApp respondió ${r.status}` }
    return { ok: true, detalle: body?.messages?.[0]?.id ? `id ${body.messages[0].id}` : 'enviado' }
  } catch (e) {
    return { ok: false, detalle: `No se pudo contactar WhatsApp: ${(e as Error).message}` }
  }
}

export async function enviarWhatsappImagen(telefono: string, png: Buffer, caption?: string, plantilla?: PlantillaEnvio): Promise<{ ok: boolean; detalle: string }> {
  const token = process.env.WHATSAPP_TOKEN
  const phoneId = process.env.WHATSAPP_PHONE_ID
  if (!token || !phoneId) {
    return { ok: false, detalle: 'WhatsApp no configurado: faltan WHATSAPP_TOKEN y/o WHATSAPP_PHONE_ID en Vercel' }
  }
  const version = process.env.WHATSAPP_VERSION || 'v23.0'
  const destino = normalizarTelefono(telefono)
  if (!destino) return { ok: false, detalle: 'Teléfono vacío o inválido' }
  try {
    // 1) Subir la imagen y quedarnos con su id de Meta.
    const form = new FormData()
    form.append('messaging_product', 'whatsapp')
    form.append('type', 'image/png')
    form.append('file', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'informe.png')
    const rSub = await fetch(`https://graph.facebook.com/${version}/${phoneId}/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    })
    const sub = (await rSub.json().catch(() => null)) as { id?: string; error?: { message?: string } } | null
    if (!rSub.ok || !sub?.id) {
      return { ok: false, detalle: sub?.error?.message || `No se pudo subir la imagen (${rSub.status})` }
    }

    // 2) Mandar el mensaje con la imagen.
    const r = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      // Con plantilla: la imagen va en el encabezado y llega siempre (fuera de la ventana de 24 h).
      body: JSON.stringify(
        plantilla
          ? {
              messaging_product: 'whatsapp',
              to: destino,
              type: 'template',
              template: { name: plantilla.nombre, language: { code: plantilla.idioma }, components: componentesPlantilla(plantilla, sub.id) },
            }
          : {
              messaging_product: 'whatsapp',
              to: destino,
              type: 'image',
              image: { id: sub.id, ...(caption ? { caption: caption.slice(0, 1000) } : {}) },
            },
      ),
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
  if (!destinos.length) {
    return { ok: false, texto: '', enviados: 0, detalle: 'El informe no tiene destinatarios' }
  }

  // Contenido: imagen PNG (si el formato es "imagen") o el texto de siempre.
  let texto: string
  let png: Buffer | null = null
  let notaImagen = ''
  if (formatoDe(informe) === 'imagen') {
    try {
      const r = await generarImagenInforme(informe)
      png = r.png
      texto = r.caption || '(imagen)'
    } catch (e) {
      // Si falla el render, mandamos el texto para no perder el aviso.
      try {
        texto = await armarCuerpo(informe)
        notaImagen = ` (la imagen falló: ${(e as Error).message})`
      } catch (e2) {
        return { ok: false, texto: '', enviados: 0, detalle: `No se pudo armar el informe: ${(e2 as Error).message}` }
      }
    }
  } else {
    try {
      texto = await armarCuerpo(informe)
    } catch (e) {
      return { ok: false, texto: '', enviados: 0, detalle: `No se pudo armar el informe: ${(e as Error).message}` }
    }
  }

  // Plantilla de Meta (opcional): {{1}} = primer nombre del destinatario, {{2}} = fecha de hoy
  const pm = plantillaMetaDe(informe)
  const fechaHoy = corta(ahoraAr().fecha)
  const plantillaPara = (d: Destinatario): PlantillaEnvio | undefined =>
    pm ? { ...pm, parametros: [(d.nombre || '').trim().split(/\s+/)[0] || 'equipo', fechaHoy] } : undefined

  let enviados = 0
  const detalles: string[] = []
  for (const d of destinos) {
    const p = plantillaPara(d)
    const r = png
      ? await enviarWhatsappImagen(d.telefono, png, texto, p)
      : p
        ? await enviarWhatsappPlantilla(d.telefono, p)
        : await enviarWhatsapp(d.telefono, texto)
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
  const detalle = detalles.join(' · ') + notaImagen
  if (informe.id) {
    await rest(`informes?id=eq.${informe.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ ultimo_envio: new Date().toISOString(), ultimo_ok: ok, ultimo_detalle: detalle.slice(0, 500) }),
    }).catch(() => undefined)
  }
  return { ok, texto, enviados, detalle }
}
