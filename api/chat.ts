/**
 * Chat IA del hub (pantalla /chat-ia, solo administradores).
 *
 *   POST /api/chat  { mensajes: [{ role: 'user'|'assistant', content: string }] }
 *     -> { respuesta, proveedor: 'claude'|'opencode'|'ollama', modelo, consultas: string[] }
 *
 * Tres modelos que trabajan juntos, en cascada (si uno no está configurado, se quedó sin saldo,
 * rechaza o no responde, la MISMA pregunta sigue con el siguiente, desde donde quedó):
 *   1. Claude Sonnet 5.5 por la API de Anthropic (créditos de API del plan Team): el principal.
 *   2. OpenCode Go (Claude Haiku 5.5, endpoint compatible con la API de Anthropic).
 *   3. Ollama del mito-server (POST <url_agentes>/api/ia/chat): último recurso (lento).
 * Las herramientas de datos corren SIEMPRE acá, con el JWT del usuario (RLS y permisos de la
 * base intactos) y son de solo lectura. No se exponen datos personales (RRHH, DNI, clientes
 * de la tienda web, usuarios). No se guarda historial: la conversación vive en la pantalla.
 *
 * Variables de entorno:
 *   ANTHROPIC_API_KEY              - key de la consola de Anthropic (NUNCA con prefijo VITE_)
 *   ANTHROPIC_MODELO (opcional)    - por defecto claude-sonnet-5-5
 *   ANTHROPIC_WORKSPACE_ID (opc.)  - solo si la key es de organización (sin workspace): wrkspc_...
 *   OPENCODE_GO_API_KEY           - key de OpenCode Go (NUNCA con prefijo VITE_)
 *   OPENCODE_GO_MODELO (opcional)  - por defecto claude-haiku-5-5
 *   SUPABASE_URL / SUPABASE_ANON_KEY
 *   URL_AGENTES (opcional)         - respaldo si la base no tiene la URL publicada del mito-server
 */
import Anthropic from '@anthropic-ai/sdk'
import { tokenDe } from '../src/lib/apiAuth.js'
import { postAlPuente, urlsDelPuente } from '../src/lib/puenteRetry.js'

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
const MAX_VUELTAS = 8
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

/** GET/POST a un endpoint del propio hub con el JWT del usuario (los permisos los valida ese endpoint). */
async function hub(
  origen: string,
  token: string,
  ruta: string,
  { qs, body, timeout = 40_000 }: { qs?: URLSearchParams; body?: unknown; timeout?: number } = {},
): Promise<Record<string, unknown>> {
  const r = await fetch(`${origen}/api/${ruta}${qs ? `?${qs}` : ''}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(timeout),
  })
  const cuerpo = (await r.json().catch(() => null)) as Record<string, unknown> | null
  if (!r.ok || !cuerpo) throw new Error(String(cuerpo?.error ?? `El hub respondió ${r.status} en ${ruta}`))
  return cuerpo
}

/** Acción de solo lectura directa al Puente SQL (stock de locales: el endpoint de la tienda pide otra clave). */
async function alPuente(cuerpo: Record<string, unknown>, timeoutMs = 30_000): Promise<Record<string, unknown>> {
  const destino = (await urlsDelPuente())[0] ?? process.env.SQL_LOGICAPP_URL ?? ''
  const tokenPuente = process.env.SQL_BRIDGE_TOKEN ?? ''
  if (!destino || !tokenPuente) throw new Error('Falta configurar el Puente SQL')
  const r0 = await postAlPuente(
    destino,
    { headers: { 'Content-Type': 'application/json', 'X-Puente-Token': tokenPuente }, body: JSON.stringify(cuerpo) },
    { timeoutMs, intentos: 2 },
  )
  if (!r0.ok) throw new Error('No se pudo contactar la PC del SQL (puente)')
  const datos = (await r0.res.json().catch(() => null)) as Record<string, unknown> | null
  if (!r0.res.ok || !datos) throw new Error(`Puente SQL: ${String(datos?.error ?? `respuesta ${r0.res.status}`)}`)
  return datos
}

const codigosArticulo = (v: unknown, max: number): string[] =>
  [...new Set((Array.isArray(v) ? v : String(v ?? '').split(',')).map((x) => String(x).trim().toUpperCase()))]
    .filter((x) => /^[A-Z0-9._/-]{1,40}$/.test(x))
    .slice(0, max)

const num = (v: unknown) => Number(v) || 0

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
      'Ranking de unidades vendidas por artículo (o por SKU artículo+color+talle) en los locales, para uno o varios días de los últimos ~12, HOY INCLUIDO. ' +
      'Sale directo de las bases Dragon de los locales (mismos criterios que el DWH; tarda unos segundos). Usala para "lo más vendido", "qué se vendió en tal local", etc. ' +
      'Trae también unidades por local y los días disponibles. Si las bases no responden usa la foto del DWH, que puede tardar ~1 minuto.',
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
      'Estado de los pedidos de compra a proveedores (todos, no anulados): unidades pedidas, recibidas, canceladas y PENDIENTES ' +
      '(pedidas − recibidas − canceladas = lo que el proveedor todavía debe). Sin proveedor: resumen por proveedor de TODOS los pedidos, ' +
      'ordenado por pendientes (completo, sirve para rankings). Con proveedor: además el detalle de sus pedidos. ' +
      'Los pedidos anteriores a la fecha de corte del hub (hoy marzo 2026) están marcados SIN SALDO: su pendiente no cuenta ' +
      '("pedidos_sin_saldo" dice cuántos). Con "desde" se cuentan solo los pedidos desde esa fecha.',
    parametros: {
      type: 'object',
      properties: {
        proveedor: { type: 'string', description: 'Parte del nombre o código del proveedor (opcional)' },
        desde: { ...FECHA, description: 'Solo pedidos con fecha desde este día (opcional, AAAA-MM-DD)' },
      },
    },
    correr: async (a, { token }) => {
      const filas = (await rpc(token, 'estado_pedidos_compra')) as Array<Record<string, unknown>>
      const p = texto(a.proveedor, 40).toLowerCase()
      const desde = fecha(a.desde)
      const sel = filas.filter(
        (f) =>
          (!p || `${f.proveedor ?? ''} ${f.proveedor_nombre ?? ''}`.toLowerCase().includes(p)) &&
          (!desde || String(f.fecha ?? '').slice(0, 10) >= desde),
      )
      const n = (v: unknown) => Number(v) || 0
      // Los pedidos anteriores a la fecha de corte (config_app.pedidos_compra_saldo_desde) no cuentan
      const pend = (f: Record<string, unknown>) => (f.sin_saldo ? 0 : Math.max(n(f.unidades) - n(f.recibidas) - n(f.canceladas), 0))

      // Se resume acá: 500 pedidos con todos sus campos no entran en el resultado (se recortan a 10.000
      // caracteres) y el ranking salía con una parte. Por proveedor entran todos.
      const grupos = new Map<string, { proveedor: string; codigos: Set<string>; pedidos: number; con_pendiente: number; pedidas: number; recibidas: number; canceladas: number; pendientes: number; pendiente_mas_viejo: string; ultimo_ingreso: string }>()
      for (const f of sel) {
        const nombre = String(f.proveedor_nombre ?? '').trim() || String(f.proveedor ?? '').trim() || '(sin proveedor)'
        const g = grupos.get(nombre) ?? { proveedor: nombre, codigos: new Set(), pedidos: 0, con_pendiente: 0, pedidas: 0, recibidas: 0, canceladas: 0, pendientes: 0, pendiente_mas_viejo: '', ultimo_ingreso: '' }
        const fp = String(f.fecha ?? '').slice(0, 10)
        if (pend(f) > 0 && fp && (!g.pendiente_mas_viejo || fp < g.pendiente_mas_viejo)) g.pendiente_mas_viejo = fp
        if (f.proveedor) g.codigos.add(String(f.proveedor).trim())
        g.pedidos++
        g.pedidas += n(f.unidades)
        g.recibidas += n(f.recibidas)
        g.canceladas += n(f.canceladas)
        g.pendientes += pend(f)
        if (pend(f) > 0) g.con_pendiente++
        const ult = String(f.ultimo_ingreso ?? '').slice(0, 10)
        if (ult > g.ultimo_ingreso) g.ultimo_ingreso = ult
        grupos.set(nombre, g)
      }
      const proveedores = [...grupos.values()]
        .sort((x, y) => y.pendientes - x.pendientes || y.pedidas - x.pedidas)
        .map(({ codigos, ...g }) => ({ ...g, codigos: [...codigos].join(',') }))
      const total = (k: 'pedidas' | 'recibidas' | 'canceladas' | 'pendientes') => proveedores.reduce((s, g) => s + g[k], 0)
      const MAX_PROV = 60
      return {
        ...(desde ? { desde } : {}),
        pedidos: sel.length,
        pedidos_sin_saldo: sel.filter((f) => f.sin_saldo).length,
        totales: { pedidas: total('pedidas'), recibidas: total('recibidas'), canceladas: total('canceladas'), pendientes: total('pendientes') },
        cantidad_proveedores: proveedores.length,
        // Columnas + filas (sin repetir los nombres de campo): así entran todos en el resultado
        columnas: ['proveedor', 'codigos', 'pedidos', 'con_pendiente', 'pedidas', 'recibidas', 'canceladas', 'pendientes', 'pendiente_mas_viejo', 'ultimo_ingreso'],
        proveedores: proveedores
          .slice(0, MAX_PROV)
          .map((g) => [g.proveedor.slice(0, 45), g.codigos, g.pedidos, g.con_pendiente, g.pedidas, g.recibidas, g.canceladas, g.pendientes, g.pendiente_mas_viejo || null, g.ultimo_ingreso || null]),
        ...(proveedores.length > MAX_PROV ? { nota: `Se muestran los ${MAX_PROV} con más pendientes; los totales son de todos.` } : {}),
        // Con un proveedor puntual, también el detalle (primero los que deben más)
        ...(p
          ? {
              detalle: sel
                .map((f) => ({
                  numero: f.numero, fecha: f.fecha, proveedor: f.proveedor, observacion: String(f.observacion ?? '').slice(0, 60),
                  pedidas: n(f.unidades), recibidas: n(f.recibidas), canceladas: n(f.canceladas), pendientes: pend(f),
                  ultimo_ingreso: String(f.ultimo_ingreso ?? '').slice(0, 10) || null,
                }))
                .sort((x, y) => y.pendientes - x.pendientes)
                .slice(0, 50),
            }
          : {}),
      }
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
    nombre: 'stock_articulo',
    descripcion:
      'Stock REAL (físico − pedido − preparado) de uno o varios artículos en el depósito MITO y en los 17 locales a la calle, en vivo de Dragon. ' +
      'Devuelve el total por artículo y local; con detalle=true (o un solo artículo) también por color y talle. ' +
      'Pide CÓDIGOS de artículo: si el usuario da una descripción, primero buscá el código con buscar_articulos.',
    parametros: {
      type: 'object',
      properties: {
        articulos: { type: 'array', items: { type: 'string' }, description: 'Códigos de artículo (1 a 60), ej. CF264132' },
        locales: { type: 'array', items: { type: 'string' }, description: 'Solo estos locales (códigos, opcional). MITO = depósito mayorista' },
        detalle: { type: 'boolean', description: 'true: abrir por color y talle' },
      },
      required: ['articulos'],
    },
    correr: async (a) => {
      const arts = codigosArticulo(a.articulos, 60)
      if (!arts.length) return { error: 'Pasá al menos un código de artículo válido (usá buscar_articulos si tenés la descripción).' }
      const soloLocales = new Set(
        (Array.isArray(a.locales) ? a.locales : []).map((l) => texto(l, 20).toUpperCase()).filter(Boolean),
      )
      const [mito, locales] = await Promise.allSettled([
        alPuente({ accion: 'stock_tienda', articulos: arts }),
        alPuente({ accion: 'stock_tienda', articulos: arts, locales: true }, 45_000),
      ])
      type Fila = { l?: string; a: string; c: string; t: string; s: number }
      const filas: Fila[] = []
      const sinDatos: string[] = []
      if (mito.status === 'fulfilled') for (const f of (mito.value.filas as Fila[]) ?? []) filas.push({ ...f, l: 'MITO' })
      else sinDatos.push(`MITO (${(mito.reason as Error).message})`)
      if (locales.status === 'fulfilled') {
        for (const f of (locales.value.filas as Fila[]) ?? []) filas.push(f)
        sinDatos.push(...(((locales.value.sin_datos as string[]) ?? []).map(String)))
      } else sinDatos.push(`locales (${(locales.reason as Error).message})`)

      const sel = filas.filter((f) => num(f.s) !== 0 && (!soloLocales.size || soloLocales.has(String(f.l))))
      const porArtLocal = new Map<string, number>()
      const totalArt = new Map<string, number>()
      for (const f of sel) {
        const k = `${f.a}|${f.l}`
        porArtLocal.set(k, (porArtLocal.get(k) ?? 0) + num(f.s))
        totalArt.set(f.a, (totalArt.get(f.a) ?? 0) + num(f.s))
      }
      const detalle = a.detalle === true || arts.length === 1
      return {
        articulos_pedidos: arts.join(','),
        sin_stock: arts.filter((x) => !totalArt.has(x)).join(',') || undefined,
        ...(sinDatos.length ? { sin_datos: sinDatos.join(', ') } : {}),
        totales: [...totalArt.entries()].map(([articulo, unidades]) => ({ articulo, unidades })),
        por_local: [...porArtLocal.entries()]
          .map(([k, unidades]) => ({ articulo: k.split('|')[0], local: k.split('|')[1], unidades }))
          .sort((x, y) => x.articulo.localeCompare(y.articulo) || y.unidades - x.unidades),
        ...(detalle
          ? {
              por_color_talle: sel
                .map((f) => ({ articulo: f.a, local: f.l, color: f.c, talle: f.t, unidades: num(f.s) }))
                .sort((x, y) => x.articulo.localeCompare(y.articulo) || String(x.local).localeCompare(String(y.local)))
                .slice(0, 400),
            }
          : {}),
        nota: 'Unidades negativas = el local vendió/comprometió más de lo que figura cargado.',
      }
    },
  },
  {
    nombre: 'stock_valorizado',
    descripcion:
      'Stock valorizado a costo (lista Compra) de todas las sucursales y depósitos: unidades, plata, unidades sin costo y en tránsito por sucursal. ' +
      'Con "base" (ej. DRAGONFISH_NVOCED) devuelve los artículos de esa sucursal, los de más plata primero. Con "articulo" filtra el total por código o descripción.',
    parametros: {
      type: 'object',
      properties: {
        base: { type: 'string', description: 'Base Dragon de la sucursal, ej. DRAGONFISH_GPAZD (opcional)' },
        articulo: { type: 'string', description: 'Código o parte de la descripción (opcional)' },
      },
    },
    correr: async (a, { token, origen }) => {
      const base = texto(a.base, 60).toUpperCase()
      const q = texto(a.articulo, 40).toLowerCase()
      type Art = { articulo: string; descripcion: string; unidades: number; valorizado: number; costo: number | null; transito?: number; proveedor?: string }
      const filtrar = (lista: Art[]) =>
        lista
          .filter((x) => !q || `${x.articulo} ${x.descripcion}`.toLowerCase().includes(q))
          .sort((x, y) => num(y.valorizado) - num(x.valorizado))
      if (base) {
        const r = await hub(origen, token, 'sql/stock-valorizado', { qs: new URLSearchParams({ base: base.startsWith('DRAGONFISH_') ? base : `DRAGONFISH_${base}` }), timeout: 60_000 })
        const arts = filtrar((r.articulos as Art[]) ?? [])
        return {
          base: r.base,
          articulos_con_stock: arts.length,
          unidades: arts.reduce((s, x) => s + num(x.unidades), 0),
          valorizado: Math.round(arts.reduce((s, x) => s + num(x.valorizado), 0)),
          articulos: arts.slice(0, 80).map((x) => ({ articulo: x.articulo, descripcion: String(x.descripcion ?? '').slice(0, 40), unidades: x.unidades, costo: x.costo, valorizado: Math.round(num(x.valorizado)) })),
        }
      }
      const r = await hub(origen, token, 'sql/stock-valorizado', { timeout: 60_000 })
      const bases = ((r.bases as Array<Record<string, unknown>>) ?? []).sort((x, y) => num(y.valorizado) - num(x.valorizado))
      const total = (k: string) => Math.round(bases.reduce((s, b) => s + num(b[k]), 0))
      return {
        calculado: r.calculado,
        totales: { unidades: total('unidades'), valorizado: total('valorizado'), unidades_sin_costo: total('unidades_sin_costo'), transito: total('transito'), transito_val: total('transito_val') },
        por_sucursal: bases.map((b) => ({ base: b.base, unidades: b.unidades, valorizado: Math.round(num(b.valorizado)), sin_costo: b.unidades_sin_costo, transito: b.transito ?? 0 })),
        ...(q ? { articulos: filtrar((r.articulos as Art[]) ?? []).slice(0, 60).map((x) => ({ articulo: x.articulo, descripcion: String(x.descripcion ?? '').slice(0, 40), unidades: x.unidades, costo: x.costo, valorizado: Math.round(num(x.valorizado)) })) } : { top_articulos: ((r.articulos as Art[]) ?? []).sort((x, y) => num(y.valorizado) - num(x.valorizado)).slice(0, 25).map((x) => ({ articulo: x.articulo, descripcion: String(x.descripcion ?? '').slice(0, 40), unidades: x.unidades, valorizado: Math.round(num(x.valorizado)) })) }),
        cantidad_sin_costo: ((r.sin_costo as unknown[]) ?? []).length,
      }
    },
  },
  {
    nombre: 'stock_mayorista',
    descripcion:
      'Mayorista: stock del depósito MITO (unidades y en tránsito) y la "tapera" (mercadería remitida a clientes mayoristas sin facturar). ' +
      'Sin filtro: totales y los artículos con más unidades. Con "articulo" (código o descripción) y/o "cliente": el detalle.',
    parametros: {
      type: 'object',
      properties: {
        articulo: { type: 'string', description: 'Código o parte de la descripción (opcional)' },
        cliente: { type: 'string', description: 'Parte del nombre del cliente, para la tapera (opcional)' },
      },
    },
    correr: async (a, { token, origen }) => {
      const r = await hub(origen, token, 'sql/stock-mayorista', { timeout: 60_000 })
      type Dep = { a: string; c: string; t: string; u: number; tr: number }
      type Tap = { remito: number; fecha: string; cli: string; cli_nom: string; a: string; c: string; t: string; u: number; precio: number }
      const info = new Map(((r.articulos as Array<{ a: string; des: string; prov_nom?: string }>) ?? []).map((x) => [x.a, x]))
      const q = texto(a.articulo, 40).toLowerCase()
      const cli = texto(a.cliente, 40).toLowerCase()
      const okArt = (cod: string) => !q || `${cod} ${info.get(cod)?.des ?? ''}`.toLowerCase().includes(q)
      const dep = ((r.deposito as Dep[]) ?? []).filter((x) => okArt(x.a))
      const tap = ((r.tapera as Tap[]) ?? []).filter((x) => okArt(x.a) && (!cli || `${x.cli} ${x.cli_nom}`.toLowerCase().includes(cli)))
      const porArt = new Map<string, { articulo: string; descripcion: string; deposito: number; transito: number; tapera: number }>()
      const fila = (cod: string) => {
        const f = porArt.get(cod) ?? { articulo: cod, descripcion: String(info.get(cod)?.des ?? '').slice(0, 40), deposito: 0, transito: 0, tapera: 0 }
        porArt.set(cod, f)
        return f
      }
      for (const x of dep) {
        fila(x.a).deposito += num(x.u)
        fila(x.a).transito += num(x.tr)
      }
      for (const x of tap) fila(x.a).tapera += num(x.u)
      const arts = [...porArt.values()].sort((x, y) => y.deposito + y.tapera - (x.deposito + x.tapera))
      const porCliente = new Map<string, { cliente: string; remitos: Set<number>; unidades: number; importe: number }>()
      for (const x of tap) {
        const g = porCliente.get(x.cli_nom) ?? { cliente: x.cli_nom, remitos: new Set(), unidades: 0, importe: 0 }
        g.remitos.add(x.remito)
        g.unidades += num(x.u)
        g.importe += num(x.u) * num(x.precio)
        porCliente.set(x.cli_nom, g)
      }
      return {
        calculado: r.calculado,
        totales: { deposito: dep.reduce((s, x) => s + num(x.u), 0), transito: dep.reduce((s, x) => s + num(x.tr), 0), tapera: tap.reduce((s, x) => s + num(x.u), 0) },
        articulos: arts.slice(0, q ? 80 : 30),
        tapera_por_cliente: [...porCliente.values()]
          .sort((x, y) => y.unidades - x.unidades)
          .slice(0, 40)
          .map((g) => ({ cliente: g.cliente, remitos: g.remitos.size, unidades: g.unidades, importe: Math.round(g.importe) })),
        ...(q || cli
          ? { detalle_deposito: dep.slice(0, 150).map((x) => ({ articulo: x.a, color: x.c, talle: x.t, unidades: x.u, transito: x.tr })), detalle_tapera: tap.slice(0, 150).map((x) => ({ remito: x.remito, fecha: x.fecha, cliente: x.cli_nom, articulo: x.a, color: x.c, talle: x.t, unidades: x.u })) }
          : {}),
      }
    },
  },
  {
    nombre: 'analisis_ventas',
    descripcion:
      'Análisis de ventas de los locales con HISTORIAL LARGO (años, días cerrados hasta ayer; para hoy usá ventas_por_articulo): ' +
      'plata, unidades y tickets del período, comparado contra el año anterior o el período anterior, serie por día/semana/mes/año, ' +
      'venta por día de la semana y una tabla abierta por proveedor, línea, grupo, material, familia, temporada, año, género, local o artículo (con stock). ' +
      'Sin locales elegidos cuenta solo los locales a la calle (sin depósitos ni mayorista).',
    parametros: {
      type: 'object',
      properties: {
        desde: FECHA,
        hasta: FECHA,
        comparar: { type: 'string', enum: ['anio', 'anterior', 'nada'], description: 'anio = mismo período del año anterior (por defecto); anterior = período anterior de igual largo' },
        gran: { type: 'string', enum: ['dia', 'sem', 'mes', 'anio'], description: 'Agrupación de la serie (por defecto según el largo)' },
        abrir_por: { type: 'string', enum: ['prov', 'linea', 'grupo', 'mat', 'flia', 'temp', 'anio', 'gen', 'local', 'art'], description: 'Tabla abierta por (por defecto local)' },
        locales: { type: 'array', items: { type: 'string' }, description: 'Códigos de base de los locales (opcional)' },
        articulo: { type: 'string', description: 'Filtrar por código de artículo (opcional)' },
        origen: { type: 'string', enum: ['', 'MITO', 'MARCAS'], description: 'MITO = marcas propias, MARCAS = de terceros, vacío = todo' },
        top: { type: 'number', description: 'Filas de la tabla (1-100, por defecto 30)' },
      },
      required: ['desde', 'hasta'],
    },
    correr: async (a, { token, origen }) => {
      const desde = fecha(a.desde)
      const hasta = fecha(a.hasta)
      if (!desde || !hasta) return { error: 'Faltan desde y hasta (AAAA-MM-DD).' }
      const dias = (Date.parse(hasta) - Date.parse(desde)) / 86_400_000
      const gran = ['dia', 'sem', 'mes', 'anio'].includes(String(a.gran)) ? a.gran : dias > 400 ? 'anio' : dias > 62 ? 'mes' : dias > 21 ? 'sem' : 'dia'
      const locales = Array.isArray(a.locales) ? a.locales.map((l) => texto(l, 20).toUpperCase()).filter(Boolean) : []
      const art = texto(a.articulo, 40).toUpperCase()
      const r = await hub(origen, token, 'sql/analisis-ventas', {
        body: {
          desde,
          hasta,
          comparar: ['anio', 'anterior', 'nada'].includes(String(a.comparar)) ? a.comparar : 'anio',
          gran,
          dim: texto(a.abrir_por, 10) || 'local',
          camino: [],
          corte: 'dia',
          filtros: {
            ...(locales.length ? { locales } : { excluir: ['MITO', 'POLO52', 'INDO', 'INDOD', 'TX-POLO', 'FABRICA', 'CENTRALD', 'NOMED', 'OUTLETD'] }),
            ...(art ? { art } : {}),
            ...(a.origen === 'MITO' || a.origen === 'MARCAS' ? { origen: a.origen } : {}),
          },
        },
        timeout: 45_000,
      })
      if (r.estado && r.estado !== 'listo') return { estado: r.estado, nota: 'El puente todavía está cargando ventas; probá de nuevo en un rato.' }
      const top = Math.min(Math.max(Number(a.top) || 30, 1), 100)
      const tabla = (r.tabla as { dim?: string; filas?: unknown[] } | undefined) ?? {}
      const DOW = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
      return {
        periodo: `${r.desde} a ${r.hasta}`,
        comparado: r.comparado,
        kpis: r.kpis,
        faltan_dias: r.faltan,
        serie: ((r.serie as Array<Record<string, unknown>>) ?? []).slice(-60).map((p) => {
          const comp = p.comp as Record<string, unknown> | null
          return { periodo: p.lab, monto: p.monto, unid: p.unid, tickets: p.tickets, monto_comp: comp?.monto ?? null, unid_comp: comp?.unid ?? null }
        }),
        por_dia_semana: ((r.dow as Array<Record<string, unknown>>) ?? []).map((d, i) => ({ dia: DOW[i], ...d })),
        tabla_dim: tabla.dim,
        tabla: (tabla.filas ?? []).slice(0, top),
        filas_tabla: (tabla.filas ?? []).length,
        anio_a_la_fecha: r.anio,
      }
    },
  },
  {
    nombre: 'items_pedido_venta',
    descripcion:
      'Renglones (artículo, color, talle, cantidades y precios) de un pedido de venta mayorista, en vivo de Dragon. ' +
      'Usá el "codigo" que da pedidos_venta.',
    parametros: {
      type: 'object',
      properties: { codigo: { type: 'string', description: 'Código del pedido (columna codigo de pedidos_venta)' } },
      required: ['codigo'],
    },
    correr: async (a, { token, origen }) => {
      const codigo = texto(a.codigo, 60)
      if (!codigo) return { error: 'Falta el código del pedido.' }
      const r = await hub(origen, token, 'sql/pedido-venta-items', { qs: new URLSearchParams({ codigo }) })
      return r
    },
  },
  {
    nombre: 'flexxus',
    descripcion:
      'Contabilidad y ventas en Flexxus (Firebird, solo lectura). consulta: ventas (facturación entre fechas), saldos (de clientes), ' +
      'asientos (hasta 93 días), balance (sumas y saldos por cuenta), mayor (líneas de una cuenta; requiere cuenta), centros (resultado por centro de costo).',
    parametros: {
      type: 'object',
      properties: {
        consulta: { type: 'string', enum: ['ventas', 'saldos', 'asientos', 'balance', 'mayor', 'centros'] },
        desde: FECHA,
        hasta: FECHA,
        cuenta: { type: 'string', description: 'Código de cuenta contable (solo para mayor)' },
      },
      required: ['consulta'],
    },
    correr: async (a, { token, origen }) => {
      const consulta = texto(a.consulta, 20)
      const qs = new URLSearchParams({ consulta })
      if (consulta !== 'saldos') {
        const { desde, hasta } = rango(a, 30)
        qs.set('desde', desde)
        qs.set('hasta', hasta)
      }
      if (texto(a.cuenta, 30)) qs.set('cuenta', texto(a.cuenta, 30))
      return hub(origen, token, 'sql/flexxus', { qs, timeout: 60_000 })
    },
  },
  {
    nombre: 'arqueos',
    descripcion:
      'Arqueos de caja de los locales de un día: local, caja, hora, vendedor y total contado. Horarios fijos 10, 14, 19 y 22 hs: ' +
      'un arqueo vale desde 1 h 30 antes (el de las 19 desde las 17:00) hasta 1 h después. Sirve para "quién no arqueó" o "quién arqueó tarde".',
    parametros: {
      type: 'object',
      properties: { fecha: { ...FECHA, description: 'Día (AAAA-MM-DD, por defecto hoy)' }, local: { type: 'string', description: 'Código de local (opcional)' } },
    },
    correr: async (a, { token }) => {
      const dia = fecha(a.fecha) ?? hoyAr()
      const local = texto(a.local, 20)
      const [filas, excluidos] = await Promise.all([
        tabla(token, `arqueos_locales?select=local,caja,arqueo,hora,vendedor,total&fecha=eq.${dia}${local ? `&local=eq.${filtro(local)}` : ''}&order=local,hora`),
        tabla(token, 'arqueos_excluidos?select=local').catch(() => []),
      ])
      return {
        fecha: dia,
        horarios: '10, 14, 19 y 22',
        no_controlados: ((excluidos as Array<{ local: string }>) ?? []).map((x) => x.local).join(',') || undefined,
        arqueos: filas,
      }
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
    'Para "más vendido", rankings o unidades vendidas por artículo/producto/SKU usá SIEMPRE ventas_por_articulo (sirve también para hoy). ' +
      'Si una herramienta falla (timeout, puente caído), decí que la fuente no respondió y que se puede reintentar: nunca digas que el dato no existe.',
    'Stock: stock_articulo (por local y depósito MITO, color y talle; pide códigos, buscalos con buscar_articulos), ' +
      'stock_valorizado (plata en stock por sucursal), stock_mayorista (depósito MITO y tapera de clientes). ' +
      'Ventas con historial largo, comparaciones contra el año pasado y aperturas por proveedor/línea/local/artículo: analisis_ventas (días cerrados hasta ayer). ' +
      'Contabilidad: flexxus. Arqueos de caja: arqueos. Renglones de un pedido mayorista: items_pedido_venta.',
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
/**
 * Bloques de la API de Claude que no son texto ni herramienta (thinking, fallback, etc.): se devuelven
 * TAL CUAL en las vueltas siguientes con Claude (la API lo exige), y se sacan al pasar a otro proveedor.
 */
type BloqueClaude = { type: string } & Record<string, unknown>
type Mensaje = { role: 'user' | 'assistant'; content: string | Array<Bloque | BloqueClaude> }
type Proveedor = 'claude' | 'opencode' | 'ollama'

class SinCupo extends Error {}

const esBloque = (b: Bloque | BloqueClaude): b is Bloque => b.type === 'text' || b.type === 'tool_use' || b.type === 'tool_result'

/** Conversación sin los bloques propios de Claude, para OpenCode u Ollama. */
function soloBasicos(mensajes: Mensaje[]): Mensaje[] {
  return mensajes
    .map((m) =>
      typeof m.content === 'string'
        ? m
        : {
            role: m.role,
            content: m.content.filter(esBloque).map((b) => (b.type === 'text' ? { type: 'text' as const, text: b.text } : b)),
          },
    )
    .filter((m) => typeof m.content === 'string' || m.content.length)
}

function herramientasAnthropic() {
  return HERRAMIENTAS.map((h, i) => ({
    name: h.nombre,
    description: h.descripcion,
    input_schema: h.parametros,
    // Caché de prompt: herramientas + instrucciones son iguales en cada vuelta (la fecha cambia una vez por día)
    ...(i === HERRAMIENTAS.length - 1 ? { cache_control: { type: 'ephemeral' as const } } : {}),
  }))
}

let clienteClaude: Anthropic | null = null

/**
 * Una vuelta con Claude Sonnet 5.5 por la API de Anthropic. Esfuerzo medium (recomendado para varias
 * herramientas). Si el modelo rechaza por política, la API reintenta sola con el modelo de respaldo
 * ("fallbacks: default"). Sin key, sin saldo, límite o caída: SinCupo y sigue OpenCode.
 */
async function vueltaClaude(mensajes: Mensaje[], uso: Uso): Promise<{ bloques: Array<Bloque | BloqueClaude>; modelo: string }> {
  const key = process.env.ANTHROPIC_API_KEY?.trim()
  if (!key) throw new SinCupo('La API de Claude no está configurada')
  // Una key de organización (sin workspace) exige el header anthropic-workspace-id; una key creada
  // dentro de un workspace no lo necesita.
  const workspace = process.env.ANTHROPIC_WORKSPACE_ID?.trim()
  clienteClaude ??= new Anthropic({
    apiKey: key,
    maxRetries: 1,
    timeout: 90_000,
    ...(workspace ? { defaultHeaders: { 'anthropic-workspace-id': workspace } } : {}),
  })
  let r: Anthropic.Beta.BetaMessage
  try {
    r = await clienteClaude.beta.messages.create({
      model: process.env.ANTHROPIC_MODELO?.trim() || 'claude-sonnet-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium' },
      system: [{ type: 'text', text: sistema(), cache_control: { type: 'ephemeral' } }],
      tools: herramientasAnthropic() as unknown as Anthropic.Beta.BetaToolUnion[],
      messages: mensajes as unknown as Anthropic.Beta.BetaMessageParam[],
    })
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      // 400 por saldo agotado, 401/403 key, 429 límite, 5xx/529 caída: todo sigue con OpenCode
      const detalle = (err.error as { error?: { message?: string } } | undefined)?.error?.message ?? err.message
      const motivo = /credit balance/i.test(detalle)
        ? 'se terminó el saldo de la API de Claude'
        : /workspace/i.test(detalle)
          ? 'la key de Claude no tiene workspace: creá la key dentro de un workspace o cargá ANTHROPIC_WORKSPACE_ID en Vercel'
        : err.status === 401 || err.status === 403
          ? 'la key de la API de Claude no es válida'
          : err.status === 429
            ? 'la API de Claude llegó al límite de uso'
            : err.status && err.status >= 500
              ? 'la API de Claude está caída'
              : `API de Claude: ${err.status ?? 'sin conexión'} ${detalle}`
      throw new SinCupo(motivo.slice(0, 300))
    }
    throw new SinCupo(`API de Claude no respondió (${(err as Error).message})`)
  }
  uso.vueltas++
  uso.entrada += (r.usage.input_tokens ?? 0) + (r.usage.cache_creation_input_tokens ?? 0)
  uso.salida += r.usage.output_tokens ?? 0
  uso.cache += r.usage.cache_read_input_tokens ?? 0
  if (r.stop_reason === 'refusal') throw new SinCupo('Claude rechazó la consulta')
  return { bloques: r.content as unknown as Array<Bloque | BloqueClaude>, modelo: r.model }
}

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
        system: [{ type: 'text', text: sistema(), cache_control: { type: 'ephemeral' } }],
        tools: herramientasAnthropic(),
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
      for (const b of m.content.filter(esBloque)) {
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
  let proveedor: Proveedor = 'claude'
  let modelo = ''
  const avisos: string[] = []
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
      // Cascada: Claude Sonnet → OpenCode (Haiku) → Ollama. Al bajar de proveedor se sigue la misma
      // conversación (con los resultados de herramientas ya obtenidos), sin los bloques propios de Claude.
      let bloques: Array<Bloque | BloqueClaude> | null = null
      while (!bloques) {
        try {
          if (proveedor === 'claude') {
            const r = await vueltaClaude(mensajes, uso)
            bloques = r.bloques
            modelo = r.modelo
          } else if (proveedor === 'opencode') {
            bloques = await vueltaOpencode(soloBasicos(mensajes), sesion, uso)
            modelo = process.env.OPENCODE_GO_MODELO?.trim() || 'claude-haiku-5-5'
          } else {
            bloques = await vueltaOllama(soloBasicos(mensajes), token)
            modelo = 'ollama'
          }
        } catch (err) {
          if (!(err instanceof SinCupo) || proveedor === 'ollama') throw err
          avisos.push(err.message)
          proveedor = proveedor === 'claude' ? 'opencode' : 'ollama'
        }
      }

      const llamadas = bloques.filter((b): b is Extract<Bloque, { type: 'tool_use' }> => b.type === 'tool_use')
      mensajes.push({ role: 'assistant', content: bloques })
      if (!llamadas.length) {
        const respuesta = bloques
          .filter((b): b is Extract<Bloque, { type: 'text' }> => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim()
        await anotar()
        return res.status(200).json({
          respuesta: respuesta || '(sin respuesta)',
          proveedor,
          modelo,
          consultas,
          // "La API de Claude no está configurada" no es un aviso: es lo esperado hasta cargar la key
          aviso: avisos.filter((a) => !/no está configurada/.test(a)).join(' · ') || undefined,
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
      modelo,
      consultas,
    })
  } catch (err) {
    return res.status(502).json({
      error: `No se pudo responder: ${(err as Error).message}${avisos.length ? ` (antes: ${avisos.join(' · ')})` : ''}`,
    })
  }
}
