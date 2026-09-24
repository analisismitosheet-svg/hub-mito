import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, MapPin, Search, X, Download, RefreshCw } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import ConfirmDialog from '@/components/ConfirmDialog'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { cargarMapeo, type Mapeo } from '@/lib/mapeo'

/** Mapeo depósito · Orden mapeado: cada artículo con su(s) ubicación(es) */
export default function MapeoOrden() {
  const { can } = useAuth()
  const puedeBorrar = can('mayorista.mapeo.borrar')

  const [filas, setFilas] = useState<Mapeo[]>([])
  const [cargando, setCargando] = useState(true)
  const [busqueda, setBusqueda] = useState('')
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

  const onRecargar = () => void cargar()

  // Un artículo por fila con todas sus ubicaciones, en el orden del recorrido
  // (el artículo aparece donde se escaneó por primera vez)
  const articulos = useMemo(() => {
    const m = new Map<string, { codigo: string; ubicaciones: Mapeo[] }>()
    for (const f of [...filas].sort((x, y) => x.orden - y.orden)) {
      const a = m.get(f.codigo) ?? { codigo: f.codigo, ubicaciones: [] }
      a.ubicaciones.push(f)
      m.set(f.codigo, a)
    }
    return [...m.values()]
  }, [filas])

  const visibles = useMemo(() => {
    const q = busqueda.trim().toUpperCase()
    if (!q) return articulos
    return articulos.filter(
      (a) => a.codigo.toUpperCase().includes(q) || a.ubicaciones.some((u) => (u.ubicacion ?? '').toUpperCase().includes(q)),
    )
  }, [articulos, busqueda])

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
    const datos = articulos.map((a) => ({
      Artículo: a.codigo,
      Ubicaciones: a.ubicaciones.map((u) => u.ubicacion ?? 'Sin ubicación').join(', '),
    }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(datos), 'Mapeo')
    XLSX.writeFile(wb, `mapeo_deposito_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  return (
    <Layout>
      <BackButton />
      <header className="mb-3 mt-2">
        <h1 className="font-display text-2xl font-semibold text-ink">Orden mapeado</h1>
        <p className="text-sm text-sub">{articulos.length} artículos mapeados.</p>
      </header>
      <div className="space-y-3 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] flex-1">
            <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub" />
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar artículo o ubicación…"
              aria-label="Buscar"
              className="h-11 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-sm text-ink outline-none transition placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40"
            />
          </div>
          <button
            onClick={onRecargar}
            disabled={cargando}
            className="btn-press inline-flex h-11 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-sm font-medium text-ink transition hover:bg-surface2 disabled:opacity-60"
            title="Actualizar"
          >
            <RefreshCw size={16} aria-hidden className={cargando ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">Actualizar</span>
          </button>
          <button
            onClick={() => void exportar()}
            disabled={articulos.length === 0}
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
            {busqueda ? 'No hay artículos que coincidan con la búsqueda.' : 'Todavía no hay nada mapeado.'}
          </p>
        ) : (
          <ul className="divide-y divide-line/60 overflow-hidden rounded-2xl border border-line bg-surface">
            {visibles.map((a) => (
              <li key={a.codigo} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5">
                <span className="min-w-[7rem] text-[15px] font-semibold text-ink">{a.codigo}</span>
                <span className="flex flex-1 flex-wrap items-center gap-1.5">
                  {a.ubicaciones.map((u) => (
                    <span
                      key={u.id}
                      className="inline-flex items-center gap-1 rounded-lg bg-amber-500/15 py-0.5 pl-2 pr-1 text-xs font-semibold text-amber-500"
                    >
                      <MapPin size={12} aria-hidden />
                      {u.ubicacion ?? 'Sin ubicación'}
                      {puedeBorrar ? (
                        <button
                          onClick={() => setBorrar(u)}
                          className="ml-0.5 flex h-6 w-6 items-center justify-center rounded-md text-amber-500/70 transition hover:bg-brand-600/15 hover:text-brand-400"
                          title="Quitar de esta ubicación"
                          aria-label={`Quitar ${a.codigo} de ${u.ubicacion ?? 'sin ubicación'}`}
                        >
                          <X size={13} aria-hidden />
                        </button>
                      ) : (
                        <span className="w-1" />
                      )}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        )}

        <ConfirmDialog
          open={!!borrar}
          title="¿Quitar de la ubicación?"
          message={borrar ? `${borrar.codigo} sale de ${borrar.ubicacion ?? 'sin ubicación'}.` : ''}
          confirmLabel="Quitar"
          busy={borrando}
          onCancel={() => setBorrar(null)}
          onConfirm={() => void confirmarBorrar()}
        />
      </div>
    </Layout>
  )
}
