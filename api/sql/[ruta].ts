/**
 * Proxy de lectura al SQL Server (vía Logic App / Puente SQL), más el estado y el
 * explorador de la conexión. Un solo endpoint para los tres usos de /api/sql/*:
 *
 *   GET /api/sql/ping                          -> { ok }: el puente responde desde afuera (vigilante)
 *   GET /api/sql/status                        -> estado de la conexión (Configuraciones > Conexión SQL)
 *   GET /api/sql/catalogo?...                  -> explorador de bases/objetos (solo admins)
 *   GET /api/sql/stock-valorizado[?forzar=1]   -> stock valorizado a costo por sucursal (Administradores)
 *   GET /api/sql/stock-valorizado?base=...     -> los artículos de esa sucursal (el desplegable)
 *   GET /api/sql/repo-diaria[?fechas=&forzar=1] -> repo diaria desde el DWH (Compras; responde "calculando" hasta tenerla)
 *   GET|POST /api/sql/reparto                  -> Reparto manual: opciones de filtros / stock y venta por local (solo lectura)
 *   GET /api/sql/stock-mayorista[?forzar=1]    -> Mayorista > Stock: depósito y tapera (remitido sin facturar) de MITO
 *   GET /api/sql/stock-tienda?prefijos=|articulos=[&locales=1] -> tienda cf-zimith-mayorista (clave X-Mayorista-Token, sin sesión)
 *   POST /api/sql/tienda-dragon                -> tienda: buscar códigos / alta de artículo en Dragon INDOD (misma clave)
 *   POST /api/sql/tienda-telegram              -> tienda: link de ingreso por el bot de Telegram (misma clave)
 *   POST /api/sql/tienda-clientes              -> tienda: registro, aprobación y permisos de clientes (misma clave)
 *   GET /api/sql/stock-mito?articulos=         -> Mayorista > Estado de pedidos: stock real del depósito MITO por SKU (sesión, pedidos_venta.view)
 *   POST /api/sql/tienda-productos             -> tienda: lo de la web de cada artículo (visible, pre-venta, locales, detalle)
 *   GET /api/sql/pedido-venta-items?codigo=    -> renglones de un pedido de venta viejo, en vivo de Dragonfish
 *   GET /api/sql/dragon-variantes?base=&articulo= -> colores y talles de un artículo en Dragon (Órdenes de compras)
 *   GET /api/sql/dragon-articulos?base=&q=|codigos= -> artículos en vivo de Dragon (buscador e importar txt de Órdenes de compras)
 *   GET /api/sql/flexxus?consulta=ventas|saldos|asientos|balance&desde=&hasta= -> Administración > Flexxus (Firebird, solo lectura)
 *   GET /api/sql/polo-bulto?codigo=          -> Polo 52 > Mapeo de bultos: artículos del remito de un bulto (Dragon POLO52)
 *   POST /api/sql/tablero-locales             -> Administración > Tablero locales: caja y errores de caja por local (en vivo)
 *   POST /api/sql/analisis-ventas             -> Compras > Análisis ventas (solo admin): KPIs, serie y aperturas desde el Puente
 *   GET /api/sql/stock-publico?articulo=      -> PÚBLICO (sin sesión): stock de un artículo por local (/precios)
 *   GET /api/sql/<vista>[?where=&value=&limit=] -> filas de una vista habilitada
 *
 * Antes eran tres funciones (sql/[view], sql/status, sql/catalogo); se unificaron para
 * no pasar el tope de 12 Serverless Functions del plan Hobby de Vercel. La lógica de
 * cada una vive en src/lib/sqlVista.ts, src/lib/sqlStatus.ts y src/lib/sqlCatalogo.ts.
 *
 * Ojo con Vercel (lección aprendida 2026-10): usar catch-all `[...ruta].ts` NO anda —
 * Vercel no puebla req.query con el segmento de un catch-all en /api, así que todo
 * caía en la rama de "vista" y daba 500. Con `[ruta].ts` (segmento dinámico simple,
 * como el viejo [view].ts) Vercel sí deja el segmento en req.query.ruta.
 * Además NO construir el req de la vista con spread ({ ...req }): el req del runtime
 * tiene propiedades no enumerables (headers) que el spread pierde, y sqlVista explota.
 * Se reutiliza el mismo req y solo se setea req.query.view.
 */
import vista from '../../src/lib/sqlVista.js'
import status from '../../src/lib/sqlStatus.js'
import catalogo from '../../src/lib/sqlCatalogo.js'
import stockValorizado from '../../src/lib/stockValorizadoApi.js'
import repoDiaria from '../../src/lib/repoDiariaApi.js'
import reparto from '../../src/lib/repartoApi.js'
import pedidoVentaItems from '../../src/lib/pedidoVentaItemsApi.js'
import dragonVariantes, { dragonArticulos } from '../../src/lib/dragonVariantesApi.js'
import stockPublico from '../../src/lib/stockPublicoApi.js'
import stockMayorista from '../../src/lib/stockMayoristaApi.js'
import stockTienda, { stockMitoHub, tiendaDragon } from '../../src/lib/stockTiendaApi.js'
import tiendaTelegram from '../../src/lib/tiendaTelegramApi.js'
import tiendaClientes from '../../src/lib/tiendaClientesApi.js'
import tiendaProductos from '../../src/lib/tiendaProductosApi.js'
import flexxus from '../../src/lib/flexxusApi.js'
import poloBulto from '../../src/lib/poloBultoApi.js'
import analisisVentas from '../../src/lib/analisisVentasApi.js'
import tableroLocales from '../../src/lib/tableroLocalesApi.js'

type Req = {
  method?: string
  headers: Record<string, string | string[] | undefined>
  query: Record<string, string | string[] | undefined>
}

type Res = {
  status(code: number): Res
  setHeader(name: string, value: string): Res
  json(body: unknown): void
}

/** El segmento de [ruta]: string o lista, según cómo lo entregue el runtime. */
function primero(q: string | string[] | undefined): string {
  if (Array.isArray(q)) return typeof q[0] === 'string' ? q[0] : ''
  return q ?? ''
}

/**
 * GET /api/sql/ping -> { ok, respaldo, alguna } : ¿el puente responde desde afuera? ok = salida principal
 * (Vercel -> Funnel -> puente), respaldo = túnel de Cloudflare (null si no hay).
 * Sin datos ni secretos, sin sesión: lo usa el vigilante de la PC del puente
 * (puente-sql/scripts/vigilante.ps1) para detectar el Funnel caído y reactivarlo.
 */
async function ping(res: Res) {
  res.setHeader('Cache-Control', 'no-store')
  const url = process.env.SUPABASE_URL
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
  let destino = process.env.SQL_LOGICAPP_URL?.trim() || ''
  let respaldo = ''
  if (url && service) {
    try {
      const r = await fetch(`${url}/rest/v1/sql_conexion?id=eq.1&select=logicapp_url,respaldo_url`, {
        headers: { Authorization: `Bearer ${service}`, apikey: service },
      })
      const filas = (await r.json().catch(() => null)) as Array<{ logicapp_url?: string | null; respaldo_url?: string | null }> | null
      destino = filas?.[0]?.logicapp_url?.trim() || destino
      respaldo = filas?.[0]?.respaldo_url?.trim() || ''
    } catch {
      /* respaldo: env */
    }
  }
  if (!destino) return res.status(500).json({ ok: false })
  // La URL guardada termina en /health (o se le agrega): GET sin token
  const probar = async (u: string): Promise<boolean | null> => {
    if (!u) return null
    const salud = /\/health\/?$/.test(u) ? u : u.replace(/\/?$/, '/health')
    try {
      const r = await fetch(salud, { signal: AbortSignal.timeout(8000) })
      return r.ok
    } catch {
      return false
    }
  }
  // `ok` es la salida principal (el Funnel): es lo que mira el vigilante de la PC para re-publicarlo.
  // `respaldo` es el túnel de Cloudflare; con cualquiera de las dos el hub llega (`alguna`).
  const [ok, okRespaldo] = await Promise.all([probar(destino), probar(respaldo)])
  return res.status(ok ? 200 : 502).json({ ok: ok === true, respaldo: okRespaldo, alguna: ok === true || okRespaldo === true })
}

export default async function handler(req: Req, res: Res) {
  const ruta = primero(req.query.ruta)

  if (ruta === 'ping') return ping(res)
  if (ruta === 'stock-publico') return stockPublico(req, res)
  // tienda mayorista web: con clave privada (X-Mayorista-Token), no con sesión
  if (ruta === 'stock-tienda') return stockTienda(req, res)
  if (ruta === 'tienda-dragon') return tiendaDragon(req, res)
  if (ruta === 'tienda-telegram') return tiendaTelegram(req, res)
  if (ruta === 'tienda-clientes') return tiendaClientes(req, res)
  if (ruta === 'tienda-productos') return tiendaProductos(req, res)

  if (ruta === 'status') return status(req, res)
  if (ruta === 'catalogo') return catalogo(req, res)
  if (ruta === 'stock-valorizado') return stockValorizado(req, res)
  if (ruta === 'repo-diaria') return repoDiaria(req, res)
  if (ruta === 'reparto') return reparto(req, res)
  if (ruta === 'pedido-venta-items') return pedidoVentaItems(req, res)
  if (ruta === 'stock-mayorista') return stockMayorista(req, res)
  if (ruta === 'stock-mito') return stockMitoHub(req, res)
  if (ruta === 'dragon-variantes') return dragonVariantes(req, res)
  if (ruta === 'dragon-articulos') return dragonArticulos(req, res)
  if (ruta === 'flexxus') return flexxus(req, res)
  if (ruta === 'polo-bulto') return poloBulto(req, res)
  if (ruta === 'analisis-ventas') return analisisVentas(req, res)
  if (ruta === 'tablero-locales') return tableroLocales(req, res)

  // Cualquier otro nombre es una vista: se la pasa como ?view= a la lógica de siempre,
  // pero con el MISMO req (jamás un spread: se perdería req.headers y crashearía).
  req.query.view = ruta
  return vista(req, res)
}