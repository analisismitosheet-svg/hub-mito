/**
 * Informes del área Sistemas: envío manual y disparo de los programados.
 *
 *   POST /api/informe   { id }                        -> envía el informe guardado
 *   POST /api/informe   { informe, preview: true }     -> devuelve el texto sin enviar
 *   POST /api/informe   { estado: true }               -> ¿WhatsApp conectado? (número y nombre en Meta)
 *   GET  /api/informe   (Bearer $CRON_SECRET ó JWT)    -> dispara los diarios vencidos
 *   GET  /api/informe?evento=repo                      -> si la repo del día llegó al 100%, manda los
 *        informes "al completar la repo" que no salieron hoy (lo llama pg_cron cada 5 min; sin datos sensibles)
 *   GET  /api/informe?evento=franquicias               -> manda los WhatsApp en cola de la reposición diaria
 *        automática de franquicias (pg_cron cada 5 min y el puente apenas la arma)
 *   POST /api/informe   { franquicias: id, todos? }    -> manda ya el WhatsApp de esa reposición (Franquicias)
 *   GET/POST /api/informe?evento=whatsapp              -> webhook de Meta: verificación, estado de entrega
 *        (sent/delivered/read/failed) de cada mensaje, guardado en informes_envios por wamid, y mensajes
 *        entrantes, que abren la ventana de 24 h para mandar gratis (whatsapp_ventana)
 *   POST /api/informe   { ocPedir: numero }            -> Órdenes de compras: «Pedir autorización» por WhatsApp
 *   POST /api/informe   { ocPlantilla: 'estado'|'crear' } -> plantilla oc_autorizar_link en Meta (solo admin)
 *   (?evento=diarios además amplía los avisos de OC que nadie respondió en N horas)
 *
 * Antes eran dos funciones (informe-enviar e informe-cron); se unificaron para no
 * pasar el tope de 12 Serverless Functions del plan Hobby de Vercel. El método
 * distingue: GET = cron (Vercel Cron y respaldo al abrir la pantalla), POST = envío manual.
 *
 * Variables de entorno en Vercel (sin prefijo VITE_): CRON_SECRET, SUPABASE_URL,
 * SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, WHATSAPP_TOKEN, WHATSAPP_PHONE_ID.
 */
import { armarCuerpo, descartarRespaldo, enviarInforme, estadoWhatsapp, generarImagenInforme, reenviarConPlantilla, registrarMensajeEntrante, repoCompleta, tienePermiso, usuarioDe } from '../src/lib/informesServidor.js'
import { formatoDe, type Informe } from '../src/lib/informes.js'
import { mismoSecreto } from '../src/lib/apiAuth.js'
import { enviarPendientesFranquicias, reenviarPropuesta } from '../src/lib/franquiciasWhatsapp.js'
import { ampliarAvisosOc, crearPlantillaOc, estadoPlantillaOc, pedirAutorizacionOc } from '../src/lib/ordenesCompraWhatsapp.js'

type Req = {
  method?: string
  headers: { authorization?: string }
  body?: unknown
  query?: Record<string, string | string[] | undefined>
}

type Res = {
  status(code: number): Res
  setHeader(name: string, value: string): Res
  json(body: unknown): void
  send(body: string): void
}

const DIAS_ES = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab']

function rest(ruta: string, init: RequestInit = {}): Promise<Response> {
  const url = process.env.SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return fetch(`${url}/rest/v1/${ruta}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
}

/* ------------------------------------------------------------------ */
/*  GET: cron (informes programados)                                    */
/* ------------------------------------------------------------------ */

/** Fecha/hora/día de Argentina (UTC-3). */
function ahoraAr() {
  const ar = new Date(Date.now() - 3 * 3600_000)
  const hh = String(ar.getUTCHours()).padStart(2, '0')
  const mm = String(ar.getUTCMinutes()).padStart(2, '0')
  return { fecha: ar.toISOString().slice(0, 10), hora: `${hh}:${mm}`, dia: DIAS_ES[ar.getUTCDay()] }
}

/** Instante UTC de hoy a las 00:00 (hora de Argentina). */
function inicioHoyUtc(): string {
  const ar = new Date(Date.now() - 3 * 3600_000)
  const arStart = Date.UTC(ar.getUTCFullYear(), ar.getUTCMonth(), ar.getUTCDate())
  return new Date(arStart + 3 * 3600_000).toISOString()
}

/** Solo por header (Vercel Cron manda Authorization: Bearer $CRON_SECRET): por query quedaba en logs. */
function secretoDe(req: Req): string {
  const auth = req.headers.authorization ?? ''
  return auth.startsWith('Bearer ') ? auth.slice(7) : ''
}

/** Reclamo atómico del envío de hoy: devuelve true sólo si este proceso lo ganó. */
async function reclamarHoy(id: string): Promise<boolean> {
  const corte = inicioHoyUtc()
  const claim = await rest(
    `informes?id=eq.${id}&or=(ultimo_envio.is.null,ultimo_envio.lt.${encodeURIComponent(corte)})`,
    { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ ultimo_envio: new Date().toISOString() }) },
  )
  if (!claim.ok) return false
  const reclamados = (await claim.json().catch(() => [])) as Informe[]
  return Array.isArray(reclamados) && reclamados.length > 0
}

/**
 * Disparo "al completar la repo": sin autenticación porque no recibe nada ni devuelve datos;
 * sólo manda (una vez por día) lo que ya está configurado, y únicamente si la repo terminó.
 */
async function eventoRepo(res: Res) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: 'Falta la configuración de Supabase' })
  const rI = await rest('informes?select=*&activo=eq.true&modo=eq.repo_completa')
  if (!rI.ok) return res.status(502).json({ error: 'No se pudieron leer los informes' })
  const informes = ((await rI.json()) as Informe[]).filter((i) => {
    const corte = inicioHoyUtc()
    return !i.ultimo_envio || i.ultimo_envio < corte
  })
  if (!informes.length) return res.status(200).json({ pendientes: 0 })
  const { fecha, dia } = ahoraAr()
  let completa = false
  try {
    completa = await repoCompleta(fecha)
  } catch (e) {
    return res.status(200).json({ pendientes: informes.length, completa: false, error: (e as Error).message })
  }
  if (!completa) return res.status(200).json({ pendientes: informes.length, completa: false })
  let enviados = 0
  for (const i of informes) {
    if (i.dias?.length && !i.dias.includes(dia)) continue
    if (!(await reclamarHoy(i.id))) continue
    const r = await enviarInforme(i, 'cron')
    if (r.ok) enviados++
    // Si no salió (plantilla todavía en revisión, falta de pago, etc.) se libera para reintentar en 5 min
    else await rest(`informes?id=eq.${i.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ ultimo_envio: null }) }).catch(() => undefined)
  }
  return res.status(200).json({ pendientes: informes.length, completa: true, enviados })
}

async function cron(req: Req, res: Res) {
  if (req.query?.evento === 'repo') return eventoRepo(res)
  // ?evento=franquicias: WhatsApp de la reposición diaria automática (pg_cron cada 5 min y el
  // puente apenas la arma). Sin autenticación como ?evento=repo: no recibe nada ni devuelve
  // datos, solo manda los envíos que ya están en cola.
  if (req.query?.evento === 'franquicias') {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: 'Falta la configuración de Supabase' })
    try {
      const r = await enviarPendientesFranquicias()
      return res.status(200).json({ enviados: r.enviados, errores: r.errores })
    } catch (e) {
      return res.status(502).json({ error: (e as Error).message })
    }
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Falta la configuración de Supabase' })
  }

  // ?evento=diarios: pg_cron cada 5 min (sql/informes_diarios_cron.sql), para que salgan a su hora
  // (el cron de Vercel Hobby es uno por día). Sin autenticación, igual que ?evento=repo: no recibe
  // nada ni devuelve datos, y solo manda los diarios ya vencidos, una vez por día (reclamo atómico).
  if (req.query?.evento !== 'diarios') {
    // Autorización: el secreto del cron, o un usuario con permiso (respaldo desde la app).
    const token = secretoDe(req)
    const secreto = process.env.CRON_SECRET
    let autorizado = Boolean(secreto) && mismoSecreto(token, secreto ?? '')
    if (!autorizado && token) {
      const uid = await usuarioDe(token)
      autorizado = Boolean(uid) && (await tienePermiso(token, ['sistemas.informes.view']))
    }
    if (!autorizado) return res.status(401).json({ error: 'No autorizado' })
  }

  // Órdenes de compras: avisos de autorización que nadie respondió en N horas → a los demás autorizadores
  const ocAmpliadas = await ampliarAvisosOc().catch((e: Error) => ({ error: e.message }))

  const rI = await rest('informes?select=*&activo=eq.true&modo=eq.diario')
  if (!rI.ok) return res.status(502).json({ error: `No se pudieron leer los informes (${rI.status})` })
  const informes = (await rI.json()) as Informe[]

  const { fecha, hora, dia } = ahoraAr()
  const corte = inicioHoyUtc()
  const enviados: Array<{ nombre: string; ok: boolean; detalle: string }> = []

  for (const i of informes) {
    const suHora = (i.hora ?? '').trim()
    if (!/^\d{2}:\d{2}$/.test(suHora)) continue
    if (hora < suHora) continue // todavía no es la hora
    if (i.dias?.length && !i.dias.includes(dia)) continue // no toca hoy

    // Reclamo atómico: sólo pasa si no se mandó hoy todavía.
    const claim = await rest(
      `informes?id=eq.${i.id}&or=(ultimo_envio.is.null,ultimo_envio.lt.${encodeURIComponent(corte)})`,
      { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ ultimo_envio: new Date().toISOString() }) },
    )
    if (!claim.ok) continue
    const reclamados = (await claim.json().catch(() => [])) as Informe[]
    if (!Array.isArray(reclamados) || reclamados.length === 0) continue // ya se mandó hoy

    const r = await enviarInforme(i, 'cron')
    enviados.push({ nombre: i.nombre, ok: r.ok, detalle: r.detalle })
    // Plantilla todavía sin aprobar en Meta (#132001) para todos: no le llegó a nadie, así que se
    // libera y se reintenta en 5 min (hasta la medianoche) en vez de esperar al día siguiente.
    const partes = r.detalle.split(' · ')
    if (!r.ok && partes.length > 0 && partes.every((p) => p.includes('(#132001)'))) {
      await rest(`informes?id=eq.${i.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ ultimo_envio: null }) }).catch(() => undefined)
    }
  }

  return res.status(200).json({ fecha, hora, dia, informes: informes.length, procesados: enviados.length, enviados, ocAmpliadas })
}

/* ------------------------------------------------------------------ */
/*  POST: envío manual (o previsualización)                             */
/* ------------------------------------------------------------------ */

function cuerpo(req: Req): Record<string, unknown> {
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body) as Record<string, unknown>
    } catch {
      return {}
    }
  }
  return (req.body as Record<string, unknown>) ?? {}
}

async function manual(req: Req, res: Res) {
  const auth = req.headers.authorization ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const uid = token ? await usuarioDe(token) : null
  if (!uid) return res.status(401).json({ error: 'No autorizado' })
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Falta la configuración de Supabase' })
  }

  const datos = cuerpo(req)
  const preview = datos.preview === true

  // --- Franquicias: mandar ya el WhatsApp de una reposición ---
  if (typeof datos.franquicias === 'string') {
    if (!(await tienePermiso(token, ['mayorista.franquicias.view']))) return res.status(403).json({ error: 'No tenés permiso para esta acción' })
    if (!/^[0-9a-f-]{36}$/i.test(datos.franquicias)) return res.status(400).json({ error: 'Propuesta inválida' })
    try {
      return res.status(200).json(await reenviarPropuesta(datos.franquicias, datos.todos === true))
    } catch (e) {
      return res.status(502).json({ error: (e as Error).message })
    }
  }

  // --- Órdenes de compras: pedir autorización por WhatsApp (la RPC valida quién puede) ---
  if (datos.ocPedir !== undefined) {
    const numero = Number(datos.ocPedir)
    if (!Number.isInteger(numero) || numero <= 0) return res.status(400).json({ error: 'N° de OC inválido' })
    if (!(await tienePermiso(token, ['ordenes_compra.view']))) return res.status(403).json({ error: 'No tenés permiso para esta acción' })
    try {
      return res.status(200).json(await pedirAutorizacionOc(token, numero))
    } catch (e) {
      return res.status(400).json({ error: (e as Error).message })
    }
  }
  // --- Órdenes de compras: plantilla de WhatsApp (solo admin) ---
  if (datos.ocPlantilla === 'estado' || datos.ocPlantilla === 'crear') {
    if (!(await tienePermiso(token, ['__solo_admin__']))) return res.status(403).json({ error: 'Solo el administrador' })
    try {
      return res.status(200).json(datos.ocPlantilla === 'crear' ? await crearPlantillaOc() : await estadoPlantillaOc())
    } catch (e) {
      return res.status(502).json({ error: (e as Error).message })
    }
  }

  // --- Estado de la conexión con WhatsApp (Meta) ---
  if (datos.estado === true) {
    if (!(await tienePermiso(token, ['sistemas.informes.view']))) return res.status(403).json({ error: 'No tenés permiso para esta acción' })
    return res.status(200).json(await estadoWhatsapp())
  }

  const permitido = await tienePermiso(token, preview ? ['sistemas.informes.view'] : ['sistemas.informes.edit'])
  if (!permitido) return res.status(403).json({ error: 'No tenés permiso para esta acción' })

  // --- Previsualizar: arma el texto desde el objeto que manda el formulario ---
  if (preview) {
    const informe = datos.informe as Informe | undefined
    if (!informe) return res.status(400).json({ error: 'Falta el informe' })
    try {
      if (formatoDe(informe) === 'imagen') {
        const { png, caption } = await generarImagenInforme(informe)
        return res.status(200).json({ ok: true, texto: caption, imagen: `data:image/png;base64,${png.toString('base64')}` })
      }
      const texto = await armarCuerpo(informe)
      return res.status(200).json({ ok: true, texto })
    } catch (e) {
      return res.status(200).json({ ok: false, error: (e as Error).message })
    }
  }

  // --- Enviar un informe guardado por id ---
  const id = typeof datos.id === 'string' ? datos.id : ''
  if (!id) return res.status(400).json({ error: 'Falta el id del informe' })

  const rI = await rest(`informes?select=*&id=eq.${id}`)
  if (!rI.ok) return res.status(502).json({ error: `No se pudo leer el informe (${rI.status})` })
  const filas = (await rI.json()) as Informe[]
  const informe = filas?.[0]
  if (!informe) return res.status(404).json({ error: 'Informe no encontrado' })

  // Reenvío del informe de otro día (yyyy-mm-dd, hasta 31 días atrás): no cuenta como el envío de hoy
  let fecha: string | undefined
  if (datos.fecha !== undefined) {
    fecha = String(datos.fecha)
    const dias = (Date.parse(`${ahoraAr().fecha}T00:00:00Z`) - Date.parse(`${fecha}T00:00:00Z`)) / 86_400_000
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !(dias >= 1 && dias <= 31)) return res.status(400).json({ error: 'Fecha inválida (de ayer a 31 días atrás)' })
  }
  const resultado = await enviarInforme(informe, 'manual', fecha)
  return res.status(200).json(resultado)
}

/* ------------------------------------------------------------------ */
/*  Webhook de WhatsApp: estado de entrega de lo que mandamos           */
/* ------------------------------------------------------------------ */

/** Token de la verificación del webhook (el que se escribe en Meta al suscribirlo). No es la
 *  credencial de envío: solo prueba que la suscripción la pidió quien conoce este valor. */
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'hub-mito-informes-entrega'

/** Orden de los estados: uno viejo que llega tarde (sent después de read) no pisa al nuevo. */
const ORDEN_ESTADO: Record<string, number> = { sent: 1, delivered: 2, read: 3, failed: 4 }

type EstadoMeta = {
  id?: string
  status?: string
  timestamp?: string
  errors?: Array<{ code?: number; title?: string; message?: string; error_data?: { details?: string } }>
}

type MensajeMeta = { from?: string; timestamp?: string; type?: string }

/** Avisos que llegan como mensaje pero no son el contacto escribiendo. */
const NO_ABREN_VENTANA = new Set(['system', 'reaction', 'unsupported'])

/** Error de Meta: mensaje sin plantilla fuera de la ventana de 24 h. */
const VENTANA_VENCIDA = 131047

async function webhookWhatsapp(req: Req, res: Res) {
  // Verificación al suscribir: Meta manda hub.mode=subscribe, hub.verify_token y hub.challenge
  if (req.method === 'GET') {
    const q = req.query ?? {}
    if (q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === VERIFY_TOKEN) {
      return res.status(200).send(String(q['hub.challenge'] ?? ''))
    }
    // Abierta a mano en el navegador (sin los datos de Meta): no es un error, solo se avisa
    if (!q['hub.mode']) {
      return res.status(200).json({ ok: true, mensaje: 'Webhook de WhatsApp del hub listo. Meta lo verifica solo al guardarlo con el token.' })
    }
    return res.status(403).json({ error: 'Token de verificación inválido' })
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: 'Falta la configuración de Supabase' })

  // Solo actualiza filas que ya existen (por wamid): un aviso inventado no agrega nada.
  const body = cuerpo(req) as {
    entry?: Array<{ changes?: Array<{ value?: {
      metadata?: { phone_number_id?: string }
      statuses?: EstadoMeta[]
      messages?: MensajeMeta[]
    } }> }>
  }
  const valores = (body.entry ?? []).flatMap((e) => (e.changes ?? []).flatMap((c) => (c.value ? [c.value] : [])))

  // Un contacto escribió: se abre su ventana de 24 h para mandarle gratis. Solo si el aviso es de
  // nuestro número; un aviso inventado abriría una ventana falsa (que igual cae en la plantilla).
  const miNumero = process.env.WHATSAPP_PHONE_ID
  const entrantes = valores
    .filter((v) => miNumero && v.metadata?.phone_number_id === miNumero)
    .flatMap((v) => v.messages ?? [])
    .filter((m) => m.from && !NO_ABREN_VENTANA.has(m.type ?? ''))
  for (const m of entrantes) {
    const at = Math.min(Number(m.timestamp) * 1000 || Date.now(), Date.now())
    await registrarMensajeEntrante(m.from!, new Date(at)).catch(() => undefined)
  }

  const estados = valores.flatMap((v) => v.statuses ?? [])
  for (const s of estados) {
    if (!s.id || !s.status || !(s.status in ORDEN_ESTADO)) continue
    const err = s.errors?.[0]
    // La ventana había vencido: sale la plantilla de respaldo y este aviso ya no cuenta como «no llegó»
    if (s.status === 'failed' && err?.code === VENTANA_VENCIDA && (await reenviarConPlantilla(s.id).catch(() => false))) continue
    if (s.status === 'delivered' || s.status === 'read') await descartarRespaldo(s.id).catch(() => undefined)
    const errorTxt = err ? `${err.code ?? ''} ${err.title ?? err.message ?? ''}${err.error_data?.details ? ` — ${err.error_data.details}` : ''}`.trim() : null
    // Estados que no deben pisar: los que van "después" del que llega
    const peores = Object.keys(ORDEN_ESTADO).filter((k) => ORDEN_ESTADO[k] > ORDEN_ESTADO[s.status!])
    const filtro = peores.length ? `&or=(estado.is.null,estado.not.in.(${peores.join(',')}))` : ''
    await rest(`informes_envios?wamid=eq.${encodeURIComponent(s.id)}${filtro}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        estado: s.status,
        estado_at: s.timestamp ? new Date(Number(s.timestamp) * 1000).toISOString() : new Date().toISOString(),
        ...(errorTxt ? { error_entrega: errorTxt.slice(0, 300) } : {}),
      }),
    }).catch(() => undefined)
  }
  // Meta reintenta si no recibe 200: se contesta siempre, aunque no haya nada nuestro
  return res.status(200).json({ ok: true, estados: estados.length, entrantes: entrantes.length })
}

export default async function handler(req: Req, res: Res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.query?.evento === 'whatsapp') return webhookWhatsapp(req, res)
  if (req.method === 'GET') return cron(req, res)
  if (req.method === 'POST') return manual(req, res)
  return res.status(405).json({ error: 'Método no permitido' })
}
