import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, MapPin, Search, Trash2, Download, RefreshCw, ChevronDown, Layers, PackageX } from 'lucide-react'
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

interface ItemSinStock {
  id: string | number
  codigo: string
  /** Dónde estaba mapeado: "Caja 12", "PB-A3"… */
  lugar: string
}

/**
 * Sección «Sin stock» de Mayorista > Orden mapeado (propia de esta pantalla).
 *
 * Los artículos que llegan a stock 0 (MITO) salen de su posición y se listan acá
 * con el lugar donde estaban. NO se borran del mapeo: si el stock vuelve, el
 * artículo vuelve solo a su lugar. Quitar del todo sigue siendo a mano (tacho).
 */
function SeccionSinStock({
  items,
  descDe,
  abiertaForzada,
  onQuitar,
}: {
  items: ItemSinStock[]
  descDe: (codigo: string) => string
  /** Buscando, se abre sola para mostrar lo encontrado */
  abiertaForzada?: boolean
  /** Si viene, se muestra el tacho para quitarlo del mapeo */
  onQuitar?: (item: ItemSinStock) => void
}) {
  const [abierta, setAbierta] = useState(false)
  if (items.length === 0) return null
  const ver = abierta || !!abiertaForzada
  const ordenados = [...items].sort((a, b) => a.codigo.localeCompare(b.codigo) || a.lugar.localeCompare(b.lugar))

  return (
    <div className="overflow-hidden rounded-2xl border border-brand-600/30 bg-surface">
      <button
        onClick={() => setAbierta((v) => !v)}
        aria-expanded={ver}
        className="flex min-h-[3.25rem] w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-surface2"
      >
        <PackageX size={18} aria-hidden className="shrink-0 text-brand-400" />
        <span className="flex-1 font-display text-base font-bold text-ink">
          Sin stock
          <span className="ml-2 text-sm font-medium text-sub">quedaron en 0 y salieron de su posición</span>
        </span>
        <span className="shrink-0 rounded-full bg-brand-600/15 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-brand-400">
          {items.length} {items.length === 1 ? 'código' : 'códigos'}
        </span>
        <ChevronDown size={18} aria-hidden className={`shrink-0 text-sub transition-transform ${ver ? 'rotate-180' : ''}`} />
      </button>
      {ver && (
        <ul className="divide-y divide-line/40 border-t border-line">
          {ordenados.map((i) => (
            <li key={i.id} className="flex items-start gap-2 py-2 pl-4 pr-2">
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-sm font-semibold text-ink">{i.codigo}</span>
                  <span className="shrink-0 rounded-md bg-brand-600/15 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-brand-400">0</span>
                  <span className="shrink-0 rounded-md bg-surface2 px-1.5 py-0.5 text-[11px] font-medium text-sub">estaba en {i.lugar}</span>
                </span>
                {descDe(i.codigo) && <span className="block text-[11px] leading-tight text-sub">{descDe(i.codigo)}</span>}
              </span>
              {onQuitar && (
                <button
                  onClick={() => onQuitar(i)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sub transition hover:bg-brand-600/10 hover:text-brand-400"
                  title="Quitar del mapeo"
                  aria-label={`Quitar ${i.codigo} del mapeo`}
                >
                  <Trash2 size={15} aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Mapeo depósito · Orden mapeado: planta → pasillo (desplegables) → niveles en columnas */
export default function MapeoOrden() {
  const { isAdmin, can } = useAuth()
  /** El botón de sacar a mano de la lista: admin o quien tenga el permiso de borrar del mapeo
   *  (hoy dado de forma individual, no por rol; la RLS de mapeo_deposito pide lo mismo) */
  const veBorrar = isAdmin || can('mayorista.mapeo.borrar')

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
  // Los de stock 0 salen de su posición y pasan a la sección «Sin stock».
  // NO se borran del mapeo (si el stock viene mal, borrarlos hacía perder
  // artículos que sí están en el estante): si el stock vuelve, vuelven solos
  // a su lugar. Quitar del mapeo es siempre a mano.

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    setStockAviso(null)
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
                  'Los artículos que muestran "—" no se pudieron verificar. ' +
                  'Revisá el tope de filas en Configuraciones > Conexión SQL.'
                : 'No se pudo confirmar el tope de filas del proxy SQL: ' +
                  'los artículos que muestran "—" no se pudieron verificar.',
            )
          }
        })
        .catch((e) => {
          setStock(null)
          const m = e instanceof Error ? e.message : 'No se pudo cargar el stock.'
          setStockAviso(
            /vista no habilitada/i.test(m)
              ? 'No se pudo cargar el stock: habilitá vw_STOCK_ARTICULO_MITO en Configuraciones > Conexión SQL.'
              : `${m} Sin stock se muestra todo el mapeo.`,
          )
        })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar el mapeo.')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  /** Mapeados en stock 0 ahora mismo: van a la sección «Sin stock» (no se borran) */
  const sinStock = useMemo(
    () => (stock ? filas.filter((f) => (stockDe(stock, f.codigo) ?? 1) === 0) : []),
    [stock, filas],
  )
  const cantSinStock = sinStock.length

  /** Lo que va en las posiciones: todo el mapeo menos los de stock 0 */
  const visibles = useMemo(() => {
    if (!stock) return filas
    return filas.filter((f) => (stockDe(stock, f.codigo) ?? 1) !== 0)
  }, [stock, filas])

  // Búsqueda: por ubicación deja la ubicación entera; por código o descripción, solo lo que coincide
  const q = busqueda.trim().toUpperCase()
  const coincide = useCallback(
    (f: Mapeo) =>
      !q ||
      (f.ubicacion ?? SIN_UBICACION).toUpperCase().includes(q) ||
      f.codigo.toUpperCase().includes(q) ||
      descDe(f.codigo).toUpperCase().includes(q),
    [q, descDe],
  )
  const filtradas = useMemo(() => visibles.filter(coincide), [visibles, coincide])
  const sinStockFiltrados = useMemo(() => sinStock.filter(coincide), [sinStock, coincide])

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
    if (sinStock.length > 0) {
      const ceros = [...sinStock]
        .sort((a, b) => a.codigo.localeCompare(b.codigo))
        .map((f) => ({ Artículo: f.codigo, Descripción: descDe(f.codigo), 'Estaba en': f.ubicacion ?? SIN_UBICACION }))
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ceros), 'Sin stock')
    }
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
            disabled={filas.length === 0}
            className="btn-press inline-flex h-11 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-sm font-medium text-ink transition hover:bg-surface2 disabled:opacity-60"
          >
            <Download size={16} aria-hidden /> Excel
          </button>
        </div>

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
              ? sinStockFiltrados.length > 0
                ? 'En las posiciones no hay nada que coincida: mirá la sección «Sin stock».'
                : 'No hay ubicaciones ni códigos que coincidan.'
              : cantSinStock > 0
                ? 'Todo lo mapeado quedó sin stock: está en la sección «Sin stock».'
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

        <SeccionSinStock
          items={sinStockFiltrados.map((f) => ({ id: f.id, codigo: f.codigo, lugar: f.ubicacion ?? SIN_UBICACION }))}
          descDe={descDe}
          abiertaForzada={!!q}
          onQuitar={veBorrar ? (it) => setBorrar(sinStock.find((f) => f.id === it.id) ?? null) : undefined}
        />

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
