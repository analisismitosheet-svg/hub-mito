import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, MapPin, Search, Trash2, Download, RefreshCw } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import ConfirmDialog from '@/components/ConfirmDialog'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { ChipsArticulo as Etiquetas, cargarMapeo, type Mapeo } from '@/lib/mapeo'

/** Mapeo depósito · Orden mapeado: el recorrido completo, agrupado por ubicación */
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

  // Posición = lugar en el recorrido (1..n), sin huecos aunque se borre algo
  const ordenadas = useMemo(
    () => [...filas].sort((a, b) => a.orden - b.orden).map((m, i) => ({ ...m, pos: i + 1 })),
    [filas],
  )

  const visibles = useMemo(() => {
    const q = busqueda.trim().toUpperCase()
    if (!q) return ordenadas
    return ordenadas.filter((m) =>
      [m.codigo, m.color, m.talle, m.ubicacion].some((v) => String(v ?? '').toUpperCase().includes(q)),
    )
  }, [ordenadas, busqueda])

  // Agrupa tramos consecutivos con la misma ubicación (respeta el recorrido)
  const grupos = useMemo(() => {
    const out: { ubicacion: string | null; items: typeof visibles }[] = []
    for (const m of visibles) {
      const ult = out[out.length - 1]
      if (ult && ult.ubicacion === m.ubicacion) ult.items.push(m)
      else out.push({ ubicacion: m.ubicacion, items: [m] })
    }
    return out
  }, [visibles])

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
    const datos = ordenadas.map((m) => ({
      Posición: m.pos,
      Ubicación: m.ubicacion ?? '',
      Artículo: m.codigo,
      Color: m.color ?? '',
      Talle: m.talle ?? '',
      Escaneado: new Date(m.escaneado_at).toLocaleString('es-AR'),
    }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(datos), 'Mapeo')
    XLSX.writeFile(wb, `mapeo_deposito_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  return (
    <Layout>
      <BackButton />
      <header className="mb-3 mt-2">
        <h1 className="font-display text-2xl font-semibold text-ink">Orden mapeado</h1>
        <p className="text-sm text-sub">{filas.length} artículos en el recorrido del depósito.</p>
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
            disabled={ordenadas.length === 0}
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
          <div className="space-y-3">
            {grupos.map((g) => (
              <div key={`${g.items[0].id}`} className="overflow-hidden rounded-2xl border border-line bg-surface">
                <div className="flex items-center justify-between border-b border-line px-4 py-2">
                  <span className="flex items-center gap-1.5 font-display text-sm font-semibold text-ink">
                    <MapPin size={14} aria-hidden className="text-amber-500" />
                    {g.ubicacion ?? <span className="font-normal text-sub">Sin ubicación</span>}
                  </span>
                  <span className="text-xs tabular-nums text-sub">
                    #{g.items[0].pos}{g.items.length > 1 ? `–${g.items[g.items.length - 1].pos}` : ''}
                  </span>
                </div>
                <ul className="divide-y divide-line/60">
                  {g.items.map((m) => (
                    <li key={m.id} className="flex items-center gap-3 px-4 py-2">
                      <span className="w-10 shrink-0 text-right font-mono text-sm font-semibold tabular-nums text-sub">{m.pos}</span>
                      <span className="min-w-0 flex-1">
                        <Etiquetas m={m} chico />
                      </span>
                      {puedeBorrar && (
                        <button
                          onClick={() => setBorrar(m)}
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sub transition hover:bg-brand-600/10 hover:text-brand-400"
                          title="Quitar del mapeo"
                          aria-label={`Quitar ${m.codigo} del mapeo`}
                        >
                          <Trash2 size={16} aria-hidden />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        <ConfirmDialog
          open={!!borrar}
          title="¿Quitar del mapeo?"
          message={borrar ? `${borrar.codigo} sale del orden. Si lo volvés a escanear, entra al final.` : ''}
          confirmLabel="Quitar"
          busy={borrando}
          onCancel={() => setBorrar(null)}
          onConfirm={() => void confirmarBorrar()}
        />
      </div>
    </Layout>
  )
}
