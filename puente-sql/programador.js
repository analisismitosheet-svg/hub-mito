'use strict'
/**
 * Repo diaria y cascada PROGRAMADAS (Compras > Repo diaria > Automático del hub).
 *
 * Cada minuto le pregunta a Supabase (repo_auto_pendiente, con la clave del puente) si toca
 * correr algo: día de la semana y hora configurados, o «Correr ahora». Cuando toca:
 *
 *   REPO    1. Foto nueva del DWH (la misma de la pantalla, ~80 s).
 *           2. Días a cubrir: los días con venta DESPUÉS del último que ya tiene pedidos
 *              «REPO DIARIA (…)» en Dragon (así un lunes cubre sábado y domingo, y nunca
 *              repite días cargados a mano). Si en 2 semanas no hay ninguno: el último día.
 *           3. Carga un pedido VTD por local en Dragon (mismo código que el botón; saltea
 *              los locales que ya lo tienen).
 *           4. Si está prendido «Pedir armado»: trae los pedidos nuevos al hub
 *              (sync-pedidos-venta.js), pide el armado de esos pedidos y avisa por push.
 *   CASCADA 1. Misma foto (o una nueva si no corrió la repo).
 *           2. Días: los de la última repo cargada en Dragon (la cascada cubre lo que esa
 *              repo no pudo); si no hay, el último día con venta.
 *           3. Calcula con los parámetros guardados y crea el lote en Transferencias
 *              («AAMMDD - CASCADA dd-mm»). Si ya existe, no lo repite. Avisa por push.
 *
 * El resultado queda en repo_auto_config (repo_log / cascada_log) y en data/programador.log.
 * Si falla, Supabase lo vuelve a ofrecer a los 15 minutos (hasta 3 veces en el día).
 * PUENTE_PROGRAMADOR=0 en .env (o en el entorno) lo apaga: así se prueba un puente de copia.
 */
const fs = require('fs')
const path = require('path')

const LOG = path.join(__dirname, 'data', 'programador.log')
const CADA_MS = 60_000

function leerEnv(archivo) {
  const out = {}
  try {
    for (const linea of fs.readFileSync(archivo, 'utf8').split(/\r?\n/)) {
      const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch {
    /* opcional */
  }
  return out
}
const envHub = leerEnv(path.join(__dirname, '..', '.env'))
const cfg = (k) => process.env[k]
const SUPABASE_URL = () => cfg('SUPABASE_URL') ?? envHub.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = () => cfg('SUPABASE_ANON_KEY') ?? envHub.VITE_SUPABASE_ANON_KEY
const HUB_URL = () => (cfg('HUB_URL') || 'https://hub-mito.vercel.app').replace(/\/$/, '')

function anotar(texto) {
  const linea = `${new Date().toLocaleString('sv-SE')}  ${texto}`
  console.log(`[puente] programador: ${texto}`)
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true })
    fs.appendFileSync(LOG, linea + '\n')
  } catch {
    /* sin log en disco */
  }
}

async function rpc(nombre, params) {
  const r = await fetch(`${SUPABASE_URL()}/rest/v1/rpc/${nombre}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY(), Authorization: `Bearer ${SUPABASE_ANON_KEY()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(60_000),
  })
  const cuerpo = await r.json().catch(() => null)
  if (!r.ok) throw new Error(`${nombre}: HTTP ${r.status} ${cuerpo?.message ?? ''}`.trim())
  return cuerpo
}

/** Aviso push del hub (armados nuevos / lote de transferencias). Si falla, queda la campana. */
async function avisarHub(tipo, cuerpo) {
  try {
    const r = await fetch(`${HUB_URL()}/api/push?tipo=${tipo}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Puente-Token': cfg('PUENTE_TOKEN') ?? '' },
      body: JSON.stringify(cuerpo ?? {}),
      signal: AbortSignal.timeout(60_000),
    })
    if (!r.ok) anotar(`aviso ${tipo}: HTTP ${r.status}`)
  } catch (e) {
    anotar(`aviso ${tipo}: ${e.message}`)
  }
}

// ---- Días ----
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/**
 * "REPO DIARIA (12/11/2026)" -> ['2026-11-12']
 * "REPO DIARIA (07/11 al 09/11/2026)" -> ['2026-11-07', '2026-11-08', '2026-11-09']
 */
function diasDeObs(obs) {
  const m = String(obs).match(/\((?:(\d{2})\/(\d{2}) al )?(\d{2})\/(\d{2})\/(\d{4})\)/)
  if (!m) return []
  const [, d1, m1, d2, m2, a] = m
  const hasta = new Date(Number(a), Number(m2) - 1, Number(d2))
  if (!d1) return [iso(hasta)]
  const desde = new Date(Number(m1) > Number(m2) ? Number(a) - 1 : Number(a), Number(m1) - 1, Number(d1))
  const out = []
  for (let d = new Date(desde); d <= hasta && out.length < 31; d.setDate(d.getDate() + 1)) out.push(iso(d))
  return out
}

/** Los días que ya tienen repo en Dragon y la última repo cargada (sus días). */
async function repoEnDragon(ctx) {
  const obs = await ctx.obsRepoEnDragon()
  const cubiertos = new Set()
  let ultima = []
  for (const o of obs) {
    const dias = diasDeObs(o)
    dias.forEach((d) => cubiertos.add(d))
    if (dias.length && (!ultima.length || dias[dias.length - 1] > ultima[ultima.length - 1])) ultima = dias
  }
  return { cubiertos, ultima }
}

/**
 * Días de venta que ya tienen lote de cascada, por el nombre del lote:
 * "261114 - CASCADA 12-11" -> ['2026-11-12'] · "261110 - CASCADA 07 AL 09-11" -> 07, 08 y 09/11.
 */
function diasDeLote(nombre) {
  const m = String(nombre).match(/^(\d{2})(\d{2})\d{2} - CASCADA (\d{2})(?: AL (\d{2}))?-(\d{2})\s*$/)
  if (!m) return []
  const [, aa, mmLote, d1, d2, mm] = m
  // La venta es anterior al lote: si el lote es de enero y la venta de diciembre, es del año anterior
  const anio = 2000 + Number(aa) - (Number(mm) > Number(mmLote) ? 1 : 0)
  const desde = new Date(anio, Number(mm) - 1, Number(d1))
  const hasta = new Date(anio, Number(mm) - 1, Number(d2 ?? d1))
  // "28 AL 02-12": el primer día es del mes anterior
  if (desde > hasta) desde.setMonth(desde.getMonth() - 1)
  const out = []
  for (let d = new Date(desde); d <= hasta && out.length < 31; d.setDate(d.getDate() + 1)) out.push(iso(d))
  return out
}

const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
/** «261113 - CASCADA 12-11» / «261110 - CASCADA 07 AL 09-11» (mismo estilo que los lotes que se suben) */
function nombreLote(hoy, dias) {
  const u = dias[dias.length - 1]
  const dd = (x) => x.slice(8, 10)
  const tramo = dias.length > 1 ? `${dd(dias[0])} AL ${dd(u)}-${u.slice(5, 7)}` : `${dd(u)}-${u.slice(5, 7)}`
  return `${hoy.slice(2, 4)}${hoy.slice(5, 7)}${hoy.slice(8, 10)} - CASCADA ${tramo}`
}

// ---- Feriados de hoy (RR. HH. → Feriados): la cascada saca esos locales ----
let feriados = { en: 0, lista: [], enCurso: null }
/** Pide a Supabase los locales con feriado hoy ('*' = todos). Se guarda 5 minutos. */
function refrescarFeriados() {
  const token = cfg('PUENTE_TOKEN')
  if (feriados.enCurso || !token || !SUPABASE_URL()) return feriados.enCurso
  feriados.enCurso = rpc('feriados_hoy_puente', { p_token: token })
    .then((r) => { feriados = { en: Date.now(), lista: Array.isArray(r) ? r.map(String) : [], enCurso: null } })
    .catch((e) => {
      anotar(`feriados de hoy: ${e.message}`)
      feriados = { ...feriados, en: Date.now(), enCurso: null }
    })
  return feriados.enCurso
}
/** Lo último que se sabe (y lo vuelve a pedir si tiene más de 5 minutos). */
function feriadosHoy() {
  if (Date.now() - feriados.en > 5 * 60_000) refrescarFeriados()
  return feriados.lista
}
async function feriadosHoyFrescos() {
  if (Date.now() - feriados.en > 5 * 60_000) await refrescarFeriados()
  return feriados.lista
}

// ---- Tareas ----
async function correrRepo(ctx, pend, token) {
  if (ctx.cargaEnCurso()) throw new Error('Hay una carga a Dragon en curso desde el hub: se reintenta más tarde.')
  const hoy = ctx.hoy()
  const { cubiertos } = await repoEnDragon(ctx)
  const foto = ctx.foto()
  const disponibles = foto.dias.filter((d) => d.unidades > 0 && d.dia < hoy).map((d) => d.dia).sort()
  if (!disponibles.length) throw new Error('No hay días con venta en la foto del DWH')
  const maxCubierto = [...cubiertos].sort().pop() ?? ''
  let dias = maxCubierto ? disponibles.filter((d) => d > maxCubierto).slice(-7) : [disponibles[disponibles.length - 1]]
  const hasta = disponibles[disponibles.length - 1]
  if (!dias.length) return { ok: true, hasta, dias, texto: `Nada nuevo: la venta hasta el ${hasta.slice(8, 10)}/${hasta.slice(5, 7)} ya tiene su repo en Dragon.` }

  const plan = ctx.armarPlanDragon({ fechas: dias })
  if (!plan.locales.length) return { ok: true, hasta, dias, texto: `Venta ${plan.fecha_str}: sin nada para reponer desde MITO.` }
  await ctx.marcarExistentes(plan)
  const carga = await ctx.cargarDragon(plan)
  const cargados = carga.locales.filter((l) => l.estado === 'cargado' || l.estado === 'en_seco')
  const ya = carga.locales.filter((l) => l.estado === 'ya_estaba')
  const errores = carga.locales.filter((l) => l.estado === 'error')
  const unidades = cargados.reduce((s, l) => s + l.unidades, 0)
  const nums = cargados.map((l) => l.numero).filter(Boolean)
  let texto = `${plan.obs}: ${cargados.length} pedidos cargados (${unidades} u.)` +
    (nums.length ? ` N° ${Math.min(...nums)}–${Math.max(...nums)}` : '') +
    (carga.enSeco ? ' [EN SECO: no se llamó a Dragon]' : '') +
    (ya.length ? ` · ${ya.length} ya estaban` : '') +
    (errores.length ? ` · ${errores.length} con error: ${errores.map((l) => `${l.cliente} (${l.error})`).join('; ')}` : '')

  // Pedir armado de los pedidos de esta repo (los nuevos y los que ya estaban sin armado)
  if (pend.repo.armado && !carga.enSeco && cargados.length + ya.length > 0) {
    try {
      let arm = null
      for (let intento = 1; intento <= 3; intento++) {
        const s = await ctx.correrSync('sync-pedidos-venta.js')
        if (!s.ok) anotar(`sync pedidos de venta: ${s.error}`)
        arm = await rpc('repo_auto_pedir_armado', { p_token: token, p_obs: plan.obs, p_prioridad: pend.repo.prioridad || 'normal' })
        if (arm.encontrados >= cargados.length + ya.length) break
        await new Promise((r) => setTimeout(r, 30_000)) // Dragon todavía no los mostró: otra vuelta
      }
      texto += ` · armado pedido en ${arm.pedidos_armado}` + (arm.encontrados < cargados.length + ya.length ? ` (faltan ${cargados.length + ya.length - arm.encontrados} pedidos en el hub)` : '')
      if (arm.pedidos_armado > 0) await avisarHub('armado')
    } catch (e) {
      texto += ` · NO se pudo pedir el armado: ${e.message}`
    }
  }
  return { ok: errores.length === 0, hasta, dias, texto }
}

async function correrCascada(ctx, pend, token, diasRepo) {
  const hoy = ctx.hoy()
  let dias = diasRepo
  if (!dias?.length) dias = (await repoEnDragon(ctx)).ultima
  const foto = ctx.foto()
  const conVenta = new Set(foto.dias.filter((d) => d.unidades > 0 && d.dia < hoy).map((d) => d.dia))
  dias = (dias ?? []).filter((d) => conVenta.has(d))
  if (!dias.length) dias = [...conVenta].sort().slice(-1) // sin repo en Dragon: el último día con venta
  // Nunca repetir días de venta que ya tuvieron cascada (el sábado no hay repo y volvía a tomar
  // los días de la última: el 13 y el 14/11 salieron dos lotes «CASCADA 12-11»)
  const lotes = await rpc('cascada_lotes_recientes_puente', { p_token: token })
  const yaCubiertos = new Set((Array.isArray(lotes) ? lotes : []).flatMap(diasDeLote))
  const repetidos = dias.filter((d) => yaCubiertos.has(d))
  dias = dias.filter((d) => !yaCubiertos.has(d))
  if (!dias.length) {
    const u = repetidos[repetidos.length - 1]
    return { ok: true, hasta: u ?? null, texto: `Nada nuevo: la venta ${repetidos.map((d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`).join(', ')} ya tiene su cascada en Transferencias.` }
  }
  const repo = ctx.calcularRepo(foto, { fechas: dias, hoy })
  const c = ctx.calcularCascada(foto, repo, pend.params, { feriados: await feriadosHoyFrescos() })
  const hasta = repo.dias[repo.dias.length - 1]
  if (!c.filas.length) return { ok: true, hasta, texto: `Venta ${repo.fecha_str}: la cascada no dio ningún envío.` }
  const nombre = nombreLote(hoy, repo.dias)
  const items = c.filas.map((f) => ({
    origen: f.donante, destino: f.receptor, articulo: f.articulo, descripcion: f.descripcion,
    material: f.material, color: f.color, talle: f.talle, cantidad: f.cantidad,
  }))
  const r = await rpc('cascada_cargar_transferencias_puente', { p_token: token, p_nombre: nombre, p_items: items })
  if (!r.repetido) await avisarHub('transferencia', { lote_id: r.id })
  return {
    ok: true,
    hasta,
    texto: r.repetido
      ? `«${nombre}» ya estaba en Transferencias (${r.renglones} renglones, ${r.unidades} u.): no se repitió.`
      : `«${nombre}» cargado en Transferencias: ${r.renglones} renglones, ${r.unidades} u. (venta ${repo.fecha_str}, faltaba ${c.faltante_despues_mito} u. después de MITO).`,
  }
}

// ---- Bucle ----
let ctx = null
let corriendo = false
const estado = { activo: false, ultimo_tick: null, ultimo_error: null, corriendo: false }

async function tick() {
  if (corriendo) return
  const token = cfg('PUENTE_TOKEN')
  if (!token || !SUPABASE_URL() || !SUPABASE_ANON_KEY()) return
  estado.ultimo_tick = new Date().toISOString()
  let pend
  try {
    pend = await rpc('repo_auto_pendiente', { p_token: token })
    estado.ultimo_error = null
  } catch (e) {
    // Sin la función en Supabase (migración sin aplicar) o sin internet: no hay nada que hacer
    if (estado.ultimo_error !== e.message) anotar(`no se pudo consultar: ${e.message}`)
    estado.ultimo_error = e.message
    return
  }
  if (!pend?.repo?.toca && !pend?.cascada?.toca) return

  corriendo = estado.corriendo = true
  try {
    try {
      anotar(`toca ${[pend.repo.toca && 'repo', pend.cascada.toca && 'cascada'].filter(Boolean).join(' + ')}: foto nueva del DWH…`)
      await ctx.fotoNueva()
    } catch (e) {
      const texto = `No se pudo leer el DWH: ${e.message}`
      anotar(texto)
      if (pend.repo.toca) await rpc('repo_auto_registrar', { p_token: token, p_tarea: 'repo', p_ok: false, p_texto: texto }).catch(() => {})
      if (pend.cascada.toca) await rpc('repo_auto_registrar', { p_token: token, p_tarea: 'cascada', p_ok: false, p_texto: texto }).catch(() => {})
      return
    }
    let diasRepo = null
    for (const tarea of ['repo', 'cascada']) {
      if (!pend[tarea].toca) continue
      let r
      try {
        r = tarea === 'repo' ? await correrRepo(ctx, pend, token) : await correrCascada(ctx, pend, token, diasRepo)
        if (tarea === 'repo' && r.ok && r.dias?.length) diasRepo = r.dias
      } catch (e) {
        r = { ok: false, texto: e.message }
      }
      anotar(`${tarea}: ${r.ok ? 'OK' : 'ERROR'} ${r.texto}`)
      await rpc('repo_auto_registrar', { p_token: token, p_tarea: tarea, p_ok: r.ok, p_texto: r.texto, p_hasta: r.hasta ?? null })
        .catch((e) => anotar(`no se pudo registrar ${tarea}: ${e.message}`))
    }
  } finally {
    corriendo = estado.corriendo = false
  }
}

function iniciar(contexto) {
  if (/^(0|false|no)$/i.test(String(cfg('PUENTE_PROGRAMADOR') ?? ''))) {
    console.log('[puente] programador apagado (PUENTE_PROGRAMADOR=0)')
    return
  }
  ctx = contexto
  estado.activo = true
  // Primera vuelta al minuto de arrancar (que se conecte todo primero)
  setTimeout(() => {
    tick().catch((e) => anotar(`ERROR ${e.message}`))
    setInterval(() => tick().catch((e) => anotar(`ERROR ${e.message}`)), CADA_MS).unref?.()
  }, CADA_MS).unref?.()
}

module.exports = { iniciar, estado: () => ({ ...estado }), diasDeObs, diasDeLote, nombreLote, feriadosHoy, feriadosHoyFrescos }
