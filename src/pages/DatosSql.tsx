import { useCallback, useEffect, useMemo, useState } from 'react'
import { Database, Loader2, RefreshCw, Search } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { cargarVistas, leerVista, type FilaSql, type VistaDef } from '@/lib/sqlApi'

const MAX_FILAS_UI = 300

function celda(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return v.replace('T', ' ').slice(0, 19)
  return String(v)
}

export default function DatosSql() {
  const [vistas, setVistas] = useState<VistaDef[] | null>(null)
  const [vista, setVista] = useState('')
  const [filas, setFilas] = useState<FilaSql[]>([])
  const [busqueda, setBusqueda] = useState('')
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let activo = true
    void cargarVistas().then((vs) => {
      if (!activo) return
      setVistas(vs)
      setVista(vs[0]?.vista ?? '')
    })
    return () => {
      activo = false
    }
  }, [])

  const cargar = useCallback(async (v: string) => {
    if (!v) return
    setCargando(true)
    setError(null)
    setFilas([])
    try {
      setFilas(await leerVista(v))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error desconocido.')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    if (vista) void cargar(vista)
  }, [vista, cargar])

  const columnas = useMemo(() => {
    const cols: string[] = []
    for (const f of filas.slice(0, 20)) {
      for (const k of Object.keys(f)) if (!cols.includes(k)) cols.push(k)
    }
    return cols
  }, [filas])

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    const filtradas = q
      ? filas.filter((f) => Object.values(f).some((val) => String(val ?? '').toLowerCase().includes(q)))
      : filas
    return filtradas.slice(0, MAX_FILAS_UI)
  }, [filas, busqueda])

  if (vistas === null) {
    return (
      <Layout>
        <BackButton />
        <div className="flex items-center justify-center gap-2 py-20 text-sub">
          <Loader2 size={18} className="animate-spin" aria-hidden /> Cargando…
        </div>
      </Layout>
    )
  }

  if (vistas.length === 0) {
    return (
      <Layout>
        <BackButton />
        <header className="mb-5 mt-2">
          <h1 className="font-display text-2xl font-semibold text-ink">Datos SQL</h1>
        </header>
        <div className="rounded-2xl border border-dashed border-line2 bg-surface/50 p-8 text-center">
          <Database size={28} className="mx-auto mb-3 text-sub/50" aria-hidden />
          <p className="text-sm text-sub">
            No hay vistas habilitadas. Agregalas desde{' '}
            <strong className="text-ink">Configuraciones &rarr; Conexión SQL</strong>.
          </p>
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <BackButton />
      <header className="mb-5 mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">Datos SQL</h1>
          <p className="mt-1 text-sm text-sub">Consulta en vivo de vistas del SQL Server.</p>
        </div>
        <button
          onClick={() => void cargar(vista)}
          disabled={cargando || !vista}
          className="btn-press inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-surface2 disabled:opacity-50"
        >
          <RefreshCw size={14} className={cargando ? 'animate-spin' : ''} aria-hidden /> Actualizar
        </button>
      </header>

      {error && (
        <p role="alert" className="mb-4 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">
          {error}
        </p>
      )}

      <div className="mb-3 flex flex-wrap gap-1.5">
        {vistas.map((v) => (
          <button
            key={v.vista}
            onClick={() => setVista(v.vista)}
            aria-pressed={vista === v.vista}
            className={
              vista === v.vista
                ? 'btn-press rounded-full border border-brand-600 bg-brand-600 px-3 py-1.5 text-sm font-medium text-white'
                : 'btn-press rounded-full border border-line bg-surface px-3 py-1.5 text-sm font-medium text-sub hover:bg-surface2 hover:text-ink'
            }
          >
            {v.label}
          </button>
        ))}
      </div>

      <label className="mb-3 block">
        <span className="sr-only">Buscar</span>
        <div className="relative">
          <Search size={15} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub/60" />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar en los resultados…"
            className="w-full rounded-xl border border-line bg-surface py-2 pl-9 pr-3 text-sm text-ink outline-none placeholder:text-sub/50 focus-visible:ring-2 focus-visible:ring-brand-500/40"
          />
        </div>
      </label>

      {cargando ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sub">
          <Loader2 size={18} className="animate-spin" aria-hidden /> Consultando…
        </div>
      ) : filas.length === 0 ? (
        !error && (
          <p className="rounded-2xl border border-line bg-surface p-4 text-sm text-sub">La vista no devolvió filas.</p>
        )
      ) : visibles.length === 0 ? (
        <p className="rounded-2xl border border-line bg-surface p-4 text-sm text-sub">Ningún resultado coincide con la búsqueda.</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-soft">
            <table className="w-full text-left text-xs">
              <thead>
                <tr>
                  {columnas.map((c) => (
                    <th key={c} scope="col" className="whitespace-nowrap border-b border-line bg-surface2 px-3 py-2 font-semibold text-sub">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibles.map((f, i) => (
                  <tr key={i} className="odd:bg-surface even:bg-surface2/40">
                    {columnas.map((c) => (
                      <td key={c} className="max-w-[280px] truncate whitespace-nowrap px-3 py-1.5 text-ink" title={celda(f[c])}>
                        {celda(f[c])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-right text-xs text-sub/70">
            Mostrando {visibles.length} de {filas.length} filas{filas.length > MAX_FILAS_UI ? ` (primeras ${MAX_FILAS_UI})` : ''}
          </p>
        </>
      )}
    </Layout>
  )
}
