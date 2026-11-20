import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Package, Search, Trash2, Download, RefreshCw, ChevronDown } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import ConfirmDialog from '@/components/ConfirmDialog'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { descripcionesDeArticulos } from '@/lib/mapeo'
import { cargarCajasLlenas, cargarMapeoCajas, marcarCajaLlena, tramoDe, type MapeoCaja } from '@/lib/mapeoCajas'
import { cargarStockArticulos, stockDe, VISTA_STOCK_ARTICULO_INDOD, type StockArticulos } from '@/lib/stockArticulos'

interface Caja {
  caja: number
  items: MapeoCaja[]
}
interface Tramo {
  clave: string
  desde: number
  hasta: number
  cajas: Caja[]
  total: number
}

/** Stock al lado del código: unidades en verde, 0 en rojo, "—" si no hay dato */
function chipStock(v: number | null) {
  if (v === null) {
    return (
      <span className="shrink-0 rounded-md bg-surface2 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-sub" title="Sin dato de stock">
        —
      </span>
    )
  }
  if (v <= 0) {
    return (
      <span className="shrink-0 rounded-md bg-brand-600/15 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-brand-400" title="Sin stock en INDOD">
        0
      </span>
    )
  }
  return (
    <span className="shrink-0 rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-emerald-400" title="Stock en INDOD">
      {v.toLocaleString('es-AR')}
    </span>
  )
}

/** Mapeo de cajas · Cajas mapeadas: tramos de 50 (desplegables) → las cajas una debajo de la otra */
export default function MapeoCajasOrden() {
  const { isAdmin, can } = useAuth()
  const veBorrar = isAdmin || can('deposito.cajas.borrar')
  const puedeMarcar = isAdmin || can('deposito.cajas.escanear')
  const [llenas, setLlenas] = useState<Set<number>>(new Set())
  const [marcando, setMarcando] = useState<number | null>(null)

  const [filas, setFilas] = useState<MapeoCaja[]>([])
  const [cargando, setCargando] = useState(true)
  const [busqueda, setBusqueda] = useState('')
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set())
  const [borrar, setBorrar] = useState<MapeoCaja | null>(null)
  const [borrando, setBorrando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [descripciones, setDescripciones] = useState<Map<string, string>>(new Map())
  const descDe = useCallback((codigo: string) => descripciones.get(codigo.toUpperCase()) ?? '', [descripciones])
  const [stock, setStock] = useState<StockArticulos | null>(null)
  const [stockAviso, setStockAviso] = useState<string | null>(null)
  /** Los de stock 0 no se muestran (siguen en el mapeo); con la tilde se revelan */
  const [verSinStock, setVerSinStock] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    setStockAviso(null)
    try {
      const todas = await cargarMapeoCajas()
      setFilas(todas)
      cargarCajasLlenas().then(setLlenas).catch(() => { /* sin tilde de llenas */ })
      // No frenan la carga: si fallan, se ven solo los códigos
      descripcionesDeArticulos(todas.map((f) => f.codigo))
        .then(setDescripciones)
        .catch(() => { /* sin descripciones */ })
      cargarStockArticulos(VISTA_STOCK_ARTICULO_INDOD)
        .then((st) => {
          setStock(st)
          if (!st.completo) {
            setStockAviso('El stock vino cortado: los artículos que muestran "—" no se pudieron verificar.')
          }
        })
        .catch((e) => {
          setStock(null)
          const m = e instanceof Error ? e.message : 'No se pudo cargar el stock.'
          setStockAviso(`${m} Sin stock se muestra todo el mapeo.`)
        })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar el mapeo de cajas.')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const cantSinStock = useMemo(
    () => (stock ? filas.filter((f) => (stockDe(stock, f.codigo) ?? 1) === 0).length : 0),
    [stock, filas],
  )

  const visibles = useMemo(() => {
    if (!stock || verSinStock) return filas
    return filas.filter((f) => (stockDe(stock, f.codigo) ?? 1) !== 0)
  }, [stock, verSinStock, filas])

  // Búsqueda: un número busca la caja exacta (la muestra entera); si no, por código o descripción
  const q = busqueda.trim().toUpperCase()
  const qCaja = /^\d+$/.test(q) ? Number(q) : null
  const filtradas = useMemo(() => {
    if (!q) return visibles
    return visibles.filter(
      (f) =>
        f.caja === qCaja ||
        f.codigo.toUpperCase().includes(q) ||
        descDe(f.codigo).toUpperCase().includes(q),
    )
  }, [visibles, q, qCaja, descDe])

  // Tramo (1–50, 51–100 …) → caja, de menor a mayor
  const tramos = useMemo<Tramo[]>(() => {
    const porCaja = new Map<number, MapeoCaja[]>()
    for (const f of filtradas) porCaja.set(f.caja, [...(porCaja.get(f.caja) ?? []), f])
    const porTramo = new Map<string, Tramo>()
    for (const [caja, items] of [...porCaja.entries()].sort((a, b) => a[0] - b[0])) {
      const { desde, hasta } = tramoDe(caja)
      const clave = `${desde}`
      const t = porTramo.get(clave) ?? { clave, desde, hasta, cajas: [], total: 0 }
      t.cajas.push({ caja, items: [...items].sort((a, b) => a.codigo.localeCompare(b.codigo)) })
      t.total += items.length
      porTramo.set(clave, t)
    }
    return [...porTramo.values()].sort((a, b) => a.desde - b.desde)
  }, [filtradas])

  const cantCajas = useMemo(() => new Set(visibles.map((f) => f.caja)).size, [visibles])

  function alternar(k: string) {
    setAbiertos((prev) => {
      const n = new Set(prev)
      if (n.has(k)) n.delete(k)
      else n.add(k)
      return n
    })
  }
  // Buscando, todo se abre solo para mostrar lo encontrado
  const estaAbierto = (k: string) => !!q || abiertos.has(k)

  async function alternarLlena(caja: number) {
    const nueva = !llenas.has(caja)
    setMarcando(caja)
    setError(null)
    try {
      await marcarCajaLlena(caja, nueva)
      setLlenas((prev) => {
        const s = new Set(prev)
        if (nueva) s.add(caja)
        else s.delete(caja)
        return s
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo marcar la caja.')
    } finally {
      setMarcando(null)
    }
  }

  async function confirmarBorrar() {
    if (!borrar || !supabase) return
    setBorrando(true)
    setError(null)
    const { error: e } = await supabase.from('mapeo_cajas').delete().eq('id', borrar.id)
    setBorrando(false)
    if (e) setError(e.message)
    else {
      const id = borrar.id
      setFilas((prev) => prev.filter((m) => m.id !== id))
    }
    setBorrar(null)
  }

  async function exportar() {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    const datos = [...visibles]
      .sort((a, b) => a.caja - b.caja || a.codigo.localeCompare(b.codigo))
      .map((f) => ({
        Caja: f.caja,
        Llena: llenas.has(f.caja) ? 'Sí' : '',
        Artículo: f.codigo,
        Descripción: descDe(f.codigo),
        Stock: stockDe(stock, f.codigo) ?? '',
      }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(datos), 'Cajas')
    XLSX.writeFile(wb, `mapeo_cajas_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  const chip = (n: number) => (
    <span className="shrink-0 rounded-full bg-orange-500/15 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-orange-500">
      {n} {n === 1 ? 'código' : 'códigos'}
    </span>
  )

  return (
    <Layout>
      <BackButton />
      <header className="mb-3 mt-2">
        <h1 className="font-display text-2xl font-semibold text-ink">Cajas mapeadas</h1>
        <p className="text-sm text-sub">
          {cantCajas} {cantCajas === 1 ? 'caja' : 'cajas'} · {visibles.length} códigos
          {llenas.size > 0 && <> · {llenas.size} {llenas.size === 1 ? 'llena' : 'llenas'}</>}
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
              placeholder="Buscar N° de caja, código o descripción…"
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
            title="Los que están en stock 0 no se muestran (no se borran): acá se revelan"
          >
            <input type="checkbox" checked={verSinStock} onChange={(e) => setVerSinStock(e.target.checked)} className="h-4 w-4 accent-brand-600" />
            Ver sin stock
            {cantSinStock > 0 && (
              <span className="rounded-full bg-brand-600/15 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-brand-400">{cantSinStock}</span>
            )}
          </label>
        </div>

        {error && (
          <p role="alert" className="rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>
        )}
        {stockAviso && (
          <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-500">{stockAviso}</p>
        )}

        {cargando && filas.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sub">
            <Loader2 size={18} className="animate-spin" aria-hidden /> Cargando cajas…
          </div>
        ) : tramos.length === 0 ? (
          <p className="rounded-2xl border border-line bg-surface px-4 py-10 text-center text-sm text-sub">
            {busqueda
              ? 'No hay cajas ni códigos que coincidan.'
              : !verSinStock && cantSinStock > 0
                ? 'Todo lo mapeado tiene stock 0: tildá «Ver sin stock» para verlo.'
                : 'Todavía no hay ninguna caja mapeada.'}
          </p>
        ) : (
          <div className="space-y-3">
            {tramos.map((t) => {
              const abierto = estaAbierto(t.clave)
              return (
                <div key={t.clave} className="overflow-hidden rounded-2xl border border-line bg-surface">
                  <button
                    onClick={() => alternar(t.clave)}
                    aria-expanded={abierto}
                    className="flex min-h-[3.25rem] w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-surface2"
                  >
                    <Package size={18} aria-hidden className="shrink-0 text-orange-500" />
                    <span className="flex-1 font-display text-base font-bold tabular-nums text-ink">
                      Cajas {t.desde}–{t.hasta}
                      <span className="ml-2 text-sm font-medium text-sub">
                        {t.cajas.length} {t.cajas.length === 1 ? 'caja' : 'cajas'}
                      </span>
                    </span>
                    {chip(t.total)}
                    <ChevronDown size={18} aria-hidden className={`shrink-0 text-sub transition-transform ${abierto ? 'rotate-180' : ''}`} />
                  </button>

                  {abierto && (
                    <div className="border-t border-line bg-surface2/50 px-3 py-3">
                      <div className="flex flex-col gap-3">
                        {t.cajas.map((c) => (
                          <div key={c.caja} className="flex w-full flex-col overflow-hidden rounded-xl border border-line bg-surface">
                            <div className={`border-b border-line px-3 py-2 ${llenas.has(c.caja) ? 'bg-brand-600/10' : ''}`}>
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-display text-base font-bold tabular-nums text-ink">Caja {c.caja}</span>
                                <span className="rounded-full bg-orange-500/15 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-orange-500">
                                  {c.items.length}
                                </span>
                              </div>
                              {puedeMarcar ? (
                                <label className={`mt-1 flex cursor-pointer select-none items-center gap-1.5 text-xs font-semibold ${llenas.has(c.caja) ? 'text-brand-400' : 'text-sub'}`}>
                                  {marcando === c.caja ? (
                                    <Loader2 size={14} className="animate-spin" aria-hidden />
                                  ) : (
                                    <input
                                      type="checkbox"
                                      checked={llenas.has(c.caja)}
                                      onChange={() => void alternarLlena(c.caja)}
                                      className="h-4 w-4 accent-red-600"
                                    />
                                  )}
                                  Caja llena
                                </label>
                              ) : (
                                llenas.has(c.caja) && <p className="mt-1 text-xs font-bold text-brand-400">LLENA</p>
                              )}
                            </div>
                            <ul className="divide-y divide-line/40">
                              {c.items.map((i) => (
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
                                      title="Quitar de esta caja"
                                      aria-label={`Quitar ${i.codigo} de la caja ${c.caja}`}
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

        <ConfirmDialog
          open={!!borrar}
          title={borrar ? `¿Estás seguro de quitar ${borrar.codigo} de la caja ${borrar.caja}?` : ''}
          message="Deja de figurar en esa caja. Para volver a ponerlo hay que escanearlo de nuevo."
          confirmarCon="Sí, estoy seguro"
          confirmLabel="Quitar"
          busy={borrando}
          onCancel={() => setBorrar(null)}
          onConfirm={() => void confirmarBorrar()}
        />
      </div>
    </Layout>
  )
}
