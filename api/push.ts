/**
 * Avisos push al celular (Web Push). Un solo endpoint para todos los avisos:
 *
 *   GET  /api/push?tipo=armado|pausa|faltantes  -> { publicKey } (clave VAPID pública)
 *   POST /api/push?tipo=armado                  -> avisa los armados pendientes del usuario
 *   POST /api/push?tipo=pausa                   -> avisa las pausas pendientes del usuario
 *   POST /api/push?tipo=faltantes { armado_id } -> avisa los faltantes de un armado cerrado
 *   POST /api/push?tipo=transferencia { lote_id } -> avisa a los legajos de la ubicación (Depósito Indo)
 *                                                    que el lote tiene renglones para ellos
 *   POST /api/push?tipo=requerimiento { id }       -> avisa al local qué arreglo le programaron, el día,
 *                                                    el horario y quién va (sql/requerimientos.sql)
 *
 * Antes eran tres funciones (push-armado / push-pausa / push-faltantes); se unificaron
 * para no pasar el tope de 12 Serverless Functions del plan Hobby de Vercel. El cliente
 * arma la URL con el ?tipo= (src/lib/push.ts).
 *
 * Variables de entorno en Vercel: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT,
 * SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
 */
import webpush from 'web-push'
import { autorizado, esUuid } from '../src/lib/apiAuth.js'

type Req = {
  method?: string
  headers: { authorization?: string }
  body?: string
  query?: Record<string, string | string[] | undefined>
}

type Res = {
  status(code: number): Res
  setHeader(name: string, value: string): Res
  json(body: unknown): void
}

interface Armado {
  id: string
  pedido_numero: number | null
  pedido_codigo: string
  cliente: string | null
  cliente_nombre?: string | null
  prioridad?: 'urgente' | 'normal' | 'baja'
  asignado_legajo?: string | null
  aceptado_legajo?: string | null
  aceptado_nombre?: string | null
  faltantes?: number
}

interface Pausa {
  id: string
  tipo: string
  motivo: string
  detalle: string | null
  local: string | null
}

interface Faltante {
  articulo: string | null
  descripcion: string | null
  color: string | null
  talle: string | null
  cantidad: number
  escaneadas: number
}

interface Suscripcion {
  endpoint: string
  usuario_id: string
  p256dh: string
  auth: string
}

const PRIORIDAD: Record<string, string> = { urgente: '🔴 URGENTE', normal: '🟡 Normal', baja: '🟢 Baja' }

const MOTIVO: Record<string, string> = {
  bano: 'Baño',
  otra_tarea: 'Me pidieron otra tarea',
  falta_mercaderia: 'Falta mercadería',
  equipo: 'Problema con el celular/escáner',
  otro: 'Otro motivo',
}

function primerQuery(q: string | string[] | undefined): string {
  if (Array.isArray(q)) return typeof q[0] === 'string' ? q[0] : ''
  return q ?? ''
}

/** Id del usuario del JWT (o null si no es válido). */
async function usuarioDe(token: string): Promise<string | null> {
  const url = process.env.SUPABASE_URL
  const anon = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !anon) return null
  try {
    const r = await fetch(`${url}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: anon } })
    if (!r.ok) return null
    const u = (await r.json()) as { id?: string }
    return u.id ?? null
  } catch {
    return null
  }
}

/** PostgREST con la service role */
async function rest(ruta: string, init: RequestInit = {}): Promise<Response> {
  const url = process.env.SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return fetch(`${url}/rest/v1/${ruta}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
}

/** Manda un payload a las suscripciones y limpia las vencidas (404/410). */
async function entregar(payload: string, subs: Suscripcion[]): Promise<{ enviados: number; vencidas: number }> {
  let enviados = 0
  const vencidas: string[] = []
  const usadas = new Set<string>()
  const envios: Promise<void>[] = []
  for (const s of subs) {
    envios.push(
      webpush
        .sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600, urgency: 'high' })
        .then(() => { enviados++; usadas.add(s.endpoint) })
        .catch((e: { statusCode?: number }) => {
          if (e.statusCode === 404 || e.statusCode === 410) vencidas.push(s.endpoint)
        }),
    )
  }
  await Promise.all(envios)
  if (vencidas.length) {
    await rest(`push_suscripciones?endpoint=in.(${vencidas.map((v) => `"${v.replace(/"/g, '')}"`).join(',')})`, { method: 'DELETE' })
  }
  if (usadas.size) {
    await rest(`push_suscripciones?endpoint=in.(${subs.filter((s) => usadas.has(s.endpoint)).map((s) => `"${s.endpoint.replace(/"/g, '')}"`).join(',')})`, {
      method: 'PATCH',
      body: JSON.stringify({ usado_at: new Date().toISOString() }),
      headers: { Prefer: 'return=minimal' },
    })
  }
  return { enviados, vencidas: vencidas.length }
}

/** Ids de usuarios con un permiso: admin + por rol + directo (con revoke). */
async function conPermiso(clave: string): Promise<string[]> {
  const ids = new Set<string>()
  const rA = await rest('usuarios?select=id&es_admin=eq.true')
  if (rA.ok) for (const u of (await rA.json()) as { id: string }[]) ids.add(u.id)

  const rR = await rest(`rol_permisos?select=rol&permiso_clave=eq.${clave}`)
  if (rR.ok) {
    const roles = (await rR.json()) as { rol: string }[]
    if (roles.length) {
      const lista = roles.map((r) => `"${r.rol.replace(/"/g, '')}"`).join(',')
      const rU = await rest(`usuario_roles?select=usuario_id&rol_codigo=in.(${lista})`)
      if (rU.ok) for (const u of (await rU.json()) as { usuario_id: string }[]) ids.add(u.usuario_id)
    }
  }

  const rP = await rest(`usuario_permisos?select=usuario_id,efecto&permiso_clave=eq.${clave}`)
  if (rP.ok) {
    for (const u of (await rP.json()) as { usuario_id: string; efecto: string }[]) {
      if (u.efecto === 'revoke') ids.delete(u.usuario_id)
      else ids.add(u.usuario_id)
    }
  }
  return [...ids]
}

/** Armado de pedidos: los armados pendientes que pidió el usuario y todavía no se avisaron. */
async function avisarArmado(req: Req, res: Res, uid: string) {
  // Armados pendientes que pidió este usuario y todavía no se avisaron (últimas 2 h)
  const desde = new Date(Date.now() - 2 * 3600_000).toISOString()
  const rA = await rest(
    `mayorista_armados?select=id,pedido_numero,pedido_codigo,cliente,cliente_nombre,prioridad,asignado_legajo` +
      `&estado=eq.pendiente&push_at=is.null&creado_por=eq.${uid}&creado_at=gte.${desde}&order=creado_at.asc`,
  )
  if (!rA.ok) return res.status(502).json({ error: `No se pudieron leer los armados (${rA.status})` })
  const armados = (await rA.json()) as Armado[]
  if (!armados.length) return res.status(200).json({ enviados: 0, armados: 0 })

  // Se marcan antes de mandar, así dos llamadas seguidas no avisan dos veces
  const ids = armados.map((a) => a.id)
  await rest(`mayorista_armados?id=in.(${ids.join(',')})`, {
    method: 'PATCH',
    body: JSON.stringify({ push_at: new Date().toISOString() }),
    headers: { Prefer: 'return=minimal' },
  })

  const rS = await rest('push_suscripciones?select=endpoint,usuario_id,p256dh,auth')
  if (!rS.ok) return res.status(502).json({ error: `No se pudieron leer las suscripciones (${rS.status})` })
  const subs = (await rS.json()) as Suscripcion[]

  // Legajo de cada usuario suscripto: los armados asignados al responsable del local
  // (sql/armado_responsable.sql) le llegan solo a él; los sin asignar, a todos.
  const legajoDe = new Map<string, string>()
  const esLegajo = new Set<string>()
  const uids = [...new Set(subs.map((x) => x.usuario_id))]
  if (uids.length) {
    const rU = await rest(`usuarios?select=id,legajo,email&id=in.(${uids.join(',')})`)
    if (rU.ok) {
      for (const u of (await rU.json()) as { id: string; legajo: string | null; email: string | null }[]) {
        legajoDe.set(u.id, String(u.legajo ?? '').trim())
        if (String(u.email ?? '').toLowerCase().endsWith('@empleados.hub-mito.app')) esLegajo.add(u.id)
      }
    }
  }
  // Los armados son del piso: legajos y quien tenga mayorista.repos_piso. El rol deposito
  // también anota el celular (avisos de transferencias de Indo) y no tiene que sonarle esto.
  const piso = new Set([...esLegajo, ...(await conPermiso('mayorista.repos_piso'))])
  const subsPiso = subs.filter((s) => piso.has(s.usuario_id))
  const grupos = new Map<string, Armado[]>() // '' = sin asignar
  for (const a of armados) {
    const k = String(a.asignado_legajo ?? '').trim()
    grupos.set(k, [...(grupos.get(k) ?? []), a])
  }

  /** Un aviso por tanda: si es uno, el detalle; si son varios, el resumen */
  const aviso = (lista: Armado[]) => {
    const a0 = lista[0]
    const urgente = lista.some((a) => a.prioridad === 'urgente')
    return JSON.stringify(
      lista.length === 1
        ? {
            title: `🔔 Pedido N° ${a0.pedido_numero ?? a0.pedido_codigo} a armar`,
            body: `${PRIORIDAD[a0.prioridad ?? ''] ?? ''} · ${a0.cliente_nombre || a0.cliente || 'Cliente'}`,
            url: '/mayorista/mi-repo',
            urgente,
          }
        : {
            title: `🔔 ${lista.length} pedidos a armar`,
            body: lista.map((a) => `N° ${a.pedido_numero ?? a.pedido_codigo}`).join(' · '),
            url: '/mayorista/mi-repo',
            urgente,
          },
    )
  }

  let enviados = 0
  let vencidas = 0
  for (const [legajo, lista] of grupos) {
    const payload = aviso(lista)
    const destinatarios = subsPiso.filter((s) => !legajo || legajoDe.get(s.usuario_id) === legajo)
    const r = await entregar(payload, destinatarios)
    enviados += r.enviados
    vencidas += r.vencidas
  }
  return res.status(200).json({ enviados, armados: armados.length, suscripciones: subs.length, vencidas })
}

/** Pausas del piso: las pendientes que pidió el usuario, a los que autorizan. */
async function avisarPausa(req: Req, res: Res, uid: string) {
  // Pausas pendientes que pidió este usuario y todavía no se avisaron (últimas 2 h)
  const desde = new Date(Date.now() - 2 * 3600_000).toISOString()
  const rP = await rest(
    `piso_pausas?select=id,tipo,motivo,detalle,local` +
      `&estado=eq.pendiente&push_at=is.null&usuario_id=eq.${uid}&solicitada_at=gte.${desde}&order=solicitada_at.asc`,
  )
  if (!rP.ok) return res.status(502).json({ error: `No se pudieron leer las pausas (${rP.status})` })
  const pausas = (await rP.json()) as Pausa[]
  if (!pausas.length) return res.status(200).json({ enviados: 0, pausas: 0 })

  // Se marcan antes de mandar, así dos llamadas seguidas no avisan dos veces
  const ids = pausas.map((p) => p.id)
  await rest(`piso_pausas?id=in.(${ids.join(',')})`, {
    method: 'PATCH',
    body: JSON.stringify({ push_at: new Date().toISOString() }),
    headers: { Prefer: 'return=minimal' },
  })

  const uids = await conPermiso('mayorista.pausas.autorizar')
  if (!uids.length) return res.status(200).json({ enviados: 0, pausas: pausas.length, autorizadores: 0 })

  const rS = await rest(`push_suscripciones?select=endpoint,usuario_id,p256dh,auth&usuario_id=in.(${uids.join(',')})`)
  if (!rS.ok) return res.status(502).json({ error: `No se pudieron leer las suscripciones (${rS.status})` })
  const subs = (await rS.json()) as Suscripcion[]
  if (!subs.length) return res.status(200).json({ enviados: 0, pausas: pausas.length, suscripciones: 0 })

  /** Un aviso por pausa: si son varias, se resumen */
  const payloadDe = (p: Pausa) =>
    JSON.stringify({
      title: '⏸️ Pausa por autorizar',
      body: `${MOTIVO[p.motivo] ?? p.motivo}${p.local ? ` · ${p.local}` : ''}${p.detalle ? ` · ${p.detalle}` : ''}`,
      url: '/mayorista/pausas',
      urgente: true,
    })

  let enviados = 0
  let vencidas = 0
  for (const p of pausas) {
    const r = await entregar(payloadDe(p), subs)
    enviados += r.enviados
    vencidas += r.vencidas
  }
  return res.status(200).json({ enviados, pausas: pausas.length, autorizadores: uids.length, suscripciones: subs.length, vencidas })
}

/** Faltantes de stock: al cerrar un armado con faltantes, a los que pueden verlos. */
async function avisarFaltantes(req: Req, res: Res, token: string) {
  let armadoId = ''
  try {
    armadoId = String(JSON.parse(req.body ?? '{}').armado_id ?? '')
  } catch {
    armadoId = ''
  }
  if (!armadoId) return res.status(400).json({ error: 'Falta armado_id' })
  // Va pegado en filtros de PostgREST con service role: solo un UUID
  if (!esUuid(armadoId)) return res.status(400).json({ error: 'armado_id inválido' })
  // Lo dispara quien cierra el armado (piso) o quien ve los pedidos de venta
  if (!(await autorizado(token, ['mayorista.repos_piso', 'pedidos_venta.view']))) {
    return res.status(403).json({ error: 'No autorizado' })
  }

  // Un solo aviso por armado: se reclama antes de mandar (dos llamadas no avisan dos veces)
  const rA = await rest(
    `mayorista_armados?id=eq.${armadoId}&push_faltantes_at=is.null&faltantes=gt.0` +
      `&select=id,pedido_codigo,pedido_numero,cliente,aceptado_legajo,aceptado_nombre,faltantes`,
    { method: 'PATCH', body: JSON.stringify({ push_faltantes_at: new Date().toISOString() }), headers: { Prefer: 'return=representation' } },
  )
  if (!rA.ok) return res.status(502).json({ error: `No se pudo leer el armado (${rA.status})` })
  const armados = (await rA.json()) as Armado[]
  const armado = armados[0]
  if (!armado || !armado.faltantes || armado.faltantes <= 0) {
    return res.status(200).json({ enviados: 0, faltantes: 0 })
  }

  const rF = await rest(
    `mayorista_armados_items?select=articulo,descripcion,color,talle,cantidad,escaneadas` +
      `&armado_id=eq.${armadoId}&estado=eq.faltante&order=linea.asc`,
  )
  if (!rF.ok) return res.status(502).json({ error: `No se pudieron leer los faltantes (${rF.status})` })
  const faltantes = (await rF.json()) as Faltante[]

  const uids = await conPermiso('mayorista.faltantes.ver')
  if (!uids.length) return res.status(200).json({ enviados: 0, faltantes: faltantes.length, receptores: 0 })

  const rS = await rest(`push_suscripciones?select=endpoint,usuario_id,p256dh,auth&usuario_id=in.(${uids.join(',')})`)
  if (!rS.ok) return res.status(502).json({ error: `No se pudieron leer las suscripciones (${rS.status})` })
  const subs = (await rS.json()) as Suscripcion[]
  if (!subs.length) return res.status(200).json({ enviados: 0, faltantes: faltantes.length, suscripciones: 0 })

  const quien = armado.aceptado_nombre
    ? ` por ${armado.aceptado_nombre}${armado.aceptado_legajo ? ` (#${armado.aceptado_legajo})` : ''}`
    : ''
  const payload = JSON.stringify({
    title: `⚠️ Faltantes de stock · Pedido N° ${armado.pedido_numero ?? armado.pedido_codigo}`,
    body: `Faltan ${armado.faltantes} u.${quien}. ${resumir(faltantes)}`,
    url: `/mayorista/pedidos-venta?abrir=${encodeURIComponent(armado.pedido_codigo)}`,
    urgente: true,
  })

  const { enviados, vencidas } = await entregar(payload, subs)
  return res.status(200).json({ enviados, faltantes: faltantes.length, receptores: uids.length, suscripciones: subs.length, vencidas })
}

interface AvisoUbicacion {
  usuario_id: string
  ubicacion: string
  articulos: number
  unidades: number
  salen: number
  entran: number
}

const NOMBRE_UBICACION: Record<string, string> = { 'DEPOSITO INDO': 'Depósito Indo', 'DEPOSITO MAYORISTA': 'Depósito Mayorista' }

/** Reposición/transferencia nueva: a los legajos de la ubicación que tiene renglones (sql/legajos_ubicacion.sql). */
async function avisarTransferencia(req: Req, res: Res, token: string) {
  let loteId = ''
  try {
    loteId = String(JSON.parse(req.body ?? '{}').lote_id ?? '')
  } catch {
    loteId = ''
  }
  if (!loteId) return res.status(400).json({ error: 'Falta lote_id' })
  // Va pegado en filtros de PostgREST con service role: solo un UUID
  if (!esUuid(loteId)) return res.status(400).json({ error: 'lote_id inválido' })
  // Lo dispara quien carga las transferencias
  if (!(await autorizado(token, ['transferencias.import']))) {
    return res.status(403).json({ error: 'No autorizado' })
  }

  // Un solo aviso por lote: se reclama antes de mandar (dos llamadas no avisan dos veces)
  const rL = await rest(`transfer_lotes?id=eq.${loteId}&push_ubicacion_at=is.null&select=id,nombre`, {
    method: 'PATCH',
    body: JSON.stringify({ push_ubicacion_at: new Date().toISOString() }),
    headers: { Prefer: 'return=representation' },
  })
  if (!rL.ok) return res.status(502).json({ error: `No se pudo leer el lote (${rL.status})` })
  const lote = ((await rL.json()) as { id: string; nombre: string }[])[0]
  if (!lote) return res.status(200).json({ enviados: 0, yaAvisado: true })

  const rA = await rest('rpc/transfer_avisos_ubicacion', { method: 'POST', body: JSON.stringify({ p_lote: loteId }) })
  if (!rA.ok) return res.status(502).json({ error: `No se pudo calcular a quién avisar (${rA.status})` })
  const avisos = (await rA.json()) as AvisoUbicacion[]
  if (!avisos.length) return res.status(200).json({ enviados: 0, receptores: 0 })

  const uids = [...new Set(avisos.map((a) => a.usuario_id))]
  const rS = await rest(`push_suscripciones?select=endpoint,usuario_id,p256dh,auth&usuario_id=in.(${uids.join(',')})`)
  if (!rS.ok) return res.status(502).json({ error: `No se pudieron leer las suscripciones (${rS.status})` })
  const subs = (await rS.json()) as Suscripcion[]
  if (!subs.length) return res.status(200).json({ enviados: 0, receptores: uids.length, suscripciones: 0 })

  // Un aviso por ubicación (todos sus legajos reciben el mismo texto)
  let enviados = 0
  let vencidas = 0
  const porUbicacion = new Map<string, AvisoUbicacion[]>()
  for (const a of avisos) porUbicacion.set(a.ubicacion, [...(porUbicacion.get(a.ubicacion) ?? []), a])
  for (const [ubicacion, lista] of porUbicacion) {
    const a0 = lista[0]
    const partes = [
      a0.salen ? `salen ${a0.salen} u.` : '',
      a0.entran ? `entran ${a0.entran} u.` : '',
    ].filter(Boolean).join(' · ')
    const payload = JSON.stringify({
      title: `📦 Reposición para ${NOMBRE_UBICACION[ubicacion] ?? ubicacion}`,
      body: `${lote.nombre} · ${a0.articulos} artículo${a0.articulos === 1 ? '' : 's'}${partes ? ` · ${partes}` : ''}`,
      url: '/mayorista/mi-repo',
      urgente: true,
    })
    const ids = new Set(lista.map((x) => x.usuario_id))
    const r = await entregar(payload, subs.filter((s) => ids.has(s.usuario_id)))
    enviados += r.enviados
    vencidas += r.vencidas
  }
  return res.status(200).json({ enviados, receptores: uids.length, suscripciones: subs.length, vencidas })
}

interface Requerimiento {
  id: number
  local: string | null
  rubro: string
  descripcion: string
  programado_para: string | null
  asignados_nombres: string[] | null
  programado_nota: string | null
}

/** Requerimiento programado: al local que lo pidió, con la tarea, el día y el horario. */
async function avisarRequerimiento(req: Req, res: Res, token: string) {
  let id = ''
  try {
    id = String(JSON.parse(req.body ?? '{}').id ?? '')
  } catch {
    id = ''
  }
  // Va pegado en filtros de PostgREST con service role: solo un número
  if (!/^\d{1,12}$/.test(id)) return res.status(400).json({ error: 'id inválido' })
  // Lo dispara Arquitectura al programar desde la bandeja
  if (!(await autorizado(token, ['requerimientos.gestionar']))) {
    return res.status(403).json({ error: 'No autorizado' })
  }

  // Un aviso por programación: se reclama antes de mandar (requerimiento_programar limpia push_local_at)
  const rR = await rest(
    `requerimientos?id=eq.${id}&push_local_at=is.null&estado=in.(programado,en_curso)` +
      `&select=id,local,rubro,descripcion,programado_para,asignados_nombres,programado_nota`,
    { method: 'PATCH', body: JSON.stringify({ push_local_at: new Date().toISOString() }), headers: { Prefer: 'return=representation' } },
  )
  if (!rR.ok) return res.status(502).json({ error: `No se pudo leer el requerimiento (${rR.status})` })
  const r = ((await rR.json()) as Requerimiento[])[0]
  if (!r || !r.local || !r.programado_para) return res.status(200).json({ enviados: 0, yaAvisado: true })

  // Las cuentas del local (usuarios.local); el código no lleva comillas ni comas
  const local = r.local.replace(/[^A-Za-z0-9_-]/g, '')
  const rU = await rest(`usuarios?select=id&local=eq.${local}`)
  if (!rU.ok) return res.status(502).json({ error: `No se pudieron leer los usuarios del local (${rU.status})` })
  const uids = ((await rU.json()) as { id: string }[]).map((u) => u.id)
  if (!uids.length) return res.status(200).json({ enviados: 0, receptores: 0 })

  const rS = await rest(`push_suscripciones?select=endpoint,usuario_id,p256dh,auth&usuario_id=in.(${uids.join(',')})`)
  if (!rS.ok) return res.status(502).json({ error: `No se pudieron leer las suscripciones (${rS.status})` })
  const subs = (await rS.json()) as Suscripcion[]
  if (!subs.length) return res.status(200).json({ enviados: 0, receptores: uids.length, suscripciones: 0 })

  const cuando = new Date(r.programado_para).toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Cordoba', weekday: 'long', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  })
  const nombres = (r.asignados_nombres ?? []).filter(Boolean)
  const quien = nombres.length ? ` · Va ${nombres.join(' y ')}` : ''
  const tarea = r.descripcion.length > 90 ? `${r.descripcion.slice(0, 87)}…` : r.descripcion
  const payload = JSON.stringify({
    title: `🔧 ${r.rubro}: arreglo programado para el ${cuando}`,
    body: `N° ${r.id} · ${tarea}${quien}${r.programado_nota ? ` · ${r.programado_nota}` : ''}`,
    url: '/arquitectura/requerimientos/nuevo',
    urgente: false,
  })
  const { enviados, vencidas } = await entregar(payload, subs)
  return res.status(200).json({ enviados, receptores: uids.length, suscripciones: subs.length, vencidas })
}

/** Corta la lista de artículos que faltan para el texto del aviso. */
function resumir(faltantes: Faltante[]): string {
  if (faltantes.length === 0) return ''
  const partes = faltantes.slice(0, 3).map((f) => {
    const falta = Math.max((f.cantidad || 0) - Math.min(f.escaneadas || 0, f.cantidad || 0), 0)
    const nombre = [f.articulo, f.color, f.talle].filter(Boolean).join(' · ') || f.descripcion || 'Artículo'
    return `${nombre} (faltan ${falta})`
  })
  const res = partes.join(' — ')
  return faltantes.length > 3 ? `${res} · y ${faltantes.length - 3} más` : res
}

export default async function handler(req: Req, res: Res) {
  res.setHeader('Cache-Control', 'no-store')
  const pub = process.env.VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  if (!pub || !priv) return res.status(500).json({ error: 'Faltan las claves VAPID en Vercel' })

  if (req.method === 'GET') return res.status(200).json({ publicKey: pub })
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })

  const auth = req.headers.authorization ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const uid = token ? await usuarioDe(token) : null
  if (!uid) return res.status(401).json({ error: 'No autorizado' })
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Falta la configuración de Supabase' })
  }

  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'https://hub-mito.vercel.app', pub, priv)

  const tipo = primerQuery(req.query?.tipo)
  if (tipo === 'pausa') return avisarPausa(req, res, uid)
  if (tipo === 'faltantes') return avisarFaltantes(req, res, token)
  if (tipo === 'transferencia') return avisarTransferencia(req, res, token)
  if (tipo === 'requerimiento') return avisarRequerimiento(req, res, token)
  return avisarArmado(req, res, uid)
}
