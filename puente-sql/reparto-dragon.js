/**
 * REPARTO MANUAL → DRAGON: lo que MITO (columna MAYORD) le da a un local en el Reparto manual
 * se carga como PEDIDO DE VENTA en DRAGONFISH_MITO, uno por local, como la Repo diaria
 * (cliente = CLIENTE REPO, lista = la del último pedido VTD del local). El motivo lo elige el
 * usuario (de los motivos que ya usan los pedidos de venta en Dragon). SOLO ALTAS.
 *
 *   accion 'reparto_dragon' body:
 *     { modo:'motivos' }                                   -> { motivos:[{cod, pedidos}] }  (se guarda 1 h)
 *     { modo:'revisar', motivo, obs, pedidos:[{local, items:[{art,color,talle,cantidad}]}] }
 *         -> { carga }  (qué se va a cargar; marca los locales que ya tienen ese pedido)
 *     { modo:'cargar', ...lo mismo, confirmo: obs }      -> { carga }  (corre por detrás)
 *     { modo:'estado' }                                    -> { carga }
 *
 * Cuidados (igual que la Repo diaria):
 *  - No se repite: antes de cargar mira en COMPROBANTEV qué clientes ya tienen un pedido con el
 *    mismo motivo y la misma observación en los últimos 30 días; esos se saltean (sirve para reintentar).
 *  - Una carga a la vez. PUENTE_DRAGON_EN_SECO=1 arma todo sin llamar a Dragon.
 */

// Columna del reparto -> cliente de Dragon (CLIENTE REPO de la Repo diaria)
const CLIENTE = {
  VCPD: 'VCPD', WALMARTD: 'WALTD', DINOD: 'DINOD', RIVERAD: 'RIVED', CFRA: 'CFRA', RUTA9D: 'R9D', CFR9: 'CFR9',
  BUSTOD: 'BUSTD', CFD: 'CFD', CFPO: 'CFPO', GRALPAZ: 'GPAZD', MUNOZ: 'MUNOD', '9DEJULIO': '9DEJU2',
  LIBERD: 'LIBED', ESPINOD: 'ESPID', NVOCED: 'NCEND2', CFR4: 'CFR4',
}
const LISTA_REPO = { CFR4: 'LISTA2', R9D: 'LISTA2', VCPD: 'LISTA2' }
const MOTIVOS_MS = 60 * 60_000
const txt = (v) => (v == null ? '' : String(v).trim())

function crear(deps) {
  let motivos = null // { en, lista }
  let carga = null

  async function leerMotivos() {
    if (motivos && Date.now() - motivos.en < MOTIVOS_MS) return motivos.lista
    const pool = await deps.conexionLarga()
    try {
      const r = await pool.request().query(`
        SELECT RTRIM(MOTIVO) AS cod, COUNT(*) AS pedidos
          FROM DRAGONFISH_MITO.ZooLogic.COMPROBANTEV
         WHERE FACTTIPO = 23 AND FFCH >= DATEADD(day, -365, GETDATE()) AND RTRIM(ISNULL(MOTIVO, '')) <> ''
         GROUP BY RTRIM(MOTIVO)
         ORDER BY COUNT(*) DESC`)
      const lista = r.recordset.map((f) => ({ cod: txt(f.cod).toUpperCase(), pedidos: Number(f.pedidos) || 0 }))
      motivos = { en: Date.now(), lista }
      return lista
    } finally {
      await pool.close().catch(() => {})
    }
  }

  /** Valida y agrupa lo que manda el hub: un pedido por cliente. */
  async function armarPlan(body) {
    const motivo = txt(body?.motivo).toUpperCase()
    if (!(await leerMotivos()).some((m) => m.cod === motivo)) throw new Error(`Motivo «${motivo}» no existe en los pedidos de venta de Dragon`)
    const obs = txt(body?.obs).replace(/\s+/g, ' ').slice(0, 250)
    if (obs.length < 3) throw new Error('Falta la observación del pedido')
    const pedidos = Array.isArray(body?.pedidos) ? body.pedidos : []
    if (!pedidos.length) throw new Error('No hay nada que MITO tenga que mandar')
    if (pedidos.length > 30) throw new Error('Demasiados locales')
    const porCliente = new Map()
    for (const p of pedidos) {
      const local = txt(p?.local).toUpperCase()
      const cliente = CLIENTE[local]
      if (!cliente) throw new Error(`El local ${local || '?'} no recibe pedidos de MITO`)
      const items = (Array.isArray(p?.items) ? p.items : []).map((i) => ({
        art: txt(i?.art).toUpperCase(), color: txt(i?.color).toUpperCase(), talle: txt(i?.talle).toUpperCase(), cantidad: Number(i?.cantidad),
      }))
      if (!items.length || items.length > 3000) throw new Error(`Pedido de ${local} vacío o demasiado grande`)
      for (const i of items) {
        if (!/^[A-Z0-9]{1,20}$/.test(i.art) || !/^[A-Z0-9 ._\-/]{0,10}$/.test(i.color) || !/^[A-Z0-9 ._\-/]{0,10}$/.test(i.talle) || !Number.isInteger(i.cantidad) || i.cantidad < 1 || i.cantidad > 999) {
          throw new Error(`Renglón inválido en ${local}: ${i.art} ${i.color} ${i.talle} × ${i.cantidad}`)
        }
      }
      if (!porCliente.has(cliente)) porCliente.set(cliente, { cliente, local, items: [] })
      porCliente.get(cliente).items.push(...items)
    }
    const locales = [...porCliente.values()].map((l) => ({
      ...l, renglones: l.items.length, unidades: l.items.reduce((a, i) => a + i.cantidad, 0),
    }))
    return { motivo, obs, locales }
  }

  /** Qué clientes ya tienen este pedido (motivo + obs, 30 días) y con qué lista cargar a cada uno. */
  async function marcarExistentes(plan) {
    const pool = await deps.conexionLarga()
    try {
      const V = deps.sql.VarChar(250)
      const r = await pool.request().input('obs', V, plan.obs).input('motivo', V, plan.motivo).query(`
        SELECT RTRIM(FPERSON) AS cliente, MAX(FNUMCOMP) AS numero
          FROM DRAGONFISH_MITO.ZooLogic.COMPROBANTEV
         WHERE FACTTIPO = 23 AND RTRIM(MOTIVO) = @motivo AND FFCH >= DATEADD(day, -30, GETDATE())
           AND RTRIM(CAST(FOBS AS varchar(250))) = @obs
         GROUP BY RTRIM(FPERSON);
        SELECT cliente, lista FROM (
          SELECT RTRIM(FPERSON) AS cliente, RTRIM(CODLISTA) AS lista,
                 ROW_NUMBER() OVER (PARTITION BY RTRIM(FPERSON) ORDER BY FFCH DESC, FNUMCOMP DESC) AS n
            FROM DRAGONFISH_MITO.ZooLogic.COMPROBANTEV
           WHERE FACTTIPO = 23 AND RTRIM(MOTIVO) = 'VTD' AND FFCH >= DATEADD(day, -60, GETDATE())) x
         WHERE n = 1;`)
      const existentes = new Map(r.recordsets[0].map((f) => [txt(f.cliente).toUpperCase(), f.numero]))
      const listas = new Map(r.recordsets[1].map((f) => [txt(f.cliente).toUpperCase(), txt(f.lista)]))
      for (const l of plan.locales) {
        l.lista = listas.get(l.cliente) || LISTA_REPO[l.cliente] || 'LISTA1'
        l.numero = existentes.get(l.cliente) ?? null
        l.estado = l.numero ? 'ya_estaba' : 'pendiente'
        l.error = null
      }
      return plan
    } finally {
      await pool.close().catch(() => {})
    }
  }

  const vista = (c) =>
    c && {
      motivo: c.motivo,
      obs: c.obs,
      en_curso: !!c.enCurso,
      en_seco: !!c.enSeco,
      inicio: c.inicio ? new Date(c.inicio).toISOString() : null,
      fin: c.fin ? new Date(c.fin).toISOString() : null,
      locales: c.locales.map(({ items, ...l }) => l),
    }

  function ejecutar(plan) {
    const c = { ...plan, enCurso: true, enSeco: deps.enSeco(), inicio: Date.now(), fin: null }
    carga = c
    ;(async () => {
      for (const l of c.locales) {
        if (l.estado !== 'pendiente') continue
        l.estado = 'cargando'
        try {
          const r = await deps.dragon.crearPedido({ cliente: l.cliente, lista: l.lista, motivo: c.motivo, obs: c.obs, items: l.items, soloArmar: c.enSeco })
          if (r.ok) {
            l.estado = c.enSeco ? 'en_seco' : 'cargado'
            l.numero = r.numero ?? r.codigo ?? null
          } else {
            l.estado = 'error'
            l.error = r.detalle
          }
        } catch (e) {
          l.estado = 'error'
          l.error = e.message
        }
        console.log(`[puente] reparto → Dragon ${l.cliente} (${c.motivo}): ${l.estado}${l.numero ? ` N° ${l.numero}` : ''}${l.error ? ` ${l.error}` : ''}`)
      }
    })().finally(() => {
      c.enCurso = false
      c.fin = Date.now()
    })
  }

  async function accion(body) {
    const modo = txt(body?.modo)
    if (modo === 'motivos') return { motivos: await leerMotivos() }
    if (modo === 'estado') return { carga: vista(carga) }
    if (modo !== 'revisar' && modo !== 'cargar') throw new Error('Modo inválido')
    if (modo === 'cargar' && carga?.enCurso) throw new Error('Ya hay una carga del reparto a Dragon en curso: esperá a que termine.')
    const plan = await marcarExistentes(await armarPlan(body))
    if (modo === 'revisar') return { carga: vista({ ...plan, enSeco: deps.enSeco() }) }
    // el hub repite la observación que mostró al confirmar
    if (txt(body?.confirmo) !== plan.obs) throw new Error('La confirmación no coincide: revisalo de nuevo.')
    ejecutar(plan)
    return { carga: vista(carga) }
  }

  return { accion }
}

module.exports = { crear, CLIENTE }
