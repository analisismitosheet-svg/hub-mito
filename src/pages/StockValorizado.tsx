import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Boxes, ChevronDown, Download, Layers, Loader2, RefreshCw, Search, TriangleAlert, Wallet, X } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import MultiselectFiltro, { type OpcionMulti } from '@/components/MultiselectFiltro'
import { coloresUnicos } from '@/lib/coloresUnicos'
import {
  basesDesdeCruce,
  cargarStockValorizado,
  costoUnitario,
  nombreBase,
  numero,
  pesos,
  pesosCorto,
  totalDe,
  type StockValorizado as Datos,
} from '@/lib/stockValorizado'

/**
 * Administradores > Stock valorizado.
 *
 * Qué tengo en stock y cuánta plata es, a COSTO, sucursal por sucursal.
 * Los números salen de /api/sql/stock-valorizado → Puente SQL →
 * puente-sql/sql/stock-valorizado.sql: stock por SKU de cada base
 * DRAGONFISH_* (ZooLogic.COMB) por el costo de la lista "Compra" (LISTA0)
 * de la base INDO, que está cargada por artículo.
 *
 * El cálculo recorre ~40 bases y tarda unos 12 s, así que el puente lo cachea
 * 10 minutos; "Actualizar" recalcula de cero (forzar=1).
 */

/** Filas que se dibujan en la tabla de artículos sin costo (el resto, al Excel). */
const TOPE_TABLA = 300

export default function StockValorizado() {
  const [datos, setDatos] = useState<Datos | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [incluirSinValor, setIncluirSinValor] = useState(false)
  const [verSinCosto, setVerSinCosto] = useState(false)
  /** Solapa: la plata por sucursal o artículo por artículo. */
  const [solapa, setSolapa] = useState<'sucursal' | 'articulo'>('sucursal')
  /** Artículos sin costo con el detalle por sucursal desplegado. */
  const [abiertos, setAbiertos] = useState<string[]>([])
  /** Bases con el listado de artículos sin costo desplegado en la tabla Por sucursal. */
  const [basesAbiertas, setBasesAbiertas] = useState<string[]>([])
  /** Filtros de proveedor y material (vacío = todos), al estilo de los de Excel. */
  const [provSel, setProvSel] = useState<Set<string>>(new Set())
  const [matSel, setMatSel] = useState<Set<string>>(new Set())

  const cargar = useCallback(async (forzar = false) => {
    setCargando(true)
    try {
      setDatos(await cargarStockValorizado(forzar))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  /* Filtros por proveedor y material: el puente manda el cruce
     sucursal x proveedor x material y los nombres de esos códigos. Si todavía no
     los manda (puente sin reiniciar), la barra de filtros no se dibuja y la
     pantalla queda como antes. */
  const cruce = useMemo(() => datos?.cruce ?? [], [datos])
  const hayFiltros = cruce.length > 0
  const filtrando = hayFiltros && (provSel.size > 0 || matSel.size > 0)

  const nombreClas = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of datos?.clasificaciones ?? []) m.set(`${c.tipo}:${c.codigo}`, c.nombre)
    return m
  }, [datos])

  /** Opciones de un filtro: los códigos que de verdad tienen stock, por nombre. */
  const opcionesDe = useCallback(
    (campo: 'proveedor' | 'material', tipo: string): OpcionMulti[] =>
      [...new Set(cruce.map((f) => f[campo]))]
        .map((id) => ({ id, label: id ? (nombreClas.get(`${tipo}:${id}`) || id) : '(sin cargar)' }))
        .sort((a, b) => a.label.localeCompare(b.label, 'es')),
    [cruce, nombreClas],
  )
  const opcionesProv = useMemo(() => opcionesDe('proveedor', 'prov'), [opcionesDe])
  const opcionesMat = useMemo(() => opcionesDe('material', 'mat'), [opcionesDe])

  const pasaFiltro = useCallback(
    (a: { proveedor?: string; material?: string }) =>
      (provSel.size === 0 || provSel.has(a.proveedor ?? '')) &&
      (matSel.size === 0 || matSel.has(a.material ?? '')),
    [provSel, matSel],
  )

  /* Con filtro puesto, la fila de cada sucursal se rehace sumando el cruce; sin
     filtro se usa la que manda el SQL, que es la misma cuenta pero no depende de
     que el puente ya mande el cruce. */
  const todas = useMemo(
    () => (filtrando ? basesDesdeCruce(cruce, provSel, matSel) : (datos?.bases ?? [])),
    [datos, cruce, filtrando, provSel, matSel],
  )

  /* Hay bases que no son de mercadería de venta (insumos, descartes) y no tienen
     ningún costo cargado: suman cientos de miles de unidades y $0, así que de
     entrada quedan afuera para que el total no engañe. Se ven con el botón. */
  const sinValor = useMemo(() => todas.filter((b) => b.valorizado <= 0), [todas])
  /* Si NINGUNA valoriza se muestran todas igual: pasa al filtrar por algo que no
     tiene costo cargado (DESARROLLO, por ejemplo), y si no la pantalla quedaba
     vacía como si no hubiera stock, cuando lo que pasa es que vale $0. */
  const bases = useMemo(
    () =>
      incluirSinValor || todas.every((b) => b.valorizado <= 0) ? todas : todas.filter((b) => b.valorizado > 0),
    [todas, incluirSinValor],
  )
  const total = useMemo(() => totalDe(bases), [bases])
  /* Mercadería en tránsito: ya viene sumada en unidades y valorizado de cada base;
     la columna aparte se muestra solo si el puente la manda (uno viejo no la trae). */
  const hayTransito = todas.some((b) => b.transito !== undefined)

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (!q) return bases
    return bases.filter((b) => `${nombreBase(b.base)} ${b.base}`.toLowerCase().includes(q))
  }, [bases, busqueda])

  /* Mismo criterio que el total: con el botón ámbar apagado se muestran solo
     los artículos que están en sucursales que valorizan (si no, el listado
     arranca con miles de avíos de NOMED). */
  const sinCosto = useMemo(() => {
    let lista = datos?.sin_costo ?? []
    if (filtrando) lista = lista.filter(pasaFiltro)
    return incluirSinValor ? lista : lista.filter((a) => a.unidades_val > 0)
  }, [datos, incluirSinValor, filtrando, pasaFiltro])
  const unidadesSinCosto = (a: { unidades: number; unidades_val: number }) =>
    incluirSinValor ? a.unidades : a.unidades_val

  /* Dónde están esas unidades: el detalle por sucursal, agrupado por artículo y
     filtrado con el mismo criterio que las unidades de arriba, para que lo que
     se despliega sume exactamente lo que dice la fila. */
  const detallePorArticulo = useMemo(() => {
    const mapa = new Map<string, { base: string; unidades: number; valoriza: boolean }[]>()
    for (const f of datos?.sin_costo_detalle ?? []) {
      if (!incluirSinValor && !f.valoriza) continue
      const filas = mapa.get(f.articulo)
      if (filas) filas.push(f)
      else mapa.set(f.articulo, [f])
    }
    return mapa
  }, [datos, incluirSinValor])

  /* Al revés: para cada base de la tabla "Por sucursal", qué artículos tienen
     costo $0 ahí (código, descripción y unidades), respetando el filtro de
     proveedor y material para que sume igual que la columna "Sin costo". */
  const sinCostoPorBase = useMemo(() => {
    const infoArt = new Map<string, string>()
    for (const a of datos?.sin_costo ?? []) {
      if (filtrando && !pasaFiltro(a)) continue
      infoArt.set(a.articulo, a.descripcion)
    }
    const tieneSinCosto = (datos?.sin_costo?.length ?? 0) > 0
    const mapa = new Map<string, { articulo: string; descripcion: string; unidades: number }[]>()
    for (const f of datos?.sin_costo_detalle ?? []) {
      if (tieneSinCosto && !infoArt.has(f.articulo)) continue
      const item = { articulo: f.articulo, descripcion: infoArt.get(f.articulo) ?? '', unidades: f.unidades }
      const filas = mapa.get(f.base)
      if (filas) filas.push(item)
      else mapa.set(f.base, [item])
    }
    for (const filas of mapa.values()) filas.sort((a, b) => b.unidades - a.unidades)
    return mapa
  }, [datos, filtrando, pasaFiltro])

  /* Solapa "Por artículo": todo lo que hay en stock, sumando las sucursales.
     Viene ordenado por valorizado desde el SQL. */
  const articulos = useMemo(() => datos?.articulos ?? [], [datos])
  /** Lo que dejan pasar los filtros, todavía sin el buscador: es lo que va al Excel general. */
  const articulosFiltrados = useMemo(
    () => (filtrando ? articulos.filter(pasaFiltro) : articulos),
    [articulos, filtrando, pasaFiltro],
  )
  const articulosVisibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (!q) return articulosFiltrados
    return articulosFiltrados.filter((a) => `${a.articulo} ${a.descripcion}`.toLowerCase().includes(q))
  }, [articulosFiltrados, busqueda])
  const totalArticulos = useMemo(
    () =>
      articulosVisibles.reduce(
        (t, a) => ({ unidades: t.unidades + a.unidades, valorizado: t.valorizado + a.valorizado }),
        { unidades: 0, valorizado: 0 },
      ),
    [articulosVisibles],
  )

  const hayDetalle = (datos?.sin_costo_detalle ?? []).length > 0
  const alternar = (articulo: string) =>
    setAbiertos((a) => (a.includes(articulo) ? a.filter((x) => x !== articulo) : [...a, articulo]))
  const alternarBase = (base: string) =>
    setBasesAbiertas((a) => (a.includes(base) ? a.filter((x) => x !== base) : [...a, base]))

  // Íconos de las tarjetas: sin tonos repetidos en la pantalla
  const [cEmerald, cBlue, cViolet, cAmber] = coloresUnicos(['#10b981', '#3b82f6', '#8b5cf6', '#f59e0b'])

  async function exportar() {
    if (bases.length === 0) return
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        bases.map((b) => ({
          Sucursal: nombreBase(b.base),
          Base: b.base,
          Unidades: b.unidades,
          'Costo promedio': Math.round(costoUnitario(b)),
          Valorizado: Math.round(b.valorizado),
          'Unidades sin costo': b.unidades_sin_costo,
          SKUs: b.skus,
          ...(hayTransito ? { 'En tránsito (u.)': b.transito ?? 0, 'En tránsito ($)': Math.round(b.transito_val ?? 0) } : {}),
        })),
      ),
      'Por sucursal',
    )
    if (articulosFiltrados.length > 0) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filasPorArticulo(articulosFiltrados)), 'Por artículo')
    }
    agregarHojasSinCosto(XLSX, wb)
    XLSX.writeFile(wb, `stock_valorizado_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  /** Nombre del proveedor o material de un artículo (el código si no tiene nombre). */
  const nombreProv = (cod?: string) => (cod ? (nombreClas.get(`prov:${cod}`) || cod) : '')
  const nombreMat = (cod?: string) => (cod ? (nombreClas.get(`mat:${cod}`) || cod) : '')

  /** Columnas de la solapa "Por artículo", en el mismo orden que la pantalla. */
  const filasPorArticulo = (lista: typeof articulos) =>
    lista.map((a) => ({
      Artículo: a.articulo,
      Descripción: a.descripcion,
      ...(hayFiltros ? { Proveedor: nombreProv(a.proveedor), Material: nombreMat(a.material) } : {}),
      Stock: a.unidades,
      'Precio costo': a.costo ?? '',
      'Total valorizado': Math.round(a.valorizado),
      ...(hayTransito ? { 'En tránsito': a.transito ?? 0 } : {}),
    }))

  /** Solo el listado por artículo, en su propio archivo (lo que se ve en la solapa). */
  async function exportarArticulos() {
    if (articulosVisibles.length === 0) return
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filasPorArticulo(articulosVisibles)), 'Por artículo')
    XLSX.writeFile(wb, `stock_valorizado_articulos_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  /**
   * Las dos hojas de los artículos sin costo. Las usan el Excel completo y el
   * botón de la sección ámbar, que baja solo esto (es lo que más se pide:
   * la lista para ir a cargarles el costo en Dragon).
   */
  function agregarHojasSinCosto(XLSX: typeof import('xlsx'), wb: import('xlsx').WorkBook): number {
    if (sinCosto.length === 0) return 0
    /* Las dos cifras juntas: el total de la empresa y el que entra al
       valorizado. En pantalla se ve una sola (la que dice el botón ámbar),
       acá van las dos para no tener que exportar dos veces. */
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        sinCosto.map((a) => ({
          Artículo: a.articulo,
          Descripción: a.descripcion,
          ...(hayFiltros ? { Proveedor: nombreProv(a.proveedor), Material: nombreMat(a.material) } : {}),
          'Unidades (todas)': a.unidades,
          'Unidades en sucursales que valorizan': a.unidades_val,
          Sucursales: a.sucursales,
          'En qué sucursales': a.bases,
        })),
      ),
      'Sin costo',
    )
    /* Y el mismo listado abierto por sucursal. Van todas las sucursales de
       esos artículos, con la columna ¿Valoriza? para distinguirlas: igual que
       arriba, el Excel se lleva el panorama completo. */
    const descripciones = new Map(sinCosto.map((a) => [a.articulo, a.descripcion]))
    const detalle = (datos?.sin_costo_detalle ?? [])
      .filter((f) => descripciones.has(f.articulo))
      .map((f) => ({
        Artículo: f.articulo,
        Descripción: descripciones.get(f.articulo) ?? '',
        Sucursal: nombreBase(f.base),
        Base: f.base,
        Unidades: f.unidades,
        '¿Valoriza?': f.valoriza ? 'Sí' : 'No',
      }))
    if (detalle.length > 0) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detalle), 'Sin costo x sucursal')
    }
    return sinCosto.length
  }

  /** Solo los artículos sin costo, en su propio archivo. */
  async function exportarSinCosto() {
    if (sinCosto.length === 0) return
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    agregarHojasSinCosto(XLSX, wb)
    XLSX.writeFile(wb, `articulos_sin_costo_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  const btnChico =
    'btn-press inline-flex h-8 items-center gap-1 rounded-lg border border-line bg-surface2 px-2.5 text-xs font-medium text-ink transition hover:bg-line disabled:opacity-50'

  const tarjetas = [
    { titulo: 'Valorizado total', valor: pesosCorto(total.valorizado), pie: pesos(total.valorizado), icono: Wallet, color: cEmerald },
    {
      titulo: 'Unidades',
      valor: numero(total.unidades),
      pie:
        hayTransito && total.transito > 0
          ? `${numero(total.transito)} en tránsito (${pesosCorto(total.transito_val)}) · ${numero(total.skus)} SKUs`
          : `${numero(total.skus)} SKUs con stock`,
      icono: Boxes,
      color: cBlue,
    },
    { titulo: 'Sucursales', valor: numero(total.sucursales), pie: 'bases con stock cargado', icono: Layers, color: cViolet },
    {
      titulo: 'Unidades sin costo',
      valor: numero(total.unidades_sin_costo),
      pie:
        total.unidades > 0
          ? `${((total.unidades_sin_costo / total.unidades) * 100).toFixed(1)} % del stock, valen 0`
          : 'sin stock',
      icono: TriangleAlert,
      color: cAmber,
    },
  ]

  return (
    <Layout>
      <BackButton />
      <header className="mb-4 mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink">
          <Wallet size={22} style={{ color: cEmerald }} aria-hidden /> Stock valorizado
        </h1>
        <span className="text-xs text-sub/70">
          a costo · lista «{datos?.costo.lista_nombre ?? 'Compra'}» de {datos?.costo.base || 'Dragon'}
          {datos?.costo.articulos_con_costo ? ` · ${numero(datos.costo.articulos_con_costo)} artículos con costo` : ''}
        </span>
        {datos?.calculado && (
          <span className="rounded-full border border-line bg-surface2 px-2 py-0.5 text-[11px] text-sub">
            calculado {new Date(datos.calculado).toLocaleString('es-AR', { hour12: false })}
            {datos.cacheado ? ' (cache)' : datos.segundos ? ` en ${datos.segundos} s` : ''}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => void exportar()} disabled={bases.length === 0} className={btnChico} type="button">
            <Download size={13} aria-hidden /> Excel
          </button>
          {/* Atajo a la vista: el mismo Excel del botón de la sección ámbar */}
          {sinCosto.length > 0 && (
            <button
              onClick={() => void exportarSinCosto()}
              className="btn-press inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 text-xs font-medium text-amber-500 transition hover:bg-amber-500/20"
              title={`Bajar los ${numero(sinCosto.length)} artículos sin costo a Excel`}
              type="button"
            >
              <Download size={13} aria-hidden /> Sin costo ({numero(sinCosto.length)})
            </button>
          )}
          <button onClick={() => void cargar(true)} disabled={cargando} className={btnChico} type="button">
            <RefreshCw size={13} className={cargando ? 'animate-spin' : ''} aria-hidden /> Actualizar
          </button>
        </div>
      </header>

      {error && (
        <p role="alert" className="mb-4 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">
          {error}
        </p>
      )}

      {cargando && !datos && (
        <p className="flex items-center gap-2 rounded-xl border border-line bg-surface p-4 text-sm text-sub">
          <Loader2 size={16} className="animate-spin" aria-hidden /> Recorriendo las bases y valorizando el stock…
        </p>
      )}

      {datos && (
        <div className="space-y-4 pb-6">
          {/* Resumen */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {tarjetas.map((t) => (
              <div key={t.titulo} className="rounded-2xl border border-line bg-surface p-3">
                <p className="flex items-center gap-1.5 text-xs text-sub">
                  <t.icono size={14} style={{ color: t.color }} aria-hidden /> {t.titulo}
                </p>
                <p className="mt-1 font-display text-2xl font-semibold text-ink">{t.valor}</p>
                <p className="text-[11px] text-sub/70">{t.pie}</p>
              </div>
            ))}
          </div>

          {/* Solapas */}
          <div className="flex items-center gap-1 rounded-xl border border-line bg-surface p-1 sm:w-fit">
            {([
              { id: 'sucursal', texto: 'Por sucursal', icono: Layers },
              { id: 'articulo', texto: 'Por artículo', icono: Boxes },
            ] as const).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setSolapa(t.id)
                  setBusqueda('')
                }}
                className={`btn-press inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-medium transition sm:flex-none ${
                  solapa === t.id ? 'bg-surface2 text-ink' : 'text-sub hover:text-ink'
                }`}
              >
                <t.icono size={15} style={{ color: solapa === t.id ? (t.id === 'sucursal' ? cViolet : cBlue) : undefined }} aria-hidden />
                {t.texto}
              </button>
            ))}
          </div>

          {/* Buscador + bases sin costo */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative max-w-xs flex-1">
            <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub" />
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder={solapa === 'sucursal' ? 'Buscar sucursal…' : 'Buscar artículo o descripción…'}
              className="h-10 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-sm text-ink placeholder:text-sub/60"
              />
            </div>
            {hayFiltros && (
              <>
                {/* arrancaTodo: los dos filtros de esta pantalla arrancan con todo
                    tildado y se destilda lo que se quiere sacar (pedido del usuario). */}
                <MultiselectFiltro
                  label="Proveedor"
                  opciones={opcionesProv}
                  seleccionadas={provSel}
                  onChange={setProvSel}
                  arrancaTodo
                />
                <MultiselectFiltro
                  label="Material"
                  opciones={opcionesMat}
                  seleccionadas={matSel}
                  onChange={setMatSel}
                  arrancaTodo
                />
                {filtrando && (
                  <button
                    type="button"
                    onClick={() => {
                      setProvSel(new Set())
                      setMatSel(new Set())
                    }}
                    className="btn-press inline-flex items-center gap-1 rounded-lg border border-line bg-surface2 px-2 py-1.5 text-xs text-sub transition hover:bg-line hover:text-ink"
                  >
                    <X size={12} aria-hidden /> Limpiar ({numero(articulosFiltrados.length)} art.)
                  </button>
                )}
              </>
            )}
            {solapa === 'articulo' && (
              <button
                type="button"
                onClick={() => void exportarArticulos()}
                disabled={articulosVisibles.length === 0}
                className="btn-press inline-flex h-10 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-xs font-medium text-ink transition hover:bg-surface2 disabled:opacity-50"
              >
                <Download size={13} aria-hidden /> Excel ({numero(articulosVisibles.length)})
              </button>
            )}
            {sinValor.length > 0 && (
              <button
                type="button"
                onClick={() => setIncluirSinValor((v) => !v)}
                className={`btn-press inline-flex h-10 items-center gap-1.5 rounded-xl border px-3 text-xs font-medium transition ${
                  incluirSinValor
                    ? 'border-amber-500/40 bg-amber-500/10 text-amber-500'
                    : 'border-line bg-surface text-sub hover:bg-surface2'
                }`}
                title={sinValor.map((b) => `${nombreBase(b.base)} · ${numero(b.unidades)} u.`).join(' · ')}
              >
                <TriangleAlert size={13} aria-hidden />
                {incluirSinValor ? 'Ocultar' : 'Sumar'} {sinValor.length} base{sinValor.length > 1 ? 's' : ''} sin costo
                cargado ({numero(sinValor.reduce((t, b) => t + b.unidades, 0))} u.)
              </button>
            )}
          </div>

          {/* Por sucursal */}
          {solapa === 'sucursal' && (
            <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-sub">
                    <th className="px-3 py-2 font-medium">Sucursal</th>
                    <th className="px-3 py-2 text-right font-medium">Unidades</th>
                    {hayTransito && <th className="px-3 py-2 text-right font-medium">En tránsito</th>}
                    <th className="px-3 py-2 text-right font-medium">Costo prom.</th>
                    <th className="px-3 py-2 text-right font-medium">Valorizado</th>
                    <th className="px-3 py-2 font-medium">% del total</th>
                    <th className="px-3 py-2 text-right font-medium">Sin costo</th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((b) => {
                    const parte = total.valorizado > 0 ? (b.valorizado / total.valorizado) * 100 : 0
                    const detalleBase = sinCostoPorBase.get(b.base) ?? []
                    const puedeAbrir = b.unidades_sin_costo > 0 && detalleBase.length > 0
                    const abierta = puedeAbrir && basesAbiertas.includes(b.base)
                    return (
                      <Fragment key={b.base}>
                        <tr
                          onClick={puedeAbrir ? () => alternarBase(b.base) : undefined}
                          className={`border-b border-line/60 last:border-0 ${puedeAbrir ? 'cursor-pointer hover:bg-surface2/40' : ''}`}
                        >
                          <td className="px-3 py-2">
                            {puedeAbrir ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  alternarBase(b.base)
                                }}
                                aria-expanded={abierta}
                                className="inline-flex items-center gap-1.5 text-left"
                              >
                                <ChevronDown
                                  size={14}
                                  style={{ color: cAmber }}
                                  className={`shrink-0 transition ${abierta ? '' : '-rotate-90'}`}
                                  aria-hidden
                                />
                                <span className="font-medium text-ink">{nombreBase(b.base)}</span>
                                <span className="ml-1 font-mono text-[11px] text-sub/70">{b.base}</span>
                              </button>
                            ) : (
                              <>
                                <span className={`${hayDetalle ? 'pl-5 ' : ''}font-medium text-ink`}>{nombreBase(b.base)}</span>
                                <span className="ml-2 font-mono text-[11px] text-sub/70">{b.base}</span>
                              </>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-ink">{numero(b.unidades)}</td>
                          {hayTransito && (
                            <td className="px-3 py-2 text-right tabular-nums text-xs text-sub" title={pesos(b.transito_val ?? 0)}>
                              {b.transito ? numero(b.transito) : '—'}
                            </td>
                          )}
                          <td className="px-3 py-2 text-right tabular-nums text-sub">{pesos(costoUnitario(b))}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-semibold text-ink">{pesos(b.valorizado)}</td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface2">
                                <div className="h-full rounded-full" style={{ width: `${parte}%`, backgroundColor: cEmerald }} />
                              </div>
                              <span className="tabular-nums text-xs text-sub">{parte.toFixed(1)} %</span>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-xs text-amber-500">
                            {puedeAbrir ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  alternarBase(b.base)
                                }}
                                aria-expanded={abierta}
                                className={`btn-press inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-amber-500 transition ${
                                  abierta ? 'bg-amber-500/15 hover:bg-amber-500/20' : 'hover:bg-amber-500/10'
                                }`}
                              >
                                <ChevronDown
                                  size={13}
                                  className={`shrink-0 transition ${abierta ? '' : '-rotate-90'}`}
                                  aria-hidden
                                />
                                {numero(b.unidades_sin_costo)}
                              </button>
                            ) : b.unidades_sin_costo > 0 ? (
                              numero(b.unidades_sin_costo)
                            ) : (
                              '—'
                            )}
                          </td>
                        </tr>
                        {abierta && (
                          <tr className="border-b border-amber-500/20">
                            <td colSpan={hayTransito ? 7 : 6} className="bg-amber-500/5 px-4 pb-3 pt-2">
                              <div className="mb-1.5 flex items-center justify-between text-xs">
                                <span className="font-medium text-amber-500">
                                  Artículos con costo $0 en {nombreBase(b.base)} ({b.base}) — {numero(detalleBase.length)}{' '}
                                  {detalleBase.length === 1 ? 'artículo' : 'artículos'} · {numero(b.unidades_sin_costo)} unidades
                                </span>
                              </div>
                              <ul className="ml-1 grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
                                {detalleBase.slice(0, TOPE_TABLA).map((a) => (
                                  <li
                                    key={a.articulo}
                                    className="flex items-baseline justify-between gap-3 border-b border-amber-500/10 py-1 text-xs last:border-0"
                                  >
                                    <span className="min-w-0 truncate" title={a.descripcion || a.articulo}>
                                      <span className="font-mono text-ink">{a.articulo}</span>
                                      {a.descripcion && <span className="ml-1.5 text-sub">{a.descripcion}</span>}
                                    </span>
                                    <span className="shrink-0 tabular-nums font-medium text-amber-500">{numero(a.unidades)} u.</span>
                                  </li>
                                ))}
                              </ul>
                              {detalleBase.length > TOPE_TABLA && (
                                <p className="mt-1.5 text-[11px] text-sub/70">
                                  Se muestran los {numero(TOPE_TABLA)} de más unidades de los {numero(detalleBase.length)} de esta base.
                                </p>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                  {visibles.length === 0 && (
                    <tr>
                      <td colSpan={hayTransito ? 7 : 6} className="px-3 py-6 text-center text-sm text-sub">
                        No hay sucursales que coincidan.
                      </td>
                    </tr>
                  )}
                </tbody>
                {visibles.length > 0 && (
                  <tfoot>
                    <tr className="border-t border-line bg-surface2/50 font-semibold text-ink">
                      <td className="px-3 py-2">Total</td>
                      <td className="px-3 py-2 text-right tabular-nums">{numero(total.unidades)}</td>
                      {hayTransito && (
                        <td className="px-3 py-2 text-right tabular-nums text-sub" title={pesos(total.transito_val)}>
                          {total.transito > 0 ? numero(total.transito) : '—'}
                        </td>
                      )}
                      <td className="px-3 py-2 text-right tabular-nums text-sub">{pesos(costoUnitario(total))}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{pesos(total.valorizado)}</td>
                      <td className="px-3 py-2" />
                      <td className="px-3 py-2 text-right tabular-nums text-amber-500">
                        {total.unidades_sin_costo > 0 ? numero(total.unidades_sin_costo) : '—'}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}

          {solapa === 'articulo' && (
            <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-sub">
                    <th className="px-3 py-2 font-medium">Artículo</th>
                    <th className="px-3 py-2 font-medium">Descripción</th>
                    {hayFiltros && <th className="px-3 py-2 font-medium">Proveedor</th>}
                    <th className="px-3 py-2 text-right font-medium">Stock</th>
                    <th className="px-3 py-2 text-right font-medium">Precio costo</th>
                    <th className="px-3 py-2 text-right font-medium">Total valorizado</th>
                  </tr>
                </thead>
                <tbody>
                  {articulosVisibles.slice(0, TOPE_TABLA).map((a) => (
                    <tr key={a.articulo} className="border-b border-line/60 last:border-0">
                      <td className="px-3 py-2 font-mono text-xs text-ink">{a.articulo}</td>
                      <td className="px-3 py-2 text-sub">{a.descripcion || '—'}</td>
                      {hayFiltros && (
                        <td className="px-3 py-2 text-xs text-sub/80" title={nombreMat(a.material) || undefined}>
                          {nombreProv(a.proveedor) || '—'}
                        </td>
                      )}
                      <td className="px-3 py-2 text-right tabular-nums text-ink">{numero(a.unidades)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${a.costo == null ? 'text-amber-500' : 'text-sub'}`}>
                        {a.costo == null ? 'sin costo' : pesos(a.costo)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-ink">{pesos(a.valorizado)}</td>
                    </tr>
                  ))}
                  {articulosVisibles.length === 0 && (
                    <tr>
                      <td colSpan={hayFiltros ? 6 : 5} className="px-3 py-6 text-center text-sm text-sub">
                        No hay artículos que coincidan.
                      </td>
                    </tr>
                  )}
                </tbody>
                {articulosVisibles.length > 0 && (
                  <tfoot>
                    <tr className="border-t border-line bg-surface2/50 font-semibold text-ink">
                      <td className="px-3 py-2" colSpan={hayFiltros ? 3 : 2}>
                        Total ({numero(articulosVisibles.length)} artículos)
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{numero(totalArticulos.unidades)}</td>
                      <td className="px-3 py-2" />
                      <td className="px-3 py-2 text-right tabular-nums">{pesos(totalArticulos.valorizado)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
              {articulosVisibles.length > TOPE_TABLA && (
                <p className="border-t border-line px-3 py-2 text-[11px] text-sub/70">
                  Se dibujan los {numero(TOPE_TABLA)} de más plata. El total de arriba y el Excel llevan los{' '}
                  {numero(articulosVisibles.length)}; para encontrar uno puntual, buscalo arriba.
                </p>
              )}
            </div>
          )}


          {/* Artículos sin costo cargado */}
          {sinCosto.length > 0 && (
            <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5">
              <div className="flex items-center gap-2 pr-3">
                <button
                  type="button"
                  onClick={() => setVerSinCosto((v) => !v)}
                  className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left text-sm font-medium text-ink"
                >
                  <ChevronDown size={16} className={`transition ${verSinCosto ? '' : '-rotate-90'}`} aria-hidden />
                  <TriangleAlert size={15} style={{ color: cAmber }} aria-hidden />
                  Artículos sin costo cargado ({sinCosto.length})
                  <span className="ml-auto hidden text-xs font-normal text-sub/70 sm:inline">
                    {numero(sinCosto.reduce((t, a) => t + unidadesSinCosto(a), 0))} unidades que hoy valen $0
                    {hayDetalle ? ' · tocá las sucursales para abrir el detalle' : ''}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void exportarSinCosto()}
                  className="btn-press inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 text-xs font-medium text-amber-500 transition hover:bg-amber-500/20"
                  title={`Bajar los ${numero(sinCosto.length)} artículos sin costo a Excel`}
                >
                  <Download size={13} aria-hidden /> Excel
                </button>
              </div>
              {verSinCosto && (
                <div className="overflow-x-auto border-t border-amber-500/20">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead>
                      <tr className="border-b border-amber-500/20 text-left text-xs uppercase tracking-wide text-sub">
                        <th className="px-3 py-2 font-medium">Artículo</th>
                        <th className="px-3 py-2 font-medium">Descripción</th>
                        <th className="px-3 py-2 text-right font-medium">Unidades</th>
                        <th className="px-3 py-2 font-medium">Sucursales</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sinCosto.slice(0, TOPE_TABLA).map((a) => {
                        const detalle = detallePorArticulo.get(a.articulo) ?? []
                        const abierto = abiertos.includes(a.articulo)
                        return (
                          <Fragment key={a.articulo}>
                            <tr className="border-b border-amber-500/10 last:border-0">
                              <td className="px-3 py-2 font-mono text-xs text-ink">{a.articulo}</td>
                              <td className="px-3 py-2 text-sub">{a.descripcion || '—'}</td>
                              <td className="px-3 py-2 text-right tabular-nums text-ink">
                                {numero(unidadesSinCosto(a))}
                              </td>
                              <td className="px-3 py-2 text-xs text-sub/80">
                                {detalle.length > 0 ? (
                                  <button
                                    type="button"
                                    onClick={() => alternar(a.articulo)}
                                    className="btn-press inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-left transition hover:bg-amber-500/10"
                                    aria-expanded={abierto}
                                  >
                                    <ChevronDown
                                      size={13}
                                      className={`shrink-0 transition ${abierto ? '' : '-rotate-90'}`}
                                      aria-hidden
                                    />
                                    {detalle.length > 3 ? `${detalle.length} sucursales` : a.bases || '—'}
                                  </button>
                                ) : (
                                  <span title={a.bases}>
                                    {a.sucursales > 3 ? `${a.sucursales} sucursales` : a.bases || '—'}
                                  </span>
                                )}
                              </td>
                            </tr>
                            {abierto && detalle.length > 0 && (
                              <tr className="border-b border-amber-500/10">
                                <td colSpan={4} className="bg-amber-500/5 px-3 pb-2.5 pt-1">
                                  <ul className="ml-1 grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
                                    {detalle.map((f) => (
                                      <li
                                        key={f.base}
                                        className="flex items-baseline justify-between gap-3 border-b border-amber-500/10 py-0.5 text-xs last:border-0"
                                      >
                                        <span className={f.valoriza ? 'text-sub' : 'text-sub/60'}>
                                          {nombreBase(f.base)}
                                          {!f.valoriza && <span className="ml-1 text-[10px]">(no valoriza)</span>}
                                        </span>
                                        <span className="tabular-nums text-ink">{numero(f.unidades)}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                  {sinCosto.length > TOPE_TABLA && (
                    <p className="px-3 py-2 text-[11px] text-sub/70">
                      Se muestran los {numero(TOPE_TABLA)} de más unidades. Los {numero(sinCosto.length)} están
                      completos en el Excel, hojas «Sin costo» y «Sin costo x sucursal».
                    </p>
                  )}
                </div>
              )}
            </section>
          )}

          <p className="text-[11px] leading-relaxed text-sub/70">
            El costo es el de la lista «{datos.costo.lista_nombre}» ({datos.costo.lista}) de la base{' '}
            {datos.costo.base || 'de Dragon'}, tomando la vigencia más nueva de cada artículo. Las unidades de artículos sin costo cargado se cuentan en «Unidades»
            pero suman $0 al valorizado. Stock por SKU de cada base <span className="font-mono">DRAGONFISH_*</span>{' '}
            {datos.servidor ? `del servidor ${datos.servidor}` : ''}.
          </p>
        </div>
      )}
    </Layout>
  )
}
