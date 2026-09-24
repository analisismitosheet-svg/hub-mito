import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, MapPin, Search, Trash2, Download, RefreshCw, ChevronDown } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import ConfirmDialog from '@/components/ConfirmDialog'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { cargarMapeo, compararUbicaciones, type Mapeo } from '@/lib/mapeo'

const SIN_UBICACION = 'Sin ubicación'

/** Mapeo depósito · Orden mapeado: cada ubicación con sus códigos (desplegable) */
export default function MapeoOrden() {
  const { can } = useAuth()
  const puedeBorrar = can('mayorista.mapeo.borrar')

  const [filas, setFilas] = useState<Mapeo[]>([])
  const [cargando, setCargando] = useState(true)
  const [busqueda, setBusqueda] = useState('')
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set())
  const [borrar, setBorrar] = useState<Mapeo | null>(null)
  const [borrando, setBorrando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      setFilas(await cargarMapeo())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar el mapeo.')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  // Ubicaciones en el orden del depósito (PB-A1, PB-A2 …), cada una con sus códigos
  const ubicaciones = useMemo(() => {
    const m = new Map<string, Mapeo[]>()
    for (const f of filas) {
      const u = f.ubicacion ?? SIN_UBICACION
      m.set(u, [...(m.get(u) ?? []), f])
    }
    return [...m.entries()]
      .map(([ubicacion, items]) => ({
        ubicacion,
        items: items.sort((a, b) => a.codigo.localeCompare(b.codigo)),
      }))
      .sort((a, b) =>
        a.ubicacion === SIN_UBICACION ? 1 : b.ubicacion === SIN_UBICACION ? -1 : compararUbicaciones(a.ubicacion, b.ubicacion),
      )
  }, [filas])

  // Búsqueda: por ubicación muestra la ubicación entera; por código, solo los códigos que coinciden
  const q = busqueda.trim().toUpperCase()
  const visibles = useMemo(() => {
    if (!q) return ubicaciones
    return ubicaciones
      .map((u) =>
        u.ubicacion.toUpperCase().includes(q) ? u : { ...u, items: u.items.filter((i) => i.codigo.toUpperCase().includes(q)) },
      )
      .filter((u) => u.items.length > 0)
  }, [ubicaciones, q])

  function alternar(u: string) {
    setAbiertas((prev) => {
      const n = new Set(prev)
      if (n.has(u)) n.delete(u)
      else n.add(u)
      return n
    })
  }

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
    const datos = ubicaciones.flatMap((u) => u.items.map((i) => ({ Ubicación: u.ubicacion, Artículo: i.codigo })))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(datos), 'Mapeo')
    XLSX.writeFile(wb, `mapeo_deposito_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  return (
    <Layout>
      <BackButton />
      <header className="mb-3 mt-2">
        <h1 className="font-display text-2xl font-semibold text-ink">Orden mapeado</h1>
        <p className="text-sm text-sub">
          {ubicaciones.length} {ubicaciones.length === 1 ? 'ubicación' : 'ubicaciones'} · {filas.length} códigos
        </p>
      </header>
      <div className="space-y-3 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] flex-1">
            <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub" />
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar ubicación o código…"
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

        {cargando && filas.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sub">
            <Loader2 size={18} className="animate-spin" aria-hidden /> Cargando mapeo…
          </div>
        ) : visibles.length === 0 ? (
          <p className="rounded-2xl border border-line bg-surface px-4 py-10 text-center text-sm text-sub">
            {busqueda ? 'No hay ubicaciones ni códigos que coincidan.' : 'Todavía no hay nada mapeado.'}
          </p>
        ) : (
          <ul className="divide-y divide-line/60 overflow-hidden rounded-2xl border border-line bg-surface">
            {visibles.map((u) => {
              // Buscando, se abren solas para mostrar lo encontrado
              const abierta = !!q || abiertas.has(u.ubicacion)
              return (
                <li key={u.ubicacion}>
                  <button
                    onClick={() => alternar(u.ubicacion)}
                    aria-expanded={abierta}
                    className="flex min-h-[3rem] w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-surface2"
                  >
                    <MapPin size={16} aria-hidden className="shrink-0 text-amber-500" />
                    <span className="flex-1 font-display text-[15px] font-semibold text-ink">{u.ubicacion}</span>
                    <span className="shrink-0 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-amber-500">
                      {u.items.length} {u.items.length === 1 ? 'código' : 'códigos'}
                    </span>
                    <ChevronDown
                      size={18}
                      aria-hidden
                      className={`shrink-0 text-sub transition-transform ${abierta ? 'rotate-180' : ''}`}
                    />
                  </button>
                  {abierta && (
                    <ul className="divide-y divide-line/40 border-t border-line/60 bg-surface2/50">
                      {u.items.map((i) => (
                        <li key={i.id} className="flex min-h-[2.75rem] items-center gap-3 py-1.5 pl-11 pr-3">
                          <span className="flex-1 text-sm font-semibold text-ink">{i.codigo}</span>
                          {puedeBorrar && (
                            <button
                              onClick={() => setBorrar(i)}
                              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sub transition hover:bg-brand-600/10 hover:text-brand-400"
                              title="Quitar de esta ubicación"
                              aria-label={`Quitar ${i.codigo} de ${u.ubicacion}`}
                            >
                              <Trash2 size={16} aria-hidden />
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
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
