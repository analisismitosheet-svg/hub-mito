/**
 * Franquicias · Reposición diaria automática: manda por WhatsApp el link de cada
 * reposición a todos los números del cliente (un envío por número, cada uno con su
 * token: así el link sabe quién confirmó y bloquea a los demás).
 *
 * Solo servidor (lo usa api/informe.ts): service role + WhatsApp Cloud API.
 * La plantilla tiene que estar aprobada en Meta: fuera de la ventana de 24 h un
 * texto libre no llega. Nombre por env WHATSAPP_PLANTILLA_FRANQUICIAS
 * (por defecto reposicion_franquicia, es_AR). Cuerpo con 6 variables:
 *   {{1}} cliente · {{2}} N° de propuesta · {{3}} venta del … · {{4}} artículos ·
 *   {{5}} unidades · {{6}} link
 * Datos: sql/franquicias_reposicion_auto.sql.
 */
import { enviarWhatsappPlantilla } from './informesServidor.js'

/** Reintentos de un envío que falla (plantilla en revisión, Meta caído…): cada 5 min → ~1 h. */
const MAX_INTENTOS = 12

interface PropuestaEnvio {
  numero: string
  cliente_nombre: string | null
  franquicia_nombre: string
  desde: string | null
  hasta: string | null
  estado: string
}
interface Envio {
  id: number
  propuesta_id: string
  telefono: string
  token: string
  intentos: number
  franquicias_propuestas: PropuestaEnvio | null
}

function rest(ruta: string, init: RequestInit = {}): Promise<Response> {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Falta SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  return fetch(`${url}/rest/v1/${ruta}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
}

const hubUrl = () => (process.env.HUB_URL || 'https://hub-mito.vercel.app').replace(/\/$/, '')
/** '2026-10-26' -> '26/10' */
const dia = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
const ventaDe = (p: PropuestaEnvio) =>
  !p.desde || !p.hasta ? 'los últimos días' : p.desde === p.hasta ? dia(p.hasta) : `${dia(p.desde)} al ${dia(p.hasta)}`

/** Artículos y unidades que van en el link (sugerido > 0). */
async function totalesDe(propuestaId: string): Promise<{ articulos: number; unidades: number }> {
  const r = await rest(`franquicias_propuesta_items?propuesta_id=eq.${propuestaId}&sugerido=gt.0&select=sugerido`)
  const filas = r.ok ? ((await r.json()) as Array<{ sugerido: number }>) : []
  return { articulos: filas.length, unidades: filas.reduce((s, f) => s + (Number(f.sugerido) || 0), 0) }
}

export interface ResultadoFranquicias {
  enviados: number
  errores: number
  detalle: string[]
}

/**
 * Manda los envíos pendientes (o los de una propuesta). Cada envío se reclama sumando
 * un intento con PATCH condicional: si dos corridas se cruzan, solo una lo manda.
 */
export async function enviarPendientesFranquicias(propuestaId?: string): Promise<ResultadoFranquicias> {
  const filtro = propuestaId ? `propuesta_id=eq.${propuestaId}` : `intentos=lt.${MAX_INTENTOS}`
  const r = await rest(
    `franquicias_propuesta_envios?estado=neq.enviado&${filtro}` +
      '&select=id,propuesta_id,telefono,token,intentos,franquicias_propuestas(numero,cliente_nombre,franquicia_nombre,desde,hasta,estado)' +
      '&order=creado_at&limit=40',
  )
  if (!r.ok) throw new Error(`No se pudieron leer los envíos (${r.status})`)
  const envios = (await r.json()) as Envio[]
  const plantilla = process.env.WHATSAPP_PLANTILLA_FRANQUICIAS || 'reposicion_franquicia'
  const idioma = process.env.WHATSAPP_PLANTILLA_FRANQUICIAS_IDIOMA || 'es_AR'
  const totales = new Map<string, { articulos: number; unidades: number }>()
  const out: ResultadoFranquicias = { enviados: 0, errores: 0, detalle: [] }

  for (const e of envios) {
    const p = e.franquicias_propuestas
    // Ya confirmada o anulada: el link igual muestra el bloqueo, no hace falta avisar
    if (!p || p.estado !== 'enviada') continue

    const claim = await rest(`franquicias_propuesta_envios?id=eq.${e.id}&intentos=eq.${e.intentos}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ intentos: e.intentos + 1 }),
    })
    const ganado = claim.ok ? ((await claim.json().catch(() => [])) as unknown[]) : []
    if (!ganado.length) continue

    let t = totales.get(e.propuesta_id)
    if (!t) { t = await totalesDe(e.propuesta_id); totales.set(e.propuesta_id, t) }
    const res = await enviarWhatsappPlantilla(e.telefono, {
      nombre: plantilla,
      idioma,
      parametros: [
        p.cliente_nombre || p.franquicia_nombre,
        p.numero,
        ventaDe(p),
        String(t.articulos),
        String(t.unidades),
        `${hubUrl()}/p/${e.token}`,
      ],
    })
    const ahora = new Date().toISOString()
    await rest(`franquicias_propuesta_envios?id=eq.${e.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(res.ok
        ? { estado: 'enviado', enviado_at: ahora, detalle: res.detalle }
        : { estado: 'error', detalle: res.detalle.slice(0, 500) }),
    }).catch(() => undefined)
    if (res.ok) {
      out.enviados++
      await rest(`franquicias_propuestas?id=eq.${e.propuesta_id}&enviada_at=is.null`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ enviada_at: ahora }),
      }).catch(() => undefined)
    } else {
      out.errores++
    }
    out.detalle.push(`${p.numero} +${e.telefono}: ${res.ok ? 'OK' : res.detalle}`)
  }
  return out
}

/** "Enviar ahora" desde el hub: vuelve a poner en cola los que no salieron y los manda. */
export async function reenviarPropuesta(propuestaId: string, todos: boolean): Promise<ResultadoFranquicias> {
  await rest(`franquicias_propuesta_envios?propuesta_id=eq.${propuestaId}${todos ? '' : '&estado=neq.enviado'}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ estado: 'pendiente', intentos: 0, detalle: null }),
  })
  return enviarPendientesFranquicias(propuestaId)
}
