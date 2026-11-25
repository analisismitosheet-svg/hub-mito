/**
 * Telegram (solo servidor, lo usan informes, órdenes de compra y franquicias).
 *
 * Con TELEGRAM_BOT_TOKEN cargado en Vercel, los mensajes salen por acá y WhatsApp deja de usarse.
 * Cada persona abre el bot y toca «Compartir mi número»: Telegram garantiza que el número es suyo
 * y queda en telegram_vinculos qué chat le corresponde a ese teléfono (sql/telegram_vinculos.sql).
 * Un bot no puede iniciar la conversación: a quien no se vinculó no le llega nada.
 */
import { createHash } from 'node:crypto'
import { claveTelefono, normalizarTelefono } from './informes.js'

export const telegramActivo = (): boolean => Boolean(process.env.TELEGRAM_BOT_TOKEN)

export interface ResultadoTelegram {
  ok: boolean
  detalle: string
  via: 'telegram' | 'sin_telegram'
  /** La persona todavía no se vinculó: no es una falla para reintentar. */
  sinVinculo?: boolean
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

/** El token va en la URL: los errores nunca muestran la URL, solo lo que contesta Telegram. */
export async function llamar<T>(metodo: string, cuerpo?: BodyInit | Record<string, unknown>): Promise<{ ok: boolean; result?: T; description?: string }> {
  const esForm = cuerpo instanceof FormData
  const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${metodo}`, {
    method: cuerpo ? 'POST' : 'GET',
    ...(cuerpo && !esForm ? { headers: { 'Content-Type': 'application/json' } } : {}),
    ...(cuerpo ? { body: esForm ? (cuerpo as FormData) : JSON.stringify(cuerpo) } : {}),
    signal: AbortSignal.timeout(20_000),
  })
  const j = (await r.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null
  return { ok: Boolean(j?.ok), result: j?.result, description: j?.description ?? `Telegram respondió ${r.status}` }
}

export async function chatDe(telefono: string): Promise<number | null> {
  const r = await rest(`telegram_vinculos?select=chat_id&telefono=eq.${claveTelefono(telefono)}`)
  if (!r.ok) throw new Error(`No se pudieron leer los vínculos (${r.status})`)
  const filas = (await r.json()) as Array<{ chat_id: number }>
  return filas[0]?.chat_id ?? null
}

export type BotonTelegram = { text: string; callback_data?: string; url?: string }

/** Manda texto, o una imagen con ese texto debajo. Los botones van solo con texto. */
/** html: el texto va con <b> (escapar lo que venga de datos con escaparHtml). */
export async function enviarTelegram(telefono: string, texto: string, png?: Buffer | null, botones?: BotonTelegram[][], html = false): Promise<ResultadoTelegram> {
  try {
    const chat = await chatDe(telefono)
    if (!chat) return { ok: false, sinVinculo: true, via: 'sin_telegram', detalle: 'Todavía no vinculó Telegram' }
    let res
    if (png) {
      const form = new FormData()
      form.append('chat_id', String(chat))
      form.append('caption', texto.slice(0, 1024))
      form.append('photo', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'informe.png')
      res = await llamar('sendPhoto', form)
    } else {
      res = await llamar('sendMessage', { chat_id: chat, text: texto.slice(0, 4096), ...(html ? { parse_mode: 'HTML' } : {}), ...(botones ? { reply_markup: { inline_keyboard: botones } } : {}) })
    }
    return res.ok ? { ok: true, via: 'telegram', detalle: 'Enviado por Telegram' } : { ok: false, via: 'telegram', detalle: res.description ?? 'Telegram rechazó el mensaje' }
  } catch (e) {
    return { ok: false, via: 'telegram', detalle: `No se pudo contactar Telegram: ${(e as Error).name}` }
  }
}

/** Secreto del webhook: Telegram lo manda en un encabezado. Sale del token, así no hay otra variable que cargar. */
export const secretoWebhookTelegram = (): string =>
  createHash('sha256').update(`webhook:${process.env.TELEGRAM_BOT_TOKEN ?? ''}`).digest('hex')

type MensajeTelegram = {
  chat?: { id?: number; type?: string }
  from?: { id?: number; first_name?: string; last_name?: string; username?: string }
  text?: string
  contact?: { phone_number?: string; user_id?: number; first_name?: string; last_name?: string }
}

/** «Nombre Apellido» de Telegram (o @usuario), para mostrar quién es cada número */
const nombreDe = (p?: { first_name?: string; last_name?: string; username?: string }): string | null => {
  const n = [p?.first_name, p?.last_name].map((x) => (x ?? '').trim()).filter(Boolean).join(' ')
  return (n || (p?.username ? `@${p.username}` : '')).slice(0, 80) || null
}

const pedirNumero = (chat: number, texto: string) =>
  llamar('sendMessage', {
    chat_id: chat,
    text: texto,
    reply_markup: { keyboard: [[{ text: 'Compartir mi número', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true },
  })

/**
 * Lo que manda Telegram al webhook: el saludo, o el número que la persona compartió.
 * Devuelve el teléfono si se acaba de vincular (para mandarle lo que tenía pendiente).
 */
export async function procesarUpdateTelegram(update: { message?: MensajeTelegram }): Promise<string | null> {
  const m = update.message
  const chat = m?.chat?.id
  if (!m || !chat || m.chat?.type !== 'private') return null
  if (m.contact) {
    // Solo vale el número propio: se puede compartir el contacto de otra persona
    const tel = normalizarTelefono(m.contact.phone_number ?? '')
    if (!tel || !m.from?.id || m.contact.user_id !== m.from.id) {
      await pedirNumero(chat, 'Necesito tu propio número. Tocá el botón «Compartir mi número».')
      return null
    }
    const r = await rest('telegram_vinculos?on_conflict=telefono', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        telefono: claveTelefono(tel), chat_id: chat, vinculado_at: new Date().toISOString(),
        nombre: nombreDe(m.contact) ?? nombreDe(m.from),
      }),
    })
    await llamar('sendMessage', {
      chat_id: chat,
      text: r.ok ? 'Listo, quedaste vinculado. Los avisos de MITO te van a llegar por acá.' : 'No se pudo guardar. Probá de nuevo en un rato.',
      reply_markup: { remove_keyboard: true },
    })
    return r.ok ? tel : null
  }
  await pedirNumero(chat, 'Hola. Para recibir los avisos de MITO, tocá el botón «Compartir mi número». Solo se hace una vez.')
  return null
}

/**
 * Completa el nombre de los que se vincularon antes de que se guardara (getChat de cada
 * chat privado). Solo los que no lo tienen, de a pocos: lo llama el estado del bot.
 */
export async function completarNombresTelegram(max = 25): Promise<number> {
  if (!telegramActivo()) return 0
  const r = await rest(`telegram_vinculos?select=telefono,chat_id&nombre=is.null&limit=${max}`)
  if (!r.ok) return 0
  const filas = (await r.json()) as Array<{ telefono: string; chat_id: number }>
  let n = 0
  for (const f of filas) {
    const c = await llamar<{ first_name?: string; last_name?: string; username?: string }>('getChat', { chat_id: f.chat_id }).catch(() => null)
    // Sin nombre (chat cerrado, bot bloqueado): se marca vacío para no volver a preguntar
    const nombre = (c?.ok ? nombreDe(c.result) : null) ?? ''
    const u = await rest(`telegram_vinculos?telefono=eq.${encodeURIComponent(f.telefono)}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ nombre }),
    })
    if (u.ok && nombre) n++
  }
  return n
}

export interface EstadoTelegram {
  configurado: boolean
  usuario?: string
  conectado?: boolean
  error?: string
}

export async function estadoTelegram(hubUrl: string): Promise<EstadoTelegram> {
  if (!telegramActivo()) return { configurado: false }
  try {
    const [yo, hook] = await Promise.all([llamar<{ username?: string }>('getMe'), llamar<{ url?: string; allowed_updates?: string[] }>('getWebhookInfo')])
    if (!yo.ok) return { configurado: true, error: yo.description }
    // Sin callback_query, Telegram no avisa cuando alguien toca un botón
    const conectado = hook.result?.url === urlWebhook(hubUrl) && Boolean(hook.result?.allowed_updates?.includes('callback_query'))
    return { configurado: true, usuario: yo.result?.username, conectado }
  } catch (e) {
    return { configurado: true, error: `No se pudo contactar Telegram: ${(e as Error).name}` }
  }
}

const urlWebhook = (hubUrl: string) => `${hubUrl.replace(/\/$/, '')}/api/informe?evento=telegram`

/** Le dice a Telegram adónde mandar lo que le escriben al bot. */
export async function conectarBotTelegram(hubUrl: string): Promise<{ ok: boolean; error?: string }> {
  if (!telegramActivo()) return { ok: false, error: 'Falta TELEGRAM_BOT_TOKEN en Vercel' }
  const r = await llamar('setWebhook', { url: urlWebhook(hubUrl), secret_token: secretoWebhookTelegram(), allowed_updates: ['message', 'callback_query'] })
  return r.ok ? { ok: true } : { ok: false, error: r.description }
}

/** Para textos con parse_mode HTML: lo que viene de datos (nombres) no puede romper el formato. */
export const escaparHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
