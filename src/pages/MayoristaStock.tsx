import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Boxes, ChevronDown, Download, FileText, Loader2, Package, RefreshCw, Search, Truck, Users, Wallet, Warehouse } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import MultiselectFiltro, { type OpcionMulti } from '@/components/MultiselectFiltro'
import { coloresUnicos } from '@/lib/coloresUnicos'
import {
  cargarStockMayorista,
  compararTalles,
  diasDesde,
  numero,
  pesos,
  type ArticuloInfo,
  type LineaTapera,
  type StockMayorista,
} from '@/lib/stockMayorista'

/**
 * Mayorista > Stock. Dos solapas, las dos de DRAGONFISH_MITO:
 *  - Depósito: stock por artículo + color, con la curva de talles.
 *  - Tapera: lo remitido a clientes que todavía no se facturó, por artículo o por cliente.
 * Datos: /api/sql/stock-mayorista → Puente SQL → puente-sql/sql/stock-mayorista.sql.
 */

/** Filas que se dibujan (el resto va al Excel). */
const TOPE = 300

type Solapa = 'deposito' | 'tapera'
type Vista = 'art' | 'cli'

interface GrupoDep {
  clave: string
  a: string
  c: string
  curva: [string, number][]
  u: number
  tr: number
}

interface GrupoTap {
  clave: string
  a: string
  c: string
  curva: [string, number][]
  u: number
  pesos: number
  lineas: LineaTapera[]
}

interface GrupoCli {
  cli: string
  nom: string
  remitos: number[]
  vieja: string
  u: number
  pesos: number
  lineas: LineaTapera[]
}

function curvaDe(pares: [string, number][]): [string, number][] {
  const m = new Map<string, number>()
  pares.forEach(([t, u]) => m.set(t, (m.get(t) ?? 0) + u))
  return [...m.entries()].sort((x, y) => compararTalles(x[0], y[0]))
}

const fechaCorta = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(2, 4)}`

export default function MayoristaStock() {
  const [datos, setDatos] = useState<StockMayorista | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [solapa, setSolapa] = useState<Solapa>('deposito')
  const [vista, setVista] = useState<Vista>('art')
  const [busqueda, setBusqueda] = useState('')
  const [abierta, setAbierta] = useState<string | null>(null)
  const [matSel, setMatSel] = useState<Set<string>>(new Set())
  const [provSel, setProvSel] = useState<Set<string>>(new Set())
  /** Tapera: clientes elegidos (vacío = todos). */
  const [cliSel, setCliSel] = useState<Set<string>>(new Set())

  const cargar = useCallback(async (forzar = false) => {
    setCargando(true)
    setError(null)
    try {
      setDatos(await cargarStockMayorista(forzar))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const [cSky, cEmerald, cViolet, cRose, cAmber] = coloresUnicos(['#0ea5e9', '#10b981', '#8b5cf6', '#f43f5e', '#f59e0b'])

  const arts = useMemo(() => new Map<string, ArticuloInfo>((datos?.articulos ?? []).map((x) => [x.a, x])), [datos])
  const colores = useMemo(() => new Map((datos?.colores ?? []).map((x) => [x.c, x.des])), [datos])
  const colorDe = (c: string) => colores.get(c) || c
  const desDe = (a: string) => arts.get(a)?.des ?? ''

  const opcionesMat = useMemo<OpcionMulti[]>(() => {
    const m = new Map<string, string>()
    arts.forEach((x) => m.set(x.mat, x.mat ? x.mat_nom || x.mat : '(sin cargar)'))
    return [...m.entries()].map(([id, label]) => ({ id, label })).sort((x, y) => x.label.localeCompare(y.label))
  }, [arts])
  const opcionesProv = useMemo<OpcionMulti[]>(() => {
    const m = new Map<string, string>()
    arts.forEach((x) => m.set(x.prov, x.prov ? x.prov_nom || x.prov : '(sin cargar)'))
    return [...m.entries()].map(([id, label]) => ({ id, label })).sort((x, y) => x.label.localeCompare(y.label))
  }, [arts])

  const opcionesCli = useMemo<OpcionMulti[]>(() => {
    const m = new Map<string, string>()
    ;(datos?.tapera ?? []).forEach((l) => m.set(l.cli, `${l.cli_nom || l.cli} (${l.cli})`))
    return [...m.entries()].map(([id, label]) => ({ id, label })).sort((x, y) => x.label.localeCompare(y.label))
  }, [datos])

  const pasaFiltros = useCallback(
    (a: string) => {
      const info = arts.get(a)
      if (matSel.size && !matSel.has(info?.mat ?? '')) return false
      if (provSel.size && !provSel.has(info?.prov ?? '')) return false
      return true
    },
    [arts, matSel, provSel],
  )

  const q = busqueda.trim().toLowerCase()

  // ---- Depósito ----
  const gruposDep = useMemo<GrupoDep[]>(() => {
    const m = new Map<string, { a: string; c: string; pares: [string, number][]; u: number; tr: number }>()
    for (const l of datos?.deposito ?? []) {
      const k = `${l.a}|${l.c}`
      let g = m.get(k)
      if (!g) m.set(k, (g = { a: l.a, c: l.c, pares: [], u: 0, tr: 0 }))
      g.pares.push([l.t, l.u])
      g.u += l.u
      g.tr += l.tr
    }
    return [...m.entries()]
      .map(([clave, g]) => ({ clave, a: g.a, c: g.c, curva: curvaDe(g.pares), u: g.u, tr: g.tr }))
      .sort((x, y) => y.u - x.u)
  }, [datos])

  const depFiltrado = useMemo(
    () =>
      gruposDep.filter(
        (g) =>
          pasaFiltros(g.a) &&
          (!q || `${g.a} ${desDe(g.a)} ${colorDe(g.c)}`.toLowerCase().includes(q)),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gruposDep, pasaFiltros, q, arts, colores],
  )

  // ---- Tapera ----
  const tapFiltrado = useMemo(
    () =>
      (datos?.tapera ?? []).filter(
        (l) =>
          pasaFiltros(l.a) &&
          (cliSel.size === 0 || cliSel.has(l.cli)) &&
          (!q || `${l.a} ${desDe(l.a)} ${l.cli} ${l.cli_nom} ${l.remito}`.toLowerCase().includes(q)),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [datos, pasaFiltros, q, arts, cliSel],
  )

  const tapPorArt = useMemo<GrupoTap[]>(() => {
    const m = new Map<string, { a: string; c: string; pares: [string, number][]; u: number; pesos: number; lineas: LineaTapera[] }>()
    for (const l of tapFiltrado) {
      const k = `${l.a}|${l.c}`
      let g = m.get(k)
      if (!g) m.set(k, (g = { a: l.a, c: l.c, pares: [], u: 0, pesos: 0, lineas: [] }))
      g.pares.push([l.t, l.u])
      g.u += l.u
      g.pesos += l.u * l.precio
      g.lineas.push(l)
    }
    return [...m.entries()]
      .map(([clave, g]) => ({ clave, a: g.a, c: g.c, curva: curvaDe(g.pares), u: g.u, pesos: g.pesos, lineas: g.lineas }))
      .sort((x, y) => y.u - x.u)
  }, [tapFiltrado])

  const tapPorCli = useMemo<GrupoCli[]>(() => {
    const m = new Map<string, GrupoCli>()
    for (const l of tapFiltrado) {
      let g = m.get(l.cli)
      if (!g) m.set(l.cli, (g = { cli: l.cli, nom: l.cli_nom, remitos: [], vieja: l.fecha, u: 0, pesos: 0, lineas: [] }))
      if (!g.remitos.includes(l.remito)) g.remitos.push(l.remito)
      if (l.fecha < g.vieja) g.vieja = l.fecha
      g.u += l.u
      g.pesos += l.u * l.precio
      g.lineas.push(l)
    }
    return [...m.values()].sort((x, y) => y.pesos - x.pesos)
  }, [tapFiltrado])

  const tapTotales = useMemo(
    () => ({
      u: tapFiltrado.reduce((s, l) => s + l.u, 0),
      pesos: tapFiltrado.reduce((s, l) => s + l.u * l.precio, 0),
      remitos: new Set(tapFiltrado.map((l) => l.remito)).size,
      clientes: new Set(tapFiltrado.map((l) => l.cli)).size,
    }),
    [tapFiltrado],
  )

  const depTotales = useMemo(
    () => ({
      u: depFiltrado.reduce((s, g) => s + g.u, 0),
      tr: depFiltrado.reduce((s, g) => s + g.tr, 0),
      ceros: depFiltrado.reduce((s, g) => s + g.curva.filter(([, u]) => u === 0).length, 0),
    }),
    [depFiltrado],
  )

  /** Unidades por artículo en cada lugar (para el cruce del desplegable). */
  const depPorArt = useMemo(() => {
    const m = new Map<string, number>()
    ;(datos?.deposito ?? []).forEach((l) => m.set(l.a, (m.get(l.a) ?? 0) + l.u))
    return m
  }, [datos])
  const tapPorArtTotal = useMemo(() => {
    const m = new Map<string, number>()
    ;(datos?.tapera ?? []).forEach((l) => m.set(l.a, (m.get(l.a) ?? 0) + l.u))
    return m
  }, [datos])

  function cambiarSolapa(s: Solapa) {
    setSolapa(s)
    setAbierta(null)
    setBusqueda('')
  }

  async function exportar() {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    const hoy = new Date().toISOString().slice(0, 10)
    if (solapa === 'deposito') {
      const filas = depFiltrado.flatMap((g) =>
        g.curva.map(([t, u]) => ({
          Artículo: g.a,
          Descripción: desDe(g.a),
          Color: colorDe(g.c),
          Talle: t,
          Stock: u,
          Material: arts.get(g.a)?.mat_nom ?? '',
          Proveedor: arts.get(g.a)?.prov_nom ?? '',
        })),
      )
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas), 'Depósito')
      XLSX.writeFile(wb, `stock_deposito_${hoy}.xlsx`)
    } else {
      const filas = tapFiltrado.map((l) => ({
        Remito: l.remito,
        Fecha: l.fecha,
        Cliente: l.cli,
        Nombre: l.cli_nom,
        Artículo: l.a,
        Descripción: desDe(l.a),
        Color: colorDe(l.c),
        Talle: l.t,
        'Sin facturar': l.u,
        Precio: l.precio,
        Importe: l.u * l.precio,
        'Días': diasDesde(l.fecha),
      }))
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas), 'Tapera')
      XLSX.writeFile(wb, `stock_tapera_${hoy}.xlsx`)
    }
  }

  const btnChico =
    'btn-press inline-flex h-8 items-center gap-1 rounded-lg border border-line bg-surface2 px-2.5 text-xs font-medium text-ink transition hover:bg-line disabled:opacity-50'

  const tarjetas =
    solapa === 'deposito'
      ? [
          { titulo: 'Artículos', valor: numero(depFiltrado.length), pie: 'artículo + color', icono: Boxes, color: cSky },
          { titulo: 'Unidades', valor: numero(depTotales.u), pie: 'en el depósito', icono: Package, color: cEmerald },
          { titulo: 'En tránsito', valor: numero(depTotales.tr), pie: 'todavía sin recibir', icono: Truck, color: cViolet },
          { titulo: 'Talles en 0', valor: numero(depTotales.ceros), pie: 'dentro de las curvas', icono: Warehouse, color: cRose },
        ]
      : [
          { titulo: 'Remitos sin facturar', valor: numero(tapTotales.remitos), pie: 'con algo pendiente', icono: FileText, color: cSky },
          { titulo: 'Clientes', valor: numero(tapTotales.clientes), pie: 'con mercadería sin facturar', icono: Users, color: cViolet },
          { titulo: 'Unidades', valor: numero(tapTotales.u), pie: 'remitidas sin facturar', icono: Package, color: cEmerald },
          { titulo: 'A facturar', valor: pesos(tapTotales.pesos), pie: 'al precio del remito', icono: Wallet, color: cAmber },
        ]

  const chip = (t: string, u: number, rojo = false) => (
    <span
      key={t}
      className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums ${
        rojo ? 'bg-rose-500/15 text-rose-500' : 'bg-surface2 text-ink'
      }`}
    >
      {t}
      <b className="ml-1">{u}</b>
    </span>
  )

  const antiguedad = (fecha: string) => {
    const d = diasDesde(fecha)
    const cls =
      d > 30 ? 'bg-rose-500/15 text-rose-500' : d > 15 ? 'bg-amber-500/15 text-amber-500' : 'bg-emerald-500/15 text-emerald-500'
    return <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>{d} días</span>
  }

  const flecha = (abierto: boolean) => (
    <ChevronDown size={14} style={{ color: cViolet }} className={`shrink-0 transition ${abierto ? '' : '-rotate-90'}`} aria-hidden />
  )

  const th = 'px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-sub'
  const thR = `${th} text-right`

  return (
    <Layout>
      <BackButton />
      <header className="mb-4 mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink">
          <Boxes size={22} style={{ color: cSky }} aria-hidden /> Stock
        </h1>
        <span className="text-xs text-sub/70">
          {solapa === 'deposito' ? 'stock del depósito' : 'remitido a clientes sin facturar'} · DRAGONFISH_MITO
        </span>
        {datos?.calculado && (
          <span className="rounded-full border border-line bg-surface2 px-2 py-0.5 text-[11px] text-sub">
            {new Date(datos.calculado).toLocaleString('es-AR', { hour12: false })}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => void exportar()} disabled={!datos} className={btnChico} type="button">
            <Download size={13} aria-hidden /> Excel
          </button>
          <button onClick={() => void cargar(true)} disabled={cargando} className={btnChico} type="button">
            <RefreshCw size={13} className={cargando ? 'animate-spin' : ''} aria-hidden /> Actualizar
          </button>
        </div>
      </header>

      {/* Solapas */}
      <div className="mb-4 flex gap-1 rounded-xl border border-line bg-surface p-1 sm:inline-flex">
        {(
          [
            { id: 'deposito', texto: 'Depósito', icono: Warehouse, color: cSky },
            { id: 'tapera', texto: 'Tapera', icono: Truck, color: cAmber },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => cambiarSolapa(t.id)}
            className={`btn-press inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-medium transition sm:flex-none ${
              solapa === t.id ? 'bg-surface2 text-ink' : 'text-sub hover:text-ink'
            }`}
          >
            <t.icono size={15} style={{ color: solapa === t.id ? t.color : undefined }} aria-hidden />
            {t.texto}
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">
          {error}
        </p>
      )}

      {cargando && !datos && (
        <p className="flex items-center gap-2 rounded-xl border border-line bg-surface p-4 text-sm text-sub">
          <Loader2 size={16} className="animate-spin" aria-hidden /> Leyendo el stock de Dragon…
        </p>
      )}

      {datos && (
        <div className="space-y-4 pb-6">
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

          <div className="flex flex-wrap items-center gap-2">
            {solapa === 'tapera' && (
              <div className="flex gap-0.5 rounded-xl border border-line bg-surface p-0.5">
                {(
                  [
                    { id: 'art', texto: 'Por artículo' },
                    { id: 'cli', texto: 'Por cliente' },
                  ] as const
                ).map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => {
                      setVista(v.id)
                      setAbierta(null)
                    }}
                    className={`btn-press h-9 rounded-lg px-3 text-xs font-medium transition ${
                      vista === v.id ? 'bg-surface2 text-ink' : 'text-sub hover:text-ink'
                    }`}
                  >
                    {v.texto}
                  </button>
                ))}
              </div>
            )}
            <div className="relative min-w-[14rem] max-w-xs flex-1">
              <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub" />
              <input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder={solapa === 'deposito' ? 'Buscar código, descripción o color…' : 'Buscar artículo, cliente o N° de remito…'}
                className="h-10 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-sm text-ink placeholder:text-sub/60"
              />
            </div>
            {solapa === 'tapera' && (
              <MultiselectFiltro label="Cliente" opciones={opcionesCli} seleccionadas={cliSel} onChange={setCliSel} />
            )}
            <MultiselectFiltro label="Material" opciones={opcionesMat} seleccionadas={matSel} onChange={setMatSel} arrancaTodo />
            <MultiselectFiltro label="Proveedor" opciones={opcionesProv} seleccionadas={provSel} onChange={setProvSel} arrancaTodo />
            {(matSel.size > 0 || provSel.size > 0 || (solapa === 'tapera' && cliSel.size > 0)) && (
              <button
                type="button"
                className={btnChico}
                onClick={() => {
                  setMatSel(new Set())
                  setProvSel(new Set())
                  setCliSel(new Set())
                }}
              >
                Limpiar
              </button>
            )}
          </div>

          <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
            {solapa === 'deposito' && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line">
                    <th className={th}>Artículo</th>
                    <th className={th}>Descripción</th>
                    <th className={th}>Color</th>
                    <th className={th}>Curva</th>
                    <th className={thR}>Tránsito</th>
                    <th className={thR}>Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {depFiltrado.slice(0, TOPE).map((g) => {
                    const abierto = abierta === g.clave
                    const enTapera = tapPorArtTotal.get(g.a) ?? 0
                    return (
                      <Fragment key={g.clave}>
                        <tr
                          onClick={() => setAbierta(abierto ? null : g.clave)}
                          className={`cursor-pointer border-b border-line/60 transition hover:bg-surface2/40 ${abierto ? 'bg-surface2/40' : ''}`}
                        >
                          <td className="px-3 py-2">
                            <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
                              {flecha(abierto)} {g.a}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-sub">{desDe(g.a)}</td>
                          <td className="px-3 py-2 text-sub">{colorDe(g.c)}</td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-1">{g.curva.map(([t, u]) => chip(t, u, u === 0))}</div>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums" style={{ color: g.tr ? cViolet : undefined }}>
                            {g.tr ? numero(g.tr) : '—'}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold tabular-nums text-ink">{numero(g.u)}</td>
                        </tr>
                        {abierto && (
                          <tr className="border-b border-line/60">
                            <td colSpan={6} className="px-3 pb-3">
                              <div className="rounded-xl bg-surface2/50 p-3 text-xs">
                                <p className="mb-2 font-medium text-ink">
                                  Detalle por talle · {g.a} {colorDe(g.c)}
                                </p>
                                <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-10">
                                  {g.curva.map(([t, u]) => (
                                    <div key={t} className="rounded-lg border border-line bg-surface p-2 text-center">
                                      <p className="text-sub">{t}</p>
                                      <p className={`text-lg font-semibold tabular-nums ${u === 0 ? 'text-rose-500' : 'text-ink'}`}>{u}</p>
                                    </div>
                                  ))}
                                </div>
                                <p className="mt-2 text-sub">
                                  En Tapera (remitido sin facturar, todos los colores):{' '}
                                  <b style={{ color: cAmber }}>{enTapera ? `${numero(enTapera)} u.` : 'nada'}</b>
                                </p>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                  {depFiltrado.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-sub">
                        Sin artículos con ese filtro
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="border-t border-line font-semibold">
                    <td className="px-3 py-2 text-ink" colSpan={4}>
                      Total{depFiltrado.length > TOPE ? ` · se muestran ${TOPE} de ${numero(depFiltrado.length)} (el Excel lleva todos)` : ''}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums" style={{ color: cViolet }}>
                      {numero(depTotales.tr)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums" style={{ color: cEmerald }}>
                      {numero(depTotales.u)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}

            {solapa === 'tapera' && vista === 'art' && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line">
                    <th className={th}>Artículo</th>
                    <th className={th}>Descripción</th>
                    <th className={th}>Color</th>
                    <th className={th}>Curva remitida</th>
                    <th className={thR}>Clientes</th>
                    <th className={thR}>Sin facturar</th>
                  </tr>
                </thead>
                <tbody>
                  {tapPorArt.slice(0, TOPE).map((g) => {
                    const abierto = abierta === g.clave
                    const nCli = new Set(g.lineas.map((l) => l.cli)).size
                    return (
                      <Fragment key={g.clave}>
                        <tr
                          onClick={() => setAbierta(abierto ? null : g.clave)}
                          className={`cursor-pointer border-b border-line/60 transition hover:bg-surface2/40 ${abierto ? 'bg-surface2/40' : ''}`}
                        >
                          <td className="px-3 py-2">
                            <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
                              {flecha(abierto)} {g.a}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-sub">{desDe(g.a)}</td>
                          <td className="px-3 py-2 text-sub">{colorDe(g.c)}</td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-1">{g.curva.map(([t, u]) => chip(t, u))}</div>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums" style={{ color: cViolet }}>
                            {nCli}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold tabular-nums" style={{ color: cEmerald }}>
                            {numero(g.u)}
                          </td>
                        </tr>
                        {abierto && (
                          <tr className="border-b border-line/60">
                            <td colSpan={6} className="px-3 pb-3">
                              <div className="overflow-x-auto rounded-xl bg-surface2/50 p-3 text-xs">
                                <p className="mb-2 font-medium text-ink">
                                  A quién se remitió · {g.a} {colorDe(g.c)}
                                </p>
                                <table className="w-full">
                                  <thead className="text-[10px] uppercase text-sub">
                                    <tr>
                                      <th className="py-1 text-left">Remito</th>
                                      <th className="text-left">Fecha</th>
                                      <th className="text-left">Cliente</th>
                                      <th className="text-left">Talle</th>
                                      <th className="text-left">Antigüedad</th>
                                      <th className="text-right">Sin facturar</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {g.lineas.map((l, i) => (
                                      <tr key={i} className="border-t border-line/60">
                                        <td className="py-1.5 font-medium text-ink">R {l.remito}</td>
                                        <td className="text-sub">{fechaCorta(l.fecha)}</td>
                                        <td className="text-ink">
                                          {l.cli_nom} <span className="text-sub/70">{l.cli}</span>
                                        </td>
                                        <td className="text-ink">{l.t}</td>
                                        <td>{antiguedad(l.fecha)}</td>
                                        <td className="text-right font-semibold tabular-nums text-ink">{l.u}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                                <p className="mt-2 text-sub">
                                  En Depósito: <b style={{ color: cSky }}>{numero(depPorArt.get(g.a) ?? 0)} u.</b>
                                </p>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                  {tapPorArt.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-sub">
                        Nada remitido sin facturar con ese filtro
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="border-t border-line font-semibold">
                    <td className="px-3 py-2 text-ink" colSpan={5}>
                      Total
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums" style={{ color: cEmerald }}>
                      {numero(tapTotales.u)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}

            {solapa === 'tapera' && vista === 'cli' && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line">
                    <th className={th}>Cliente</th>
                    <th className={th}>Remitos</th>
                    <th className={th}>Más viejo</th>
                    <th className={thR}>Unidades</th>
                    <th className={thR}>A facturar</th>
                  </tr>
                </thead>
                <tbody>
                  {tapPorCli.map((c) => {
                    const abierto = abierta === c.cli
                    return (
                      <Fragment key={c.cli}>
                        <tr
                          onClick={() => setAbierta(abierto ? null : c.cli)}
                          className={`cursor-pointer border-b border-line/60 transition hover:bg-surface2/40 ${abierto ? 'bg-surface2/40' : ''}`}
                        >
                          <td className="px-3 py-2">
                            <span className="inline-flex items-center gap-1.5">
                              {flecha(abierto)}
                              <span className="font-semibold text-ink">{c.nom || c.cli}</span>
                              <span className="text-xs text-sub/70">{c.cli}</span>
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-1">
                              {c.remitos.map((r) => (
                                <span key={r} className="rounded-md bg-surface2 px-1.5 py-0.5 text-[11px] font-medium text-ink">
                                  R {r}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="px-3 py-2">{antiguedad(c.vieja)}</td>
                          <td className="px-3 py-2 text-right font-semibold tabular-nums" style={{ color: cEmerald }}>
                            {numero(c.u)}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold tabular-nums" style={{ color: cAmber }}>
                            {pesos(c.pesos)}
                          </td>
                        </tr>
                        {abierto && (
                          <tr className="border-b border-line/60">
                            <td colSpan={5} className="px-3 pb-3">
                              <div className="overflow-x-auto rounded-xl bg-surface2/50 p-3 text-xs">
                                <p className="mb-2 font-medium text-ink">Lo que tiene remitido sin facturar · {c.nom || c.cli}</p>
                                <table className="w-full">
                                  <thead className="text-[10px] uppercase text-sub">
                                    <tr>
                                      <th className="py-1 text-left">Remito</th>
                                      <th className="text-left">Fecha</th>
                                      <th className="text-left">Artículo</th>
                                      <th className="text-left">Color · Talle</th>
                                      <th className="text-right">Sin facturar</th>
                                      <th className="text-right">Importe</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {c.lineas.map((l, i) => (
                                      <tr key={i} className="border-t border-line/60">
                                        <td className="py-1.5 font-medium text-ink">R {l.remito}</td>
                                        <td className="text-sub">{fechaCorta(l.fecha)}</td>
                                        <td className="text-ink">
                                          <b>{l.a}</b> <span className="text-sub">{desDe(l.a)}</span>
                                        </td>
                                        <td className="text-sub">
                                          {colorDe(l.c)} · {l.t}
                                        </td>
                                        <td className="text-right font-semibold tabular-nums text-ink">{l.u}</td>
                                        <td className="text-right tabular-nums" style={{ color: cAmber }}>
                                          {pesos(l.u * l.precio)}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                  {tapPorCli.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-sub">
                        Nada remitido sin facturar con ese filtro
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="border-t border-line font-semibold">
                    <td className="px-3 py-2 text-ink" colSpan={3}>
                      Total
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums" style={{ color: cEmerald }}>
                      {numero(tapTotales.u)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums" style={{ color: cAmber }}>
                      {pesos(tapTotales.pesos)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>

          <p className="text-[11px] text-sub/70">
            {solapa === 'deposito'
              ? 'Depósito = stock de DRAGONFISH_MITO. Tocá una fila para ver el detalle por talle y cuánto de ese artículo está en Tapera. Talle en 0 = rojo.'
              : 'Tapera = mercadería remitida a clientes mayoristas que todavía no se facturó: remitos de venta de DRAGONFISH_MITO no anulados, menos lo que les descontaron las facturas y cancelaciones. Antigüedad: verde hasta 15 días, ámbar hasta 30, rojo más de 30.'}
          </p>
        </div>
      )}
    </Layout>
  )
}
