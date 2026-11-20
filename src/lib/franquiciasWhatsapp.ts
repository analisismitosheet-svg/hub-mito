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
import { enviarTelegram, escaparHtml, telegramActivo } from './telegram.js'
import { claveTelefono } from './informes.js'

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

const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
/** '2026-11-19' -> 'jueves 19/11' */
const diaLargo = (iso: string) => `${DIAS_SEMANA[new Date(`${iso}T12:00:00Z`).getUTCDay()]} ${dia(iso)}`
/** Ayer en Argentina, 'AAAA-MM-DD'. */
const ayerAr = () => new Date(Date.now() - 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })

/** Encabezado que deja claro de qué día es la venta (la reposición es diaria: casi siempre, ayer). */
function encabezadoVenta(p: PropuestaEnvio): { titulo: string; frase: string } {
  if (!p.desde || !p.hasta) return { titulo: 'REPOSICIÓN DIARIA', frase: 'según lo que vendiste' }
  if (p.desde === p.hasta) {
    return p.hasta === ayerAr()
      ? { titulo: `VENTA DE AYER · ${diaLargo(p.hasta).toUpperCase()}`, frase: `según lo que vendiste ayer (${diaLargo(p.hasta)})` }
      : { titulo: `VENTA DEL ${diaLargo(p.hasta).toUpperCase()}`, frase: `según lo que vendiste el ${diaLargo(p.hasta)}` }
  }
  return {
    titulo: `VENTA DEL ${diaLargo(p.desde).toUpperCase()} AL ${diaLargo(p.hasta).toUpperCase()}`,
    frase: `según lo que vendiste del ${diaLargo(p.desde)} al ${diaLargo(p.hasta)}`,
  }
}

/** Artículos y unidades que van en el link (sugerido > 0). */
async function totalesDe(propuestaId: string): Promise<{ articulos: number; unidades: number; vendido: number }> {
  const r = await rest(`franquicias_propuesta_items?propuesta_id=eq.${propuestaId}&select=sugerido,vendido`)
  const filas = r.ok ? ((await r.json()) as Array<{ sugerido: number; vendido: number }>) : []
  const conRepo = filas.filter((f) => Number(f.sugerido) > 0)
  return {
    articulos: conRepo.length,
    unidades: conRepo.reduce((s, f) => s + (Number(f.sugerido) || 0), 0),
    vendido: filas.reduce((s, f) => s + (Number(f.vendido) || 0), 0),
  }
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
export async function enviarPendientesFranquicias(propuestaId?: string, ids?: number[]): Promise<ResultadoFranquicias> {
  const filtro = ids?.length ? `id=in.(${ids.join(',')})` : propuestaId ? `propuesta_id=eq.${propuestaId}` : `intentos=lt.${MAX_INTENTOS}`
  const r = await rest(
    `franquicias_propuesta_envios?estado=neq.enviado&${filtro}` +
      '&select=id,propuesta_id,telefono,token,intentos,franquicias_propuestas(numero,cliente_nombre,franquicia_nombre,desde,hasta,estado)' +
      '&order=creado_at&limit=40',
  )
  if (!r.ok) throw new Error(`No se pudieron leer los envíos (${r.status})`)
  const envios = (await r.json()) as Envio[]
  const plantilla = process.env.WHATSAPP_PLANTILLA_FRANQUICIAS || 'reposicion_franquicia'
  const idioma = process.env.WHATSAPP_PLANTILLA_FRANQUICIAS_IDIOMA || 'es_AR'
  const totales = new Map<string, { articulos: number; unidades: number; vendido: number }>()
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
    const cliente = p.cliente_nombre || p.franquicia_nombre
    const link = `${hubUrl()}/p/${e.token}`
    const texto = `Hola ${cliente}, te armamos la reposición ${p.numero} según la venta del ${ventaDe(p)}: ${t.articulos} artículos, ${t.unidades} unidades.\n\nMirala y confirmala acá:\n${link}`
    const enc = encabezadoVenta(p)
    const res = telegramActivo()
      ? await enviarTelegram(
          e.telefono,
          `<b>📅 REPOSICIÓN DIARIA</b>\n<b>🛍️ ${enc.titulo}</b>\n📊 Venta total: <b>${t.vendido} u.</b> · Disponible a reponer: <b>${t.unidades} u.</b>\n\nHola ${escaparHtml(cliente)}, ${enc.frase} te armamos la reposición ${escaparHtml(p.numero)}: ${t.articulos} artículos, ${t.unidades} unidades.\n\nMirala, ajustá lo que quieras y confirmala con el botón.`,
          null,
          [[{ text: '🛒 Ver y confirmar el pedido', url: link }]],
          true,
        )
      : await enviarWhatsappPlantilla(
          e.telefono,
          {
            nombre: plantilla,
            idioma,
            parametros: [cliente, p.numero, ventaDe(p), String(t.articulos), String(t.unidades), link],
          },
          // Sin costo si el cliente escribió en las últimas 24 h
          texto,
        )
    const ahora = new Date().toISOString()
    await rest(`franquicias_propuesta_envios?id=eq.${e.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(res.ok
        ? { estado: 'enviado', enviado_at: ahora, detalle: res.detalle }
        // Sin vínculo a Telegram no sirve reintentar: sale solo apenas la persona se vincula (enviarAlVincular)
        : { estado: 'error', detalle: res.detalle.slice(0, 500), ...('sinVinculo' in res && res.sinVinculo ? { intentos: MAX_INTENTOS } : {}) }),
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

/**
 * Alguien se acaba de vincular al bot de Telegram: le manda las reposiciones que tenía
 * pendientes (todavía sin aceptar ni vencer) a ese número.
 */
export async function enviarAlVincular(telefono: string): Promise<ResultadoFranquicias | null> {
  const clave = claveTelefono(telefono)
  const r = await rest(
    'franquicias_propuesta_envios?estado=neq.enviado' +
      '&select=id,telefono,franquicias_propuestas!inner(estado,vence_at)' +
      `&franquicias_propuestas.estado=eq.enviada&franquicias_propuestas.vence_at=gt.${new Date().toISOString()}` +
      '&order=id.desc&limit=200',
  )
  if (!r.ok) return null
  const ids = ((await r.json()) as Array<{ id: number; telefono: string }>)
    .filter((e) => claveTelefono(e.telefono) === clave)
    .map((e) => e.id)
  if (!ids.length) return null
  await rest(`franquicias_propuesta_envios?id=in.(${ids.join(',')})`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ estado: 'pendiente', intentos: 0, detalle: null }),
  })
  return enviarPendientesFranquicias(undefined, ids)
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
