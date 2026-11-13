'use strict'
/**
 * CASCADA entre locales — lo que la repo diaria NO pudo cubrir con el stock de MITO.
 *
 * Es la cuenta de `D:\analisis de datos indo\transfer\cascada_05nov_conCalzado.py`
 * (modo por defecto: solo VENTA, sin INDOD), con una diferencia pedida el 13/11/2026:
 * lo que necesita cada local ya no es toda su venta sino
 *     faltante = venta del local − lo que le manda MITO en la repo diaria.
 *
 * Todas las reglas son PARÁMETROS (PARAMS_DEFAULT = las del script). Se editan en el hub
 * (Compras > Repo diaria > Cascada > Parámetros), se guardan en Supabase
 * (repo_auto_config.cascada_params) y cada regla se puede apagar o cambiar de valores:
 *   - prioridad: los locales que participan y su orden (desempata donantes y ordena la salida)
 *   - no_donan / no_reciben
 *   - restar_mito: faltante = venta − MITO (apagado: toda la venta)
 *   - respetar_transito: no recibe un SKU que ya le está llegando
 *   - receptor_max: no recibe si ya tiene ≥ N del SKU
 *   - donante_queda: unidades que se queda el donante (pase normal)
 *   - tope_sku: máximo que dona un local por SKU
 *   - min_envio: cada par donante → receptor suma al menos N unidades
 *   - restriccion: ciertos receptores solo reciben ciertos proveedores (CF ⇐ MOCF/MOZH/MOFR)
 *   - pase_extra: locales que, si no recibieron nada, aceptan donantes con 1 sola unidad (NVOCED)
 *   - materiales (incluir), excluir_temporadas / grupos / articulos / proveedores / lineas
 *   - orden_receptores: 'alfabetico' (como el script) o 'prioridad'
 *   - orden_donantes: 'stock' (más stock del artículo primero, como el script) o 'prioridad'
 *   - prioridad_venta (opcional): compara la venta de cada local de la misma categoría del
 *     artículo (cualquier combinación de DIMENSIONES: proveedor, material, grupo, familia, línea,
 *     temporada, categoría, clasificación, tipo, marca, año, artículo, color, talle — los
 *     atributos del artículo en el DWH y en Dragon) en los últimos N días con venta y ordena
 *     por eso: recibe primero el que más vende la categoría y/o dona primero el que menos
 *     vende. La prioridad fija queda de desempate.
 * Diferencias con el script: lo que un local recibe NO lo puede volver a donar (todavía no
 * lo tiene), y los filtros de artículo se aplican antes de repartir (mismo resultado, pero
 * el "faltante" del resumen cuenta solo lo que entra en la cascada).
 *
 * Funciones puras y sin dependencias: corre en el Puente (server.js / programador.js) y
 * también en el navegador (el HTML de muestra la incluye tal cual).
 */
;(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica(require('./repo-diaria').baseDeTienda)
  else raiz.CascadaLocales = fabrica((t) => String(t ?? '').trim())
})(typeof self !== 'undefined' ? self : this, function (baseDeTienda) {
  const PARAMS_DEFAULT = Object.freeze({
    prioridad: [
      'CFD', 'CFPO', 'CFRA', 'CFR4', 'CFR9', 'NVOCED', 'ESPINOD', 'LIBERD',
      '9DEJULIO', 'BUSTOD', 'MUNOZ', 'RIVERAD', 'RUTA9D2', 'DINOD', 'WALMARTD', 'VCPD', 'GRALPAZ',
    ],
    no_donan: ['GRALPAZ'],
    no_reciben: [],
    restar_mito: true,
    respetar_transito: true,
    receptor_max: { activo: true, valor: 2 },
    donante_queda: 1,
    tope_sku: { activo: true, valor: 2 },
    min_envio: { activo: true, valor: 2 },
    restriccion: { activo: true, receptores: ['CFR4', 'CFR9', 'CFD', 'CFPO', 'CFRA'], proveedores: ['MOCF', 'MOZH', 'MOFR'] },
    pase_extra: { activo: true, locales: ['NVOCED'] },
    materiales: { activo: true, lista: ['ACCESORIOS', 'PANTALONES', 'BERMUDAS', 'BOARDSHORTS-BIKINIS', 'REMERAS', 'CAMISAS', 'CALZADO'] },
    excluir_temporadas: { activo: true, lista: ['Invierno'] },
    excluir_grupos: { activo: true, lista: ['U02', 'U03'] },
    excluir_articulos: { activo: true, lista: ['BCF'] },
    excluir_proveedores: { activo: false, lista: [] },
    excluir_lineas: { activo: false, lista: [] },
    orden_receptores: 'alfabetico',
    orden_donantes: 'stock',
    prioridad_venta: { activo: false, por: ['material', 'grupo'], dias: 7, aplica: 'receptores' },
  })
  const TEMPORADA = { 1: 'Verano', 2: 'Continuo', 3: 'Invierno' }

  // Atributos para comparar la venta (prioridad_venta.por). a = artículo, v = { color, talle }
  const conNombre = (cod, des) => (cod && des && des !== cod ? `${cod} ${des}` : cod || des || '')
  const DIMENSIONES = {
    proveedor: { nombre: 'Proveedor', valor: (a) => conNombre(a.ID_PROV, a.PROVEEDOR) },
    material: { nombre: 'Material', valor: (a) => a.MATERIAL },
    grupo: { nombre: 'Grupo', valor: (a) => conNombre(a.ID_GRUPO, a.GRUPO) },
    familia: { nombre: 'Familia', valor: (a) => conNombre(a.ID_FLIA, a.FAMILIA) },
    linea: { nombre: 'Línea', valor: (a) => conNombre(a.ID_LINEA, a.LINEA) },
    temporada: { nombre: 'Temporada', valor: (a) => TEMPORADA[Number(a.ID_TEMPORADA)] ?? a.ID_TEMPORADA },
    categoria: { nombre: 'Categoría', valor: (a) => a.CATEGORIA },
    clasificacion: { nombre: 'Clasificación', valor: (a) => a.CLASIFICACION },
    tipo: { nombre: 'Tipo', valor: (a) => a.TIPO },
    marca: { nombre: 'Marca', valor: (a) => a.MARCA },
    anio: { nombre: 'Año', valor: (a) => a.ANIO },
    articulo: { nombre: 'Artículo', valor: (a) => a.ID_ART },
    color: { nombre: 'Color', valor: (_a, v) => v.color },
    talle: { nombre: 'Talle', valor: (_a, v) => v.talle },
  }
  const porDeTexto = (por) =>
    ({ material: ['material'], grupo: ['grupo'], material_grupo: ['material', 'grupo'] })[por] ?? null

  // Descripciones corregidas a mano (las de DESC_MANUAL del script)
  const DESC_MANUAL = {
    CF165114: 'REMERA CAPTAIN FIN HARRY', CF165708: 'REMERA CAPTAIN FIN DECK CHAIR',
    CF165804: 'REMERA CAPTAIN FIN SPLASH', CF165808: 'REMERA CAPTAIN FIN FLY',
    CF165908: 'REMERA CAPTAIN FIN WILD NATURE', CF165909: 'REMERA CAPTAIN FIN GELLER',
    CF265826: 'REMERA CAPTAIN FIN LEVI', CF265902: 'REMERA CAPTAIN FIN HUGO',
    CF265903: 'REMERA CAPTAIN FIN JIM', CF265123: 'REMERA CAPTAIN FIN LOOP GOOD',
    CF265712: 'REMERA CAPTAIN FIN CARVE OVERSIZE FIT', CF265819: 'REMERA CAPTAIN FIN STORK RELAXED FIT',
    LE241411: 'PULLS LACOSTE AH932423', LE241412: 'TRICOT LACOSTE AJ455823',
    LE251400: 'CHEMISE LACOSTE PH36002370V', LE265101: 'POLO PIQUE LISA LOOSE FIT MC LACOSTE',
    LE265103: 'POLO C/ESTAMPA DEL HOLIDAYS LACOSTE', LE265104: 'POLO PIQUE FULL PRINT LACOSTE',
    LE265105: 'POLO FANCY MANGA CORTA LACOSTE', FY165105: 'PANTALON JEAN KENNEDY BLACK DENIM',
  }

  /** clean_macro del script sobre la "Descripción adicional macro". */
  function descripcion(a) {
    if (!a) return ''
    if (DESC_MANUAL[a.ID_ART]) return DESC_MANUAL[a.ID_ART]
    let s = `(${a.ID_FLIA})${a.ARTICULO_ADICIONAL} - ${a.ID_LINEA}(${a.ID_GRUPO})`.trim()
    s = s.replace(/^(\([^)]*\)\s*)+/, '').trim()
    s = s.replace(/^\[[^\]]*\]\d+\s*/, '').trim()
    s = s.replace(/^\d+\s+/, '').trim()
    s = s.replace(/\s*-\s*\w*\([^)]+\)\s*$/, '').trim()
    return s || a.ARTICULO || ''
  }

  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

  // ---- Parámetros: lo guardado se mezcla con los de siempre y se valida ----
  const lista = (v, def, mayus = true) => {
    if (!Array.isArray(v)) return [...def]
    const out = []
    for (const x of v) {
      const s = String(x ?? '').trim()
      const t = mayus ? s.toUpperCase() : s
      if (t && t.length <= 40 && !out.includes(t)) out.push(t)
    }
    return out
  }
  const entero = (v, def, min = 0, max = 99) => {
    const n = Math.floor(Number(v))
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def
  }
  const bool = (v, def) => (typeof v === 'boolean' ? v : def)
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})

  function normalizarParams(p) {
    const d = PARAMS_DEFAULT
    p = obj(p)
    const reglaN = (k, min) => ({ activo: bool(obj(p[k]).activo, d[k].activo), valor: entero(obj(p[k]).valor, d[k].valor, min) })
    const reglaL = (k, mayus = true) => ({ activo: bool(obj(p[k]).activo, d[k].activo), lista: lista(obj(p[k]).lista, d[k].lista, mayus) })
    const r = obj(p.restriccion)
    const pe = obj(p.pase_extra)
    // Temporadas: se guardan con su nombre (Verano / Continuo / Invierno)
    const temp = reglaL('excluir_temporadas', false)
    temp.lista = temp.lista.map((t) => TEMPORADA[t] ?? t[0].toUpperCase() + t.slice(1).toLowerCase())
    const prioridad = lista(p.prioridad, d.prioridad)
    return {
      prioridad: prioridad.length ? prioridad : [...d.prioridad],
      no_donan: lista(p.no_donan, d.no_donan),
      no_reciben: lista(p.no_reciben, d.no_reciben),
      restar_mito: bool(p.restar_mito, d.restar_mito),
      respetar_transito: bool(p.respetar_transito, d.respetar_transito),
      receptor_max: reglaN('receptor_max', 1),
      donante_queda: entero(p.donante_queda, d.donante_queda, 0),
      tope_sku: reglaN('tope_sku', 1),
      min_envio: reglaN('min_envio', 1),
      restriccion: {
        activo: bool(r.activo, d.restriccion.activo),
        receptores: lista(r.receptores, d.restriccion.receptores),
        proveedores: lista(r.proveedores, d.restriccion.proveedores),
      },
      pase_extra: { activo: bool(pe.activo, d.pase_extra.activo), locales: lista(pe.locales, d.pase_extra.locales) },
      materiales: reglaL('materiales'),
      excluir_temporadas: temp,
      excluir_grupos: reglaL('excluir_grupos'),
      excluir_articulos: reglaL('excluir_articulos'),
      excluir_proveedores: reglaL('excluir_proveedores'),
      excluir_lineas: reglaL('excluir_lineas'),
      orden_receptores: p.orden_receptores === 'prioridad' ? 'prioridad' : 'alfabetico',
      orden_donantes: p.orden_donantes === 'prioridad' ? 'prioridad' : 'stock',
      prioridad_venta: (() => {
        const pv = obj(p.prioridad_venta)
        const dv = d.prioridad_venta
        return {
          activo: bool(pv.activo, dv.activo),
          // lista de dimensiones (antes era 'material' | 'grupo' | 'material_grupo')
          por: (() => {
            const l = (typeof pv.por === 'string' ? porDeTexto(pv.por) : Array.isArray(pv.por) ? pv.por : null) ?? dv.por
            const ok = [...new Set(l.map(String).filter((x) => DIMENSIONES[x]))]
            return ok.length ? ok : [...dv.por]
          })(),
          dias: entero(pv.dias, dv.dias, 1, 60),
          aplica: ['receptores', 'donantes', 'ambos'].includes(pv.aplica) ? pv.aplica : dv.aplica,
        }
      })(),
    }
  }

  /**
   * @param foto   prepararFoto(...) (ventas, arts: Map, stockLocales, transito)
   * @param repo   calcularRepo(...) de los mismos días ({ dias, filas: [{base, sku, a_reponer}] })
   * @param params parámetros (se completan con PARAMS_DEFAULT)
   */
  function calcularCascada(foto, repo, params) {
    const P = normalizarParams(params)
    const PRIORIDAD = P.prioridad
    const PRIO = new Map(PRIORIDAD.map((b, i) => [b, i + 1]))
    const noDonan = new Set(P.no_donan)
    const noReciben = new Set(P.no_reciben)
    const INF = Number.MAX_SAFE_INTEGER
    const TOPE = P.tope_sku.activo ? P.tope_sku.valor : INF
    const restrRec = new Set(P.restriccion.activo ? P.restriccion.receptores : [])
    const restrProv = new Set(P.restriccion.proveedores)
    const paseExtra = new Set(P.pase_extra.activo ? P.pase_extra.locales : [])
    const dias = new Set(repo.dias)
    const sku = (a, c, t) => `${a} ${c} ${t}`

    // ¿El artículo entra en la cascada? (material, temporada, grupo, artículo, proveedor, línea)
    const elegibleCache = new Map()
    const empieza = (v, pref) => pref.some((g) => v.startsWith(g))
    function elegible(art) {
      if (elegibleCache.has(art)) return elegibleCache.get(art)
      const a = foto.arts.get(art)
      let ok = !!a
      if (ok && P.materiales.activo && !P.materiales.lista.includes(String(a.MATERIAL).toUpperCase())) ok = false
      if (ok && P.excluir_temporadas.activo && P.excluir_temporadas.lista.includes(TEMPORADA[Number(a.ID_TEMPORADA)] ?? '')) ok = false
      if (ok && P.excluir_grupos.activo && empieza(String(a.ID_GRUPO || '').toUpperCase(), P.excluir_grupos.lista)) ok = false
      if (ok && P.excluir_articulos.activo && P.excluir_articulos.lista.includes(art.toUpperCase())) ok = false
      if (ok && P.excluir_proveedores.activo && P.excluir_proveedores.lista.includes(String(a.ID_PROV).toUpperCase())) ok = false
      if (ok && P.excluir_lineas.activo && P.excluir_lineas.lista.includes(String(a.ID_LINEA).toUpperCase())) ok = false
      elegibleCache.set(art, ok)
      return ok
    }

    // Lo que MITO ya manda: por base del local y SKU
    const mito = new Map()
    for (const f of repo.filas) mito.set(`${f.base}|${f.sku}`, (mito.get(`${f.base}|${f.sku}`) ?? 0) + f.a_reponer)

    // Stock vivo de cada local por SKU y por artículo
    const stock = new Map()
    const stockArt = new Map()
    for (const s of foto.stockLocales) {
      if (!PRIO.has(s.base) || s.cant <= 0) continue
      const k = `${s.base}|${sku(s.art, s.color, s.talle)}`
      stock.set(k, (stock.get(k) ?? 0) + s.cant)
      stockArt.set(`${s.base}|${s.art}`, (stockArt.get(`${s.base}|${s.art}`) ?? 0) + s.cant)
    }
    const stockInicial = new Map(stock)
    const transito = new Set(foto.transito.map((t) => `${t.base}|${t.sku}`))
    const get = (b, s) => stock.get(`${b}|${s}`) ?? 0
    const mover = (b, s, d) => stock.set(`${b}|${s}`, get(b, s) + d)

    // Venta de los días por local (base) y SKU — v_agg del script
    const venta = new Map()
    for (const v of foto.ventas) {
      if (!dias.has(v.dia) || v.cant <= 0) continue
      const base = baseDeTienda(v.tienda)
      if (!PRIO.has(base)) continue
      const s = sku(v.art, v.color, v.talle)
      const k = `${base}|${s}`
      const p = venta.get(k)
      if (p) p.venta += v.cant
      else venta.set(k, { base, sku: s, art: v.art, color: v.color, talle: v.talle, venta: v.cant })
    }
    // Prioridad por venta de la categoría (material / grupo / material + grupo)
    const PV = P.prioridad_venta
    const catCache = new Map()
    const usaSku = PV.por.includes('color') || PV.por.includes('talle')
    /** La categoría del artículo (o del SKU si se compara por color / talle): "REMERAS · H51 …" */
    const categoria = (art, color = '', talle = '') => {
      const ck = usaSku ? `${art} ${color} ${talle}` : art
      if (catCache.has(ck)) return catCache.get(ck)
      const a = foto.arts.get(art) ?? { ID_ART: art }
      const k = PV.por.map((d) => String(DIMENSIONES[d].valor(a, { color, talle }) ?? '').trim() || `(sin ${DIMENSIONES[d].nombre.toLowerCase()})`).join(' · ')
      catCache.set(ck, k)
      return k
    }
    const ventaCat = new Map()
    let diasCat = []
    if (PV.activo) {
      const ult = repo.dias[repo.dias.length - 1]
      diasCat = [...new Set(foto.ventas.filter((v) => v.cant > 0).map((v) => v.dia))].filter((d) => d <= ult).sort().slice(-PV.dias)
      const enDias = new Set(diasCat)
      for (const v of foto.ventas) {
        if (!enDias.has(v.dia) || v.cant <= 0) continue
        const base = baseDeTienda(v.tienda)
        if (!PRIO.has(base)) continue
        const k = `${base}|${categoria(v.art, v.color, v.talle)}`
        ventaCat.set(k, (ventaCat.get(k) ?? 0) + v.cant)
      }
    }
    const sc = (base, art, color, talle) => ventaCat.get(`${base}|${categoria(art, color, talle)}`) ?? 0
    const pvRec = PV.activo && PV.aplica !== 'donantes'
    const pvDon = PV.activo && PV.aplica !== 'receptores'

    // Orden de los receptores: alfabético = el groupby (local, SKU) de pandas del script.
    // Con prioridad por venta: primero el que más vende la categoría del artículo.
    const pares = [...venta.values()].sort((a, b) =>
      (pvRec ? sc(b.base, b.art, b.color, b.talle) - sc(a.base, a.art, a.color, a.talle) || PRIO.get(a.base) - PRIO.get(b.base) || cmp(a.sku, b.sku) : 0) ||
      (P.orden_receptores === 'prioridad'
        ? PRIO.get(a.base) - PRIO.get(b.base) || cmp(a.sku, b.sku)
        : cmp(a.base, b.base) || cmp(a.sku, b.sku)),
    )
    for (const p of pares) {
      p.mito = mito.get(`${p.base}|${p.sku}`) ?? 0
      p.faltante = P.restar_mito ? p.venta - p.mito : p.venta
      p.elegible = elegible(p.art) && !noReciben.has(p.base)
    }

    const donantesBase = PRIORIDAD.filter((d) => !noDonan.has(d))
    // Con prioridad por venta (donantes): dona primero el que MENOS vende la categoría
    const donantesDe = (art, color, talle) =>
      [...donantesBase].sort(
        (a, b) =>
          (pvDon ? sc(a, art, color, talle) - sc(b, art, color, talle) : 0) ||
          (P.orden_donantes === 'prioridad' ? 0 : (stockArt.get(`${b}|${art}`) ?? 0) - (stockArt.get(`${a}|${art}`) ?? 0)) ||
          PRIO.get(a) - PRIO.get(b),
      )
    const donado = new Map()
    const asignados = new Set()
    const envios = []
    const prov = (art) => String(foto.arts.get(art)?.ID_PROV ?? '').toUpperCase()
    const motivos = { transito: 0, ya_tiene: 0, restriccion: 0, sin_donante: 0 }

    // Lo que un local recibe en la cascada NO se suma a su stock: todavía no lo tiene,
    // así que no puede volver a donarlo (el script viejo lo permitía).
    function dar(p, queda) {
      let falta = p.faltante
      for (const d of donantesDe(p.art, p.color, p.talle)) {
        if (d === p.base) continue
        const kd = `${d}|${p.sku}`
        const ya = donado.get(kd) ?? 0
        if (ya >= TOPE) continue
        const ds = get(d, p.sku)
        const n = Math.min(ds - queda, falta, TOPE - ya)
        if (n <= 0) continue
        mover(d, p.sku, -n)
        donado.set(kd, ya + n)
        envios.push({ donante: d, receptor: p.base, sku: p.sku, art: p.art, color: p.color, talle: p.talle, cantidad: n })
        asignados.add(`${p.base}|${p.sku}`)
        falta -= n
        if (falta <= 0) break
      }
      return falta
    }

    // PASE 1: VENTA (lo que faltó después de MITO). Se anota por qué no se intenta cada par.
    const motivoDe = new Map()
    const resto = new Map()
    for (const p of pares) {
      if (p.faltante <= 0 || !p.elegible) continue
      let m = 'sin_donante'
      if (P.respetar_transito && transito.has(`${p.base}|${p.sku}`)) m = 'transito'
      else if (P.receptor_max.activo && get(p.base, p.sku) >= P.receptor_max.valor) m = 'ya_tiene'
      else if (restrRec.has(p.base) && !restrProv.has(prov(p.art))) m = 'restriccion'
      motivoDe.set(p, m)
      resto.set(p, m === 'sin_donante' ? dar(p, P.donante_queda) : p.faltante)
    }
    // PASE EXTRA (como el pase NVOCED del script): si no recibió nada, acepta donantes con 1 unidad
    for (const p of pares) {
      if (!paseExtra.has(p.base) || !motivoDe.has(p)) continue
      const m = motivoDe.get(p)
      if (m === 'transito' || m === 'restriccion' || asignados.has(`${p.base}|${p.sku}`)) continue
      resto.set(p, dar(p, 0))
    }
    for (const [p, r] of resto) motivos[motivoDe.get(p)] += Math.max(0, r)

    // Mínimo de unidades por par donante → receptor
    const porPar = new Map()
    for (const e of envios) porPar.set(`${e.donante}|${e.receptor}`, (porPar.get(`${e.donante}|${e.receptor}`) ?? 0) + e.cantidad)
    const minEnvio = P.min_envio.activo ? P.min_envio.valor : 0
    const chicos = [...porPar.values()].filter((u) => u < minEnvio)
    const finales = envios.filter((e) => porPar.get(`${e.donante}|${e.receptor}`) >= minEnvio)

    // Controles: nadie dona más del tope ni más de lo que tiene
    const totDon = new Map()
    for (const e of envios) totDon.set(`${e.donante}|${e.sku}`, (totDon.get(`${e.donante}|${e.sku}`) ?? 0) + e.cantidad)
    for (const [k, u] of totDon) {
      if (u > TOPE) throw new Error(`Cascada: ${k} dona ${u} (> ${TOPE})`)
      if (u > (stockInicial.get(k) ?? 0)) throw new Error(`Cascada: ${k} dona más que su stock`)
    }

    const filas = finales
      .map((e) => {
        const a = foto.arts.get(e.art)
        const p = venta.get(`${e.receptor}|${e.sku}`)
        return {
          donante: e.donante,
          receptor: e.receptor,
          articulo: e.art,
          descripcion: descripcion(a),
          material: a.MATERIAL,
          grupo: a.ID_GRUPO,
          proveedor: a.PROVEEDOR,
          proveedor_id: a.ID_PROV,
          color: e.color,
          talle: e.talle,
          sku: e.sku,
          cantidad: e.cantidad,
          venta: p?.venta ?? 0,
          mito: p?.mito ?? 0,
          stock_donante: stockInicial.get(`${e.donante}|${e.sku}`) ?? 0,
          stock_receptor: stockInicial.get(`${e.receptor}|${e.sku}`) ?? 0,
          ...(PV.activo
            ? {
                categoria: categoria(e.art, e.color, e.talle),
                venta_cat_receptor: sc(e.receptor, e.art, e.color, e.talle),
                venta_cat_donante: sc(e.donante, e.art, e.color, e.talle),
              }
            : {}),
        }
      })
      .sort((a, b) => PRIO.get(a.donante) - PRIO.get(b.donante) || PRIO.get(a.receptor) - PRIO.get(b.receptor) || cmp(a.sku, b.sku))

    // Resumen
    const faltanteTotal = pares.filter((p) => p.elegible).reduce((s, p) => s + Math.max(0, p.faltante), 0)
    const cubierto = filas.reduce((s, f) => s + f.cantidad, 0)
    const porMaterial = {}
    for (const f of filas) porMaterial[f.material] = (porMaterial[f.material] ?? 0) + f.cantidad
    const matriz = {}
    for (const f of filas) {
      matriz[f.donante] ??= {}
      matriz[f.donante][f.receptor] = (matriz[f.donante][f.receptor] ?? 0) + f.cantidad
    }
    const ult = repo.dias[repo.dias.length - 1]
    const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
    const etiqueta = repo.dias.length > 1
      ? `${repo.dias[0].slice(8, 10)}-${ult.slice(8, 10)}${MES[Number(ult.slice(5, 7)) - 1]}`
      : `${ult.slice(8, 10)}${MES[Number(ult.slice(5, 7)) - 1]}`

    return {
      archivo: `CASCADA_${etiqueta}_conCalzado_soloVENTA.xlsx`,
      filas,
      unidades: cubierto,
      faltante_despues_mito: faltanteTotal,
      pares_eliminados: chicos.length,
      unidades_eliminadas: chicos.reduce((s, u) => s + u, 0),
      // Por qué quedó sin cubrir lo que faltaba (unidades)
      no_cubierto: { ...motivos, envio_chico: chicos.reduce((s, u) => s + u, 0) },
      por_material: porMaterial,
      matriz,
      donantes: PRIORIDAD.filter((d) => matriz[d]),
      receptores: PRIORIDAD.filter((r) => filas.some((f) => f.receptor === r)),
      // Venta por categoría de cada local (solo las categorías que salen en la cascada)
      ranking_venta: PV.activo
        ? {
            dias: diasCat,
            por: PV.por,
            por_nombre: PV.por.map((d) => DIMENSIONES[d].nombre).join(' + '),
            categorias: Object.fromEntries(
              [...new Set(filas.map((f) => f.categoria))].map((k) => [
                k,
                PRIORIDAD.map((b) => [b, ventaCat.get(`${b}|${k}`) ?? 0]).sort((x, y) => y[1] - x[1] || PRIO.get(x[0]) - PRIO.get(y[0])),
              ]),
            ),
          }
        : null,
      params: P,
    }
  }

  const DIMENSIONES_LISTA = Object.entries(DIMENSIONES).map(([clave, d]) => ({ clave, nombre: d.nombre }))
  return { calcularCascada, normalizarParams, PARAMS_DEFAULT, TEMPORADA, DIMENSIONES: DIMENSIONES_LISTA }
})
