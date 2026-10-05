/**
 * Cliente del Puente SQL con reintentos para los parpadeos del túnel.
 *
 * Este archivo solo lo usan las funciones de Vercel (Node): no puede usar
 * `import.meta.env`, igual que `loginEmpleado.ts`.
 *
 * Por qué reintentar: el destino no es un servicio propio, es un túnel público que
 * termina en el borde de un proveedor (hoy Tailscale Funnel). Ese borde es un pool
 * de IPs cualquiera y se cae entero por períodos; cuando eso pasa el `fetch` muere en
 * el TLS en menos de un segundo. Reintentar es la reacción correcta: es barato y no
 * cambia la semántica.
 *
 * Por qué NO duele: todo lo que viaja por acá son lecturas puras (SELECT, catálogo,
 * réplicas). No hay ninguna escritura que se pueda duplicar, así que repetir es seguro.
 *
 * Por qué tiene presupuesto y no solo cantidad de intentos: una consulta legítima
 * puede tardar varios segundos. El reintento solo se concede si el fallo fue *rápido*
 * (o sea, un parpadeo del borde) y queda tiempo. Si la lectura ya se demoró, se
 * devuelve el error tal como venía antes, sin estirar la ejecución.
 *
 * No se reintenta un 401 ni un 400: son deterministas — el token o la petición están
 * mal — y repetir solo gasta tiempo.
 */

/** Códigos que sí vale la pena volver a intentar: el puente o un proxy intermedio se quedaron sin aire. */
const REINTENTABLES = new Set([502, 503, 504])

/** Por qué no se pudo llegar al destino, para distinguirlo en el mensaje. */
export type MotivoFallo = 'red' | 'timeout'

export interface Opciones {
  /** Intentos totales, incluido el primero. 1 desactiva el reintento. Default 3. */
  intentos?: number
  /** Tiempo extra tolerado entre reintentos (esperas + fallos). Default 5000 ms. */
  presupuestoMs?: number
  /** Un fallo más lento que esto se considera real, no un parpadeo. Default 2500 ms. */
  rapidoMs?: number
  /** Espera antes del segundo intento; se duplica en cada uno. Default 250 ms. */
  esperaBaseMs?: number
  /** Tope por intento. Default 30 s (es una red de por sí, no se espera que tarde tanto). */
  timeoutMs?: number
}

export type Resultado =
  | { ok: true; res: Response; intentos: number }
  | { ok: false; motivo: MotivoFallo; intentos: number; ultimoError?: unknown }

function num(v: string | undefined, alt: number): number {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : alt
}

const OP = {
  intentos: () => Math.min(5, Math.max(1, Math.round(num(process.env.SQL_INTENTOS, 3)))),
  presupuestoMs: () => num(process.env.SQL_RETRY_PRESUPUESTO_MS, 5000),
  rapidoMs: () => num(process.env.SQL_RETRY_RAPIDO_MS, 2500),
  esperaBaseMs: () => num(process.env.SQL_RETRY_ESPERA_MS, 250),
  timeoutMs: () => num(process.env.SQL_FETCH_TIMEOUT_MS, 30_000),
}

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

const esAbort = (e: unknown) =>
  (e as { name?: string } | undefined)?.name === 'AbortError' ||
  /abort|timeout/i.test(String((e as Error | undefined)?.message ?? e))

/**
 * Un pedido al Puente SQL. Devuelve la respuesta del último intento si hubo alguna
 * (incluso si vino 502), o el motivo si el destino nunca respondió.
 *
 * El body es un string, así que se reusa entre intentos sin ninguna complicación.
 */
async function pedir(
  url: string,
  init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string },
  opciones: Opciones,
): Promise<Resultado> {
  const intentos = opciones.intentos ?? OP.intentos()
  const rapido = opciones.rapidoMs ?? OP.rapidoMs()
  const tope = opciones.timeoutMs ?? OP.timeoutMs()
  let presupuesto = opciones.presupuestoMs ?? OP.presupuestoMs()
  let base = opciones.esperaBaseMs ?? OP.esperaBaseMs()

  let ultima: Response | null = null
  let ultimoError: unknown = null
  let motivo: MotivoFallo = 'red'
  let hechas = 0

  for (let i = 0; i < intentos; i++) {
    // El intento se cuenta apenas se lo intenta, así el informe nunca miente ni dice
    // "3 intentos" cuando el presupuesto cortó antes. Al menos 1 siempre.
    hechas = i + 1
    const ultimaVez = i === intentos - 1
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), tope)
    const t0 = Date.now()

    try {
      const r = await fetch(url, {
        method: init.method,
        headers: init.headers,
        ...(init.body !== undefined ? { body: init.body } : {}),
        cache: 'no-store',
        signal: ctrl.signal,
      })
      const dt = Date.now() - t0
      // Contestó. Si no es transitorio, o tardó (no es un parpadeo), se entrega tal cual.
      if (!REINTENTABLES.has(r.status) || dt > rapido) return { ok: true, res: r, intentos: hechas }
      ultima = r
    } catch (e) {
      motivo = esAbort(e) ? 'timeout' : 'red'
      ultimoError = e
      // Tardó en caer: el túnel no está de parpadeo, está caído. Insistir no suma.
      if (Date.now() - t0 > rapido) return { ok: false, motivo, intentos: hechas, ultimoError }
    } finally {
      clearTimeout(timer)
    }

    // No se espera al pedo si no queda otro intento.
    if (ultimaVez) break
    const espera = Math.min(base, Math.max(0, presupuesto))
    if (espera <= 0) break
    await dormir(espera)
    presupuesto -= espera + (Date.now() - t0)
    base *= 2
  }

  if (ultima) return { ok: true, res: ultima, intentos: hechas }
  return { ok: false, motivo, intentos: hechas, ultimoError }
}

/** Lectura al Puente SQL (SELECT, catálogo, réplicas). */
export function postAlPuente(
  url: string,
  init: { headers: Record<string, string>; body: string },
  opciones: Opciones = {},
): Promise<Resultado> {
  return pedir(url, { method: 'POST', ...init }, opciones)
}

/**
 * Sondeo del destino para la pantalla de estado. Un 405 o un 404 también cuentan
 * como "el túnel está vivo": lo que importa es que hubo respuesta.
 */
export function getAlDestino(url: string, opciones: Opciones = {}): Promise<Resultado> {
  return pedir(url, { method: 'GET', headers: {} }, opciones)
}