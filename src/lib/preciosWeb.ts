/**
 * Lectura de precios en la web de la marca (por ahora vans.com.ar), para Compras >
 * Comparativa de precios. La usan api/precios-sync.ts (botón y cron, por tandas) y
 * scripts/precios-sync.ts (corrida completa desde una PC).
 *
 * Por cada código VN0… de la descripción de los artículos:
 *   GET https://www.vans.com.ar/Product/Detail/{cod}
 *   - existe si el JSON-LD trae "sku":"{cod}" (sin distinguir mayúsculas). La web
 *     responde 200 aunque el código no exista, con una página sin sku.
 *   - si no existe y termina en un sufijo de variante (CA, SM, …) se prueba sin el
 *     sufijo, siempre que queden al menos 9 caracteres; ahí se guarda cod_web.
 *   - precios del objeto a nivel PRODUCTO (`var productData={…"descripcionCorta"…}`),
 *     no del array por talle, que repite precioAnterior con valores que no corresponden.
 *
 * Sin dependencias ni imports: corre igual en Vercel y en Node 24 (`node archivo.ts`).
 */

export interface PrecioWeb {
  cod: string
  cod_web: string | null
  nombre_web: string | null
  precio: number | null
  precio_lista: number | null
  desc_pct: number | null
  con_stock: boolean | null
  url: string | null
  encontrado: boolean
}

export const MARCAS: Record<string, { url: (cod: string) => string }> = {
  vans: { url: (cod) => `https://www.vans.com.ar/Product/Detail/${encodeURIComponent(cod)}` },
}

/** Del más largo al más corto, para que CAS gane sobre CA y SMU sobre SM. */
const SUFIJOS = ['CAS', 'SMU', 'CA', 'SM', 'CS', 'CK', 'CR', 'OL', 'NH', 'NU', 'P', 'D', '1', '2']

export const PARALELO = 6

/** Código sin el sufijo de variante, o null si no tiene o quedaría muy corto. */
export function sinSufijo(cod: string): string | null {
  const s = SUFIJOS.find((x) => cod.endsWith(x))
  if (!s) return null
  const base = cod.slice(0, -s.length)
  return base.length >= 9 ? base : null
}

const numero = (bloque: string, campo: string): number | null => {
  const m = bloque.match(new RegExp(`"${campo}"\\s*:\\s*(-?[0-9]+(?:\\.[0-9]+)?)`))
  return m ? Number(m[1]) : null
}

const entidades = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))

/** Interpreta la página de un producto. null = la página no es de ese código. */
export function leerPagina(html: string, cod: string): Omit<PrecioWeb, 'cod' | 'cod_web' | 'url'> | null {
  const skus = [...html.matchAll(/"sku"\s*:\s*"([^"]*)"/gi)].map((m) => m[1].toUpperCase())
  if (!skus.includes(cod.toUpperCase())) return null

  // Bloque a nivel producto: desde "descripcionCorta" en adelante, dentro de productData
  const ini = html.indexOf('var productData=')
  const corta = html.indexOf('"descripcionCorta"', ini >= 0 ? ini : 0)
  const bloque = corta >= 0 ? html.slice(corta, corta + 4000) : ''
  const precio = numero(bloque, 'precioActual')
  const desc = numero(bloque, 'porcentajeDescuento') ?? 0
  const historico = numero(bloque, 'precioHistoricoMaximo')
  const precioLista = desc > 0 && historico ? historico : precio

  const conStock = /"availability"\s*:\s*"https?:\/\/schema\.org\/InStock"/i.test(html)
  const titulo = html.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim()

  return {
    nombre_web: titulo ? entidades(titulo).replace(/\s+/g, ' ') : null,
    precio,
    precio_lista: precioLista,
    desc_pct: Math.round(desc),
    con_stock: conStock,
    encontrado: precio != null,
  }
}

class ErrorHttp extends Error {}

/** GET con un reintento si la web responde 5xx o se corta. */
async function bajar(url: string): Promise<string> {
  for (let intento = 0; ; intento++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HubMito/1.0)', Accept: 'text/html' },
        signal: AbortSignal.timeout(15_000),
      })
      if (res.status >= 500) throw new ErrorHttp(`HTTP ${res.status}`)
      return await res.text()
    } catch (e) {
      if (intento >= 1) throw e
    }
  }
}

/** Lee un código (y, si no aparece, la versión sin sufijo). Tira error si la web no responde. */
export async function leerCodigo(marca: string, cod: string): Promise<PrecioWeb> {
  const m = MARCAS[marca]
  if (!m) throw new Error(`Marca no soportada: ${marca}`)
  const candidatos = [cod, sinSufijo(cod)].filter((c): c is string => !!c)
  for (const c of candidatos) {
    const url = m.url(c)
    const datos = leerPagina(await bajar(url), c)
    if (datos) return { cod, cod_web: c === cod ? null : c, url, ...datos }
  }
  return { cod, cod_web: null, nombre_web: null, precio: null, precio_lista: null, desc_pct: null, con_stock: null, url: null, encontrado: false }
}

/**
 * Lee una lista de códigos con PARALELO consultas a la vez. Deja de arrancar códigos
 * nuevos al pasar `hastaMs` (marca de tiempo absoluta) y devuelve cuántos procesó, que
 * siempre son los primeros `procesados` de la lista (los que quedan van en la próxima tanda).
 */
export async function leerTanda(
  marca: string, codigos: string[], hastaMs = Infinity,
): Promise<{ filas: PrecioWeb[]; errores: number; procesados: number }> {
  const resultados: (PrecioWeb | 'error' | undefined)[] = new Array(codigos.length)
  let siguiente = 0
  let cortado = codigos.length
  async function trabajador() {
    for (;;) {
      const i = siguiente++
      if (i >= codigos.length) return
      if (Date.now() > hastaMs) { cortado = Math.min(cortado, i); return }
      try {
        resultados[i] = await leerCodigo(marca, codigos[i])
      } catch {
        resultados[i] = 'error'
      }
    }
  }
  await Promise.all(Array.from({ length: PARALELO }, trabajador))
  const hechos = resultados.slice(0, cortado)
  return {
    filas: hechos.filter((r): r is PrecioWeb => !!r && r !== 'error'),
    errores: hechos.filter((r) => r === 'error').length,
    procesados: cortado,
  }
}
