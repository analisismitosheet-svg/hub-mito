import { useEffect, useMemo, useState } from 'react'
import { Loader2, Search } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import FotoArticulo from '@/components/FotoArticulo'
import FranquiciaPropuestas, { type ItemPropuesta } from '@/components/FranquiciaPropuestas'
import FranquiciasTabs from '@/components/FranquiciasTabs'
import { supabase } from '@/lib/supabase'
import { leerVista, leerVistaFiltrada } from '@/lib/sqlApi'
import { VISTA_ARTICULOS } from '@/lib/articulosConsulta'
import { cargarStockSku, claveSku } from '@/lib/stockSku'
import {
  cargarClientes,
  cargarMapaFranquicias,
  clientesConBase,
  destinoDe,
  type ClienteFranquicia,
  type MapaFranquicias,
} from '@/lib/franquicias'

/* ------------------------------------------------------------------ */
/*  Pedido de venta · Calzado por curva de talles                     */
/*  Stock y precio: vw_STOCK_SKU_MITO + vw_ARTICULOS_MITO.             */
/*  Se arma el pedido, se manda el link (/p/:token) y el cliente lo    */
/*  confirma: el mismo circuito que la reposición.                     */
/* ------------------------------------------------------------------ */

const VISTA_MATERIALES = 'DWH.dbo.vw_DIM_MATERIAL'

const TEMPORADAS: Record<string, string> = { '0': 'Sin temporada', '1': 'Verano', '2': 'Continuo', '3': 'Invierno', '4': 'Atemporal' }
const temporadaDe = (codigo: string) => TEMPORADAS[codigo] || (codigo ? `Temporada ${codigo}` : 'Sin temporada')

const fmt = (n: number) => new Intl.NumberFormat('es-AR').format(n)
const fmtPesos = (n: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)
const txt = (v: unknown) => String(v ?? '').trim()
const num = (v: unknown) => Number(v) || 0

/** '38/39' es talle doble (chanclas, slippers); '40' es simple. */
const esDoble = (talle: string) => talle.includes('/')
/** Ordena 38, 39, 40… y 38/39, 40/41… */
const valorTalle = (talle: string) => {
  const n = Number((talle.split('/')[0] ?? '').replace(',', '.'))
  return Number.isFinite(n) ? n : 9999
}

interface Modelo {
  key: string
  art: string
  color: string
  descrip: string
  grupo: string
  temporada: string
  talles: Map<string, number>
  stockTotal: number
  precio: number | null
}

export default function MayoristaFranquiciasCalzado() {
  const [mapa, setMapa] = useState<MapaFranquicias>({ bases: [], clientes: {} })
  const [clientes, setClientes] = useState<ClienteFranquicia[]>([])
  const [cargandoMapa, setCargandoMapa] = useState(true)
  const [clienteSel, setClienteSel] = useState('')

  const [modelos, setModelos] = useState<Modelo[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [precios, setPrecios] = useState<{ sku: Map<string, number>; art: Map<string, number> }>({ sku: new Map(), art: new Map() })
  const [cargandoPrecios, setCargandoPrecios] = useState(false)

  const [tab, setTab] = useState<'simple' | 'doble'>('simple')
  const [busca, setBusca] = useState('')
  const [grupo, setGrupo] = useState('')
  const [temporada, setTemporada] = useState('')
  /** art|color|talle -> pares pedidos */
  const [carrito, setCarrito] = useState<Record<string, number>>({})

  const disponibles = useMemo(() => clientesConBase(clientes, mapa), [clientes, mapa])
  const cliente = disponibles.find((c) => c.codigo === clienteSel) ?? disponibles[0] ?? null
  const franq = cliente ? destinoDe(cliente, mapa) : null

  useEffect(() => {
    let activo = true
    ;(async () => {
      try {
        const [m, cs] = await Promise.all([cargarMapaFranquicias(), cargarClientes()])
        if (!activo) return
        setMapa(m)
        setClientes(cs)
        const con = clientesConBase(cs, m)
        setClienteSel((prev) => (con.some((c) => c.codigo === prev) ? prev : con.find((c) => c.codigo === '01140')?.codigo ?? con[0]?.codigo ?? ''))
      } catch (e) {
        if (activo) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (activo) setCargandoMapa(false)
      }
    })()
    return () => { activo = false }
  }, [])

  useEffect(() => {
    let activo = true
    ;(async () => {
      try {
        const [stock, filasM] = await Promise.all([
          cargarStockSku(),
          leerVista(VISTA_MATERIALES).catch(() => []),
        ])
        if (!activo) return

        // Códigos de material que el DWH llama CALZADO (en el maestro son '1' y 'CALZADO')
        const codCalzado = new Set(
          filasM
            .filter((m) => txt(m.MATERIAL).toUpperCase() === 'CALZADO')
            .map((m) => txt(m.ID_MATERIAL).toUpperCase()),
        )
        if (codCalzado.size === 0) { codCalzado.add('1'); codCalzado.add('CALZADO') }

        // Artículos con stock > 0 (una sola pasada al maestro en Supabase)
        const arts = [...stock.porArticulo.entries()].filter(([, n]) => n > 0).map(([a]) => a)
        const info = new Map<string, { descripcion: string; grupo: string; temporada: string }>()
        for (let i = 0; supabase && i < arts.length; i += 300) {
          const { data } = await supabase
            .from('articulos')
            .select('id_art,descripcion,id_material,id_grupo,id_temporada')
            .in('id_art', arts.slice(i, i + 300))
          for (const a of (data as { id_art: string; descripcion: string | null; id_material: string | null; id_grupo: string | null; id_temporada: string | null }[] | null) ?? []) {
            if (!codCalzado.has(txt(a.id_material).toUpperCase())) continue
            info.set(txt(a.id_art).toUpperCase(), { descripcion: txt(a.descripcion), grupo: txt(a.id_grupo), temporada: temporadaDe(txt(a.id_temporada)) })
          }
        }
        if (!activo) return

        // Curva: un modelo por artículo + color, con el stock de cada talle
        const porModelo = new Map<string, Modelo>()
        for (const [k, n] of stock.porSku) {
          const [art, color, talle] = k.split('|')
          if (!art || !color || !talle || n <= 0) continue
          const a = info.get(art)
          if (!a) continue
          const key = `${art}|${color}`
          let m = porModelo.get(key)
          if (!m) {
            m = { key, art, color, descrip: a.descripcion, grupo: a.grupo, temporada: a.temporada, talles: new Map(), stockTotal: 0, precio: null }
            porModelo.set(key, m)
          }
          m.talles.set(talle, (m.talles.get(talle) ?? 0) + n)
          m.stockTotal += n
        }
        const lista = [...porModelo.values()].filter((m) => m.talles.size > 0)
        lista.sort((a, b) => b.stockTotal - a.stockTotal || a.art.localeCompare(b.art))
        if (!activo) return
        setModelos(lista)
      } catch (e) {
        if (activo) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (activo) setCargando(false)
      }
    })()
    return () => { activo = false }
  }, [])

  // Precio por artículo (vw_ARTICULOS_MITO, de a 6 consultas a la vez)
  const artsModelos = useMemo(
    () => [...new Set(modelos.map((m) => m.art))].sort().join(','),
    [modelos],
  )
  useEffect(() => {
    const faltan = artsModelos.split(',').filter((a) => a && !precios.art.has(a))
    if (!faltan.length) return
    let activo = true
    setCargandoPrecios(true)
    ;(async () => {
      const sku = new Map(precios.sku)
      const art = new Map(precios.art)
      const cola = [...faltan]
      async function trabajador() {
        for (let a = cola.shift(); a; a = cola.shift()) {
          try {
            const filas = await leerVistaFiltrada(VISTA_ARTICULOS, { donde: ['ID_ARTICULO'], valor: a, coincide: 'igual' })
            let max = 0
            for (const r of filas) {
              const p = num(r.PRECIO)
              if (p > 0) sku.set(claveSku(r.ID_ARTICULO, r.COLOR_CODIGO, r.TALLE_CODIGO), p)
              max = Math.max(max, p)
            }
            art.set(a, max)
          } catch {
            art.set(a, 0)
          }
        }
      }
      await Promise.all(Array.from({ length: 6 }, trabajador))
      if (!activo) return
      setPrecios({ sku, art })
      setCargandoPrecios(false)
    })()
    return () => { activo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artsModelos])

  const tallesTab = useMemo(() => {
    const set = new Set<string>()
    for (const m of modelos) for (const t of m.talles.keys()) if (esDoble(t) === (tab === 'doble')) set.add(t)
    return [...set].sort((a, b) => valorTalle(a) - valorTalle(b) || a.localeCompare(b))
  }, [modelos, tab])

  const grupos = useMemo(() => [...new Set(modelos.map((m) => m.grupo).filter(Boolean))].sort(), [modelos])
  const temporadas = useMemo(() => [...new Set(modelos.map((m) => m.temporada).filter(Boolean))].sort(), [modelos])

  const visibles = useMemo(() => {
    const q = busca.trim().toUpperCase()
    return modelos.filter((m) => {
      if (![...m.talles.keys()].some((t) => esDoble(t) === (tab === 'doble'))) return false
      if (grupo && m.grupo !== grupo) return false
      if (temporada && m.temporada !== temporada) return false
      if (!q) return true
      return `${m.art} ${m.descrip} ${m.color}`.toUpperCase().includes(q)
    })
  }, [modelos, tab, grupo, temporada, busca])

  const precioDe = (m: Modelo, talle: string) => precios.sku.get(claveSku(m.art, m.color, talle)) ?? precios.art.get(m.art) ?? 0

  const pedido = useMemo<ItemPropuesta[]>(() => {
    const out: ItemPropuesta[] = []
    for (const m of modelos) {
      for (const [talle, stock] of m.talles) {
        const cant = carrito[`${m.art}|${m.color}|${talle}`] ?? 0
        if (cant <= 0) continue
        out.push({
          art: m.art,
          descrip: m.descrip,
          material: 'CALZADO',
          color: m.color,
          talle,
          stockCli: 0,
          vendido: 0,
          stock,
          sugerido: Math.min(cant, stock),
          precio: precioDe(m, talle) || null,
        })
      }
    }
    return out
  }, [modelos, carrito, precios])

  const pares = pedido.reduce((s, i) => s + i.sugerido, 0)
  const importe = pedido.reduce((s, i) => s + i.sugerido * (i.precio ?? 0), 0)

  function cambiarCantidad(art: string, color: string, talle: string, stock: number, valor: string) {
    const n = Math.max(0, Math.min(stock, Math.floor(Number(valor) || 0)))
    setCarrito((c) => {
      const k = `${art}|${color}|${talle}`
      const next = { ...c }
      if (n > 0) next[k] = n
      else delete next[k]
      return next
    })
  }

  const th = 'whitespace-nowrap px-2 py-2 text-[10.5px] uppercase tracking-wide text-sub'

  return (
    <Layout>
      <div className="px-3 pt-3 md:px-4 md:pt-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <BackButton />
            <h1 className="font-display truncate text-lg font-semibold text-ink md:text-xl">Franquicias · Pedido de venta de calzado</h1>
          </div>
        </div>

        <FranquiciasTabs />

        <div id="frame" className="overflow-hidden rounded-2xl border border-line bg-paper p-3">
          <div className="mb-3 mt-1 flex min-w-0 flex-wrap items-center gap-3">
            <div className="min-w-0">
              <h2 className="font-display text-lg font-semibold text-ink">Pedido de venta · Calzado por curva de talles</h2>
              <p className="truncate text-sm text-sub">Stock real de MITO por talle · el cliente confirma por el link y se carga en Dragon</p>
            </div>
            <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-xs text-sub">
                Cliente
                <select
                  value={clienteSel}
                  onChange={(e) => setClienteSel(e.target.value)}
                  disabled={disponibles.length === 0}
                  className="max-w-[280px] rounded-full border border-line2 bg-surface px-2 py-1 text-xs text-ink disabled:opacity-50"
                >
                  {disponibles.length === 0 && <option value="">Sin clientes con base</option>}
                  {disponibles.map((c) => (
                    <option key={c.codigo} value={c.codigo}>{c.codigo} · {c.razonSocial}</option>
                  ))}
                </select>
              </label>
              {franq && (
                <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium text-amber-500" style={{ borderColor: 'rgba(217,119,6,.45)', background: 'rgba(217,119,6,.15)' }}>
                  {franq.nombre.toUpperCase()} · {franq.base}
                </span>
              )}
            </div>
          </div>

          {cargandoMapa && (
            <p className="mb-3 flex items-center gap-2 text-sm text-sub"><Loader2 size={14} className="animate-spin" aria-hidden /> Cargando clientes y bases…</p>
          )}
          {!cargandoMapa && !franq && (
            <p className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-400">
              No hay ningún cliente con base asignada. Asignala en <b>Clientes y bases</b> para poder armarle un pedido.
            </p>
          )}

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="flex rounded-full border border-line bg-surface p-1">
              <button
                type="button"
                onClick={() => setTab('simple')}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${tab === 'simple' ? 'bg-surface2 text-ink shadow-sm' : 'text-sub hover:text-ink'}`}
              >
                Zapatillas · talle simple
              </button>
              <button
                type="button"
                onClick={() => setTab('doble')}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${tab === 'doble' ? 'bg-surface2 text-ink shadow-sm' : 'text-sub hover:text-ink'}`}
              >
                Chanclas y slippers · talle doble
              </button>
            </div>
            <label className="flex min-w-[180px] flex-1 items-center gap-2 rounded-full border border-line2 bg-surface px-3 py-1.5 text-xs text-sub">
              <Search size={13} aria-hidden />
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Artículo, descripción o color"
                className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-sub"
              />
            </label>
            {grupos.length > 0 && (
              <select value={grupo} onChange={(e) => setGrupo(e.target.value)} className="rounded-full border border-line2 bg-surface px-3 py-1.5 text-xs text-ink">
                <option value="">Todos los grupos</option>
                {grupos.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            )}
            {temporadas.length > 1 && (
              <select value={temporada} onChange={(e) => setTemporada(e.target.value)} className="rounded-full border border-line2 bg-surface px-3 py-1.5 text-xs text-ink">
                <option value="">Todas las temporadas</option>
                {temporadas.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            )}
          </div>

          <div className="mb-3 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border border-line bg-surface px-3 py-1 text-sub">Modelos: <b className="text-ink">{fmt(visibles.length)}</b></span>
            <span className="rounded-full border border-line bg-surface px-3 py-1 text-sub">Pares pedidos: <b className="text-ink">{fmt(pares)}</b></span>
            <span className="rounded-full border border-line bg-surface px-3 py-1 text-sub">Importe: <b className="text-ink">{cargandoPrecios ? '…' : fmtPesos(importe)}</b></span>
            {pares > 0 && (
              <button type="button" onClick={() => setCarrito({})} className="rounded-full border border-line2 bg-surface px-3 py-1 font-semibold text-sub hover:text-ink">Limpiar pedido</button>
            )}
          </div>

          {error && (
            <p role="alert" className="mb-3 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">
              No se pudieron traer los datos: {error}
            </p>
          )}

          <div className="overflow-hidden rounded-xl border border-line">
            <div className="max-h-[620px] overflow-auto">
              <table className="w-full border-collapse text-[12.5px]">
                <thead className="sticky top-0 z-10 bg-surface">
                  <tr>
                    <th className={`text-left ${th}`}>Foto</th>
                    <th className={`text-left ${th}`}>Artículo</th>
                    <th className={`text-left ${th}`}>Descripción</th>
                    <th className={`text-center ${th}`}>Color</th>
                    <th className={`text-right ${th}`}>Precio</th>
                    <th className={`text-center ${th}`}>Stock</th>
                    {tallesTab.map((t) => <th key={t} className={`text-center ${th}`}>{t}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {cargando && (
                    <tr>
                      <td colSpan={6 + tallesTab.length} className="px-3 py-10 text-center text-sub">
                        <Loader2 size={16} className="mr-2 inline animate-spin" aria-hidden />
                        Trayendo el calzado con stock…
                      </td>
                    </tr>
                  )}
                  {!cargando && !error && visibles.length === 0 && (
                    <tr>
                      <td colSpan={6 + tallesTab.length} className="px-3 py-10 text-center text-sub">No hay calzado con stock para esa búsqueda.</td>
                    </tr>
                  )}
                  {visibles.map((m) => {
                    const precio = precios.art.get(m.art) ?? 0
                    return (
                      <tr key={m.key} className="border-t border-line/60 hover:bg-white/5">
                        <td className="px-2 py-1.5"><FotoArticulo codigo={m.art} nombre={m.descrip} size={40} /></td>
                        <td className="whitespace-nowrap px-2 py-2 font-medium text-ink">{m.art}</td>
                        <td className="px-2 py-2 text-sub">
                          {m.descrip || '—'}
                          {m.grupo && <span className="ml-1.5 rounded-full border border-line px-1.5 py-0.5 text-[10px] text-sub">{m.grupo}</span>}
                        </td>
                        <td className="px-2 py-2 text-center text-sub">{m.color || 'U'}</td>
                        <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums text-sub">{precio ? fmtPesos(precio) : cargandoPrecios ? '…' : '—'}</td>
                        <td className="px-2 py-2 text-center font-semibold tabular-nums text-ink">{fmt(m.stockTotal)}</td>
                        {tallesTab.map((t) => {
                          const stock = m.talles.get(t)
                          if (stock === undefined) return <td key={t} className="px-1 py-1 text-center text-sub">—</td>
                          const k = `${m.art}|${m.color}|${t}`
                          const cant = carrito[k] ?? 0
                          return (
                            <td key={t} className="px-1 py-1 text-center">
                              <input
                                type="number"
                                min={0}
                                max={stock}
                                value={cant || ''}
                                onChange={(e) => cambiarCantidad(m.art, m.color, t, stock, e.target.value)}
                                aria-label={`${m.art} ${m.color} talle ${t}`}
                                className={`w-12 rounded-md border px-1 py-0.5 text-center text-xs tabular-nums outline-none ${cant > 0 ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-400' : 'border-line2 bg-surface text-ink'}`}
                              />
                              <div className="text-[9.5px] tabular-nums text-sub">{fmt(stock)}</div>
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot className="bg-surface">
                  <tr className="text-[12px]">
                    <td colSpan={5 + tallesTab.length} className="px-3 py-2 font-semibold text-ink">{fmt(visibles.length)} modelos · {fmt(pares)} pares</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-sm font-bold tabular-nums text-emerald-500">{cargandoPrecios ? '…' : fmtPesos(importe)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-sub">
            Cada celda muestra arriba los pares a pedir y abajo el stock de MITO de ese talle. Solo aparecen modelos con stock.
          </p>
        </div>

        {franq && (
          <FranquiciaPropuestas
            franquicia={franq.id}
            nombre={franq.nombre}
            desde={null}
            hasta={null}
            tipo="calzado"
            cliente={{ id: franq.clienteId, nombre: franq.clienteNombre }}
            listo={!cargando && !cargandoPrecios && !error}
            items={pedido}
          />
        )}
      </div>
    </Layout>
  )
}
