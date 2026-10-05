import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, MapPin, Search, Trash2, Download, RefreshCw, ChevronDown, Layers } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import ConfirmDialog from '@/components/ConfirmDialog'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import {
  cargarMapeo, compararUbicaciones, descripcionesDeArticulos, nombrePlanta, ordenPlanta, type Mapeo,
} from '@/lib/mapeo'
import { cargarStockArticulos, stockDe, type StockArticulos } from '@/lib/stockArticulos'

const SIN_UBICACION = 'Sin ubicación'
/** Grupo para lo que no sigue el formato PLANTA-LETRA+NIVEL (ej. sin ubicación) */
const OTRAS = 'OTRAS'

interface Nivel {
  ubicacion: string
  etiqueta: string // "A1"
  items: Mapeo[]
}
interface Pasillo {
  letra: string
  niveles: Nivel[]
  total: number
}
interface Planta {
  planta: string
  pasillos: Pasillo[]
  total: number
}

/** "PB-A10" -> { planta: 'PB', letra: 'A', nivel: 10 } */
function partes(u: string): { planta: string; letra: string; nivel: number } | null {
  const m = /^([A-Z0-9]+)-([A-Z])(\d+)$/.exec(u.trim().toUpperCase())
  return m ? { planta: m[1], letra: m[2], nivel: Number(m[3]) } : null
}

/** Stock al lado del código: unidades en verde, 0 en rojo, "—" si no hay dato */
function chipStock(v: number | null) {
  if (v === null) {
    return (
      <span
        className="shrink-0 rounded-md bg-surface2 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-sub"
        title="Sin dato de stock"
      >
        —
      </span>
    )
  }
  if (v <= 0) {
    return (
      <span
        className="shrink-0 rounded-md bg-brand-600/15 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-brand-400"
        title="Sin stock en MITO"
      >
        0
      </span>
    )
  }
  return (
    <span
      className="shrink-0 rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-emerald-400"
      title="Stock en MITO"
    >
      {v.toLocaleString('es-AR')}
    </span>
  )
}

/** Mapeo depósito · Orden mapeado: planta → pasillo (desplegables) → niveles en columnas */
export default function MapeoOrden() {
  const { can, isAdmin } = useAuth()
  /** Permiso para sacar artículos de su ubicación (lo da la RLS de la tabla) */
  const puedeBorrar = can('mayorista.mapeo.borrar')
  /** El botón de sacar a mano de la lista lo ve solo el admin */
  const veBorrar = isAdmin

  const [filas, setFilas] = useState<Mapeo[]>([])
  const [cargando, setCargando] = useState(true)
  const [busqueda, setBusqueda] = useState('')
  // Desplegables abiertos: plantas ("PB") y pasillos ("PB|A")
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set())
  const [borrar, setBorrar] = useState<Mapeo | null>(null)
  const [borrando, setBorrando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Descripción de cada código (maestro de artículos); llega después de la lista
  const [descripciones, setDescripciones] = useState<Map<string, string>>(new Map())
  const descDe = useCallback((codigo: string) => descripciones.get(codigo.toUpperCase()) ?? '', [descripciones])
  // Stock total de cada artículo (vista SQL); llega después de la lista
  const [stock, setStock] = useState<StockArticulos | null>(null)
  /** Aviso del stock: qué falló o qué vino cortado */
  const [stockAviso, setStockAviso] = useState<string | null>(null)
  /** Resultado de la limpieza automática de los que están en stock 0 */
  const [quitados, setQuitados] = useState<{ texto: string; ok: boolean } | null>(null)
  /** Mientras se borran los de stock 0 */
  const [limpiando, setLimpiando] = useState(false)
  /** Los que quedaron en 0 y no se pudieron quitar no se muestran;
   *  con la tilde se revelan (en la base siguen hasta que se borren). */
  const [verSinStock, setVerSinStock] = useState(false)

  /**
   * Borra de `mapeo_deposito` los artículos que están en stock 0 (de todas
   * sus ubicaciones). Solo lo que la vista marcó en 0: sin dato no se toca.
   */
  const quitarSinStock = useCallback(
    async (todas: Mapeo[], st: StockArticulos) => {
      if (!supabase) return
      const sinStock = todas.filter((f) => (stockDe(st, f.codigo) ?? 1) === 0)
      if (sinStock.length === 0) {
        setQuitados(null)
        return
      }
      if (!puedeBorrar) {
        setQuitados({
          texto: `${sinStock.length} ${sinStock.length === 1 ? 'artículo está' : 'artículos están'} en stock 0: no tenés permiso para quitarlos del mapeo, así que solo no se muestran.`,
          ok: false,
        })
        return
      }
      const codigos = [...new Set(sinStock.map((f) => f.codigo))]
      const TANDA = 150 // el filtro .in() va en la URL: de a tandas
      const borrados = new Set<string>()
      let fallo: string | null = null
      for (let i = 0; i < codigos.length; i += TANDA) {
        const lote = codigos.slice(i, i + TANDA)
        const { error: e } = await supabase.from('mapeo_deposito').delete().in('codigo', lote)
        if (e) {
          fallo = e.message
          break
        }
        for (const c of lote) borrados.add(c)
      }
      if (borrados.size > 0) {
        const n = sinStock.filter((f) => borrados.has(f.codigo)).length
        setFilas((prev) => prev.filter((m) => !borrados.has(m.codigo)))
        setQuitados({
          texto: `${n} ${n === 1 ? 'artículo sin stock (0) se quitó' : 'artículos sin stock (0) se quitaron'} del mapeo (de todas sus ubicaciones).`,
          ok: true,
        })
      }
      if (fallo) setError(`No se pudo quitar todo lo que está en stock 0: ${fallo}`)
    },
    [puedeBorrar],
  )

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    setStockAviso(null)
    setQuitados(null)
    setLimpiando(false)
    try {
      const todas = await cargarMapeo()
      setFilas(todas)
      // No frenan la carga: si fallan, se ven solo los códigos
      descripcionesDeArticulos(todas.map((f) => f.codigo))
        .then(setDescripciones)
        .catch(() => { /* sin descripciones */ })
      cargarStockArticulos()
        .then(async (st) => {
          setStock(st)
          if (!st.completo) {
            setStockAviso(
              st.limite
                ? `El stock vino cortado: se recibieron ${st.filas} de hasta ${st.limite.toLocaleString('es-AR')} filas. ` +
                  'Los artículos que muestran "—" no se pudieron verificar y NO se quitan del mapeo. ' +
                  'Revisá el tope de filas en Configuraciones > Conexión SQL.'
                : 'No se pudo confirmar el tope de filas del proxy SQL: ' +
                  'los artículos que muestran "—" no se pudieron verificar y NO se quitan del mapeo.',
            )
          }
          setLimpiando(true)
          try {
            await quitarSinStock(todas, st)
          } finally {
            setLimpiando(false)
          }
        })
        .catch((e) => {
          setStock(null)
          const m = e instanceof Error ? e.message : 'No se pudo cargar el stock.'
          setStockAviso(
            /vista no habilitada/i.test(m)
              ? 'No se pudo cargar el stock: habilitá vw_STOCK_ARTICULO_MITO en Configuraciones > Conexión SQL.'
              : `${m} Sin stock no se muestra nada ni se quita nada.`,
          )
        })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar el mapeo.')
    } finally {
      setCargando(false)
    }
  }, [quitarSinStock])

  useEffect(() => {
    void cargar()
  }, [cargar])

  /** Cuántos mapeados están en stock 0 ahora mismo (los que quedaron sin poder quitarse) */
  const cantSinStock = useMemo(
    () => (stock ? filas.filter((f) => (stockDe(stock, f.codigo) ?? 1) === 0).length : 0),
    [stock, filas],
  )

  /** Lo que se muestra: todo el mapeo, menos los de stock 0 (si no se pidió verlos) */
  const visibles = useMemo(() => {
    if (!stock || verSinStock) return filas
    return filas.filter((f) => (stockDe(stock, f.codigo) ?? 1) !== 0)
  }, [stock, verSinStock, filas])

  // Búsqueda: por ubicación deja la ubicación entera; por código o descripción, solo lo que coincide
  const q = busqueda.trim().toUpperCase()
  const filtradas = useMemo(() => {
    if (!q) return visibles
    return visibles.filter(
      (f) =>
        (f.ubicacion ?? SIN_UBICACION).toUpperCase().includes(q) ||
        f.codigo.toUpperCase().includes(q) ||
        descDe(f.codigo).toUpperCase().includes(q),
    )
  }, [visibles, q, descDe])

  // Árbol planta → pasillo → nivel, en el orden del depósito
  const plantas = useMemo<Planta[]>(() => {
    const porUbic = new Map<string, Mapeo[]>()
    for (const f of filtradas) {
      const u = f.ubicacion ?? SIN_UBICACION
      porUbic.set(u, [...(porUbic.get(u) ?? []), f])
    }
    const arbol = new Map<string, Map<string, Nivel[]>>()
    for (const [ubicacion, items] of porUbic) {
      const p = partes(ubicacion)
      const planta = p?.planta ?? OTRAS
      const letra = p?.letra ?? ''
      const pas = arbol.get(planta) ?? new Map<string, Nivel[]>()
      pas.set(letra, [
        ...(pas.get(letra) ?? []),
        {
          ubicacion,
          etiqueta: p ? `${p.letra}${p.nivel}` : ubicacion,
          items: [...items].sort((a, b) => a.codigo.localeCompare(b.codigo)),
        },
      ])
      arbol.set(planta, pas)
    }
    return [...arbol.entries()]
      .map(([planta, pas]) => {
        const pasillos = [...pas.entries()]
          .map(([letra, niveles]) => {
            const ordenados = niveles.sort((a, b) => compararUbicaciones(a.ubicacion, b.ubicacion))
            return { letra, niveles: ordenados, total: ordenados.reduce((s, n) => s + n.items.length, 0) }
          })
          .sort((a, b) => a.letra.localeCompare(b.letra))
        return { planta, pasillos, total: pasillos.reduce((s, x) => s + x.total, 0) }
      })
      .sort((a, b) =>
        a.planta === OTRAS ? 1 : b.planta === OTRAS ? -1 : ordenPlanta(a.planta) - ordenPlanta(b.planta) || a.planta.localeCompare(b.planta),
      )
  }, [filtradas])

  const cantUbicaciones = useMemo(
    () => new Set(visibles.map((f) => f.ubicacion ?? SIN_UBICACION)).size,
    [visibles],
  )

  function alternar(k: string) {
    setAbiertas((prev) => {
      const n = new Set(prev)
      if (n.has(k)) n.delete(k)
      else n.add(k)
      return n
    })
  }
  // Buscando, todo se abre solo para mostrar lo encontrado
  const estaAbierta = (k: string) => !!q || abiertas.has(k)

  async function confirmarBorrar() {
    if (!borrar || !supabase) return
    setBorrando(true)
    setError(null)
    const { error: e } = await supabase.from('mapeo_deposito').delete().eq('id', borrar.id)
    setBorrando(false)
    if (e) {
      setError(e.message)
    } else {
      const id = borrar.id
      setFilas((prev) => prev.filter((m) => m.id !== id))
    }
    setBorrar(null)
  }

  async function exportar() {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    const datos = [...visibles]
      .sort(
        (a, b) =>
          compararUbicaciones(a.ubicacion ?? SIN_UBICACION, b.ubicacion ?? SIN_UBICACION) || a.codigo.localeCompare(b.codigo),
      )
      .map((f) => {
        const p = partes(f.ubicacion ?? '')
        return {
          Planta: p?.planta ?? '',
          Pasillo: p?.letra ?? '',
          Nivel: p?.nivel ?? '',
          Ubicación: f.ubicacion ?? SIN_UBICACION,
          Artículo: f.codigo,
          Descripción: descDe(f.codigo),
          Stock: stockDe(stock, f.codigo) ?? '',
        }
      })
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(datos), 'Mapeo')
    XLSX.writeFile(wb, `mapeo_deposito_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  const chip = (n: number) => (
    <span className="shrink-0 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-amber-500">
      {n} {n === 1 ? 'código' : 'códigos'}
    </span>
  )

  return (
    <Layout>
      <BackButton />
      <header className="mb-3 mt-2">
        <h1 className="font-display text-2xl font-semibold text-ink">Orden mapeado</h1>
        <p className="text-sm text-sub">
          {cantUbicaciones} {cantUbicaciones === 1 ? 'ubicación' : 'ubicaciones'} · {visibles.length} códigos
          {cantSinStock > 0 && (
            <>
              {' · '}
              <span className="font-semibold text-brand-400">{cantSinStock} sin stock</span>
            </>
          )}
        </p>
      </header>
      <div className="space-y-3 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] flex-1">
            <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub" />
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar ubicación, código o descripción…"
              aria-label="Buscar"
              className="h-11 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-sm text-ink outline-none transition placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40"
            />
          </div>
          <button
            onClick={() => void cargar()}
            disabled={cargando}
            className="btn-press inline-flex h-11 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-sm font-medium text-ink transition hover:bg-surface2 disabled:opacity-60"
            title="Actualizar"
          >
            <RefreshCw size={16} aria-hidden className={cargando ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">Actualizar</span>
          </button>
          <button
            onClick={() => void exportar()}
            disabled={visibles.length === 0}
            className="btn-press inline-flex h-11 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-sm font-medium text-ink transition hover:bg-surface2 disabled:opacity-60"
          >
            <Download size={16} aria-hidden /> Excel
          </button>
          <label
            className="inline-flex h-11 cursor-pointer select-none items-center gap-2 rounded-xl border border-line bg-surface px-3 text-sm font-medium text-ink transition hover:bg-surface2"
            title="Al cargar se quitan del mapeo los que están en stock 0; acá se revelan los que quedaron (si no se pudieron quitar)"
          >
            <input
              type="checkbox"
              checked={verSinStock}
              onChange={(e) => setVerSinStock(e.target.checked)}
              className="h-4 w-4 accent-brand-600"
            />
            Ver sin stock
            {cantSinStock > 0 && (
              <span className="rounded-full bg-brand-600/15 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-brand-400">
                {cantSinStock}
              </span>
            )}
          </label>
        </div>

        {quitados ? (
          <p
            role="status"
            className={`rounded-xl border p-3 text-sm ${
              quitados.ok
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-500'
            }`}
          >
            {quitados.texto}
          </p>
        ) : limpiando ? (
          <p className="flex items-center gap-2 rounded-xl border border-line bg-surface2 p-3 text-sm text-sub">
            <Loader2 size={16} className="animate-spin" aria-hidden />
            Quitando del mapeo los artículos sin stock…
          </p>
        ) : (
          !verSinStock &&
          cantSinStock > 0 && (
            <p className="rounded-xl border border-line bg-surface2 p-3 text-sm text-sub">
              {cantSinStock} {cantSinStock === 1 ? 'artículo mapeado está' : 'artículos mapeados están'} en stock 0 y{' '}
              {cantSinStock === 1 ? 'no se muestra' : 'no se muestran'}. Tildá «Ver sin stock» para verlos.
            </p>
          )
        )}

        {error && (
          <p role="alert" className="rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>
        )}

        {stockAviso && (
          <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-500">{stockAviso}</p>
        )}

        {cargando && filas.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sub">
            <Loader2 size={18} className="animate-spin" aria-hidden /> Cargando mapeo…
          </div>
        ) : plantas.length === 0 ? (
          <p className="rounded-2xl border border-line bg-surface px-4 py-10 text-center text-sm text-sub">
            {busqueda
              ? 'No hay ubicaciones ni códigos que coincidan.'
              : !verSinStock && cantSinStock > 0
                ? 'Todo lo que está mapeado tiene stock 0: tildá «Ver sin stock» para verlo.'
                : 'Todavía no hay nada mapeado.'}
          </p>
        ) : (
          <div className="space-y-3">
            {plantas.map((pl) => {
              const abiertaPl = estaAbierta(pl.planta)
              return (
                <div key={pl.planta} className="overflow-hidden rounded-2xl border border-line bg-surface">
                  {/* Nivel 1: planta */}
                  <button
                    onClick={() => alternar(pl.planta)}
                    aria-expanded={abiertaPl}
                    className="flex min-h-[3.25rem] w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-surface2"
                  >
                    <Layers size={18} aria-hidden className="shrink-0 text-amber-500" />
                    <span className="flex-1 font-display text-base font-bold text-ink">
                      {pl.planta === OTRAS ? 'Otras ubicaciones' : pl.planta}
                      {pl.planta !== OTRAS && nombrePlanta(pl.planta) !== pl.planta && (
                        <span className="ml-2 text-sm font-medium text-sub">{nombrePlanta(pl.planta)}</span>
                      )}
                    </span>
                    {chip(pl.total)}
                    <ChevronDown size={18} aria-hidden className={`shrink-0 text-sub transition-transform ${abiertaPl ? 'rotate-180' : ''}`} />
                  </button>

                  {abiertaPl && (
                    <div className="divide-y divide-line/60 border-t border-line">
                      {pl.pasillos.map((pa) => {
                        const clave = `${pl.planta}|${pa.letra}`
                        const abiertoPa = estaAbierta(clave)
                        return (
                          <div key={clave}>
                            {/* Nivel 2: pasillo */}
                            <button
                              onClick={() => alternar(clave)}
                              aria-expanded={abiertoPa}
                              className="flex min-h-[2.75rem] w-full items-center gap-3 py-2 pl-8 pr-4 text-left transition hover:bg-surface2"
                            >
                              <MapPin size={15} aria-hidden className="shrink-0 text-amber-500" />
                              <span className="flex-1 font-display text-[15px] font-semibold text-ink">
                                {pa.letra ? `Pasillo ${pa.letra}` : 'Sin pasillo'}
                                <span className="ml-2 text-xs font-medium text-sub">
                                  {pa.niveles.length} {pa.niveles.length === 1 ? 'nivel' : 'niveles'}
                                </span>
                              </span>
                              {chip(pa.total)}
                              <ChevronDown size={17} aria-hidden className={`shrink-0 text-sub transition-transform ${abiertoPa ? 'rotate-180' : ''}`} />
                            </button>

                            {/* Nivel 3: cada nivel es una columna (A1, A2 …) */}
                            {abiertoPa && (
                              <div className="overflow-x-auto bg-surface2/50 px-3 py-3 sm:pl-8">
                                <div className="flex gap-3">
                                  {pa.niveles.map((nv) => (
                                    <div key={nv.ubicacion} className="flex w-56 shrink-0 flex-col overflow-hidden rounded-xl border border-line bg-surface">
                                      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2" title={nv.ubicacion}>
                                        <span className="font-display text-base font-bold text-ink">{nv.etiqueta}</span>
                                        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-amber-500">
                                          {nv.items.length}
                                        </span>
                                      </div>
                                      <ul className="divide-y divide-line/40">
                                        {nv.items.map((i) => (
                                          <li key={i.id} className="flex items-start gap-1.5 py-1.5 pl-3 pr-1.5">
                                            <span className="min-w-0 flex-1">
                                              <span className="flex items-center gap-1.5">
                                                <span className="truncate text-sm font-semibold text-ink">{i.codigo}</span>
                                                {chipStock(stockDe(stock, i.codigo))}
                                              </span>
                                              {descDe(i.codigo) && (
                                                <span className="block text-[11px] leading-tight text-sub">{descDe(i.codigo)}</span>
                                              )}
                                            </span>
                                            {veBorrar && (
                                              <button
                                                onClick={() => setBorrar(i)}
                                                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sub transition hover:bg-brand-600/10 hover:text-brand-400"
                                                title="Quitar de esta ubicación"
                                                aria-label={`Quitar ${i.codigo} de ${nv.ubicacion}`}
                                              >
                                                <Trash2 size={15} aria-hidden />
                                              </button>
                                            )}
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <ConfirmDialog
          open={!!borrar}
          title="¿Quitar de la ubicación?"
          message={borrar ? `${borrar.codigo} sale de ${borrar.ubicacion ?? SIN_UBICACION}.` : ''}
          confirmLabel="Quitar"
          busy={borrando}
          onCancel={() => setBorrar(null)}
          onConfirm={() => void confirmarBorrar()}
        />
      </div>
    </Layout>
  )
}
