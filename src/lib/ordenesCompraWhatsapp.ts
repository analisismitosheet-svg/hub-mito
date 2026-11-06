/**
 * Órdenes de compras · WhatsApp (solo servidor, lo usa api/informe.ts).
 *
 * - pedirAutorizacionOc(token, numero): el usuario tocó «Pedir autorización». La RPC
 *   oc_pedir_autorizacion (con SU sesión: valida permisos) deja los envíos en cola y
 *   devuelve a quién mandarle; acá se manda la plantilla con un botón al link de ese envío.
 * - ampliarAvisosOc(): pg_cron cada 5 min (?evento=diarios): si nadie respondió en N horas,
 *   le llega también a los demás autorizadores.
 * - La respuesta se da en /oc/:token (src/pages/AutorizarOc.tsx, sql/ordenes_compra_link.sql).
 * - Plantilla «oc_autorizar_link» (es_AR): estado y alta en Meta desde Autorizadores (admin).
 */
import { enviarConVentana } from './informesServidor.js'
import { chatDe, enviarTelegram, llamar, telegramActivo, type BotonTelegram } from './telegram.js'

export const PLANTILLA_OC = 'oc_autorizar_link'
const IDIOMA = 'es_AR'
const URL_OC = 'https://hub-mito.vercel.app/oc/'
/** Cuenta de WhatsApp Business (WABA) de «hub mito informes». */
const WABA_ID = process.env.WHATSAPP_WABA_ID || '3764563940363184'
const version = () => process.env.WHATSAPP_VERSION || 'v23.0'

function rest(ruta: string, init: RequestInit = {}): Promise<Response> {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Falta SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  return fetch(`${url}/rest/v1/${ruta}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
}

async function rpcServicio<T>(nombre: string, params: Record<string, unknown>): Promise<T> {
  const r = await rest(`rpc/${nombre}`, { method: 'POST', body: JSON.stringify(params) })
  const j = (await r.json().catch(() => null)) as T & { message?: string }
  if (!r.ok) throw new Error((j as { message?: string })?.message ?? `${nombre}: HTTP ${r.status}`)
  return j
}

/** RPC con la sesión del usuario (la RLS / los permisos los valida la base). */
async function rpcUsuario<T>(token: string, nombre: string, params: Record<string, unknown>): Promise<T> {
  const url = process.env.SUPABASE_URL
  const anon = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !anon) throw new Error('Falta SUPABASE_URL / SUPABASE_ANON_KEY')
  const r = await fetch(`${url}/rest/v1/rpc/${nombre}`, {
    method: 'POST',
    headers: { apikey: anon, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const j = (await r.json().catch(() => null)) as T & { message?: string }
  if (!r.ok) throw new Error((j as { message?: string })?.message ?? `${nombre}: HTTP ${r.status}`)
  return j
}

interface EnvioCola { id: number; nombre: string; telefono: string }
interface DatosOc { numero: number; tipo: string; proveedor: string; monto: number | null; observacion: string | null; cargo: string | null }
interface Lote { envios: EnvioCola[] | null; oc: DatosOc }

const pesos = (v: number | null) => (v == null ? 'sin monto' : '$ ' + Number(v).toLocaleString('es-AR', { maximumFractionDigits: 0 }))
const corto = (s: string | null | undefined, n: number) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return (t.length > n ? t.slice(0, n - 1) + '…' : t) || '-'
}

/** Link por envío, para saber quién respondió. */
async function tokenDelEnvio(id: number): Promise<string | null> {
  const r = await rest(`ordenes_compra_whatsapp?id=eq.${id}&select=token`)
  const filas = r.ok ? ((await r.json().catch(() => [])) as Array<{ token?: string }>) : []
  return filas[0]?.token ?? null
}

async function mandarPlantilla(envio: EnvioCola, oc: DatosOc): Promise<{ ok: boolean; detalle: string; wamid?: string }> {
  const parametros = [
    envio.nombre, String(oc.numero), oc.tipo, corto(oc.proveedor, 80), pesos(oc.monto), corto(oc.observacion, 200), corto(oc.cargo, 60),
  ]
  try {
    const link = await tokenDelEnvio(envio.id)
    if (!link) return { ok: false, detalle: 'No se pudo generar el link del envío' }
    // Con la ventana de 24 h abierta sale gratis: el mismo texto, con el link en lugar del botón
    const texto = parametros
      .reduce((t, valor, i) => t.replace(`{{${i + 1}}}`, () => valor), CUERPO)
      .replace('Tocá el botón para verla y responder.', `Entrá para verla y responder:\n${URL_OC}${link}`)
    if (telegramActivo()) {
      const cuerpo = texto.replace(/Entrá para verla y responder:[\s\S]*$/, 'Respondé con los botones.')
      const t = await enviarTelegram(envio.telefono, cuerpo, null, botonesOc(envio.id, link))
      return t.ok ? { ok: true, detalle: 'enviado por Telegram' } : { ok: false, detalle: t.detalle }
    }
    const r = await enviarConVentana(
      envio.telefono,
      { type: 'text', text: { preview_url: true, body: texto } },
      {
        type: 'template',
        template: {
          name: PLANTILLA_OC,
          language: { code: IDIOMA },
          components: [
            { type: 'body', parameters: parametros.map((t) => ({ type: 'text', text: t })) },
            { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: link }] },
          ],
        },
      },
    )
    return r.ok ? { ok: true, detalle: 'enviado', wamid: r.wamid } : { ok: false, detalle: r.detalle }
  } catch (e) {
    return { ok: false, detalle: `No se pudo contactar WhatsApp: ${(e as Error).message}` }
  }
}

/* ---------------- Botones de Telegram ---------------- */
const botonesOc = (id: number, token: string): BotonTelegram[][] => [
  [{ text: 'Autorizar', callback_data: `oc:a:${id}` }, { text: 'No autorizar', callback_data: `oc:n:${id}` }],
  [{ text: 'Ver detalle', url: `${URL_OC}${token}` }],
]

export interface BotonPulsado {
  id?: string
  data?: string
  from?: { id?: number }
  message?: { message_id?: number; text?: string; chat?: { id?: number } }
}

/**
 * Alguien tocó un botón: un solo toque responde, sin clave ni confirmación (decisión del usuario). El botón
 * solo vale desde el chat vinculado al teléfono de ese envío, y la respuesta queda a nombre de esa persona.
 */
export async function procesarBotonOc(b: BotonPulsado): Promise<void> {
  const responder = (text?: string) => llamar('answerCallbackQuery', { callback_query_id: b.id, ...(text ? { text, show_alert: true } : {}) })
  const m = /^oc:(a|n):(\d+)$/.exec(b.data ?? '')
  const chat = b.message?.chat?.id
  const mensaje = b.message?.message_id
  if (!m || !chat || !mensaje) return void (await responder())
  const [, accion, id] = m

  const r = await rest(`ordenes_compra_whatsapp?id=eq.${id}&select=numero,nombre,telefono,token`)
  const envio = (r.ok ? ((await r.json().catch(() => [])) as Array<{ numero: number; nombre: string; telefono: string; token: string }>) : [])[0]
  const dueno = envio ? await chatDe(envio.telefono) : null
  if (!envio || !dueno || dueno !== chat || b.from?.id !== chat) return void (await responder('Este pedido no es para vos.'))

  let resultado: { oc?: { autorizada_por?: string | null; cancelada_por?: string | null; no_autorizada?: boolean } | null; error?: string }
  try {
    resultado = await rpcServicio('oc_telegram_responder', { p_envio: Number(id), p_autoriza: accion === 'a' })
  } catch {
    return void (await responder('No se pudo registrar la respuesta. Probá de nuevo.'))
  }
  const oc = resultado.oc
  if (!oc) return void (await responder('No se encontró la orden.'))
  const estado = oc.autorizada_por
    ? `Autorizada por ${oc.autorizada_por}.`
    : oc.no_autorizada
      ? `No autorizada por ${oc.cancelada_por ?? '—'}.`
      : `Cancelada por ${oc.cancelada_por ?? '—'}.`
  const base = (b.message?.text ?? `OC N° ${envio.numero}`).replace(/\n*Respondé con los botones\.$/, '')
  await llamar('editMessageText', { chat_id: chat, message_id: mensaje, text: `${base}\n\n${estado}`.slice(0, 4096) })
  await responder()
}

async function mandarLote(l: Lote): Promise<{ enviados: number; errores: string[]; destinatarios: string[] }> {
  const out = { enviados: 0, errores: [] as string[], destinatarios: [] as string[] }
  for (const e of l.envios ?? []) {
    const r = await mandarPlantilla(e, l.oc)
    await rest(`ordenes_compra_whatsapp?id=eq.${e.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ estado: r.ok ? 'enviado' : 'error', detalle: r.detalle.slice(0, 400), wamid: r.wamid ?? null }),
    }).catch(() => undefined)
    if (r.ok) { out.enviados++; out.destinatarios.push(e.nombre) } else out.errores.push(`${e.nombre}: ${r.detalle}`)
  }
  return out
}

export async function pedirAutorizacionOc(token: string, numero: number) {
  const lote = await rpcUsuario<Lote>(token, 'oc_pedir_autorizacion', { p_numero: numero })
  const r = await mandarLote(lote)
  return { ok: r.enviados > 0, ...r }
}

export async function ampliarAvisosOc(): Promise<{ ocs: number; enviados: number }> {
  const lotes = await rpcServicio<Lote[]>('oc_ampliar_avisos', {})
  let enviados = 0
  for (const l of lotes ?? []) enviados += (await mandarLote(l)).enviados
  return { ocs: lotes?.length ?? 0, enviados }
}

/* ---------------- Plantilla en Meta ---------------- */
const CUERPO =
  'Hola {{1}}, hay una orden de compra para autorizar.\n\n' +
  'OC N° {{2}} · {{3}}\nProveedor: {{4}}\nMonto bruto: {{5}}\nQué es: {{6}}\nCargó: {{7}}\n\n' +
  'Tocá el botón para verla y responder.'
const EJEMPLO = ['Diego', '15550', 'Gastos', 'LAVORIS SRL', '$ 39.688', 'Control de ausentismo a domicilio', 'Sanchez Silvina']

export async function estadoPlantillaOc(): Promise<{ existe: boolean; estado?: string; motivo?: string; error?: string }> {
  const token = process.env.WHATSAPP_TOKEN
  if (!token) return { existe: false, error: 'Falta WHATSAPP_TOKEN en Vercel' }
  const r = await fetch(`https://graph.facebook.com/${version()}/${WABA_ID}/message_templates?name=${PLANTILLA_OC}&fields=name,status,language,rejected_reason`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const j = (await r.json().catch(() => null)) as { data?: Array<{ name: string; status: string; language: string; rejected_reason?: string }>; error?: { message?: string } } | null
  if (!r.ok) return { existe: false, error: j?.error?.message ?? `Meta respondió ${r.status}` }
  const t = j?.data?.find((x) => x.name === PLANTILLA_OC && x.language === IDIOMA)
  return t ? { existe: true, estado: t.status, motivo: t.rejected_reason && t.rejected_reason !== 'NONE' ? t.rejected_reason : undefined } : { existe: false }
}

export async function crearPlantillaOc(): Promise<{ existe: boolean; estado?: string; motivo?: string; error?: string }> {
  const token = process.env.WHATSAPP_TOKEN
  if (!token) return { existe: false, error: 'Falta WHATSAPP_TOKEN en Vercel' }
  const ya = await estadoPlantillaOc()
  if (ya.existe) return ya
  const r = await fetch(`https://graph.facebook.com/${version()}/${WABA_ID}/message_templates`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: PLANTILLA_OC,
      language: IDIOMA,
      category: 'UTILITY',
      components: [
        { type: 'BODY', text: CUERPO, example: { body_text: [EJEMPLO] } },
        { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Ver y responder', url: `${URL_OC}{{1}}`, example: [`${URL_OC}ejemplo`] }] },
      ],
    }),
  })
  const j = (await r.json().catch(() => null)) as { id?: string; status?: string; category?: string; error?: { message?: string; error_user_msg?: string } } | null
  if (!r.ok) return { existe: false, error: j?.error?.error_user_msg ?? j?.error?.message ?? `Meta respondió ${r.status}` }
  return { existe: true, estado: j?.status ?? 'PENDING', motivo: j?.category && j.category !== 'UTILITY' ? `Meta la pasó a ${j.category}` : undefined }
}
