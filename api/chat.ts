/**
 * Chat IA del hub (pantalla /chat-ia, solo administradores).
 *
 *   POST /api/chat  { mensajes: [{ role: 'user'|'assistant', content: string }] }
 *     -> { respuesta, proveedor: 'opencode'|'ollama', consultas: string[] }
 *
 * Dos modelos que trabajan juntos:
 *   1. OpenCode Go (Claude Haiku 5.5, endpoint compatible con la API de Anthropic): el principal.
 *   2. Ollama del mito-server (POST <url_agentes>/api/ia/chat): respaldo automático si OpenCode
 *      no está configurado, se agotó el cupo mensual (429) o no responde.
 * Las herramientas de datos corren SIEMPRE acá, con el JWT del usuario (RLS y permisos de la
 * base intactos) y son de solo lectura. No se exponen datos personales (RRHH, DNI, clientes
 * de la tienda web, usuarios). No se guarda historial: la conversación vive en la pantalla.
 *
 * Variables de entorno:
 *   OPENCODE_GO_API_KEY            - key de OpenCode Go (NUNCA con prefijo VITE_)
 *   OPENCODE_GO_MODELO (opcional)  - por defecto claude-haiku-5-5
 *   SUPABASE_URL / SUPABASE_ANON_KEY
 *   URL_AGENTES (opcional)         - respaldo si la base no tiene la URL publicada del mito-server
 */
import { tokenDe } from '../src/lib/apiAuth.js'

type Req = {
  method?: string
  headers: Record<string, string | string[] | undefined>
  body?: unknown
}

type Res = {
  status(code: number): Res
  setHeader(name: string, value: string): Res
  json(body: unknown): void
}

const OPENCODE_URL = 'https://opencode.ai/inference/go/anthropic/v1/messages'
const MAX_VUELTAS = 6
const MAX_RESULTADO = 10_000
const VISTA_ARTICULOS = 'DESKTOP-OA4GU6I:VISTAS_CONSOLIDADAS.dbo.vw_ARTICULOS_MITO'
const COLUMNAS_BUSQUEDA = 'ARTCOD,ID_ARTICULO,ARTICULO,NOMBRE_COMPLETO,DESCRIPCION,ARTDES,ARTDESADIC'

// ---------------------------------------------------------------- Supabase con el JWT del usuario

function supa() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
  const anon = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? ''
  return { url, anon }
}

async function rpc(token: string, fn: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const { url, anon } = supa()
  const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: anon, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(25_000),
  })
  const cuerpo = await r.json().catch(() => null)
  if (!r.ok) throw new Error((cuerpo as { message?: string } | null)?.message ?? `Error ${r.status} en ${fn}`)
  return cuerpo
}

async function tabla(token: string, consulta: string): Promise<unknown> {
  const { url, anon } = supa()
  const r = await fetch(`${url}/rest/v1/${consulta}`, {
    headers: { apikey: anon, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(25_000),
  })
  const cuerpo = await r.json().catch(() => null)
  if (!r.ok) throw new Error((cuerpo as { message?: string } | null)?.message ?? `Error ${r.status}`)
  return cuerpo
}

// ---------------------------------------------------------------- herramientas (solo lectura)

type Esquema = Record<string, unknown>
interface Herramienta {
  nombre: string
  descripcion: string
  parametros: Esquema
  correr: (args: Record<string, unknown>, ctx: { token: string; origen: string }) => Promise<unknown>
}

const FECHA = { type: 'string', description: 'Fecha AAAA-MM-DD' }
const fecha = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)
const texto = (v: unknown, max = 80): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')
/** Valor seguro para un filtro de PostgREST (sin comas, paréntesis ni asteriscos). */
const filtro = (v: string) => encodeURIComponent(v.replace(/[,()*%]/g, ' ').trim())

function rango(args: Record<string, unknown>, diasAtras = 7): { desde: string; hasta: string } {
  const hoy = hoyAr()
  const hasta = fecha(args.hasta) ?? hoy
  const d = new Date(`${hasta}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - diasAtras)
  const desde = fecha(args.desde) ?? d.toISOString().slice(0, 10)
  return { desde, hasta }
}

function hoyAr(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Cordoba' }).format(new Date())
}

const HERRAMIENTAS: Herramienta[] = [
  {
    nombre: 'listar_locales',
    descripcion: 'Lista los locales (código, nombre, zona, activo). Usala para traducir nombres de local a código.',
    parametros: { type: 'object', properties: {} },
    correr: (_a, { token }) => tabla(token, 'locales?select=codigo,nombre,zona,activo&order=codigo'),
  },
  {
    nombre: 'buscar_articulos',
    descripcion:
      'Busca artículos en el SQL de MITO por código o descripción. Devuelve una fila por artículo+color+talle con stock físico, unidades en pedido y precio.',
    parametros: {
      type: 'object',
      properties: { texto: { type: 'string', description: 'Código de artículo o parte de la descripción (mín. 2 letras)' } },
      required: ['texto'],
    },
    correr: async (a, { token, origen }) => {
      const q = texto(a.texto, 60)
      if (q.length < 2) return { error: 'El texto tiene que tener al menos 2 caracteres.' }
      const qs = new URLSearchParams({ where: COLUMNAS_BUSQUEDA, value: q, match: 'contiene', limit: '80' })
      const r = await fetch(`${origen}/api/sql/${encodeURIComponent(VISTA_ARTICULOS)}?${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30_000),
      })
      const cuerpo = (await r.json().catch(() => null)) as { filas?: unknown[]; error?: string } | null
      if (!r.ok) return { error: cuerpo?.error ?? `El puente SQL respondió ${r.status}` }
      const filas = cuerpo?.filas ?? []
      return { cantidad: filas.length, truncado: filas.length >= 80, filas }
    },
  },
  {
    nombre: 'ventas_por_articulo',
    descripcion:
      'Ranking de unidades vendidas por artículo (o por SKU artículo+color+talle) en los locales, para uno o varios días de los últimos ~12. ' +
      'Sale del DWH (misma foto que la repo diaria). Usala para "lo más vendido", "qué se vendió en tal local", etc. ' +
      'Trae también unidades por local y los días disponibles. La primera consulta puede tardar ~1 minuto.',
    parametros: {
      type: 'object',
      properties: {
        fechas: { type: 'array', items: FECHA, description: 'Días a sumar (AAAA-MM-DD)' },
        local: { type: 'string', description: 'Código de local (base Dragon, ej. NVOCED, GPAZD); opcional' },
        agrupar: { type: 'string', enum: ['articulo', 'sku'], description: 'articulo (por defecto) o sku (color y talle)' },
        top: { type: 'number', description: 'Cuántos devolver (1-100, por defecto 20)' },
      },
      required: ['fechas'],
    },
    correr: async (a, { token, origen }) => {
      const fechas = (Array.isArray(a.fechas) ? a.fechas : [a.fechas]).map(fecha).filter(Boolean) as string[]
      if (!fechas.length) return { error: 'Faltan las fechas (AAAA-MM-DD).' }
      const qs = new URLSearchParams({ modo: 'ventas', fechas: fechas.slice(0, 12).join(',') })
      if (texto(a.local, 30)) qs.set('local', texto(a.local, 30))
      if (a.agrupar === 'sku') qs.set('agrupar', 'sku')
      if (Number(a.top)) qs.set('top', String(Math.min(Math.max(Number(a.top), 1), 100)))
      // La foto del DWH tarda ~45 s: el puente contesta "calculando" y se vuelve a preguntar
      const limite = Date.now() + 120_000
      for (;;) {
        const r = await fetch(`${origen}/api/sql/repo-diaria?${qs}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(30_000),
        })
        const cuerpo = (await r.json().catch(() => null)) as ({ estado?: string; error?: string } & Record<string, unknown>) | null
        if (!r.ok) return { error: cuerpo?.error ?? `El puente respondió ${r.status}` }
        if (cuerpo?.estado !== 'calculando') return cuerpo
        if (Date.now() > limite) return { error: 'El DWH sigue calculando; probá de nuevo en un minuto.' }
        await new Promise((ok) => setTimeout(ok, 5000))
      }
    },
  },
  {
    nombre: 'ventas_locales',
    descripcion:
      'Venta y objetivo diario por local (plata, en pesos) entre dos fechas. Incluye si el local operó y si fue feriado.',
    parametros: {
      type: 'object',
      properties: { desde: FECHA, hasta: FECHA, local: { type: 'string', description: 'Código de local (opcional)' } },
    },
    correr: (a, { token }) => {
      const { desde, hasta } = rango(a, 6)
      return rpc(token, 'objetivos_locales_dia', { p_desde: desde, p_hasta: hasta, p_local: texto(a.local, 20) || null })
    },
  },
  {
    nombre: 'contador_clientes',
    descripcion:
      'Entradas de clientes contadas por las cámaras, por local y día, entre dos fechas (tablero del contador).',
    parametros: {
      type: 'object',
      properties: {
        desde: FECHA,
        hasta: FECHA,
        locales: { type: 'array', items: { type: 'string' }, description: 'Códigos de local (opcional)' },
      },
    },
    correr: (a, { token }) => {
      const { desde, hasta } = rango(a, 6)
      const locales = Array.isArray(a.locales) ? a.locales.map((l) => texto(l, 20)).filter(Boolean) : null
      return rpc(token, 'contador_resumen', { p_desde: desde, p_hasta: hasta, p_locales: locales?.length ? locales : null })
    },
  },
  {
    nombre: 'contador_hoy',
    descripcion: 'Entradas de clientes de hoy por local (en vivo), para tasa de conversión del día.',
    parametros: { type: 'object', properties: {} },
    correr: (_a, { token }) => rpc(token, 'contador_locales_hoy'),
  },
  {
    nombre: 'ventas_web',
    descripcion: 'Pedidos de la tienda online (Tiendanube) entre dos fechas: estado, pago, envío, total y unidades. Sin datos del cliente.',
    parametros: { type: 'object', properties: { desde: FECHA, hasta: FECHA } },
    correr: (a, { token }) => {
      const { desde, hasta } = rango(a, 6)
      return tabla(
        token,
        `tn_pedidos?select=numero,creado_at,estado,estado_pago,estado_envio,total,descuento,envio,unidades,medio_pago,canal,provincia,cupon` +
          `&creado_at=gte.${desde}&creado_at=lt.${hasta}T23:59:59.999&order=creado_at.desc&limit=500`,
      )
    },
  },
  {
    nombre: 'pedidos_venta',
    descripcion: 'Pedidos de venta mayoristas (Dragon) entre dos fechas: cliente, total, unidades, motivo y si está anulado.',
    parametros: {
      type: 'object',
      properties: { desde: FECHA, hasta: FECHA, cliente: { type: 'string', description: 'Parte del nombre del cliente (opcional)' } },
    },
    correr: (a, { token }) => {
      const { desde, hasta } = rango(a, 14)
      const cli = texto(a.cliente, 40)
      return tabla(
        token,
        `pedidos_venta?select=codigo,numero,fecha,cliente_nombre,vendedor,total,unidades,motivo_nombre,anulado,base` +
          `&fecha=gte.${desde}&fecha=lte.${hasta}${cli ? `&cliente_nombre=ilike.*${filtro(cli)}*` : ''}&order=fecha.desc&limit=300`,
      )
    },
  },
  {
    nombre: 'estado_pedidos_compra',
    descripcion:
      'Estado de los pedidos de compra a proveedores: unidades pedidas, recibidas, de más y canceladas, y último ingreso.',
    parametros: {
      type: 'object',
      properties: { proveedor: { type: 'string', description: 'Parte del nombre o código del proveedor (opcional)' } },
    },
    correr: async (a, { token }) => {
      const filas = (await rpc(token, 'estado_pedidos_compra')) as Array<Record<string, unknown>>
      const p = texto(a.proveedor, 40).toLowerCase()
      const sel = p
        ? filas.filter((f) => `${f.proveedor ?? ''} ${f.proveedor_nombre ?? ''}`.toLowerCase().includes(p))
        : filas
      return { cantidad: sel.length, filas: sel.slice(0, 150) }
    },
  },
  {
    nombre: 'ordenes_compra',
    descripcion: 'Órdenes de compra internas (OC) entre dos fechas de compra: tipo, área, proveedor, monto, entrega y estado en Dragon.',
    parametros: {
      type: 'object',
      properties: { desde: FECHA, hasta: FECHA, proveedor: { type: 'string', description: 'Parte del proveedor (opcional)' } },
    },
    correr: (a, { token }) => {
      const { desde, hasta } = rango(a, 30)
      const prov = texto(a.proveedor, 40)
      return tabla(
        token,
        `ordenes_compra?select=numero,tipo,area,responsable,proveedor,fecha_compra,fecha_entrega,forma_pago,monto_bruto,dragon_estado,cancelada_at,no_autorizada` +
          `&fecha_compra=gte.${desde}&fecha_compra=lte.${hasta}${prov ? `&proveedor=ilike.*${filtro(prov)}*` : ''}&order=numero.desc&limit=200`,
      )
    },
  },
  {
    nombre: 'transferencias',
    descripcion: 'Lotes de transferencias/reposiciones entre locales cargados entre dos fechas (nombre, fecha, motivo).',
    parametros: { type: 'object', properties: { desde: FECHA, hasta: FECHA } },
    correr: (a, { token }) => {
      const { desde, hasta } = rango(a, 14)
      return tabla(token, `transfer_lotes?select=id,nombre,fecha,motivo&fecha=gte.${desde}&fecha=lte.${hasta}&order=fecha.desc&limit=200`)
    },
  },
  {
    nombre: 'listar_tablas',
    descripcion:
      'Catálogo de TODAS las tablas del hub (Supabase) que se pueden leer, con sus columnas. Sin "buscar" devuelve solo los nombres; ' +
      'con "buscar" (parte del nombre de tabla o columna) devuelve las columnas de las que coinciden. Usala antes de leer_tabla.',
    parametros: { type: 'object', properties: { buscar: { type: 'string', description: 'Texto a buscar en tablas/columnas (opcional)' } } },
    correr: async (a) => {
      const tablas = await leerCatalogo()
      const q = texto(a.buscar, 40).toLowerCase()
      if (!q) return { tablas: [...tablas.keys()].sort() }
      const coinciden = [...tablas.entries()].filter(([t, cols]) => t.includes(q) || cols.some((c) => c.columna.includes(q)))
      return { tablas: Object.fromEntries(coinciden.slice(0, 20).map(([t, cols]) => [t, cols.map((c) => `${c.columna}:${c.tipo}`).join(', ')])) }
    },
  },
  {
    nombre: 'leer_tabla',
    descripcion:
      'Lee filas de cualquier tabla del hub (solo lectura, sin columnas secretas). Filtros con operadores PostgREST ' +
      '(eq, neq, gt, gte, lt, lte, like, ilike con * o %, is null/true/false, in con lista). Devuelve también el total de filas que cumplen.',
    parametros: {
      type: 'object',
      properties: {
        tabla: { type: 'string' },
        columnas: { type: 'array', items: { type: 'string' }, description: 'Columnas a traer (por defecto todas las permitidas)' },
        filtros: {
          type: 'array',
          items: {
            type: 'object',
            properties: { columna: { type: 'string' }, operador: { type: 'string' }, valor: {} },
            required: ['columna', 'operador', 'valor'],
          },
        },
        orden: { type: 'string', description: 'Columna para ordenar' },
        descendente: { type: 'boolean' },
        limite: { type: 'number', description: '1-300, por defecto 50' },
      },
      required: ['tabla'],
    },
    correr: async (a, { token }) => {
      const tablas = await leerCatalogo()
      const nombre = texto(a.tabla, 63)
      const cols = tablas.get(nombre)
      if (!cols) return { error: `La tabla "${nombre}" no existe o no se puede leer. Usá listar_tablas.` }
      const validas = new Set(cols.map((c) => c.columna))
      const pedidas = Array.isArray(a.columnas) ? a.columnas.map((c) => texto(c, 63)).filter((c) => validas.has(c)) : []
      const select = (pedidas.length ? pedidas : [...validas]).join(',')
      const partes = [`select=${encodeURIComponent(select)}`]
      for (const f of Array.isArray(a.filtros) ? a.filtros.slice(0, 10) : []) {
        const fil = f as { columna?: unknown; operador?: unknown; valor?: unknown }
        const col = texto(fil.columna, 63)
        const op = texto(fil.operador, 6).toLowerCase()
        if (!validas.has(col)) return { error: `La columna "${col}" no existe en ${nombre} o no se puede leer.` }
        if (!OPERADORES.has(op)) return { error: `Operador inválido: ${op}` }
        partes.push(`${col}=${op}.${valorFiltro(op, fil.valor)}`)
      }
      const orden = texto(a.orden, 63)
      if (orden && validas.has(orden)) partes.push(`order=${orden}.${a.descendente ? 'desc' : 'asc'}.nullslast`)
      partes.push(`limit=${Math.min(Math.max(Number(a.limite) || 50, 1), 300)}`)
      const { url, anon } = supa()
      const r = await fetch(`${url}/rest/v1/${nombre}?${partes.join('&')}`, {
        headers: { apikey: anon, Authorization: `Bearer ${token}`, Prefer: 'count=exact' },
        signal: AbortSignal.timeout(25_000),
      })
      const cuerpo = await r.json().catch(() => null)
      if (!r.ok) return { error: (cuerpo as { message?: string } | null)?.message ?? `Error ${r.status}` }
      const total = Number(r.headers.get('content-range')?.split('/')[1]) || undefined
      return { total, filas: cuerpo }
    },
  },
  {
    nombre: 'listar_vistas_sql',
    descripcion: 'Vistas del SQL Server (Dragon, DWH, etc.) habilitadas para consultar desde el hub (las de Datos SQL).',
    parametros: { type: 'object', properties: {} },
    correr: async () => ({ vistas: await vistasSql() }),
  },
  {
    nombre: 'leer_vista_sql',
    descripcion:
      'Lee filas de una vista habilitada del SQL Server. "buscar" filtra por código o descripción de artículo (LIKE). Solo lectura.',
    parametros: {
      type: 'object',
      properties: {
        vista: { type: 'string', description: 'Nombre exacto, tal cual lo da listar_vistas_sql' },
        buscar: { type: 'string' },
        limite: { type: 'number', description: '1-300, por defecto 100' },
      },
      required: ['vista'],
    },
    correr: async (a, { token, origen }) => {
      const vista = texto(a.vista, 150)
      if (!(await vistasSql()).includes(vista)) return { error: `La vista "${vista}" no está habilitada. Usá listar_vistas_sql.` }
      const qs = new URLSearchParams({ limit: String(Math.min(Math.max(Number(a.limite) || 100, 1), 300)) })
      const q = texto(a.buscar, 60)
      if (q) {
        qs.set('where', COLUMNAS_BUSQUEDA)
        qs.set('value', q)
        qs.set('match', 'contiene')
      }
      const r = await fetch(`${origen}/api/sql/${encodeURIComponent(vista)}?${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(40_000),
      })
      const cuerpo = (await r.json().catch(() => null)) as { filas?: unknown[]; error?: string; detalle?: string } | null
      if (!r.ok) return { error: [cuerpo?.error, cuerpo?.detalle].filter(Boolean).join(' — ') || `Error ${r.status}` }
      return { cantidad: cuerpo?.filas?.length ?? 0, filas: cuerpo?.filas ?? [] }
    },
  },
]

// ---------------------------------------------------------------- lectura general (sin secretos)

/** Tablas que el chat NUNCA lee: secretos, tokens, suscripciones push, configuración con claves. */
const TABLAS_BLOQUEADAS = new Set([
  'puente_secreto', 'push_suscripciones', 'tracking_push', 'qr_tokens', 'ordenes_compra_claves',
  'sql_conexion', 'telegram_vinculos', 'app_config', 'config_app', 'contador_config',
])
/** Columnas que nunca se leen, en ninguna tabla. */
const COLUMNA_SECRETA = /^(token|token_hash|hash|qr_token|p256dh|auth|endpoint)$|pass|contrase|secret|api_?key|private|clave_api/i

type Catalogo = Map<string, Array<{ columna: string; tipo: string }>>
let catalogo: { en: number; tablas: Catalogo } | null = null

/**
 * Tablas y columnas del esquema public. Supabase solo entrega el catálogo (OpenAPI de PostgREST)
 * con la clave de servicio: se usa SOLO para eso, sin leer datos. Los datos se leen con el JWT
 * del usuario, así que valen la RLS y los permisos de la base. Se cachea 10 minutos.
 */
async function leerCatalogo(): Promise<Catalogo> {
  if (catalogo && Date.now() - catalogo.en < 10 * 60_000) return catalogo.tablas
  const { url } = supa()
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!url || !service) throw new Error('Falta SUPABASE_SERVICE_ROLE_KEY para leer el catálogo')
  const r = await fetch(`${url}/rest/v1/`, {
    headers: { apikey: service, Authorization: `Bearer ${service}`, Accept: 'application/openapi+json' },
    signal: AbortSignal.timeout(20_000),
  })
  if (!r.ok) throw new Error(`No se pudo leer el catálogo (${r.status})`)
  const api = (await r.json()) as { definitions?: Record<string, { properties?: Record<string, { type?: string; format?: string }> }> }
  const tablas: Catalogo = new Map()
  for (const [nombre, def] of Object.entries(api.definitions ?? {})) {
    if (TABLAS_BLOQUEADAS.has(nombre)) continue
    const cols = Object.entries(def.properties ?? {})
      .filter(([c]) => !COLUMNA_SECRETA.test(c))
      .map(([c, d]) => ({ columna: c, tipo: d.format || d.type || '' }))
    if (cols.length) tablas.set(nombre, cols)
  }
  catalogo = { en: Date.now(), tablas }
  return tablas
}

const OPERADORES = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in'])

/** Valor seguro para PostgREST: sin caracteres que rompan la sintaxis del filtro. */
function valorFiltro(op: string, v: unknown): string {
  if (op === 'is') {
    const t = String(v).toLowerCase()
    return ['null', 'true', 'false'].includes(t) ? t : 'null'
  }
  if (op === 'in') {
    const lista = (Array.isArray(v) ? v : String(v).split(',')).map((x) => `"${String(x).replace(/["\\]/g, '').trim()}"`)
    return `(${lista.slice(0, 50).join(',')})`
  }
  let t = String(v ?? '').slice(0, 200)
  if (op === 'like' || op === 'ilike') t = t.replace(/%/g, '*')
  return encodeURIComponent(t)
}

/** Vistas del SQL Server habilitadas en Configuraciones > Conexión SQL (las mismas que Datos SQL). */
async function vistasSql(): Promise<string[]> {
  const { url } = supa()
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  const fijas = (process.env.SQL_VIEWS ?? '').split(',').map((v) => v.trim()).filter(Boolean)
  if (!url || !service) return fijas
  try {
    const r = await fetch(`${url}/rest/v1/config_app?clave=eq.sql_vistas&select=valor`, {
      headers: { apikey: service, Authorization: `Bearer ${service}` },
    })
    const filas = (await r.json().catch(() => null)) as Array<{ valor?: unknown }> | null
    const raw = filas?.[0]?.valor
    const lista = typeof raw === 'string' ? JSON.parse(raw) : raw
    const deDb = Array.isArray(lista)
      ? lista.map((v) => (typeof v === 'object' && v ? String((v as Record<string, unknown>).vista ?? '') : '')).filter(Boolean)
      : []
    return [...new Set([...fijas, ...deDb])]
  } catch {
    return fijas
  }
}

function sistema(): string {
  return [
    'Sos el asistente de datos del Hub MITO (empresa de indumentaria con locales, mayorista, fábrica y tienda web, en Córdoba, Argentina).',
    `Hoy es ${hoyAr()}. Respondé siempre en español rioplatense, breve y claro.`,
    'Para cualquier número usá las herramientas: nunca inventes datos. Si una herramienta falla o no trae nada, decilo.',
    'Las herramientas son de solo lectura: no podés modificar nada. Nunca mostrás claves, contraseñas, tokens ni secretos.',
    'Preferí las herramientas específicas (ventas, contador, ventas_por_articulo, etc.). Si ninguna sirve, usá listar_tablas + leer_tabla ' +
      '(cualquier tabla del hub) o listar_vistas_sql + leer_vista_sql (SQL Server). Pedí solo las columnas y filas necesarias.',
    'Los resultados de las herramientas vienen como tabla: primera línea = columnas, después una fila por línea separada por |.',
    'Mostrá montos en pesos con separador de miles (ej. $ 1.234.567) y usá tablas Markdown cortas cuando haya varias filas.',
    'Si el pedido es ambiguo (qué local, qué fechas), elegí lo más razonable y aclaralo en una línea.',
  ].join('\n')
}

// ---------------------------------------------------------------- formato interno (estilo Anthropic)

type Bloque =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
type Mensaje = { role: 'user' | 'assistant'; content: string | Bloque[] }

class SinCupo extends Error {}

// ---------------------------------------------------------------- tokens: resultados compactos y medición

/** Celda de tabla: sin saltos ni barras (rompen el formato), números tal cual. */
function celda(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v).replace(/[|\r\n]+/g, ' ').trim()
}

const esFila = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)

/**
 * Resultado de una herramienta en texto compacto para el modelo: las listas de filas van como
 * tabla (encabezado UNA vez y valores separados por |) en vez de JSON, que repite el nombre de
 * cada columna en cada fila. Mismo dato, ~40-60 % menos tokens.
 */
function compactar(v: unknown, sangria = ''): string {
  if (Array.isArray(v)) {
    if (!v.length) return `${sangria}(vacío)`
    if (v.every(esFila)) {
      const cols: string[] = []
      for (const f of v) for (const k of Object.keys(f)) if (!cols.includes(k) && cols.length < 40) cols.push(k)
      const filas = v.map((f) => cols.map((c) => celda(f[c])).join('|'))
      return [`${sangria}${cols.join('|')}`, ...filas.map((f) => `${sangria}${f}`)].join('\n')
    }
    return `${sangria}${v.map(celda).join(', ')}`
  }
  if (esFila(v)) {
    return Object.entries(v)
      .filter(([, x]) => x !== undefined)
      .map(([k, x]) =>
        Array.isArray(x) || esFila(x) ? `${sangria}${k}:\n${compactar(x, `${sangria}  `)}` : `${sangria}${k}: ${celda(x)}`,
      )
      .join('\n')
  }
  return `${sangria}${celda(v)}`
}

interface Uso {
  vueltas: number
  entrada: number
  salida: number
  cache: number
}

/** user id (sub) del JWT, sin verificar: solo para anotar el consumo (el acceso ya lo validó soy_admin). */
function usuarioDelToken(token: string): string | null {
  try {
    const sub = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))?.sub
    return typeof sub === 'string' && /^[0-9a-f-]{36}$/i.test(sub) ? sub : null
  } catch {
    return null
  }
}

/** Anota el consumo de la pregunta en chat_ia_uso (sin texto de preguntas ni respuestas). Nunca falla la respuesta. */
async function registrarUso(fila: Record<string, unknown>) {
  console.log('[chat-ia] uso', JSON.stringify(fila))
  const { url } = supa()
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!url || !service) return
  try {
    await fetch(`${url}/rest/v1/chat_ia_uso`, {
      method: 'POST',
      headers: { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(fila),
      signal: AbortSignal.timeout(5000),
    })
  } catch {
    /* la medición es opcional */
  }
}

async function vueltaOpencode(mensajes: Mensaje[], sesion: string, uso: Uso): Promise<Bloque[]> {
  const key = process.env.OPENCODE_GO_API_KEY?.trim()
  if (!key) throw new SinCupo('OpenCode Go no está configurado')
  let r: Response
  try {
    r = await fetch(OPENCODE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        Authorization: `Bearer ${key}`,
        'anthropic-version': '2023-06-01',
        // OpenCode Go exige un ID de sesión estable por conversación y un User-Agent propio
        'x-opencode-session': sesion,
        'User-Agent': 'hub-mito-chat/1.0',
      },
      body: JSON.stringify({
        model: process.env.OPENCODE_GO_MODELO?.trim() || 'claude-haiku-5-5',
        max_tokens: 8192,
        system: sistema(),
        tools: HERRAMIENTAS.map((h) => ({ name: h.nombre, description: h.descripcion, input_schema: h.parametros })),
        messages: mensajes,
      }),
      signal: AbortSignal.timeout(40_000),
    })
  } catch (err) {
    throw new SinCupo(`OpenCode Go no respondió (${(err as Error).message})`)
  }
  const cuerpo = (await r.json().catch(() => null)) as {
    content?: Bloque[]
    error?: { message?: string }
    usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }
  } | null
  if (!r.ok) {
    const msg = cuerpo?.error?.message ?? `OpenCode Go respondió ${r.status}`
    // 401/402/403/429/5xx: se pasa a Ollama. 400 es un error nuestro, también se intenta con Ollama.
    throw new SinCupo(msg)
  }
  uso.vueltas++
  uso.entrada += (cuerpo?.usage?.input_tokens ?? 0) + (cuerpo?.usage?.cache_creation_input_tokens ?? 0)
  uso.salida += cuerpo?.usage?.output_tokens ?? 0
  uso.cache += cuerpo?.usage?.cache_read_input_tokens ?? 0
  return (cuerpo?.content ?? []).filter((b) => b.type === 'text' || b.type === 'tool_use')
}

/**
 * URLs candidatas del mito-server, en orden: la que publicó la PC en la base (túnel) y la del
 * entorno (Funnel de Tailscale). La de la base puede quedar vieja si el túnel cambió y el
 * script no la volvió a publicar (pasó el 11/11/2026), por eso se prueba la siguiente.
 */
async function urlsAgentes(token: string): Promise<string[]> {
  const urls: string[] = []
  try {
    const u = await rpc(token, 'url_agentes')
    if (typeof u === 'string' && u.trim()) urls.push(u.trim())
  } catch {
    /* sigue con el env */
  }
  for (const e of [process.env.URL_AGENTES, process.env.VITE_URL_AGENTES]) if (e?.trim()) urls.push(e.trim())
  return [...new Set(urls.map((u) => u.replace(/\/$/, '')))]
}

/** Primera URL del mito-server que contesta /api/salud (rápido, 6 s cada una). */
async function urlAgentes(token: string): Promise<string> {
  const urls = await urlsAgentes(token)
  for (const u of urls) {
    try {
      const r = await fetch(`${u}/api/salud`, { signal: AbortSignal.timeout(6000) })
      if (r.ok) return u
    } catch {
      /* prueba la siguiente */
    }
  }
  return ''
}

/** Convierte la conversación al formato de Ollama (/api/chat). */
function aOllama(mensajes: Mensaje[]) {
  const nombres = new Map<string, string>()
  const salida: Array<Record<string, unknown>> = [{ role: 'system', content: sistema() }]
  for (const m of mensajes) {
    if (typeof m.content === 'string') {
      salida.push({ role: m.role, content: m.content })
      continue
    }
    if (m.role === 'assistant') {
      const textoA = m.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('\n')
      const llamadas = m.content.filter((b): b is Extract<Bloque, { type: 'tool_use' }> => b.type === 'tool_use')
      for (const l of llamadas) nombres.set(l.id, l.name)
      salida.push({
        role: 'assistant',
        content: textoA,
        ...(llamadas.length ? { tool_calls: llamadas.map((l) => ({ function: { name: l.name, arguments: l.input } })) } : {}),
      })
    } else {
      for (const b of m.content) {
        if (b.type === 'tool_result') salida.push({ role: 'tool', tool_name: nombres.get(b.tool_use_id) ?? '', content: b.content })
        else if (b.type === 'text') salida.push({ role: 'user', content: b.text })
      }
    }
  }
  return salida
}

async function vueltaOllama(mensajes: Mensaje[], token: string): Promise<Bloque[]> {
  const base = await urlAgentes(token)
  if (!base) throw new Error('El servidor de agentes (mito-server) no responde desde afuera: revisá el túnel o el Funnel de la PC.')
  const r = await fetch(`${base}/api/ia/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      mensajes: aOllama(mensajes),
      herramientas: HERRAMIENTAS.map((h) => ({
        type: 'function',
        function: { name: h.nombre, description: h.descripcion, parameters: h.parametros },
      })),
    }),
    // Ollama en CPU es lento: hasta 4 min por vuelta (la función tiene 300 s en vercel.json, plan Pro)
    signal: AbortSignal.timeout(240_000),
  })
  const cuerpo = (await r.json().catch(() => null)) as {
    mensaje?: { content?: string; tool_calls?: Array<{ function: { name: string; arguments: unknown } }> }
    error?: string
  } | null
  if (!r.ok || !cuerpo?.mensaje) throw new Error(cuerpo?.error ?? `El mito-server respondió ${r.status}`)
  const bloques: Bloque[] = []
  const t = (cuerpo.mensaje.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim()
  if (t) bloques.push({ type: 'text', text: t })
  ;(cuerpo.mensaje.tool_calls ?? []).forEach((l, i) => {
    let input = l.function.arguments
    if (typeof input === 'string') input = JSON.parse(input || '{}')
    bloques.push({ type: 'tool_use', id: `ollama_${Date.now()}_${i}`, name: l.function.name, input: (input ?? {}) as Record<string, unknown> })
  })
  return bloques
}

// ---------------------------------------------------------------- handler

export default async function handler(req: Req, res: Res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Usá POST' })

  const token = tokenDe(req.headers.authorization as string | undefined)
  let admin = false
  try {
    admin = token ? (await rpc(token, 'soy_admin')) === true : false
  } catch {
    admin = false
  }
  if (!admin) return res.status(403).json({ error: 'El chat IA es solo para administradores.' })

  const body = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body ?? {}) as {
    mensajes?: Array<{ role?: string; content?: unknown }>
    sesion?: unknown
  }
  const sesion =
    typeof body.sesion === 'string' && /^[\w-]{8,64}$/.test(body.sesion) ? body.sesion : crypto.randomUUID()
  const historial: Mensaje[] = (body.mensajes ?? [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-20)
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: (m.content as string).slice(0, 4000) }))
  if (!historial.length || historial[historial.length - 1].role !== 'user') {
    return res.status(400).json({ error: 'Falta la pregunta.' })
  }

  const host = (req.headers['x-forwarded-host'] ?? req.headers.host) as string | undefined
  const origen = `${host?.startsWith('localhost') ? 'http' : 'https'}://${host}`
  const consultas: string[] = []
  let proveedor: 'opencode' | 'ollama' = 'opencode'
  let avisoRespaldo = ''
  const mensajes = [...historial]
  const uso: Uso = { vueltas: 0, entrada: 0, salida: 0, cache: 0 }
  const inicio = Date.now()
  const anotar = () =>
    registrarUso({
      usuario_id: usuarioDelToken(token),
      proveedor,
      vueltas: uso.vueltas,
      herramientas: consultas,
      tokens_entrada: uso.entrada,
      tokens_salida: uso.salida,
      tokens_cache: uso.cache,
      ms: Date.now() - inicio,
    })

  try {
    for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
      let bloques: Bloque[]
      if (proveedor === 'opencode') {
        try {
          bloques = await vueltaOpencode(mensajes, sesion, uso)
        } catch (err) {
          if (!(err instanceof SinCupo)) throw err
          proveedor = 'ollama'
          avisoRespaldo = err.message
          bloques = await vueltaOllama(mensajes, token)
        }
      } else {
        bloques = await vueltaOllama(mensajes, token)
      }

      const llamadas = bloques.filter((b): b is Extract<Bloque, { type: 'tool_use' }> => b.type === 'tool_use')
      mensajes.push({ role: 'assistant', content: bloques })
      if (!llamadas.length) {
        const respuesta = bloques.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('\n').trim()
        await anotar()
        return res.status(200).json({
          respuesta: respuesta || '(sin respuesta)',
          proveedor,
          consultas,
          aviso: avisoRespaldo || undefined,
          tokens: uso.entrada + uso.salida + uso.cache,
        })
      }

      const resultados: Bloque[] = []
      for (const l of llamadas) {
        const h = HERRAMIENTAS.find((x) => x.nombre === l.name)
        consultas.push(l.name)
        if (!h) {
          resultados.push({ type: 'tool_result', tool_use_id: l.id, content: 'Herramienta inexistente', is_error: true })
          continue
        }
        try {
          let salida = compactar(await h.correr(l.input ?? {}, { token, origen }))
          if (salida.length > MAX_RESULTADO) salida = `${salida.slice(0, MAX_RESULTADO)}… (recortado: pedí un rango más chico)`
          resultados.push({ type: 'tool_result', tool_use_id: l.id, content: salida })
        } catch (err) {
          resultados.push({ type: 'tool_result', tool_use_id: l.id, content: `Error: ${(err as Error).message}`, is_error: true })
        }
      }
      mensajes.push({ role: 'user', content: resultados })
    }
    await anotar()
    return res.status(200).json({
      respuesta: 'La consulta necesitó demasiados pasos. Probá con una pregunta más acotada.',
      proveedor,
      consultas,
    })
  } catch (err) {
    return res.status(502).json({
      error: `No se pudo responder: ${(err as Error).message}${avisoRespaldo ? ` (OpenCode: ${avisoRespaldo})` : ''}`,
    })
  }
}
